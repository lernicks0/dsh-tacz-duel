export const profiles = {
  easy: { reactionMs: 700, turnRate: 2, aimErrorDegrees: 3, preferredRange: 12, burstMs: 250, restMs: 500, strafe: false },
  normal: { reactionMs: 350, turnRate: 4, aimErrorDegrees: 1.4, preferredRange: 14, burstMs: 400, restMs: 250, strafe: true },
  hard: { reactionMs: 180, turnRate: 7, aimErrorDegrees: 0.5, preferredRange: 16, burstMs: 500, restMs: 120, strafe: true }
};
const limits = { reactionMs: [100, 2000], turnRate: [0.25, 12], aimErrorDegrees: [0, 8], preferredRange: [4, 40], burstMs: [100, 1500], restMs: [50, 2000] };
export function validatePolicy(policy = {}) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('Policy must be an object');
  for (const [key, value] of Object.entries(policy)) {
    if (key === 'strafe') { if (typeof value !== 'boolean') throw new Error('strafe must be boolean'); continue; }
    const limit = limits[key];
    if (!limit || typeof value !== 'number' || !Number.isFinite(value) || value < limit[0] || value > limit[1]) throw new Error(`Invalid policy field: ${key}`);
  }
  return policy;
}
export function aimAngles(eye, point) {
  const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z;
  return { yaw: Math.atan2(-dx, dz) * 180 / Math.PI, pitch: -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI };
}
export function nominalWeapon(record) {
  const d = record.data ?? {};
  const id = value => typeof value === 'string' ? value : value?.namespace && value?.path ? `${value.namespace}:${value.path}` : null;
  return { gunId: record.gunId, name: record.name ?? record.gunId, type: record.type ?? null, ammoId: id(d.ammo),
    magazineBase: d.ammo_amount ?? null, rpmBase: d.rpm ?? null,
    nominalCycleMs: typeof d.rpm === 'number' && d.rpm > 0 ? Math.round(60000 / d.rpm) : null,
    bolt: d.bolt ?? null, fireModes: d.fire_mode ?? [], aimTimeBase: d.aim_time ?? null,
    damageBase: d.bullet?.damage ?? null, projectilesPerShot: d.bullet?.bullet_amount ?? null,
    reload: d.reload ?? null, inaccuracy: d.inaccuracy ?? null, recoil: d.recoil ?? null,
    supportsDuelRunner: !d.charging || Object.keys(d.charging).length === 0 };
}
export class DuelBrain {
  constructor(policy = profiles.normal, random = Math.random) {
    this.policy = { ...profiles.normal, ...validatePolicy(policy) };
    this.random = random;
    this.firstVisibleAt = null;
    this.lastSeenAt = null;
    this.lastPoint = null;
    this.noAmmoSince = null;
    this.reloadStalledSince = null;
    this.nextReloadAt = 0;
    this.nextErrorAt = 0;
    this.error = { yaw: 0, pitch: 0 };
  }
  decide(observation, now) {
    const p = this.policy;
    const frame = { yaw: observation.yaw ?? 0, pitch: observation.pitch ?? 0, turnRate: p.turnRate, leaseMs: 600,
      forward: false, back: false, left: false, right: false, sneak: false, aim: false, shoot: false };
    if (observation.state !== 'ready' || !observation.armed || observation.menuOpen) return { stop: observation.stopReason || observation.state, frame };
    const gun = observation.gun;
    if (!gun) return { stop: 'No TACZ gun held; choose an equipped hotbar gun', frame };
    if (gun.data?.charging && Object.keys(gun.data.charging).length) return { stop: 'Charging gun requires a separate control policy; equip a conventional TACZ gun', frame };
    const reserve = gun.hasReserveAmmo === true || gun.ammoSupply?.usable === true;
    const directSupply = gun.hasInventoryAmmo === true;
    const target = observation.visibleOpponent;
    if (target?.dead) return { stop: 'Observed opponent death', frame };
    if (target) {
      if (this.firstVisibleAt === null) this.firstVisibleAt = now;
      this.lastSeenAt = now;
      this.lastPoint = { ...target.aimPoint };
      if (now >= this.nextErrorAt) {
        this.error = { yaw: (this.random() * 2 - 1) * p.aimErrorDegrees, pitch: (this.random() * 2 - 1) * p.aimErrorDegrees };
        this.nextErrorAt = now + 600;
      }
      const angles = aimAngles(observation.eye, target.aimPoint);
      frame.yaw = angles.yaw + this.error.yaw;
      frame.pitch = Math.max(-89, Math.min(89, angles.pitch + this.error.pitch));
      frame.aim = true;
      frame.forward = target.distance > p.preferredRange * 1.3 && observation.health > 6;
      frame.back = target.distance < p.preferredRange * 0.75 || observation.health <= 6 || gun.reloading;
      frame.left = p.strafe && Math.floor(now / 1600) % 2 === 0;
      frame.right = p.strafe && !frame.left;
      const burst = now % (p.burstMs + p.restMs) < p.burstMs;
      frame.shoot = now - this.firstVisibleAt >= p.reactionMs && !gun.reloading && !gun.drawing && !gun.bolting && (gun.inventoryAmmo ? directSupply : gun.ammo > 0 || gun.chambered) && burst;
    } else {
      this.firstVisibleAt = null;
      // Keep only the last actually visible position; never consume hidden coordinates.
      if (this.lastPoint && now - this.lastSeenAt < 2000) {
        const angles = aimAngles(observation.eye, this.lastPoint);
        frame.yaw = angles.yaw;
        frame.pitch = angles.pitch;
      } else {
        frame.yaw = (observation.yaw ?? 0) + 25;
        frame.pitch = 0;
      }
    }
    const empty = gun.inventoryAmmo ? !directSupply : gun.ammo <= 0 && !gun.chambered;
    const magazine = gun.magazineCapacity ?? gun.data?.ammo_amount;
    const low = typeof magazine === 'number' && gun.ammo < Math.max(1, Math.floor(magazine * 0.25));
    if (empty && !(gun.inventoryAmmo ? directSupply : reserve) && !gun.reloading && !gun.bolting && !gun.drawing) {
      this.noAmmoSince ??= now;
      if (now - this.noAmmoSince > 2000) return { stop: 'No usable ammunition or reserve ammo', frame: { ...frame, shoot: false } };
    } else this.noAmmoSince = null;
    if (empty && reserve && !gun.inventoryAmmo && !gun.reloading && !gun.drawing && !gun.bolting) {
      this.reloadStalledSince ??= now;
      if (now - this.reloadStalledSince > 15000) return { stop: 'Reserve ammunition exists, but reload did not fill the gun. Check TACZ reload locks or gun-pack scripts', frame: { ...frame, shoot: false } };
    } else this.reloadStalledSince = null;
    let reload = false;
    if (!gun.inventoryAmmo && !gun.reloading && !gun.bolting && !gun.drawing && gun.canReload && (empty || !target && low) && now >= this.nextReloadAt) {
      reload = true;
      this.nextReloadAt = now + 1500;
      frame.shoot = false;
      frame.sneak = true;
      if (target) frame.back = true;
    }
    return { frame, reload, bolt: observation.lastShotResult === 'NEED_BOLT' && !gun.bolting && !gun.reloading };
  }
}
