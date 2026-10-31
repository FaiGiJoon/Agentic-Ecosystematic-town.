import test from 'node:test';
import assert from 'node:assert/strict';
import { spotFor, animFor, fmtUsd, fmtTokens, freshLog, statusOf, skyAt } from '../public/grove/js/view.js';
import { PLACES } from '../hq/grove-world.js';

test('koalas at the same place stand apart, and stand beside the pond, not in it', () => {
  const a = spotFor(PLACES, 'clearing', 'mallee', 'sit');
  const b = spotFor(PLACES, 'clearing', 'bramble', 'sit');
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1.2);
  const p = spotFor(PLACES, 'pond', 'mallee', 'sit');
  assert.ok(Math.hypot(p.x - PLACES.pond.x, p.z - PLACES.pond.z) > 4.5);
  assert.equal(p.y, 0);
});

test('climbing and eating put the koala up in the tree', () => {
  assert.ok(spotFor(PLACES, 'big_gum', 'mallee', 'climb').y > 2);
  assert.ok(spotFor(PLACES, 'big_gum', 'mallee', 'eat').y > 2);
  assert.equal(spotFor(PLACES, 'big_gum', 'mallee', 'sit').y, 0);
  assert.deepEqual(spotFor(PLACES, 'nowhere', 'mallee', 'sit'), { x: 0, z: 0, y: 0 });
});

test('animFor picks the animation from the activity and the place', () => {
  assert.equal(animFor({ activity: 'nap', place: 'hollow' }), 'sleep');
  assert.equal(animFor({ activity: 'eat', place: 'big_gum' }), 'eat');
  assert.equal(animFor({ activity: 'climb', place: 'big_gum' }), 'cling');
  assert.equal(animFor({ activity: 'play', place: 'swing' }), 'swing');
  assert.equal(animFor({ activity: 'play', place: 'pond' }), 'splash');
  assert.equal(animFor({ activity: 'play', place: 'clearing' }), 'ball');
  assert.equal(animFor({ activity: 'move', place: 'lookout' }), 'idle');
});

test('money and tokens read well at koala scale', () => {
  assert.equal(fmtUsd(0), '$0.00');
  assert.equal(fmtUsd(0.0042), '$0.0042');
  assert.equal(fmtUsd(0.1234), '$0.12');
  assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(12345), '12.3k');
  assert.equal(fmtTokens(2_500_000), '2.5M');
});

test('freshLog returns only entries newer than the last one seen', () => {
  const log = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(freshLog(log, 1).map((e) => e.id), [2, 3]);
  assert.deepEqual(freshLog(log, 3), []);
  assert.deepEqual(freshLog(undefined, 0), []);
});

test('statusOf explains why the koalas are or are not thinking', () => {
  const base = { playing: true, present: true, capped: false, koalas: [{ thinking: false }, { thinking: false }] };
  assert.equal(statusOf(base).key, 'live');
  assert.equal(statusOf({ ...base, koalas: [{ thinking: true }, {}] }).key, 'thinking');
  assert.equal(statusOf({ ...base, playing: false }).key, 'paused');
  assert.match(statusOf({ ...base, playing: false, pausedReason: 'Calls failed 3 times' }).text, /failed/);
  assert.equal(statusOf({ ...base, capped: true }).key, 'capped');
  assert.equal(statusOf(null).key, 'offline');
});

test('skyAt: bright at noon, dark at midnight, fireflies only at night', () => {
  const noon = skyAt(0.5);
  const midnight = skyAt(0);
  assert.ok(noon.sun > 0.8);
  assert.ok(midnight.sun < 0.2);
  assert.ok(midnight.night > 0.8);
  assert.equal(noon.night, 0);
  assert.equal(noon.top.length, 3);
});
