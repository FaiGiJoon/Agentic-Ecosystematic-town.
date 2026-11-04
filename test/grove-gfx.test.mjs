import test from 'node:test';
import assert from 'node:assert/strict';
import { hash2, valueNoise, fbm, ridged, heightToNormal, rng } from '../public/js/gfx/noise.js';
import { makeTerrain, ISLAND, POND_R, SHORE_R, WATER_Y } from '../public/js/gfx/terrain-math.js';
import { SETTINGS, TIERS, pickInitialTier, ladder, Governor, parseQuality } from '../public/js/gfx/quality.js';
import { PLACES } from '../hq/grove-world.js';

test('noise is deterministic, in range and different per seed', () => {
  assert.equal(hash2(3, 9, 1), hash2(3, 9, 1));
  assert.notEqual(hash2(3, 9, 1), hash2(3, 9, 2));
  for (let i = 0; i < 500; i++) {
    const v = fbm(i * 0.37, i * 0.11, { octaves: 5, seed: 4 });
    assert.ok(v >= 0 && v <= 1, `fbm ${v}`);
    const r = ridged(i * 0.21, -i * 0.3, { octaves: 3 });
    assert.ok(r >= 0 && r <= 1, `ridged ${r}`);
  }
});

test('periodic noise tiles: the value at x and x + period is identical', () => {
  for (const p of [4, 8, 16]) {
    for (let i = 0; i < 40; i++) {
      const x = i * 0.73;
      const y = i * 0.41;
      assert.ok(Math.abs(valueNoise(x, y, 5, p) - valueNoise(x + p, y, 5, p)) < 1e-12);
      assert.ok(Math.abs(valueNoise(x, y, 5, p) - valueNoise(x, y + p, 5, p)) < 1e-12);
      const o = { octaves: 4, seed: 2, period: p };
      assert.ok(Math.abs(fbm(x, y, o) - fbm(x + p, y, o)) < 1e-12, 'fbm tiles');
    }
  }
});

test('heightToNormal: a flat field is straight up, a ramp leans against its slope', () => {
  const flat = heightToNormal(new Float32Array(16).fill(0.5), 4, 4, 3);
  assert.deepEqual([...flat.slice(0, 4)], [128, 128, 255, 255]);
  const w = 8;
  const ramp = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) ramp[y * w + x] = x * 0.1;
  const n = heightToNormal(ramp, w, w, 4);
  const o = (3 * w + 3) * 4; // an interior pixel, away from the wrap
  assert.ok(n[o] < 128, 'height rises with x, so the normal tilts toward -x');
  assert.ok(Math.abs(n[o + 1] - 128) <= 1);
});

const T = makeTerrain(PLACES);

test('terrain: pond is a basin below the water, the shore is where the ground meets it', () => {
  const p = PLACES.pond;
  assert.ok(T.height(p.x, p.z) < WATER_Y - 0.6, 'deep in the middle');
  assert.ok(T.height(p.x + POND_R + 3, p.z) > WATER_Y, 'dry bank');
  const lo = T.height(p.x + SHORE_R - 0.4, p.z);
  const hi = T.height(p.x + SHORE_R + 0.4, p.z);
  assert.ok(lo < WATER_Y && hi > WATER_Y, `shore crosses the water level between ${lo.toFixed(3)} and ${hi.toFixed(3)}`);
});

test('terrain: bounded, finite and rolls off at the island edge', () => {
  let min = Infinity;
  let max = -Infinity;
  for (let a = 0; a < 360; a += 7) {
    for (let r = 0; r <= ISLAND; r += 1.5) {
      const h = T.height(Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r);
      assert.ok(Number.isFinite(h));
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  assert.ok(max < 1.2 && min > -1.8, `range ${min.toFixed(2)}..${max.toFixed(2)}`);
  assert.ok(T.height(ISLAND, 0) < T.height(ISLAND - 8, 0) - 0.5, 'the rim is lower than the lawn');
});

test('the lawn where koalas stand is gentle enough to walk on (slope under 20%)', () => {
  for (const [id, p] of Object.entries(PLACES)) {
    if (id === 'pond') continue;
    const s = Math.hypot(T.height(p.x + 0.5, p.z) - T.height(p.x - 0.5, p.z), T.height(p.x, p.z + 0.5) - T.height(p.x, p.z - 0.5));
    assert.ok(s < 0.2, `${id} slope ${s.toFixed(3)}`);
  }
});

test('pathMask is worn along the paths and clear elsewhere', () => {
  const c = PLACES.clearing;
  assert.ok(T.pathMask(c.x, c.z) > 0.9, 'the clearing');
  const b = PLACES.big_gum;
  assert.ok(T.pathMask((c.x + b.x) / 2, (c.z + b.z) / 2) > 0.8, 'halfway along a path');
  assert.ok(T.pathMask(-20, 18) < 0.05, 'far from every path');
  for (let i = 0; i < 200; i++) {
    const v = T.pathMask(Math.cos(i) * 15, Math.sin(i * 1.3) * 15);
    assert.ok(v >= 0 && v <= 1);
  }
});

test('blocked: no trees in the pond, on a path, next to a landmark or off the island', () => {
  assert.ok(T.blocked(PLACES.pond.x, PLACES.pond.z));
  assert.ok(T.blocked(PLACES.clearing.x, PLACES.clearing.z));
  assert.ok(T.blocked(PLACES.big_gum.x + 1, PLACES.big_gum.z));
  assert.ok(T.blocked(ISLAND, 0));
  const r = rng(11);
  let free = 0;
  for (let i = 0; i < 400; i++) if (!T.blocked((r() - 0.5) * 2 * 22, (r() - 0.5) * 2 * 22)) free++;
  assert.ok(free > 60, `enough room left for a forest (${free}/400 free)`);
});

test('quality tiers only ever get cheaper going down, and the table is complete', () => {
  const num = ['dprMax', 'shadowMap', 'grass', 'leaves', 'shells', 'forest', 'particles', 'butterflies', 'texSize', 'stars', 'islets', 'terrainRings'];
  for (let i = 1; i < TIERS.length; i++) {
    for (const k of num) assert.ok(SETTINGS[TIERS[i]][k] >= SETTINGS[TIERS[i - 1]][k], `${k}: ${TIERS[i]} >= ${TIERS[i - 1]}`);
  }
  assert.equal(SETTINGS.low.bloom, false);
  assert.equal(SETTINGS.high.bloom, true);
});

test('initial tier: phones start lower than desktops, weak devices lowest', () => {
  assert.equal(pickInitialTier({ coarsePointer: true, hardwareConcurrency: 6 }), 'medium');
  assert.equal(pickInitialTier({ mobile: true, hardwareConcurrency: 4, deviceMemory: 2 }), 'low');
  assert.equal(pickInitialTier({ hardwareConcurrency: 16 }), 'high');
  assert.equal(pickInitialTier({ hardwareConcurrency: 4, deviceMemory: 4 }), 'medium');
  assert.equal(parseQuality('high'), 'high');
  assert.equal(parseQuality('ultra'), 'auto');
  assert.equal(parseQuality(null), 'auto');
});

test('ladder walks down from the chosen tier and never above it', () => {
  const l = ladder('medium');
  assert.deepEqual(l[0], { tier: 'medium', scale: 1 });
  assert.ok(l.every((s) => TIERS.indexOf(s.tier) <= TIERS.indexOf('medium')));
  assert.equal(l.at(-1).tier, 'low');
  assert.ok(l.at(-1).scale < 1);
  assert.equal(ladder('low')[0].tier, 'low');
});

function feed(g, ms, seconds, canGoUp = true) {
  const out = [];
  for (let t = 0; t < seconds; t += ms / 1000) {
    const a = g.sample(ms / 1000, canGoUp);
    if (a) out.push(a);
  }
  return out;
}

test('governor: sustained slow frames step down once, a brief hiccup does not', () => {
  const g = new Governor();
  feed(g, 16.6, 5);
  assert.deepEqual(feed(g, 60, 1.2), [], 'one second of slowness is a hiccup');
  feed(g, 16.6, 8);
  assert.deepEqual(feed(g, 40, 7), ['down'], 'seven slow seconds steps down once');
  assert.deepEqual(feed(g, 40, 7), ['down'], 'still slow after settling: one more step, not a burst');
});

test('governor: needs a long calm stretch to step up, and never when it may not', () => {
  const g = new Governor();
  feed(g, 40, 6); // downgrade, then settle
  assert.deepEqual(feed(g, 12, 10), [], 'ten fast seconds is not enough');
  assert.deepEqual(feed(g, 12, 30), ['up']);
  const h = new Governor();
  assert.deepEqual(feed(h, 12, 60, false), []);
});

test('governor ignores pauses (tab switches) and bad numbers', () => {
  const g = new Governor();
  for (const dt of [0, -1, NaN, 0.5, 3]) assert.equal(g.sample(dt), null);
  assert.equal(g.frames, 0);
});

test('build plots are kept clear of trees and rocks', async () => {
  const { makeTerrain } = await import('../public/js/gfx/terrain-math.js');
  const { PLACES, PLOTS } = await import('../hq/grove-world.js');
  const main = PLOTS.filter((p) => !p.land);
  const open = makeTerrain(PLACES);
  const kept = makeTerrain(PLACES, { clear: main });
  assert.ok(main.some((p) => !open.blocked(p.x + 1.5, p.z)), 'without the list, trees could grow on a plot');
  for (const p of main) {
    assert.equal(kept.blocked(p.x, p.z), true, p.id);
    assert.equal(kept.blocked(p.x + 1.5, p.z - 1), true, p.id);
  }
});

test('ambient occlusion runs on High only, and is the first thing the governor gives up', () => {
  assert.deepEqual(TIERS.map((t) => SETTINGS[t].ao), [false, false, true]);
  const l = ladder('high');
  assert.deepEqual(l[0], { tier: 'high', scale: 1 });
  const off = l.findIndex((s) => s.noAO);
  const lower = l.findIndex((s) => s.scale < 0.85 || s.tier !== 'high');
  assert.ok(off > 0 && off < lower, `AO goes off at step ${off}, before step ${lower}`);
  assert.ok(l.slice(off).filter((s) => s.tier === 'high').every((s) => s.noAO), 'and stays off further down');
  assert.ok(ladder('medium').every((s) => !s.noAO));
});
