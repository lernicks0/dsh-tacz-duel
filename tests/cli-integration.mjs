import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
const run = promisify(execFile);
const base = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(base, '../minecraft-tacz-duel');
const temporaryRoot = path.join(base, '.tmp');
await fs.mkdir(temporaryRoot, { recursive: true });
const runtime = await fs.mkdtemp(path.join(temporaryRoot, 'dsh-tacz-test-'));
const frames = [];
const gun = { gunId: 'test:rifle', ammo: 0, chambered: false, canReload: true, hasReserveAmmo: true,
  ammoSupply: { source: 'infinite_box', infinite: true, usable: true, reserveCount: null }, rpm: 600, fireMode: 'AUTO', data: { ammo_amount: 20, rpm: 600 } };
const state = { ammoSchema: 2, version: '0.1.1', state: 'ready', minecraft: '1.20.1', tacz: '1.1.8-hotfix', armed: false, menuOpen: false, username: 'Bot', health: 20,
  hotbar: [{ slot: 2, gunId: 'test:rifle', ammo: 0 }], ammoBoxes: [{ infinite: true, allTypes: true, matchesHeldGun: false }],
  yaw: 0, pitch: 0, eye: { x: 0, y: 65.6, z: 0 }, gun, visibleOpponent: { username: 'Human', aimPoint: { x: 0, y: 65, z: 12 }, distance: 12, dead: false }, shotsAccepted: 0 };
const server = http.createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer fixture-token');
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  if (!['observe', 'catalog'].includes(request.action)) assert.equal(request.args.expectedUsername, 'Bot');
  let value = state;
  switch (request.action) {
    case 'arm': state.armed = true; state.opponent = request.args.opponent; break;
    case 'stop': state.armed = false; state.stopReason = 'User stop'; break;
    case 'frame': frames.push(request.args); if (request.args.shoot) state.shotsAccepted++; break;
    case 'slot': assert.equal(state.armed, false); assert.equal(request.args.slot, 2); state.gun = gun; state.ammoBoxes[0].matchesHeldGun = true; break;
    case 'reload': assert.equal(state.armed, false); gun.reloading = true; setTimeout(() => {
      gun.ammo = 20; gun.chambered = true; gun.canReload = false; gun.reloading = false;
    }, 400); break;
    case 'catalog': value = [{ gunId: 'test:rifle', name: 'Fixture rifle', type: 'rifle', data: { ammo: 'test:ammo', ammo_amount: 20, rpm: 600 } }]; break;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, value }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const sessionFile = path.join(runtime, 'session.json');
const botSession = { bridge: 'dsh-tacz-bridge', port: server.address().port, token: 'fixture-token' };
await fs.writeFile(sessionFile, JSON.stringify({ ...botSession, expectedUsername: 'Bot' }));
let humanMutations = 0;
const human = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  if (!['observe', 'catalog'].includes(request.action)) humanMutations++;
  res.end(JSON.stringify({ ok: true, value: { ammoSchema: 2, username: 'Human', state: 'ready' } }));
});
human.listen(0, '127.0.0.1'); await once(human, 'listening');
const instance = path.join(runtime, 'instance');
const sessions = path.join(instance, 'config/dsh-tacz-bridge/sessions');
await fs.mkdir(sessions, { recursive: true });
const humanSession = { bridge: 'dsh-tacz-bridge', port: human.address().port, token: 'human-token' };
await fs.writeFile(path.join(sessions, '1.json'), JSON.stringify(botSession));
await fs.writeFile(path.join(sessions, '2.json'), JSON.stringify(humanSession));
await fs.writeFile(path.join(sessions, '../session.json'), JSON.stringify(humanSession));
const cli = async (...args) => JSON.parse((await run(process.execPath, [path.join(root, 'scripts/tacz.mjs'), ...args, '--runtime', runtime], { timeout: 18000, windowsHide: true })).stdout).value;
let pid;
try {
  const connected = await cli('connect', '--instance', instance, '--bot', 'Bot');
  assert.equal(connected.bot, 'Bot');
  assert.ok(!JSON.stringify(connected).includes('fixture-token'));
  state.gun = null;
  assert.equal((await cli('check')).readyToStart, false);
  const prepared = await cli('prepare');
  assert.equal(prepared.readyToStart, true);
  assert.equal(prepared.reloadRequested, true);
  assert.equal(prepared.ammoSupply.infinite, true);
  assert.equal(prepared.canReload, false);
  assert.equal(state.armed, false);
  // Shared legacy session can be overwritten; the pinned bot connection remains correct.
  await fs.writeFile(path.join(sessions, '../session.json'), JSON.stringify({ ...humanSession, port: 1 }));
  const learned = await cli('learn');
  assert.equal(learned.weaponCount, 1);
  const catalog = JSON.parse(await fs.readFile(learned.catalogPath, 'utf8'));
  assert.equal(catalog.weapons[0].nominalCycleMs, 100);
  const start = await cli('duel-start', '--opponent', 'Human', '--seconds', '10', '--difficulty', 'normal');
  assert.equal(start.started, true); pid = start.pid;
  assert.equal(state.armed, true);
  await cli('policy', '--json', JSON.stringify({ preferredRange: 5, reactionMs: 100 }));
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.ok(frames.some(frame => frame.forward === true));
  assert.ok(frames.every(frame => frame.leaseMs <= 600));
  await cli('stop');
  let status;
  for (let i = 0; i < 20; i++) {
    status = await cli('runner-status');
    if (!status.running) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(status.running, false);
  assert.equal(state.armed, false);
  assert.equal(humanMutations, 0);
  assert.equal(status.opponent, 'Human');
  assert.ok((await fs.readFile(path.join(runtime, 'learning/experience.jsonl'), 'utf8')).includes('test:rifle'));
  await assert.rejects(fs.access(path.join(runtime, 'runner.lock')));
  console.log('PASS: Two-client nickname discovery, pinned connection, unarmed equip/reload with infinite reserve, no human-client mutations, learning export, background runner, policy, stop and cleanup. Simulated native bridges only.');
} finally {
  if (pid) { try { process.kill(pid); } catch {} }
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => human.close(resolve));
  await fs.rm(runtime, { recursive: true, force: true });
}
