import test from 'node:test';
import assert from 'node:assert/strict';
import { DuelBrain, profiles, aimAngles, nominalWeapon, validatePolicy } from '../minecraft-tacz-duel/scripts/duel-core.mjs';

const observation = () => ({ state: 'ready', armed: true, menuOpen: false, health: 20, yaw: 0, pitch: 0,
  eye: { x: 0, y: 65.6, z: 0 }, gun: { ammo: 30, chambered: true, canReload: true, hasReserveAmmo: true, reloading: false, drawing: false, bolting: false, data: { ammo_amount: 30 } },
  visibleOpponent: { aimPoint: { x: 0, y: 65.1, z: 12 }, distance: 12, dead: false } });

test('Minecraft angle convention points forward and upwards correctly', () => {
  assert.equal(aimAngles({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }).yaw, -0);
  assert.equal(aimAngles({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }).yaw, -90);
  assert.ok(aimAngles({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }).pitch < 0);
});
test('reaction time prevents immediate fire on a newly visible opponent', () => {
  const brain = new DuelBrain(profiles.normal, () => 0.5);
  const state = observation();
  assert.equal(brain.decide(state, 0).frame.shoot, false);
  assert.equal(brain.decide(state, 350).frame.shoot, true);
});
test('losing line of sight stops shooting and retains only the old visible point', () => {
  const brain = new DuelBrain(profiles.normal, () => 0.5);
  brain.decide(observation(), 0);
  const state = observation(); state.visibleOpponent = null;
  assert.equal(brain.decide(state, 500).frame.shoot, false);
  assert.equal(brain.lastPoint.z, 12);
  assert.equal(brain.decide(state, 3000).frame.yaw, 25);
});
test('empty magazine requests a bounded reload and suppresses firing', () => {
  const brain = new DuelBrain();
  const state = observation(); state.gun.ammo = 0; state.gun.chambered = false;
  const decision = brain.decide(state, 1000);
  assert.equal(decision.reload, true);
  assert.equal(decision.frame.shoot, false);
  assert.equal(brain.decide(state, 1200).reload, false);
});
test('no reserve ammo ends the duel instead of endlessly reloading', () => {
  const brain = new DuelBrain();
  const state = observation(); state.gun.ammo = 0; state.gun.chambered = false; state.gun.canReload = false; state.gun.hasReserveAmmo = false;
  assert.equal(brain.decide(state, 0).stop, undefined);
  assert.match(brain.decide(state, 2500).stop, /ammunition/);
});
test('inventory-ammo weapons still stop when their actual reserve is empty', () => {
  const brain = new DuelBrain();
  const state = observation(); state.gun.inventoryAmmo = true; state.gun.ammo = 0; state.gun.chambered = false; state.gun.canReload = false;
  assert.equal(brain.decide(state, 0).frame.shoot, false);
  assert.match(brain.decide(state, 2500).stop, /ammunition/);
});
test('dead, menu and unarmed states never produce a firing intent', () => {
  for (const patch of [{ state: 'dead' }, { menuOpen: true }, { armed: false }]) {
    const state = { ...observation(), ...patch };
    const decision = new DuelBrain().decide(state, 1000);
    assert.ok(decision.stop); assert.equal(decision.frame.shoot, false);
  }
});
test('weapon-specific base data is learned without inventing a reload time', () => {
  const record = nominalWeapon({ gunId: 'test:rifle', data: { ammo: { namespace: 'test', path: 'ammo' }, rpm: 600, ammo_amount: 20, bullet: { damage: 7 } } });
  assert.equal(record.ammoId, 'test:ammo');
  assert.equal(record.nominalCycleMs, 100);
  assert.equal(record.reload, null);
  assert.equal(record.supportsDuelRunner, true);
});
test('charging weapons are rejected by the ordinary duel policy', () => {
  const state = observation(); state.gun.data.charging = { SEMI: { type: 'HOLD' } };
  assert.match(new DuelBrain().decide(state, 1000).stop, /Charging/);
  assert.equal(nominalWeapon({ gunId: 'test:charge', data: state.gun.data }).supportsDuelRunner, false);
});
test('strategy rejects unknown fields, excessive turn rate and malformed strafe', () => {
  assert.throws(() => validatePolicy({ wallhack: true }));
  assert.throws(() => validatePolicy({ turnRate: 180 }));
  assert.throws(() => validatePolicy({ strafe: 'yes' }));
  assert.deepEqual(validatePolicy({ preferredRange: 20 }), { preferredRange: 20 });
});
test('low health triggers local retreat without enabling sprint shooting', () => {
  const state = observation(); state.health = 5;
  const result = new DuelBrain().decide(state, 0);
  assert.equal(result.frame.back, true);
  assert.equal(result.frame.forward, false);
  assert.equal(Object.hasOwn(result.frame, 'sprint'), false);
});
