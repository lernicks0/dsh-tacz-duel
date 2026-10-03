import fs from 'node:fs/promises';
import path from 'node:path';

export async function readSession(file) {
  const s = JSON.parse(await fs.readFile(file, 'utf8'));
  if (s.bridge !== 'dsh-tacz-bridge' || typeof s.token !== 'string' || !Number.isInteger(s.port) || s.port < 1 || s.port > 65535)
    throw new Error('Invalid TACZ bridge session file');
  return s;
}
export async function invoke(s, action, args = {}) {
  const expectedUsername = s.expectedUsername;
  if (!['observe', 'catalog'].includes(action) && !expectedUsername)
    throw new Error('Missing bot identity. Run connect --instance GAME_DIR --bot BOT_NICK first');
  const response = await fetch(`http://127.0.0.1:${s.port}/call`, {
    method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, args: { ...args, ...(expectedUsername ? { expectedUsername } : {}) } }),
    signal: AbortSignal.timeout(4000)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  if (expectedUsername && data.value?.username && data.value.username.toLowerCase() !== expectedUsername.toLowerCase())
    throw new Error('Client identity changed. Reconnect to the bot before continuing');
  return data.value;
}
export function requireAmmoSchema(observation) {
  if (observation.ammoSchema !== 2)
    throw new Error('Old bridge cannot reliably detect infinite ammo boxes. Install bridge 0.1.1 or newer, restart the bot client, then reconnect');
}
export async function connect(instance, bot, runtime) {
  if (!instance || !bot || !/^[A-Za-z0-9_]{1,16}$/.test(bot)) throw new Error('connect requires --instance GAME_DIR --bot EXACT_NICK');
  const folder = path.join(path.resolve(instance), 'config', 'dsh-tacz-bridge');
  const entries = await fs.readdir(path.join(folder, 'sessions')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = entries.filter(name => /^\d+\.json$/.test(name)).map(name => path.join(folder, 'sessions', name));
  files.push(path.join(folder, 'session.json'));
  if (files.length > 65) throw new Error('Too many session files; remove obsolete sessions after checking their client processes');
  const seen = new Set(), matches = [];
  // Discovery only observes. It never controls a client based on a session filename.
  for (const file of files) {
    let s, observation;
    try {
      s = await readSession(file);
      const identity = `${s.port}:${s.token}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      observation = await invoke(s, 'observe');
    } catch { continue; }
    if (observation.username?.toLowerCase() === bot.toLowerCase()) matches.push({ s, observation });
  }
  if (matches.length !== 1) throw new Error(matches.length ? `Multiple live clients named ${bot}; close the duplicate before connecting` : `No reachable client named ${bot}. Check nickname, bridge installation and GAME_DIR; the client must be running`);
  const { s, observation } = matches[0];
  requireAmmoSchema(observation);
  await fs.mkdir(runtime, { recursive: true });
  const sessionPath = path.join(runtime, 'bot-session.json');
  await fs.writeFile(sessionPath, JSON.stringify({ ...s, expectedUsername: bot }, null, 2), { mode: 0o600 });
  return { connected: true, bot: observation.username, state: observation.state, version: observation.version, sessionPath,
    next: observation.state === 'ready' ? 'learn, prepare, check, then duel-start' : 'Join the same server and close menus, then learn and prepare' };
}
export function readiness(o) {
  requireAmmoSchema(o);
  const blockers = [];
  if (o.state !== 'ready') blockers.push(o.state === 'dead' ? 'Bot is dead: respawn in its client' : 'Bot must join the same server as the opponent');
  if (o.menuOpen) blockers.push('Close the bot inventory/chat/pause menu');
  if (o.armed) blockers.push('A duel is already armed: stop it before preparing or starting another');
  const gun = o.gun;
  if (!gun) blockers.push('Put a conventional TACZ gun in the bot hotbar, then run prepare');
  else {
    if (gun.data?.charging && Object.keys(gun.data.charging).length) blockers.push('Equip a conventional gun; charging guns need another controller');
    if (gun.drawing || gun.reloading || gun.bolting) blockers.push('Wait for the current draw/reload/bolt animation, then check again');
    const loaded = gun.inventoryAmmo ? gun.hasInventoryAmmo === true : gun.ammo > 0 || gun.chambered;
    if (!loaded) blockers.push(gun.canReload ? 'Gun is empty but has usable reserve: run prepare to reload' : 'No usable ammunition: put matching ammo or an infinite ammo box into the bot inventory');
  }
  const boxes = o.ammoBoxes ?? [];
  return { readyToStart: blockers.length === 0, bot: o.username, state: o.state, menuOpen: o.menuOpen,
    gunId: gun?.gunId ?? null, magazineAmmo: gun?.ammo ?? null, chambered: gun?.chambered ?? false,
    ammoSupply: gun?.ammoSupply ?? null, canReload: gun?.canReload ?? false, ammoBoxes: boxes, blockers };
}
