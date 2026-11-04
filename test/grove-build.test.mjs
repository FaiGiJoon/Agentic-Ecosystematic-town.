import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KOALAS, PLACES, ACTIONS, DECISION_SCHEMA, BLUEPRINTS, PLOTS, LANDS,
  newKoala, parseDecision, applyDecision, buildPrompt, groveClock, placesOf, freePlots, landOf,
} from '../hq/grove-world.js';
import { ISLAND, POND_R } from '../public/js/gfx/terrain-math.js';

const world = () => ({ koalas: Object.fromEntries(KOALAS.map((k) => [k.id, newKoala(k.id)])), builds: [] });
const build = (w, id, target, name = '') => applyDecision(w, id, parseDecision({ action: 'build', target, build_name: name }, w.koalas[id], placesOf(w)));

test('building is an action, with things to build and a name for each', () => {
  assert.ok(ACTIONS.includes('build'));
  assert.ok(DECISION_SCHEMA.required.includes('build_name'));
  for (const id of ['bench', 'lantern', 'flowerbed', 'birdhouse', 'stones', 'hut', 'treehouse', 'tower']) {
    assert.ok(BLUEPRINTS[id].effort >= 2, id);
    assert.ok(BLUEPRINTS[id].name, id);
  }
});

test('building plots sit on open ground: on the island, clear of every place and the pond', () => {
  const main = PLOTS.filter((p) => !p.land);
  assert.ok(main.length >= 6);
  for (const p of main) {
    assert.ok(Math.hypot(p.x, p.z) < ISLAND - 4, p.id);
    assert.ok(Math.hypot(p.x - PLACES.pond.x, p.z - PLACES.pond.z) > POND_R + 2.5, p.id);
    for (const [id, q] of Object.entries(PLACES)) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) > 4.5, `${p.id} near ${id}`);
    for (const o of main) if (o !== p) assert.ok(Math.hypot(p.x - o.x, p.z - o.z) > 4.5, `${p.id} near ${o.id}`);
  }
  // New land lies off the island's edge, and its plots stand on that land.
  for (const l of LANDS) {
    assert.ok(Math.hypot(l.x, l.z) - l.r > ISLAND + 2, l.id);
    const own = PLOTS.filter((p) => p.land === l.id);
    assert.ok(own.length >= 2, l.id);
    for (const p of own) assert.ok(Math.hypot(p.x - l.x, p.z - l.z) < l.r - 1.5, p.id);
  }
});

test('parseDecision keeps a known blueprint and a short name; anything else just keeps building', () => {
  const w = world();
  const k = w.koalas.mallee;
  const d = parseDecision({ action: 'build', target: 'treehouse', build_name: '  Sky Nest  '.padEnd(80, '!') }, k, placesOf(w));
  assert.equal(d.target, 'treehouse');
  assert.equal(d.buildName.length, 40);
  assert.equal(parseDecision({ action: 'build', target: 'castle' }, k, placesOf(w)).target, '');
});

test('a koala starts a project on a free plot and walks there', () => {
  const w = world();
  const log = build(w, 'mallee', 'treehouse', 'Sky Nest');
  assert.equal(w.builds.length, 1);
  const b = w.builds[0];
  assert.deepEqual([b.kind, b.title, b.progress, b.done, b.by], ['treehouse', 'Sky Nest', 1, false, 'mallee']);
  assert.equal(w.koalas.mallee.place, b.plot);
  assert.equal(w.koalas.mallee.activity, 'build');
  assert.ok(placesOf(w)[b.plot], 'the site is a place');
  assert.match(placesOf(w)[b.plot].name, /Sky Nest/);
  assert.ok(log.some((e) => e.kind === 'act' && /started building/.test(e.text)));
  // Without a name, the blueprint's own name is used.
  build(w, 'bramble', 'bench');
  assert.equal(w.builds[1].title, 'Log Bench');
});

test('building together goes faster, and a finished build becomes a place to visit', () => {
  const w = world();
  build(w, 'mallee', 'hut', 'Leafy Home'); // effort 5: 1
  build(w, 'bramble', 'hut'); // helps, Mallee is building there: 1 + 1
  assert.equal(w.builds[0].progress, 3);
  assert.deepEqual(w.builds[0].helpers.sort(), ['bramble', 'mallee']);
  assert.match(w.koalas.mallee.recent.at(-1), /Bramble helped/);
  const log = build(w, 'mallee', 'hut'); // 3 + 2 = 5: done
  assert.equal(w.builds[0].done, true);
  assert.ok(log.some((e) => e.kind === 'built' && /Leafy Home/.test(e.text)));
  assert.match(w.koalas.bramble.recent.join(' '), /finished the Leafy Home/);
  // A finished build is somewhere to go.
  const plot = w.builds[0].plot;
  assert.equal(parseDecision({ action: 'move', target: plot }, w.koalas.bramble, placesOf(w)).target, plot);
});

test('at most two open projects: a third idea goes to the oldest one', () => {
  const w = world();
  build(w, 'mallee', 'tower');
  build(w, 'bramble', 'birdhouse');
  build(w, 'mallee', 'lantern');
  assert.equal(w.builds.length, 2);
  assert.equal(w.builds[0].progress, 2);
  // An empty target keeps working on the koala's own project.
  build(w, 'bramble', '');
  assert.equal(w.builds[1].progress, 2);
});

test('every two finished builds, new land rises from the water with room to build', () => {
  const w = world();
  assert.equal(landOf(w).length, 0);
  const before = freePlots(w).length;
  while (!w.builds.find((b) => b.kind === 'bench')?.done) build(w, 'mallee', 'bench');
  const log = [];
  while (!w.builds.find((b) => b.kind === 'lantern')?.done) log.push(...build(w, 'mallee', 'lantern'));
  assert.equal(landOf(w).length, 1);
  const land = landOf(w)[0];
  assert.ok(log.some((e) => e.kind === 'land' && e.text.includes(land.name)));
  assert.ok(placesOf(w)[land.id], 'the new land is a place');
  assert.match(w.koalas.bramble.recent.join(' '), new RegExp(land.name));
  assert.equal(freePlots(w).length, before - 2 + PLOTS.filter((p) => p.land === land.id).length);
  // Land that has not risen yet is not somewhere to go.
  const later = LANDS[1];
  assert.equal(parseDecision({ action: 'move', target: later.id }, w.koalas.mallee, placesOf(w)).target, w.koalas.mallee.place);
});

test('with no free plot and nothing open, a koala cannot build and sits instead', () => {
  const w = world();
  w.builds = PLOTS.filter((p) => !p.land).map((p, i) => ({ id: i + 1, kind: 'bench', title: 'Bench', plot: p.id, progress: 2, effort: 2, done: true, by: 'mallee', helpers: ['mallee'] }));
  // Enough builds to raise every land: fill those plots too.
  for (const p of PLOTS.filter((x) => x.land)) w.builds.push({ id: w.builds.length + 1, kind: 'bench', title: 'Bench', plot: p.id, progress: 2, effort: 2, done: true, by: 'mallee', helpers: ['mallee'] });
  assert.equal(freePlots(w).length, 0);
  build(w, 'mallee', 'hut');
  assert.equal(w.koalas.mallee.activity, 'sit');
  assert.match(w.koalas.mallee.recent.join(' '), /no room left to build/);
});

test('the prompt tells a koala what it can build, what is underway and what stands', () => {
  const w = world();
  build(w, 'mallee', 'treehouse', 'Sky Nest');
  const p = buildPrompt(w, 'bramble', groveClock(0));
  assert.match(p, /Sky Nest \(treehouse\), 1 of 6 done/);
  assert.match(p, /build \(target: one of bench, lantern/);
  assert.match(p, /plot_\d/);
  assert.match(p, /together/i);
});
