import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DuelBrain, profiles, validatePolicy, nominalWeapon } from './duel-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const action = args.shift() ?? 'help';
const options = {};
try {
  while (args.length) {
    const key = args.shift();
    if (!['--session', '--runtime', '--opponent', '--seconds', '--difficulty', '--file', '--json', '--config'].includes(key) || !args.length || Object.hasOwn(options, key)) throw new Error(`Invalid option: ${key}`);
    options[key] = args.shift();
  }
} catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exit(1); }
const runtime = path.resolve(options['--runtime'] ?? path.join(root, '.runtime'));
const sessionPath = options['--session'] ? path.resolve(options['--session']) : null;
const session = async () => {
  if (!sessionPath) throw new Error('--session must point to the BOT game instance config/dsh-tacz-bridge/session.json');
  const s = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
  if (s.bridge !== 'dsh-tacz-bridge' || typeof s.token !== 'string' || !Number.isInteger(s.port) || s.port < 1 || s.port > 65535) throw new Error('Invalid TACZ bridge session file');
  return s;
};
async function call(command, params = {}) {
  const s = await session();
  const response = await fetch(`http://127.0.0.1:${s.port}/call`, { method: 'POST',
    headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: command, args: params }), signal: AbortSignal.timeout(4000) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function writeJsonAtomic(destination, data) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2));
  await fs.rename(temporary, destination);
}
async function readParams() {
  if (options['--file'] && options['--json']) throw new Error('Choose --file or --json');
  return JSON.parse(options['--file'] ? await fs.readFile(path.resolve(options['--file']), 'utf8') : options['--json'] ?? '{}');
}
async function learn() {
  await fs.mkdir(path.join(runtime, 'learning'), { recursive: true });
  const observation = await call('observe');
  const records = await call('catalog');
  const weapons = records.map(nominalWeapon);
  const payload = { learnedAt: new Date().toISOString(), minecraft: observation.minecraft, tacz: observation.tacz,
    note: 'These are loaded gun-pack base values. Attachments, scripts and server rules can change live behavior.', weapons, rawCatalog: records };
  const catalogPath = path.join(runtime, 'learning', 'weapons.json');
  await fs.writeFile(catalogPath, JSON.stringify(payload, null, 2));
  const rows = weapons.map(w => `| ${w.gunId} | ${String(w.name).replaceAll('|', '/')} | ${w.ammoId ?? '?'} | ${w.magazineBase ?? '?'} | ${w.rpmBase ?? '?'} | ${w.fireModes.join(',')} |`);
  await fs.writeFile(path.join(runtime, 'learning', 'weapons.md'), `# Loaded TACZ weapons\n\nBase gun-pack data; verify equipped weapon and attachments in game.\n\n| ID | Name | Ammo | Magazine | RPM | Modes |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
  return { catalogPath, weaponCount: weapons.length, weapons: weapons.map(({ gunId, name, type, supportsDuelRunner }) => ({ gunId, name, type, supportsDuelRunner })) };
}
async function startDuel() {
  const opponent = options['--opponent'];
  if (!opponent || !/^[A-Za-z0-9_]{1,16}$/.test(opponent)) throw new Error('--opponent requires your exact Minecraft nickname');
  const seconds = Number(options['--seconds'] ?? 180);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600) throw new Error('--seconds must be 10..600');
  const difficulty = options['--difficulty'] ?? 'normal';
  if (!Object.hasOwn(profiles, difficulty)) throw new Error('difficulty must be easy, normal or hard');
  await fs.mkdir(runtime, { recursive: true });
  const current = await call('observe');
  if (current.armed) throw new Error('A duel is already armed; stop it before starting another');
  if (current.state !== 'ready' || current.menuOpen || !current.gun) throw new Error('Bot must be alive, outside menus, and holding a TACZ gun');
  const lockPath = path.join(runtime, 'runner.lock');
  const lock = await fs.open(lockPath, 'wx').catch(() => { throw new Error('Runner lock exists; inspect runner-status and clean a stale lock only after its process is gone'); });
  try {
    const config = { opponent, seconds, difficulty, sessionPath, runtime };
    const configFile = path.join(runtime, 'runner-config.json');
    await fs.writeFile(configFile, JSON.stringify(config));
    await writeJsonAtomic(path.join(runtime, 'policy.json'), profiles[difficulty]);
    const logPath = path.join(runtime, 'duel.log');
    const log = await fs.open(logPath, 'a');
    const child = spawn(process.execPath, [path.join(root, 'scripts/tacz.mjs'), 'run-duel', '--config', configFile], {
      detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], cwd: root });
    let spawnError;
    child.on('error', error => { spawnError = error; });
    child.unref(); await log.close();
    await lock.writeFile(JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
    await lock.close();
    const statusPath = path.join(runtime, 'status.json');
    for (let i = 0; i < 30; i++) {
      if (spawnError) throw spawnError;
      let status;
      try { status = JSON.parse(await fs.readFile(statusPath, 'utf8')); } catch {}
      if (status?.pid === child.pid) {
        if (!status.running) throw new Error(`Controller ended during startup: ${status.reason}`);
        return { started: true, pid: child.pid, logPath, statusPath, opponent, seconds, difficulty };
      }
      await delay(200);
    }
    await call('stop').catch(() => {});
    throw new Error(`Controller startup not confirmed; inspect ${logPath}`);
  } catch (error) { await fs.unlink(lockPath).catch(() => {}); throw error; }
  finally { await lock.close(); }
}
async function runDuel() {
  const config = JSON.parse(await fs.readFile(path.resolve(options['--config']), 'utf8'));
  // run-duel is internal; paths are loaded from its generated configuration.
  const actualRuntime = path.resolve(config.runtime);
  const oldSession = sessionPath;
  if (oldSession) throw new Error('Internal run-duel uses only --config');
  const s = JSON.parse(await fs.readFile(config.sessionPath, 'utf8'));
  const invoke = async (command, params = {}) => {
    const response = await fetch(`http://127.0.0.1:${s.port}/call`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: command, args: params }), signal: AbortSignal.timeout(4000) });
    const value = await response.json();
    if (!response.ok || !value.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
    return value.value;
  };
  const brain = new DuelBrain(profiles[config.difficulty]);
  const start = Date.now();
  const statusPath = path.join(actualRuntime, 'status.json');
  let previousHealth;
  let damageTaken = 0;
  let reason = 'Duration reached';
  let latest;
  let interrupted = false;
  process.on('SIGINT', () => { interrupted = true; });
  process.on('SIGTERM', () => { interrupted = true; });
  try {
    latest = await invoke('arm', { opponent: config.opponent, seconds: config.seconds });
    while (!interrupted && Date.now() - start < config.seconds * 1000) {
      latest = await invoke('observe');
      try { brain.policy = { ...profiles[config.difficulty], ...validatePolicy(JSON.parse(await fs.readFile(path.join(actualRuntime, 'policy.json'), 'utf8'))) }; }
      catch (error) { throw new Error(`Invalid policy file: ${error.message}`); }
      if (previousHealth !== undefined && latest.health < previousHealth) damageTaken += previousHealth - latest.health;
      previousHealth = latest.health;
      const decision = brain.decide(latest, Date.now());
      if (decision.stop) { reason = decision.stop; break; }
      await invoke('frame', decision.frame);
      if (decision.reload) await invoke('reload');
      else if (decision.bolt) await invoke('bolt');
      await writeJsonAtomic(statusPath, { running: true, pid: process.pid, opponent: config.opponent, secondsElapsed: Math.floor((Date.now() - start) / 1000), observation: latest });
      await delay(200);
    }
    if (interrupted) reason = 'Runner interrupted';
  } catch (error) { reason = error.message; }
  finally {
    try { latest = await invoke('stop'); } catch {}
    const record = { time: new Date().toISOString(), opponent: config.opponent, difficulty: config.difficulty, secondsElapsed: (Date.now() - start) / 1000,
      gunId: latest?.gun?.gunId, shotsAccepted: latest?.shotsAccepted ?? 0, damageTaken, opponentDeathsObserved: latest?.opponentDeathsObserved ?? 0, reason };
    await fs.mkdir(path.join(actualRuntime, 'learning'), { recursive: true });
    await fs.appendFile(path.join(actualRuntime, 'learning', 'experience.jsonl'), JSON.stringify(record) + '\n');
    await writeJsonAtomic(statusPath, { running: false, pid: process.pid, ...record });
    await fs.unlink(path.join(actualRuntime, 'runner.lock')).catch(() => {});
    console.log(JSON.stringify(record));
  }
  return { completed: true, reason };
}
async function main() {
  if (action === 'help') return { usage: 'node tacz.mjs ACTION --session BOT_INSTANCE/config/dsh-tacz-bridge/session.json [options]',
    actions: ['observe', 'catalog', 'learn', 'duel-start', 'runner-status', 'policy', 'stop', 'slot', 'reload', 'bolt', 'fire-select'],
    duelOptions: '--opponent NICKNAME --seconds 180 --difficulty easy|normal|hard', requires: 'Node.js 22+, independent Forge 1.20.1 client with TACZ 1.1.8-hotfix and the bundled bridge mod' };
  if (action === 'run-duel') return runDuel();
  if (action === 'duel-start') return startDuel();
  if (action === 'learn') return learn();
  if (action === 'runner-status') return JSON.parse(await fs.readFile(path.join(runtime, 'status.json'), 'utf8'));
  if (action === 'policy') {
    const policy = validatePolicy(await readParams());
    const current = JSON.parse(await fs.readFile(path.join(runtime, 'policy.json'), 'utf8'));
    await writeJsonAtomic(path.join(runtime, 'policy.json'), { ...current, ...policy });
    return { updated: true, policy: { ...current, ...policy } };
  }
  return call(action, await readParams());
}
try { console.log(JSON.stringify({ ok: true, value: await main() }, null, 2)); }
catch (error) { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exitCode = 1; }
