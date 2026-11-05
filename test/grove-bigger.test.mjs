// A world 20x bigger: the island's radius, the spread-out grove, the new places, plots and
// sources, and the islands that moved out with the edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KOALAS, PLACES, PLOTS, LANDS, newKoala, parseDecision, applyDecision, buildPrompt, groveClock, placesOf,
} from '../hq/grove-world.js';
import { ISLANDS, SOURCES, ISLAND_R, BRIDGE_IN, bridgeFoot } from '../hq/grove-economy.js';
import { ISLAND, makeTerrain, POND_R, POOL_R } from '../public/js/gfx/terrain-math.js';
import { glide, tripPace, bridgeEnds } from '../public/js/view.js';

const world = () => ({ koalas: Object.fromEntries(KOALAS.map((k) => [k.id, newKoala(k.id)])), builds: [] });
const NEW = ['eucalyptus_forest', 'ghost_gum', 'red_gum', 'sunrise_meadow', 'misty_hill', 'fern_gully', 'waterfall_pool', 'sandy_cove'];
// Where things stood before the island grew (radius 24).
const OLD = {
  big_gum: [-8, -6], river_gum: [9, -9], blue_gum: [-12, 8], pond: [10, 2], swing: [2, -12], clearing: [0, 2],
  hollow: [-15, -1], lookout: [14, 12], flowers: [-2, 13], stockpile: [2.6, 4.4],
};
const OLD_PLOTS = [[3.4, 10.3], [6.0, 16.8], [-4.8, 8.4], [-9.0, 14.0], [-2.9, -6.5], [-5.4, -14.1], [4.0, -7.2], [-8.9, 3.2]];
const OLD_ISLANDS = { spring_isle: [-30, -22], sandy_shoal: [38, -6], stone_crag: [24, -30], library_isle: [-8, 38], fern_islet: [0, -36], sunset_point: [34, 15], moss_isle: [-34, 17] };
const spread = ([x, z]) => ({ x: x * 2.5, z: 2 + (z - 2) * 2.5 }); // 2.5x about the clearing (0, 2)
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const main = PLOTS.filter((p) => !p.land);

test('the island is 20x the area, and the page and the server agree on its size', () => {
  assert.equal(ISLAND, ISLAND_R);
  assert.equal(ISLAND_R, 107);
  assert.ok(Math.abs((ISLAND_R / 24) ** 2 - 20) < 0.2, 'about 20x the area');
});

test('the old grove keeps its ids and is spread 2.5x about the clearing', () => {
  for (const [id, xz] of Object.entries(OLD)) {
    const want = spread(xz);
    assert.ok(PLACES[id], id);
    assert.ok(near(PLACES[id].x, want.x) && near(PLACES[id].z, want.z), `${id} at ${PLACES[id].x},${PLACES[id].z}`);
  }
  OLD_PLOTS.forEach((xz, i) => {
    const p = PLOTS.find((q) => q.id === `plot_${i + 1}`);
    const want = spread(xz);
    assert.ok(p && !p.land, `plot_${i + 1}`);
    assert.ok(near(p.x, want.x) && near(p.z, want.z), `plot_${i + 1} at ${p.x},${p.z}`);
  });
});

test('new places fill the new land: every direction has something, 35 to 95 m out', () => {
  for (const id of NEW) {
    const p = PLACES[id];
    assert.ok(p && p.name, id);
    const d = Math.hypot(p.x, p.z);
    assert.ok(d >= 35 && d <= 95, `${id} ${d.toFixed(1)} m from the centre`);
  }
  for (const id of ['eucalyptus_forest', 'ghost_gum', 'red_gum']) assert.equal(PLACES[id].tree, true, id);
  assert.equal(PLACES.waterfall_pool.pool, true);
  for (let a = -180; a < 180; a += 45) {
    const has = NEW.some((id) => {
      const g = (Math.atan2(PLACES[id].z, PLACES[id].x) * 180) / Math.PI;
      return g >= a && g < a + 45;
    });
    assert.ok(has, `something new between ${a} and ${a + 45} degrees`);
  }
});

test('about 40 build plots on the island, all on open ground clear of places, paths, water and each other', () => {
  assert.ok(main.length >= 36 && main.length <= 44, `${main.length} plots`);
  assert.equal(new Set(PLOTS.map((p) => p.id)).size, PLOTS.length, 'ids are unique');
  const T = makeTerrain(PLACES, { roads: [bridgeFoot(ISLANDS.find((i) => i.id === 'library_isle'))] });
  const feet = [...ISLANDS, ...LANDS].map((l) => bridgeEnds(l, ISLAND).island);
  for (const p of main) {
    assert.ok(Math.hypot(p.x, p.z) < ISLAND - 8, `${p.id} on the island`);
    assert.ok(Math.hypot(p.x - PLACES.pond.x, p.z - PLACES.pond.z) > POND_R + 4, `${p.id} clear of the pond`);
    const pool = PLACES.waterfall_pool;
    assert.ok(Math.hypot(p.x - pool.x, p.z - pool.z) > POOL_R + 6, `${p.id} clear of the pool`);
    for (const [id, q] of Object.entries(PLACES)) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) > (q.tree ? 6 : 4.5), `${p.id} near ${id}`);
    for (const o of main) if (o !== p) assert.ok(Math.hypot(p.x - o.x, p.z - o.z) > 4.5, `${p.id} near ${o.id}`);
    for (const f of feet) assert.ok(Math.hypot(p.x - f.x, p.z - f.z) > 6, `${p.id} near a bridge`);
    for (let a = 0; a < 8; a++) {
      const x = p.x + Math.cos(a) * 1.5;
      const z = p.z + Math.sin(a) * 1.5;
      assert.ok(T.pathMask(x, z) < 0.05, `${p.id} on a path`);
      assert.ok(T.sandMask(x, z) < 0.05, `${p.id} on the beach`);
    }
  }
  // the places themselves stand on the island, apart from each other
  const all = Object.entries(PLACES);
  for (const [id, p] of all) {
    assert.ok(Math.hypot(p.x, p.z) < ISLAND - 6, `${id} on the island`);
    for (const [jd, q] of all) if (id !== jd && id !== 'stockpile' && jd !== 'stockpile') assert.ok(Math.hypot(p.x - q.x, p.z - q.z) > 8, `${id} near ${jd}`);
  }
});

test('worn paths reach every new place, and the library road still reaches its bridge', () => {
  const foot = bridgeFoot(ISLANDS.find((i) => i.id === 'library_isle'));
  const T = makeTerrain(PLACES, { roads: [foot] });
  const c = PLACES.clearing;
  for (const id of NEW) {
    const p = PLACES[id];
    for (const t of [0.3, 0.6, 0.85]) assert.ok(T.pathMask(c.x + (p.x - c.x) * t, c.z + (p.z - c.z) * t) > 0.8, `${id} path at ${t}`);
  }
  assert.ok(T.pathMask(c.x + (foot.x - c.x) * 0.95, c.z + (foot.z - c.z) * 0.95) > 0.8, 'library road');
});

test('islands and new land moved out with the edge: same direction, same gap beyond it', () => {
  for (const l of [...ISLANDS, ...LANDS]) {
    const [ox, oz] = OLD_ISLANDS[l.id];
    const was = Math.hypot(ox, oz);
    const d = Math.hypot(l.x, l.z);
    assert.ok(Math.abs(d - ISLAND_R - (was - 24)) < 0.2, `${l.id} ${(d - ISLAND_R).toFixed(1)} m beyond the edge`);
    const turn = Math.atan2(l.z, l.x) - Math.atan2(oz, ox);
    assert.ok(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) < 0.01, `${l.id} keeps its direction`);
    for (const p of PLOTS.filter((q) => q.land === l.id)) assert.ok(Math.hypot(p.x - l.x, p.z - l.z) < l.r - 1.5, p.id);
  }
  for (const i of ISLANDS) {
    const f = bridgeFoot(i);
    assert.ok(Math.abs(Math.hypot(f.x, f.z) - (ISLAND_R - BRIDGE_IN)) < 1e-9, `${i.id} bridge foot at the edge`);
  }
});

test('the new places give what they hold: wood from the new gums, stone, water and sand', () => {
  const want = { eucalyptus_forest: 'wood', ghost_gum: 'wood', red_gum: 'wood', misty_hill: 'stone', waterfall_pool: 'water', sandy_cove: 'sand' };
  for (const [place, res] of Object.entries(want)) {
    assert.deepEqual(SOURCES[place], [res], place);
    const w = world();
    w.koalas.crystal.place = place;
    applyDecision(w, 'crystal', parseDecision({ action: 'gather', target: res }, w.koalas.crystal, placesOf(w)));
    assert.deepEqual(w.koalas.crystal.res, { [res]: 1 }, place);
  }
  const w = world();
  w.koalas.crystal.place = 'ghost_gum';
  const d = parseDecision({ action: 'climb', target: 'red_gum' }, w.koalas.crystal, placesOf(w));
  assert.equal(d.target, 'red_gum', 'the new gums can be climbed');
});

test('the prompt lists the new places by name and id only, and where the new resources are', () => {
  const p = buildPrompt(world(), 'crystal', groveClock(0));
  const line = p.split('\n').find((l) => l.startsWith('Places:'));
  for (const id of NEW) assert.match(line, new RegExp(`\\(${id}\\)`));
  assert.doesNotMatch(line, /\d+\.\d|x:|z:/, 'no coordinates');
  assert.match(line, /Eucalyptus grows on: .*ghost_gum/);
  assert.ok(line.length < 1100, `places line ${line.length} chars`);
  assert.match(p, /misty_hill/);
});

test('a long walk takes no more than about 12 seconds; a short one keeps its gentle pace', () => {
  const walk = 2.1;
  const accel = 3.2;
  const time = (len, w = walk, a = accel) => {
    const o = tripPace(len, { walk: w, accel: a });
    let speed = 0;
    let left = len;
    let t = 0;
    while (left > 1e-6 && t < 120) {
      const g = glide(speed, left, 1 / 60, o);
      speed = g.speed;
      left -= g.step;
      t += 1 / 60;
    }
    return t;
  };
  for (const len of [60, 120, 214, 260]) assert.ok(time(len) <= 12, `${len} m in ${time(len).toFixed(1)} s`);
  assert.ok(time(260, walk * 0.65, accel * 0.65) <= 12.5, 'a baby too');
  assert.deepEqual(tripPace(8, { walk, accel }), { max: walk, accel }, 'short trips unchanged');
  assert.ok(time(30) > 6, 'a stroll across the grove is still a stroll');
});
