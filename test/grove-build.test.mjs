import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KOALAS, PLACES, ACTIONS, DECISION_SCHEMA, BLUEPRINTS, PLOTS, LANDS,
  newKoala, parseDecision, applyDecision, buildPrompt, groveClock, placesOf, freePlots, landOf,
} from '../hq/grove-world.js';
import { ISLAND, POND_R } from '../public/js/gfx/terrain-math.js';

const world = () => ({ koalas: Object.fromEntries(KOALAS.map((k) => [k.id, newKoala(k.id)])), builds: [], stock: { wood: 99, stone: 99, sand: 99, water: 99, book: 99 } });
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
  const k = w.koalas.crystal;
  const d = parseDecision({ action: 'build', target: 'treehouse', build_name: '  Sky Nest  '.padEnd(80, '!') }, k, placesOf(w));
  assert.equal(d.target, 'treehouse');
  assert.equal(d.buildName.length, 40);
  assert.equal(parseDecision({ action: 'build', target: 'castle' }, k, placesOf(w)).target, '');
});

test('a koala starts a project on a free plot and walks there', () => {
  const w = world();
  const log = build(w, 'crystal', 'treehouse', 'Sky Nest');
  assert.equal(w.builds.length, 1);
  const b = w.builds[0];
  assert.deepEqual([b.kind, b.title, b.progress, b.done, b.by], ['treehouse', 'Sky Nest', 1, false, 'crystal']);
  assert.equal(w.koalas.crystal.place, b.plot);
  assert.equal(w.koalas.crystal.activity, 'build');
  assert.ok(placesOf(w)[b.plot], 'the site is a place');
  assert.match(placesOf(w)[b.plot].name, /Sky Nest/);
  assert.ok(log.some((e) => e.kind === 'act' && /started building/.test(e.text)));
  // Without a name, the blueprint's own name is used.
  build(w, 'ruby', 'bench');
  assert.equal(w.builds[1].title, 'Log Bench');
});

test('building together goes faster, and a finished build becomes a place to visit', () => {
  const w = world();
  build(w, 'crystal', 'hut', 'Leafy Home'); // effort 5: 1
  build(w, 'ruby', 'hut'); // helps, Crystal is building there: 1 + 1
  assert.equal(w.builds[0].progress, 3);
  assert.deepEqual(w.builds[0].helpers.sort(), ['crystal', 'ruby']);
  assert.match(w.koalas.crystal.recent.at(-1), /Ruby helped/);
  const log = build(w, 'crystal', 'hut'); // 3 + 2 = 5: done
  assert.equal(w.builds[0].done, true);
  assert.ok(log.some((e) => e.kind === 'built' && /Leafy Home/.test(e.text)));
  assert.match(w.koalas.ruby.recent.join(' '), /finished the Leafy Home/);
  // A finished build is somewhere to go.
  const plot = w.builds[0].plot;
  assert.equal(parseDecision({ action: 'move', target: plot }, w.koalas.ruby, placesOf(w)).target, plot);
});

test('at most two open projects: a third idea goes to the oldest one', () => {
  const w = world();
  build(w, 'crystal', 'tower');
  build(w, 'ruby', 'birdhouse');
  build(w, 'crystal', 'lantern');
  assert.equal(w.builds.length, 2);
  assert.equal(w.builds[0].progress, 2);
  // An empty target keeps working on the koala's own project.
  build(w, 'ruby', '');
  assert.equal(w.builds[1].progress, 2);
});

test('every two finished builds, new land rises from the water with room to build', () => {
  const w = world();
  assert.equal(landOf(w).length, 0);
  const before = freePlots(w).length;
  while (!w.builds.find((b) => b.kind === 'bench')?.done) build(w, 'crystal', 'bench');
  const log = [];
  while (!w.builds.find((b) => b.kind === 'lantern')?.done) log.push(...build(w, 'crystal', 'lantern'));
  assert.equal(landOf(w).length, 1);
  const land = landOf(w)[0];
  assert.ok(log.some((e) => e.kind === 'land' && e.text.includes(land.name)));
  assert.ok(placesOf(w)[land.id], 'the new land is a place');
  assert.match(w.koalas.ruby.recent.join(' '), new RegExp(land.name));
  assert.equal(freePlots(w).length, before - 2 + PLOTS.filter((p) => p.land === land.id).length);
  // Land that has not risen yet is not somewhere to go.
  const later = LANDS[1];
  assert.equal(parseDecision({ action: 'move', target: later.id }, w.koalas.crystal, placesOf(w)).target, w.koalas.crystal.place);
});

test('with no free plot and nothing open, a koala cannot build and sits instead', () => {
  const w = world();
  w.builds = PLOTS.filter((p) => !p.land).map((p, i) => ({ id: i + 1, kind: 'bench', title: 'Bench', plot: p.id, progress: 2, effort: 2, done: true, by: 'crystal', helpers: ['crystal'] }));
  // Enough builds to raise every land: fill those plots too.
  for (const p of PLOTS.filter((x) => x.land)) w.builds.push({ id: w.builds.length + 1, kind: 'bench', title: 'Bench', plot: p.id, progress: 2, effort: 2, done: true, by: 'crystal', helpers: ['crystal'] });
  assert.equal(freePlots(w).length, 0);
  build(w, 'crystal', 'hut');
  assert.equal(w.koalas.crystal.activity, 'sit');
  assert.match(w.koalas.crystal.recent.join(' '), /no room left to build/);
});

test('the prompt tells a koala what it can build, what is underway and what stands', () => {
  const w = world();
  build(w, 'crystal', 'treehouse', 'Sky Nest');
  const p = buildPrompt(w, 'ruby', groveClock(0));
  assert.match(p, /Sky Nest \(treehouse\), 1 of 6 done/);
  assert.match(p, /You can build \(with what is in the Stockpile\): bench \(Log Bench, 2 steps, costs 2 wood\), lantern/);
  assert.match(p, /plot_\d/);
  assert.match(p, /together/i);
});

// ---- build anything ----
const invent = (w, id, name, design, target = 'new') => applyDecision(w, id, parseDecision({ action: 'build', target, build_name: name, build_design: design }, w.koalas[id], placesOf(w)));

test('the schema asks for build_design, strictly', () => {
  assert.ok(DECISION_SCHEMA.required.includes('build_design'));
  assert.equal(DECISION_SCHEMA.properties.build_design.type, 'string');
});

test('parseDecision: new, or an unknown target with a name or design, means a new invention', () => {
  const w = world();
  const k = w.koalas.crystal;
  const p = (o) => parseDecision({ action: 'build', ...o }, k, placesOf(w));
  assert.equal(p({ target: 'new', build_name: 'Arcade' }).target, 'new');
  assert.equal(p({ target: 'castle', build_design: 'a castle' }).target, 'new');
  assert.equal(p({ target: 'castle', build_name: 'Castle' }).target, 'new');
  assert.equal(p({ target: 'castle' }).target, '');
  assert.equal(p({ target: '', build_name: 'Arcade' }).target, '');
  assert.equal(p({ target: 'bench', build_design: 'x' }).target, 'bench');
  assert.equal(p({ target: 'new', build_design: 'd'.repeat(300) }).buildDesign.length, 160);
});

test('inventing spends the cost, makes a custom build that progresses and finishes', () => {
  const w = world();
  w.stock = { wood: 5, stone: 5 };
  invent(w, 'crystal', 'Arcade', 'An arcade machine with pink buttons.');
  const b = w.builds[0];
  assert.deepEqual([b.kind, b.title, b.done, b.by, b.progress], ['custom', 'Arcade', false, 'crystal', 1]);
  assert.deepEqual([b.spec.shape, b.spec.size, b.spec.colors], ['machine', 'medium', ['pink']]);
  assert.ok(b.spec.parts.includes('buttons'));
  assert.equal(b.spec.design, 'An arcade machine with pink buttons.');
  assert.deepEqual([b.cost, b.effort], [{ wood: 3, stone: 1 }, 4]);
  assert.deepEqual(w.stock, { wood: 2, stone: 4 });
  for (let i = 0; i < 3; i++) build(w, 'crystal', '');
  assert.equal(b.done, true);
  assert.match(placesOf(w)[b.plot].name, /Arcade/);
});

test('inventing without enough in the Stockpile spends nothing and leaves a note', () => {
  const w = world();
  w.stock = { wood: 1 };
  invent(w, 'crystal', 'Castle', 'A giant castle.');
  assert.equal(w.builds.length, 0);
  assert.deepEqual(w.stock, { wood: 1 });
  assert.ok(w.koalas.crystal.recent.some((t) => /needs 4 more wood/.test(t)));
});

test('inventions count toward the 2-at-once limit and asking again joins the same one', () => {
  const w = world();
  invent(w, 'crystal', 'Arcade', 'an arcade machine');
  invent(w, 'crystal', 'Arcade', 'an arcade machine');
  assert.equal(w.builds.length, 1);
  invent(w, 'ruby', 'Castle', 'a castle');
  invent(w, 'ruby', 'Fountain', 'a fountain');
  assert.equal(w.builds.length, 2);
});

test('the prompt invites inventing and lists custom builds with their design', () => {
  const w = world();
  invent(w, 'crystal', 'Arcade', 'an arcade machine');
  const p = buildPrompt(w, 'ruby', groveClock(0));
  assert.match(p, /invent anything/i);
  assert.match(p, /Arcade \(custom: an arcade machine\)/);
});
