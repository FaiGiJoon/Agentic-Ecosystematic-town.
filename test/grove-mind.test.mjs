import test from 'node:test';
import assert from 'node:assert/strict';
import { Grove } from '../hq/grove.js';
import {
  newKoala, parseDecision, applyDecision, buildPrompt, systemPrompt, wisdomOf, relevantLearned, interestsOf,
  DECISION_SCHEMA, MAX_TRAITS, MAX_LEARNED,
} from '../hq/grove-world.js';

const USAGE = { cost_usd: 0.002, tokens_in: 1500, tokens_out: 80, duration_ms: 900 };
const BRIDGE = { id: 1, kind: 'bridge_library_isle', title: 'Bridge', plot: null, progress: 4, effort: 4, done: true, by: 'crystal', helpers: ['crystal'] };

function world() {
  return { koalas: { crystal: newKoala('crystal'), ruby: newKoala('ruby') }, builds: [BRIDGE], stock: {}, minute: 0 };
}

// A grove where Crystal researches (or reads) once, and the library answers with `answer`.
function libraryGrove({ action = 'research', answer, config = {} }) {
  let t = Date.UTC(2026, 9, 31, 12);
  const calls = [];
  const brain = async (req) => {
    calls.push(req);
    if (req.kind === 'research' || req.kind === 'read') return { ok: true, raw: answer, usage: USAGE };
    return { ok: true, raw: req.koala === 'crystal' ? { action, target: 'How do stars shine?' } : { action: 'sit' }, usage: USAGE };
  };
  const grove = new Grove({ config: { dayUsd: 5, ...config }, think: brain, now: () => t, rng: () => 0.5 });
  grove.world.builds = [BRIDGE];
  grove.world.koalas.crystal.place = 'library_isle';
  const step = async (ms = 5000) => { t += ms; grove.heartbeat(); grove.tick(); await grove.idle(); };
  return { grove, calls, step };
}

test('wisdom levels: a new koala is a curious baby and grows wiser with what it learns', () => {
  const k = newKoala('crystal');
  assert.equal(k.wisdom, 0);
  assert.deepEqual(k.traits, []);
  assert.deepEqual(k.curiosities, []);
  assert.equal(wisdomOf(k).wisdomLabel, 'Curious baby');
  assert.equal(wisdomOf({ wisdom: 5 }).wisdomLabel, 'Little learner');
  assert.equal(wisdomOf({ wisdom: 70 }).wisdomLabel, 'Wise koala');
  assert.equal(wisdomOf({ wisdom: 70 }).nextWisdom, null);
  assert.equal(wisdomOf({}).wisdom, 0, 'old koalas without wisdom start at zero');
});

test('traits: a decision can add one, duplicates are ignored, and the list is capped', () => {
  assert.ok(DECISION_SCHEMA.required.includes('trait'));
  const w = world();
  const k = w.koalas.crystal;
  applyDecision(w, 'crystal', parseDecision({ action: 'sit', trait: 'I love the night sky' }, k));
  applyDecision(w, 'crystal', parseDecision({ action: 'sit', trait: 'i love the night sky' }, k));
  assert.deepEqual(k.traits, ['I love the night sky']);
  for (let i = 0; i < MAX_TRAITS + 2; i++) applyDecision(w, 'crystal', parseDecision({ action: 'sit', trait: `trait ${i}` }, k));
  assert.equal(k.traits.length, MAX_TRAITS);
  assert.equal(k.traits.at(-1), `trait ${MAX_TRAITS + 1}`);
});

test('old koalas without traits still take one', () => {
  const w = world();
  delete w.koalas.ruby.traits;
  applyDecision(w, 'ruby', parseDecision({ action: 'sit', trait: 'Quiet but brave' }, w.koalas.ruby));
  assert.deepEqual(w.koalas.ruby.traits, ['Quiet but brave']);
});

test('the prompt tells a koala its mind: level, traits, curiosities and what it knows', () => {
  const w = world();
  const k = w.koalas.crystal;
  k.wisdom = 16;
  k.traits = ['bold', 'loves puzzles'];
  k.curiosities = ['black holes'];
  k.learned = ['Stars are giant balls of hot gas.'];
  const p = buildPrompt(w, 'crystal', { label: 'Day 1', phase: 'day' });
  assert.match(p, /you are a young scholar \(wisdom 16; a clever koala at 35\)\. You know 1 thing\./);
  assert.match(p, /Who you are becoming: bold; loves puzzles\./);
  assert.match(p, /Lately you wonder about: black holes\./);
  assert.match(p, /Things you learned:\n- Stars are giant balls of hot gas\./);
  assert.match(systemPrompt('crystal', w), /research it on the web: ask a follow-up question that goes deeper/);
  assert.match(systemPrompt('crystal', w), /name it as a trait/);
});

test('curiosities widen the interests without repeating the built-in ones', () => {
  const k = { ...newKoala('crystal'), curiosities: ['stars', 'volcanoes'] };
  const all = interestsOf(k);
  assert.equal(all.filter((x) => x === 'stars').length, 1);
  assert.ok(all.includes('volcanoes'));
});

test('relevantLearned: the newest facts plus older ones that touch the wish or interests', () => {
  const k = {
    ...newKoala('crystal'),
    wish: 'build a telescope',
    learned: ['A telescope makes faraway things look close.', 'Frogs drink through their skin.', 'Moss grows in shade.',
      'Bees dance to talk.', 'Owls turn their heads far.', 'Rain comes from clouds.', 'Snails have teeth.', 'Ants are strong.'],
  };
  const got = relevantLearned(k, 6);
  assert.equal(got.length, 6);
  assert.equal(got[0], 'A telescope makes faraway things look close.', 'the old telescope fact is kept for the wish');
  assert.deepEqual(got.slice(-3), ['Rain comes from clouds.', 'Snails have teeth.', 'Ants are strong.']);
});

test('research: the library hears the koala level, personality and what it knows, and answers deeper', async () => {
  const { grove, calls, step } = libraryGrove({ answer: { fact: 'Stars shine by fusing hydrogen into helium.', idea: '', curiosity: 'the sun' } });
  const c = grove.world.koalas.crystal;
  c.traits = ['bold'];
  c.learned = ['Stars are very far away.'];
  grove.play();
  await step();
  const r = calls.find((x) => x.kind === 'research');
  assert.ok(r, 'a research call was made');
  assert.match(r.prompt, /Crystal is a curious baby koala/);
  assert.match(r.prompt, /Crystal's personality: bold\./);
  assert.match(r.prompt, /already knows:\n- Stars are very far away\./);
  assert.match(r.prompt, /Answer very simply/);
  assert.match(r.prompt, /one related topic the koala could wonder about next/);
});

test('research grows wisdom by 2, adds a curiosity, and keeps many facts', async () => {
  const { grove, step } = libraryGrove({ answer: { fact: 'Stars shine by fusing hydrogen.', idea: '', curiosity: 'the sun' } });
  const c = grove.world.koalas.crystal;
  c.learned = Array.from({ length: 20 }, (_, i) => `fact ${i}`);
  grove.play();
  await step();
  const k = grove.state().koalas.find((x) => x.id === 'crystal');
  assert.equal(k.wisdom, 2);
  assert.deepEqual(k.curiosities, ['the sun']);
  assert.equal(k.learned.length, 21, 'more than the old 8 are kept');
  assert.ok(k.recent.some((r) => /Now you wonder about the sun\./.test(r)));
  assert.equal(k.wisdomLabel, 'Curious baby');
  assert.ok(MAX_LEARNED >= 50);
});

test('crossing a wisdom level is told to the koala and logged', async () => {
  const { grove, step } = libraryGrove({ answer: { fact: 'Stars shine.', idea: '', curiosity: '' } });
  grove.world.koalas.crystal.wisdom = 4;
  grove.play();
  await step();
  const k = grove.state().koalas.find((x) => x.id === 'crystal');
  assert.equal(k.wisdomLabel, 'Little learner');
  assert.ok(k.recent.some((r) => /You feel wiser\. You are a little learner now!/.test(r)));
  assert.ok(grove.state().log.some((l) => l.kind === 'grow' && /grew wiser/.test(l.text)));
});

test('reading grows wisdom by 1', async () => {
  const { grove, step } = libraryGrove({ action: 'read', answer: { fact: 'Stars twinkle because of air.', idea: '', curiosity: '' } });
  grove.play();
  await step();
  assert.equal(grove.state().koalas.find((x) => x.id === 'crystal').wisdom, 1);
});

test('research now happens 16 times a day by default', async () => {
  const { grove, calls, step } = libraryGrove({ answer: { fact: 'x', idea: '', curiosity: '' } });
  grove.play();
  for (let i = 0; i < 40; i++) await step(70000);
  assert.equal(calls.filter((c) => c.kind === 'research').length, 16);
});
