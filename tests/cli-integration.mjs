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
const gun = { gunId: 'test:rifle', ammo: 20, chambered: true, canReload: true, rpm: 600, fireMode: 'AUTO', data: { ammo_amount: 20, rpm: 600 } };
const state = { state: 'ready', minecraft: '1.20.1', tacz: '1.1.8-hotfix', armed: false, menuOpen: false, username: 'Bot', health: 20,
  yaw: 0, pitch: 0, eye: { x: 0, y: 65.6, z: 0 }, gun, visibleOpponent: { username: 'Human', aimPoint: { x: 0, y: 65, z: 12 }, distance: 12, dead: false }, shotsAccepted: 0 };
const server = http.createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer fixture-token');
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  let value = state;
  switch (request.action) {
    case 'arm': state.armed = true; state.opponent = request.args.opponent; break;
    case 'stop': state.armed = false; state.stopReason = 'User stop'; break;
    case 'frame': frames.push(request.args); if (request.args.shoot) state.shotsAccepted++; break;
    case 'catalog': value = [{ gunId: 'test:rifle', name: 'Fixture rifle', type: 'rifle', data: { ammo: 'test:ammo', ammo_amount: 20, rpm: 600 } }]; break;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, value }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const sessionFile = path.join(runtime, 'session.json');
await fs.writeFile(sessionFile, JSON.stringify({ bridge: 'dsh-tacz-bridge', port: server.address().port, token: 'fixture-token' }));
const cli = async (...args) => JSON.parse((await run(process.execPath, [path.join(root, 'scripts/tacz.mjs'), ...args, '--session', sessionFile, '--runtime', runtime], { timeout: 12000, windowsHide: true })).stdout).value;
let pid;
try {
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
  assert.equal(status.opponent, 'Human');
  assert.ok((await fs.readFile(path.join(runtime, 'learning/experience.jsonl'), 'utf8')).includes('test:rifle'));
  await assert.rejects(fs.access(path.join(runtime, 'runner.lock')));
  console.log('PASS: CLI learning export, confirmed background startup, live policy updates, bounded frames, explicit stop, experience record and lock cleanup against a simulated native bridge.');
} finally {
  if (pid) { try { process.kill(pid); } catch {} }
  await new Promise(resolve => server.close(resolve));
  await fs.rm(runtime, { recursive: true, force: true });
}
