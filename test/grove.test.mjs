import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Grove } from '../hq/grove.js';

const USAGE = { cost_usd: 0.002, tokens_in: 1500, tokens_out: 80, duration_ms: 900 };

// A grove with a clock we move by hand and a scripted brain.
function setup({ config = {}, decide, path: dbPath } = {}) {
  let t = Date.UTC(2026, 9, 31, 12);
  const calls = [];
  const brain = async ({ koala, system, prompt }) => {
    calls.push({ koala, system, prompt });
    return decide ? decide(koala, calls.length) : { ok: true, raw: { action: 'sit', say: '', mood: 'content' }, usage: USAGE };
  };
  const grove = new Grove({ path: dbPath, config: { dayUsd: 1, ...config }, think: brain, now: () => t, rng: () => 0.5 });
  return { grove, calls, advance: (ms) => (t += ms), now: () => t };
}

async function round(g, advance, ms = 70000) {
  advance(ms);
  g.tick();
  await g.idle();
}

// Time passes while the page stays open.
async function openRound(g, advance, ms) {
  advance(ms);
  g.heartbeat();
  g.tick();
  await g.idle();
}

test('starts paused: nothing thinks until Play is pressed and the page is open', async () => {
  const { grove, calls, advance } = setup();
  assert.equal(grove.state().playing, false);
  await round(grove, advance);
  assert.equal(calls.length, 0);
  grove.play();
  await round(grove, advance);
  assert.equal(calls.length, 0, 'no page has checked in');
  grove.heartbeat();
  await round(grove, advance, 5000);
  assert.deepEqual(calls.map((c) => c.koala).sort(), ['bramble', 'mallee']);
  assert.match(calls[0].system, /You are (Mallee|Bramble)/);
});

test('the page must keep checking in: 45 s without a heartbeat stops the thinking', async () => {
  const { grove, calls, advance } = setup();
  grove.play();
  grove.heartbeat();
  advance(46000);
  grove.tick();
  await grove.idle();
  assert.equal(calls.length, 0);
  assert.equal(grove.state().present, false);
});

test('a decision moves the koala, is logged, and nudges the friend to answer', async () => {
  const { grove, advance, now } = setup({
    decide: (k) => (k === 'mallee'
      ? { ok: true, raw: { thought: 'pond time', action: 'move', target: 'pond', say: 'Come swim!', mood: 'playful', bond: 1 }, usage: USAGE }
      : { ok: true, raw: { action: 'nap', mood: 'sleepy' }, usage: USAGE }),
  });
  grove.play();
  grove.heartbeat();
  await round(grove, advance, 5000);
  const s = grove.state();
  const m = s.koalas.find((k) => k.id === 'mallee');
  assert.equal(m.place, 'pond');
  assert.equal(m.thought, 'pond time');
  assert.ok(s.log.some((e) => e.kind === 'say' && e.text === 'Come swim!'));
  const b = s.koalas.find((k) => k.id === 'bramble');
  assert.ok(b.nextAt <= now() + 12000, 'Bramble will answer soon');
  assert.equal(b.activity, 'nap');
});

test('real usage is metered per koala and in total', async () => {
  const { grove, advance } = setup();
  grove.play();
  grove.heartbeat();
  await round(grove, advance, 5000);
  const u = grove.state().usage;
  assert.equal(u.today.calls, 2);
  assert.ok(Math.abs(u.today.cost - 0.004) < 1e-9);
  assert.equal(u.today.tokens_in, 3000);
  assert.equal(u.byKoala.mallee.today.tokens_out, 80);
  assert.equal(u.byKoala.bramble.total.calls, 1);
  assert.equal(u.model, 'claude-haiku-5-5');
});

test('one call in flight per koala, and a quiet gap before the next', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { grove, calls, advance } = setup({ decide: async () => { await gate; return { ok: true, raw: { action: 'sit' }, usage: USAGE }; } });
  grove.play();
  grove.heartbeat();
  advance(5000);
  grove.tick();
  advance(5000);
  grove.heartbeat();
  grove.tick();
  assert.equal(calls.length, 2);
  assert.ok(grove.state().koalas.every((k) => k.thinking));
  release();
  await grove.idle();
  grove.tick();
  assert.equal(calls.length, 2, 'next decision waits at least 20 s');
});

test('the daily cap stops the thinking once today\'s real spend reaches it', async () => {
  const { grove, calls, advance } = setup({ config: { dayUsd: 0.003 } });
  grove.play();
  grove.heartbeat();
  await round(grove, advance, 5000);
  assert.equal(calls.length, 2);
  await openRound(grove, advance, 61000);
  await openRound(grove, advance, 61000);
  assert.equal(calls.length, 2);
  assert.equal(grove.state().capped, true);
});

test('pause stops new calls', async () => {
  const { grove, calls, advance } = setup();
  grove.play();
  grove.heartbeat();
  grove.pause();
  await round(grove, advance, 5000);
  assert.equal(calls.length, 0);
  assert.equal(grove.state().playing, false);
});

test('failures are logged and metered; three in a row pause the grove', async () => {
  const { grove, advance } = setup({ decide: () => ({ ok: false, raw: null, usage: { ...USAGE, cost_usd: 0.01 }, error: 'exit 1: not logged in' }) });
  grove.play();
  for (let i = 0; i < 3; i++) await openRound(grove, advance, 61000);
  const s = grove.state();
  assert.equal(s.playing, false);
  assert.match(s.pausedReason, /failed 3 times/);
  assert.ok(s.log.some((e) => e.kind === 'error' && /not logged in/.test(e.text)));
  assert.ok(s.usage.today.cost >= 0.03 - 1e-9);
});

test('a reply that is not a decision counts as a failure', async () => {
  const { grove, advance } = setup({ decide: () => ({ ok: true, raw: 'I refuse JSON', usage: USAGE }) });
  grove.play();
  grove.heartbeat();
  await round(grove, advance, 5000);
  assert.ok(grove.state().log.some((e) => e.kind === 'error' && /not a decision/.test(e.text)));
});

test('the visitor can give, say and pet; bad requests are refused', () => {
  const { grove } = setup();
  grove.act({ koala: 'bramble', kind: 'give', item: 'leaf' });
  const b = () => grove.state().koalas.find((k) => k.id === 'bramble');
  assert.deepEqual(b().inventory, ['leaf']);
  grove.act({ koala: 'bramble', kind: 'say', text: 'Hello Bramble!' });
  grove.act({ koala: 'bramble', kind: 'pet' });
  const log = grove.state().log;
  assert.ok(log.some((e) => e.kind === 'visitor' && /Hello Bramble!/.test(e.text)));
  grove.act({ koala: 'bramble', kind: 'give', item: 'ball' });
  const status = (fn) => { try { fn(); return 200; } catch (err) { return err.status; } };
  assert.equal(status(() => grove.act({ koala: 'bramble', kind: 'give', item: 'pebble' })), 409, 'a baby holds two things');
  grove.world.koalas.bramble.strength = 80; // a strong koala holds four
  for (const item of ['pebble', 'feather']) grove.act({ koala: 'bramble', kind: 'give', item });
  assert.equal(status(() => grove.act({ koala: 'bramble', kind: 'give', item: 'blossom' })), 409);
  assert.equal(status(() => grove.act({ koala: 'drop-bear', kind: 'pet' })), 404);
  assert.equal(status(() => grove.act({ koala: 'mallee', kind: 'dance' })), 400);
  assert.equal(status(() => grove.act({ koala: 'mallee', kind: 'give', item: 'diamond' })), 400);
  assert.equal(status(() => grove.act({ koala: 'mallee', kind: 'say', text: '' })), 400);
  assert.equal(status(() => grove.act({ koala: 'mallee', kind: 'say', text: 'x'.repeat(141) })), 400);
});

test('the state says how grown each koala is,', () => {
  const { grove } = setup();
  const [mallee, bramble] = grove.state().koalas;
  assert.deepEqual([mallee.gender, mallee.stage, mallee.carry], ['girl', 'baby', 2]);
  assert.deepEqual([bramble.gender, bramble.outfit], ['boy', 'a small blue hat']);
  assert.ok(mallee.size < 0.6 && mallee.reach < 0.4 && mallee.strength === 5);
  assert.deepEqual(mallee.nextStage, { label: 'Joey', at: 20 });
});

test('what the visitor did reaches the koala\'s next prompt', async () => {
  const { grove, calls, advance } = setup();
  grove.act({ koala: 'mallee', kind: 'say', text: 'Do you like frogs?' });
  grove.play();
  grove.heartbeat();
  await round(grove, advance, 5000);
  const p = calls.find((c) => c.koala === 'mallee').prompt;
  assert.match(p, /The visitor said: "Do you like frogs\?"/);
});

test('memories, usage and Play survive a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-'));
  const file = path.join(dir, 'grove.sqlite');
  const a = setup({ path: file, decide: () => ({ ok: true, raw: { action: 'sit', remember: 'The visitor is kind' }, usage: USAGE }) });
  a.grove.play();
  a.grove.heartbeat();
  await round(a.grove, a.advance, 5000);
  a.grove.close();
  const b = setup({ path: file });
  const s = b.grove.state();
  assert.equal(s.playing, true);
  assert.deepEqual(s.koalas[0].memories, ['The visitor is kind']);
  assert.equal(s.usage.total.calls, 2);
  b.grove.close();
});

test('the visitor can set the time of day; the day count never goes back', async () => {
  const { grove, calls, advance } = setup();
  assert.equal(grove.state().clock.label, 'Day 1 · 08:00');
  grove.setTime('night');
  assert.equal(grove.state().clock.label, 'Day 1 · 22:00');
  assert.equal(grove.state().clock.phase, 'night');
  grove.setTime('morning'); // earlier than now: that is tomorrow morning
  assert.equal(grove.state().clock.label, 'Day 2 · 07:00');
  grove.setTime('noon');
  assert.equal(grove.state().clock.label, 'Day 2 · 12:00');
  grove.setTime('evening');
  assert.equal(grove.state().clock.label, 'Day 2 · 18:30');
  assert.ok(grove.state().log.some((e) => e.kind === 'system' && /evening/.test(e.text)));
  const status = (fn) => { try { fn(); return 200; } catch (err) { return err.status; } };
  assert.equal(status(() => grove.setTime('teatime')), 400);
  // The koalas notice, and the next prompt carries the new time.
  grove.play();
  grove.heartbeat();
  await round(grove, advance, 5000);
  const p = calls.find((c) => c.koala === 'mallee').prompt;
  assert.match(p, /Day 2 · 18:3/);
  assert.match(p, /evening/i);
});

test('builds are shared by both koalas, sent to the page, and survive a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-build-'));
  const file = path.join(dir, 'grove.sqlite');
  const a = setup({ path: file, decide: () => ({ ok: true, raw: { action: 'build', target: 'hut', build_name: 'Leafy Home' }, usage: USAGE }) });
  a.grove.play();
  a.grove.heartbeat();
  await round(a.grove, a.advance, 5000);
  let s = a.grove.state();
  assert.equal(s.builds.length, 1, 'both koalas worked on one hut');
  assert.equal(s.builds[0].title, 'Leafy Home');
  assert.equal(s.builds[0].progress, 3, 'the second koala built together with the first');
  assert.match(s.places[s.builds[0].plot].name, /Leafy Home/);
  assert.ok(s.plots.length >= 8 && s.lands.length >= 1 && s.blueprints.hut);
  a.grove.close();
  const b = setup({ path: file });
  s = b.grove.state();
  assert.equal(s.builds[0].progress, 3);
  assert.equal(s.koalas[0].place, s.builds[0].plot);
  b.grove.close();
});
