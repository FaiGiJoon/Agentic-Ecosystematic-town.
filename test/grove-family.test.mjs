import test from 'node:test';
import assert from 'node:assert/strict';
import { KOALAS, newKoala, parseDecision, applyDecision, buildPrompt, groveClock } from '../hq/grove-world.js';
import { canNest, nestStep, bornBaby, graduates, NEST_WINDOW, GESTATION } from '../hq/grove-family.js';

// Two grown-ups in love, side by side.
function lovers() {
  const w = { koalas: Object.fromEntries(KOALAS.map((k) => [k.id, newKoala(k.id)])), builds: [] };
  for (const k of Object.values(w.koalas)) {
    k.strength = 80;
    k.bond = 85;
    k.place = 'hollow';
  }
  return w;
}
const baby = (id, follows = 'crystal') => ({ ...newKoala('crystal'), id, name: id, follows, parents: ['crystal', 'ruby'] });

test('a nest needs two grown-ups who love each other, together, and room in the grove', () => {
  assert.equal(canNest(lovers(), 'crystal', 'ruby').ok, true);
  const young = lovers();
  young.koalas.ruby.strength = 50;
  assert.match(canNest(young, 'crystal', 'ruby').why, /grown/);
  const cool = lovers();
  cool.koalas.ruby.bond = 79;
  assert.match(canNest(cool, 'crystal', 'ruby').why, /love/);
  const apart = lovers();
  apart.koalas.ruby.place = 'pond';
  assert.match(canNest(apart, 'crystal', 'ruby').why, /together/);
  const full = lovers();
  full.koalas.pip = baby('pip');
  full.koalas.sky = baby('sky');
  assert.match(canNest(full, 'crystal', 'ruby').why, /room/);
  const expecting = lovers();
  expecting.koalas.pip = baby('pip');
  expecting.baby = { due: 9999, parents: ['crystal', 'ruby'] };
  assert.match(canNest(expecting, 'crystal', 'ruby').why, /room|on the way/);
});

test('both must choose to nest within two grove hours of each other', () => {
  assert.equal(NEST_WINDOW, 120);
  assert.equal(GESTATION, 1440);
  const w = lovers();
  assert.deepEqual(nestStep(w, 'crystal', 1000), { pending: true });
  assert.deepEqual(nestStep(w, 'ruby', 1100), { conceived: true });
  assert.deepEqual(w.baby, { due: 1100 + 1440, parents: ['crystal', 'ruby'] });
  const late = lovers();
  nestStep(late, 'crystal', 1000);
  assert.deepEqual(nestStep(late, 'ruby', 1130), { pending: true });
  assert.equal(late.baby, undefined);
});

test('a baby is born when it is due, small, following its mother', () => {
  const w = lovers();
  w.baby = { due: 3000, parents: ['crystal', 'ruby'] };
  assert.equal(bornBaby(w, 2999, 'Pip', 'pip'), null);
  const k = bornBaby(w, 3000, 'Pip', 'pip');
  assert.equal(k.follows, 'crystal');
  assert.equal(k.strength, 5);
  assert.deepEqual(k.parents, ['crystal', 'ruby']);
  assert.equal(k.place, 'hollow');
  assert.equal(k.bornAt, 3000);
  assert.match(k.persona, /Pip/);
  assert.match(k.persona, /Crystal/);
  assert.equal(w.koalas.pip, k);
  assert.equal(w.baby, null);
});

test('a baby grows into its own mind at youngster strength', () => {
  assert.equal(graduates({ follows: 'crystal', strength: 44 }), false);
  assert.equal(graduates({ follows: 'crystal', strength: 45 }), true);
  assert.equal(graduates({ follows: null, strength: 90 }), false);
});

test('nesting through decisions: one waits for the other, then a baby is on the way', () => {
  const w = lovers();
  w.minute = 500;
  applyDecision(w, 'crystal', parseDecision({ action: 'nest' }, w.koalas.crystal));
  assert.match(w.koalas.ruby.recent.at(-1), /Crystal is making a nest/);
  w.minute = 560;
  const log = applyDecision(w, 'ruby', parseDecision({ action: 'nest' }, w.koalas.ruby));
  assert.ok(log.some((e) => e.kind === 'grow' && /baby is on the way/.test(e.text)));
  assert.ok(w.baby);
  // the prompt offers nesting only when it can happen
  assert.doesNotMatch(buildPrompt(w, 'crystal', groveClock(0)), /nest \(with/);
  assert.match(buildPrompt(lovers(), 'crystal', groveClock(0)), /nest \(with Ruby/);
  const young = { koalas: Object.fromEntries(KOALAS.map((k) => [k.id, newKoala(k.id)])), builds: [] };
  assert.doesNotMatch(buildPrompt(young, 'crystal', groveClock(0)), /nest \(with/);
  // refused when it cannot happen
  applyDecision(young, 'crystal', parseDecision({ action: 'nest' }, young.koalas.crystal));
  assert.equal(young.koalas.crystal.activity, 'sit');
  assert.match(young.koalas.crystal.recent.join(' '), /wanted to make a nest/);
});

test('a baby inherits two interests from each parent, deduped', () => {
  const w = lovers();
  w.baby = { due: 10, parents: ['crystal', 'ruby'] };
  const k = bornBaby(w, 10, 'Pip', 'pip');
  assert.deepEqual(k.interests, ['brave explorers', 'shiny stones and crystals', 'sleepy animals', 'eucalyptus and plants']);
  const w2 = lovers();
  w2.koalas.crystal.interests = ['stars', 'poems'];
  w2.koalas.ruby.interests = ['poems', 'moon', 'plants'];
  w2.baby = { due: 10, parents: ['crystal', 'ruby'] };
  assert.deepEqual(bornBaby(w2, 10, 'Pip', 'pip').interests, ['stars', 'poems', 'moon']);
});
