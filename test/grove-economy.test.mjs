import test from 'node:test';
import assert from 'node:assert/strict';
import { KOALAS, LANDS, newKoala, parseDecision, applyDecision, buildPrompt, groveClock, placesOf } from '../hq/grove-world.js';
import { RESOURCES, ISLANDS, COSTS, START_STOCK, bridged } from '../hq/grove-economy.js';

const world = () => ({ koalas: Object.fromEntries(KOALAS.map((k) => [k.id, newKoala(k.id)])), builds: [] });
const act = (w, id, raw) => applyDecision(w, id, parseDecision(raw, w.koalas[id], placesOf(w)));

test('five resources, and the spec\'s four resource islands', () => {
  assert.deepEqual(RESOURCES, ['wood', 'water', 'sand', 'stone', 'book']);
  assert.deepEqual(ISLANDS.map((i) => [i.id, i.resource]), [['spring_isle', 'water'], ['sandy_shoal', 'sand'], ['stone_crag', 'stone'], ['library_isle', 'book']]);
  assert.deepEqual(START_STOCK, { wood: 4 });
  assert.deepEqual(COSTS.hut, { wood: 4, sand: 2 });
  assert.deepEqual(COSTS.bridge, { wood: 4, stone: 2 });
});

test('resource islands sit off the edge, reachable by a short bridge, overlapping nothing', () => {
  for (const i of ISLANDS) {
    const d = Math.hypot(i.x, i.z);
    assert.ok(d - 24 >= 13 && d - 24 <= 15, `${i.id} centre ${d - 24} beyond the edge`);
    assert.ok(d - i.r - 24 < 9, `${i.id} bridge ${d - i.r - 24} long`);
  }
  const all = [...ISLANDS, ...LANDS];
  for (const a of all) for (const b of all) {
    if (a === b) continue;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r + 2, `${a.id} overlaps ${b.id}`);
  }
});

test('gather takes one unit where the place has it', () => {
  const w = world();
  w.koalas.crystal.place = 'pond';
  const log = act(w, 'crystal', { action: 'gather', target: 'water' });
  assert.deepEqual(w.koalas.crystal.res, { water: 1 });
  assert.ok(log.some((e) => /gathered water/.test(e.text)));
  act(w, 'crystal', { action: 'gather', target: 'sand' });
  assert.equal(w.koalas.crystal.activity, 'sit');
  assert.match(w.koalas.crystal.recent.join(' '), /no sand here/);
  assert.equal(parseDecision({ action: 'gather', target: 'gold' }, w.koalas.crystal).action, 'sit');
});

test('paws are shared by items and resources', () => {
  const w = world();
  const k = w.koalas.ruby; // a baby: strength 5 holds 2 things
  k.place = 'big_gum';
  k.inventory = ['pebble'];
  act(w, 'ruby', { action: 'gather', target: 'wood' });
  assert.deepEqual(k.res, { wood: 1 });
  act(w, 'ruby', { action: 'gather', target: 'wood' });
  assert.deepEqual(k.res, { wood: 1 });
  assert.match(k.recent.join(' '), /paws are full/);
});

test('store empties the paws into the stockpile, walking there first', () => {
  const w = world();
  const k = w.koalas.crystal;
  k.place = 'big_gum';
  k.res = { wood: 2, sand: 1 };
  act(w, 'crystal', { action: 'store' });
  assert.equal(k.place, 'stockpile');
  assert.deepEqual(w.stock, { wood: 6, sand: 1 });
  assert.deepEqual(k.res, {});
});

test('an unbridged island cannot be visited', () => {
  const w = world();
  const k = w.koalas.crystal;
  assert.equal(parseDecision({ action: 'move', target: 'sandy_shoal' }, k, placesOf(w)).action, 'sit');
  assert.equal(placesOf(w).sandy_shoal, undefined);
});

test('a bridge is built like anything else, costs its price, and opens its island', () => {
  const w = world();
  w.stock = { wood: 8, stone: 4 };
  let log = [];
  for (let i = 0; i < 4; i++) log = log.concat(act(w, 'crystal', { action: 'build', target: 'bridge_sandy_shoal' }));
  const b = w.builds[0];
  assert.equal(b.plot, null);
  assert.equal(b.done, true);
  assert.deepEqual(w.stock, { wood: 4, stone: 2 });
  assert.ok(bridged(w).has('sandy_shoal'));
  assert.equal(placesOf(w).sandy_shoal.resource, 'sand');
  assert.ok(log.some((e) => e.kind === 'built'));
  // Now it can be visited, and sand gathered there.
  assert.equal(parseDecision({ action: 'move', target: 'sandy_shoal' }, w.koalas.ruby, placesOf(w)).target, 'sandy_shoal');
  w.koalas.ruby.place = 'sandy_shoal';
  act(w, 'ruby', { action: 'gather', target: 'sand' });
  assert.deepEqual(w.koalas.ruby.res, { sand: 1 });
});

test('a build only starts when the stockpile can pay, and paying empties it', () => {
  const w = world();
  w.stock = { wood: 1 };
  act(w, 'crystal', { action: 'build', target: 'hut' });
  assert.equal(w.builds.length, 0);
  assert.equal(w.koalas.crystal.activity, 'sit');
  assert.match(w.koalas.crystal.recent.join(' '), /needs 3 more wood and 2 more sand/);
  assert.deepEqual(w.stock, { wood: 1 });
  w.stock = { wood: 4, sand: 2 };
  act(w, 'crystal', { action: 'build', target: 'hut' });
  assert.equal(w.builds.length, 1);
  assert.deepEqual(w.stock, {});
});

test('the prompt says what can be gathered here, the stockpile, and only builds it can pay for', () => {
  const w = world();
  w.stock = { wood: 2 };
  w.koalas.crystal.place = 'pond';
  w.koalas.crystal.res = { water: 1 };
  const p = buildPrompt(w, 'crystal', groveClock(0));
  assert.match(p, /Stockpile: 2 wood/);
  assert.match(p, /Here you can gather: water/);
  assert.match(p, /You carry: 1 water/);
  assert.match(p, /bench/);
  assert.doesNotMatch(p, /treehouse/);
  assert.match(p, /gather \(target: a resource/);
});

test('with nothing affordable, the prompt says how to get building again', () => {
  const w = world();
  w.stock = {};
  const p = buildPrompt(w, 'crystal', groveClock(0));
  assert.match(p, /To build anything, first gather resources and store them in the Stockpile/);
  w.stock = { wood: 9 };
  assert.doesNotMatch(buildPrompt(w, 'crystal', groveClock(0)), /To build anything, first gather/);
});

test('review: heading for an unbridged island, the koala sits and learns it needs a bridge', () => {
  const w = world();
  act(w, 'crystal', { action: 'move', target: 'sandy_shoal' });
  assert.equal(w.koalas.crystal.activity, 'sit');
  assert.match(w.koalas.crystal.recent.join(' '), /Sandy Shoal yet; it needs a bridge/);
});

test('the Library Isle is open from day one: bridged, a place, reachable, and its bridge is never offered', async () => {
  const { OPEN_ISLANDS, bridgeFoot, islandById } = await import('../hq/grove-economy.js');
  assert.deepEqual(OPEN_ISLANDS, ['library_isle']);
  const w = world();
  assert.ok(bridged(w).has('library_isle'));
  assert.ok(placesOf(w).library_isle);
  assert.ok(!bridged(w).has('sandy_shoal'));
  const k = w.koalas.crystal;
  const d = parseDecision({ action: 'move', target: 'library_isle' }, k, placesOf(w));
  assert.equal(d.action, 'move');
  assert.equal(d.target, 'library_isle');
  assert.equal(d.note ?? '', '');
  const foot = bridgeFoot(islandById('library_isle'));
  assert.ok(Math.abs(foot.x + 4.4) < 0.2 && Math.abs(foot.z - 21) < 0.2);
  w.stock = { wood: 20, stone: 20 };
  assert.doesNotMatch(buildPrompt(w, 'crystal', groveClock(0)), /bridge_library_isle/);
  assert.match(buildPrompt(w, 'crystal', groveClock(0)), /bridge_sandy_shoal/);
  const before = w.builds.length;
  act(w, 'crystal', { action: 'build', target: 'bridge_library_isle' });
  assert.equal(w.builds.length, before);
  assert.deepEqual(w.stock, { wood: 20, stone: 20 });
});
