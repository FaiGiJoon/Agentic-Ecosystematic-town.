import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KOALAS, PLACES, ITEMS, ACTIONS, MOODS, DECISION_SCHEMA,
  newKoala, parseDecision, applyDecision, drift, groveClock, buildPrompt, systemPrompt,
} from '../hq/grove-world.js';

const world = () => ({ koalas: Object.fromEntries(KOALAS.map((k) => [k.id, newKoala(k.id)])) });

test('two koalas with their own personas, and a grove of known places', () => {
  assert.deepEqual(KOALAS.map((k) => k.id), ['mallee', 'bramble']);
  for (const k of KOALAS) assert.ok(k.persona.length > 40);
  for (const id of ['big_gum', 'river_gum', 'blue_gum', 'pond', 'swing', 'clearing', 'hollow', 'lookout', 'flowers']) {
    assert.ok(PLACES[id], id);
    assert.equal(typeof PLACES[id].x, 'number');
  }
  assert.equal(Object.values(PLACES).filter((p) => p.tree).length, 3);
  assert.ok(ITEMS.includes('leaf'));
});

test('the decision schema names every action and mood', () => {
  assert.deepEqual(DECISION_SCHEMA.properties.action.enum, ACTIONS);
  assert.deepEqual(DECISION_SCHEMA.properties.mood.enum, MOODS);
  assert.ok(DECISION_SCHEMA.required.includes('action'));
});

test('parseDecision accepts an object and clamps text', () => {
  const k = newKoala('mallee');
  const d = parseDecision({ thought: 'x'.repeat(500), action: 'move', target: 'pond', say: ' hi ', mood: 'playful', remember: '', bond: 9, opinion: 'nice' }, k);
  assert.equal(d.action, 'move');
  assert.equal(d.target, 'pond');
  assert.equal(d.say, 'hi');
  assert.equal(d.thought.length, 200);
  assert.equal(d.mood, 'playful');
  assert.equal(d.bond, 3);
  assert.equal(d.remember, '');
});

test('parseDecision finds JSON inside prose and rejects garbage', () => {
  const k = newKoala('bramble');
  const d = parseDecision('Sure! {"action":"nap","say":"","mood":"sleepy"} done', k);
  assert.equal(d.action, 'nap');
  assert.equal(parseDecision('no json here', k), null);
  assert.equal(parseDecision('{"action":', k), null);
  assert.equal(parseDecision(null, k), null);
  assert.equal(parseDecision([1, 2], k), null);
});

test('parseDecision repairs bad actions, targets and moods', () => {
  const k = newKoala('mallee');
  k.place = 'pond';
  assert.equal(parseDecision({ action: 'fly' }, k).action, 'sit');
  assert.equal(parseDecision({ action: 'move', target: 'mars' }, k).target, 'pond');
  assert.equal(parseDecision({ action: 'eat', target: 'pond' }, k).target, 'big_gum');
  k.place = 'blue_gum';
  assert.equal(parseDecision({ action: 'climb' }, k).target, 'blue_gum');
  assert.equal(parseDecision({ action: 'play', target: 'piano' }, k).target, 'ball');
  assert.equal(parseDecision({ action: 'sit', mood: 'furious' }, k).mood, 'content');
  // Giving needs the item in paw.
  const give = parseDecision({ action: 'give', target: 'pebble' }, k);
  assert.equal(give.action, 'sit');
  k.inventory = ['pebble'];
  assert.equal(parseDecision({ action: 'give', target: 'pebble' }, k).action, 'give');
});

test('applyDecision moves, feeds, and tells the other koala what was said', () => {
  const w = world();
  const m = w.koalas.mallee;
  const b = w.koalas.bramble;
  m.hunger = 80;
  const log = applyDecision(w, 'mallee', parseDecision({ action: 'eat', target: 'river_gum', say: 'Yum!', mood: 'happy', bond: 1, opinion: 'Bramble is sweet', remember: 'River gum leaves taste best' }, m));
  assert.equal(m.place, 'river_gum');
  assert.equal(m.activity, 'eat');
  assert.equal(m.hunger, 35);
  assert.equal(m.mood, 'happy');
  assert.equal(m.bond, 4);
  assert.equal(m.opinion, 'Bramble is sweet');
  assert.deepEqual(m.memories, ['River gum leaves taste best']);
  assert.match(b.recent.at(-1), /Mallee said: "Yum!"/);
  assert.deepEqual(log.map((e) => e.kind), ['act', 'say']);
});

test('applyDecision: approach goes to the friend, give hands over the item, nap restores energy', () => {
  const w = world();
  const m = w.koalas.mallee;
  const b = w.koalas.bramble;
  b.place = 'lookout';
  m.inventory = ['blossom'];
  applyDecision(w, 'mallee', parseDecision({ action: 'approach' }, m));
  assert.equal(m.place, 'lookout');
  applyDecision(w, 'mallee', parseDecision({ action: 'give', target: 'blossom' }, m));
  assert.deepEqual(m.inventory, []);
  assert.deepEqual(b.inventory, ['blossom']);
  assert.match(b.recent.at(-1), /gave you a blossom/);
  b.energy = 20;
  applyDecision(w, 'bramble', parseDecision({ action: 'nap' }, b));
  assert.equal(b.energy, 60);
  assert.equal(b.activity, 'nap');
});

test('memories are bounded: 10 recent events, 12 long-term notes, bond within ±100', () => {
  const w = world();
  const m = w.koalas.mallee;
  for (let i = 0; i < 40; i++) applyDecision(w, 'mallee', parseDecision({ action: 'sit', remember: `note ${i}`, bond: 3 }, m));
  assert.equal(m.recent.length, 10);
  assert.equal(m.memories.length, 12);
  assert.equal(m.memories.at(-1), 'note 39');
  assert.equal(m.bond, 100);
});

test('drift makes koalas hungrier and sleepier; napping recovers', () => {
  const k = newKoala('mallee');
  k.hunger = 10;
  k.energy = 50;
  drift(k, 10);
  assert.equal(k.hunger, 22);
  assert.equal(k.energy, 42);
  k.activity = 'nap';
  drift(k, 10);
  assert.equal(k.energy, 62);
  k.hunger = 99;
  drift(k, 100);
  assert.equal(k.hunger, 100);
});

test('groveClock runs a 20-minute day that starts in the morning', () => {
  const c0 = groveClock(0);
  assert.equal(c0.day, 1);
  assert.equal(c0.hour, 8);
  assert.equal(c0.phase, 'day');
  const night = groveClock((14 / 24) * 20 * 60000); // 8 + 14 = 22:00
  assert.equal(night.hour, 22);
  assert.equal(night.phase, 'night');
  assert.equal(groveClock(20 * 60000).day, 2);
  assert.equal(groveClock(0).label, 'Day 1 · 08:00');
});

test('the prompt carries needs, the friend, memories and the place ids', () => {
  const w = world();
  w.koalas.mallee.recent = ['Bramble said: "hello"'];
  w.koalas.mallee.memories = ['The pond has frogs'];
  w.koalas.bramble.place = 'pond';
  const p = buildPrompt(w, 'mallee', groveClock(0));
  assert.match(p, /Bramble/);
  assert.match(p, /Bramble said: "hello"/);
  assert.match(p, /The pond has frogs/);
  assert.match(p, /big_gum/);
  assert.match(p, /Day 1 · 08:00/);
  assert.match(systemPrompt('bramble'), /Bramble/);
  assert.match(systemPrompt('bramble'), /JSON/);
  // Memories are for what is new; otherwise every turn re-saves the same moment.
  assert.match(systemPrompt('bramble'), /Leave remember empty unless/);
  assert.match(buildPrompt(w, 'mallee', groveClock(0)), /Things you remember/);
});
