import test from 'node:test';
import assert from 'node:assert/strict';
import { DuelBrain, profiles } from '../minecraft-tacz-duel/scripts/duel-core.mjs';
import { readiness } from '../minecraft-tacz-duel/scripts/bridge-client.mjs';
const state = gun => ({ ammoSchema: 2, username: 'deepseek', state: 'ready', armed: true, menuOpen: false, health: 20,
  eye: { x: 0, y: 1.6, z: 0 }, yaw: 0, pitch: 0, gun: { gunId: 'test:rifle', ammo: 0, chambered: false,
    data: { ammo_amount: 30 }, ...gun }, visibleOpponent: { aimPoint: { x: 0, y: 1, z: 12 }, distance: 12 } });
test('an infinite ammo box supplies reloads but cannot fire an empty ordinary gun', () => {
  const brain = new DuelBrain(profiles.normal, () => 0.5);
  const o = state({ canReload: true, hasReserveAmmo: true, ammoSupply: { infinite: true, source: 'infinite_box', usable: true } });
  assert.equal(brain.decide(o, 0).reload, true);
  const next = brain.decide(o, 3000);
  assert.equal(next.reload, true); assert.equal(next.frame.shoot, false); assert.equal(next.stop, undefined);
  o.gun.ammo = 30; o.gun.canReload = false;
  assert.equal(brain.decide(o, 3250).frame.shoot, true);
});
test('direct-feed guns fire from usable inventory without requesting reload', () => {
  const brain = new DuelBrain(profiles.normal, () => 0.5);
  const o = state({ inventoryAmmo: true, hasInventoryAmmo: true, hasReserveAmmo: true, canReload: false });
  brain.decide(o, 0);
  const next = brain.decide(o, 350);
  assert.equal(next.frame.shoot, true); assert.equal(next.reload, false); assert.equal(next.stop, undefined);
});
test('a mismatched infinite box does not count as usable reserve', () => {
  const brain = new DuelBrain();
  const o = state({ canReload: false, hasReserveAmmo: false, ammoSupply: { infinite: false, usable: false } });
  o.ammoBoxes = [{ infinite: true, matchesHeldGun: false, usableForHeldGun: false }];
  brain.decide(o, 0);
  assert.match(brain.decide(o, 2500).stop, /ammunition/);
  const check = readiness({ ...o, armed: false });
  assert.equal(check.readyToStart, false);
});
test('an ongoing long reload never triggers an ammunition exhaustion stop', () => {
  const brain = new DuelBrain();
  const o = state({ reloading: true, canReload: false, hasReserveAmmo: false });
  brain.decide(o, 0);
  assert.equal(brain.decide(o, 6000).stop, undefined);
  assert.equal(brain.decide(o, 6000).frame.shoot, false);
});
test('a stuck reload reports a reload problem instead of falsely denying infinite reserve', () => {
  const brain = new DuelBrain();
  const o = state({ canReload: false, hasReserveAmmo: true, ammoSupply: { infinite: true, usable: true } });
  brain.decide(o, 0);
  assert.match(brain.decide(o, 16000).stop, /reload did not fill/);
});
test('full magazine does not need reload permission to pass preparation', () => {
  const o = state({ ammo: 30, canReload: false, hasReserveAmmo: true, ammoSupply: { infinite: true, usable: true } });
  assert.equal(readiness({ ...o, armed: false }).readyToStart, true);
});
test('old bridge schema is rejected instead of guessing infinite ammo from canReload', () => {
  assert.throws(() => readiness({ ...state({}), ammoSchema: undefined }), /Old bridge/);
});
