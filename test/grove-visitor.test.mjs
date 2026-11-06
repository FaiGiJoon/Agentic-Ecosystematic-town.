import test from 'node:test';
import assert from 'node:assert/strict';
import { Grove } from '../hq/grove.js';
import { DECISION_SCHEMA, parseDecision, newKoala, systemPrompt } from '../hq/grove-world.js';

const USAGE = { cost_usd: 0.001, tokens_in: 900, tokens_out: 40, duration_ms: 800 };

// A grove whose koalas answer with whatever `reply(koala, request)` returns.
function setup(reply) {
  let t = Date.UTC(2026, 10, 6, 12);
  const calls = [];
  const grove = new Grove({
    config: { dayUsd: 5 },
    think: async (req) => {
      calls.push(req);
      return { ok: true, raw: { action: 'sit', ...reply(req.koala, req) }, usage: USAGE };
    },
    now: () => t,
    rng: () => 0.5,
  });
  const step = async (ms = 95000) => { t += ms; grove.heartbeat(); grove.tick(); await grove.idle(); };
  return { grove, calls, step };
}
const koala = (g, id) => g.state().koalas.find((k) => k.id === id);

test('schema: koalas can answer the visitor and ask for things', () => {
  for (const f of ['to_visitor', 'need']) assert.ok(DECISION_SCHEMA.required.includes(f));
  const d = parseDecision({ action: 'eat', to_visitor: ' Hi  there! ', need: 'two stone for the bridge' }, newKoala('crystal'));
  assert.equal(d.toVisitor, 'Hi there!');
  assert.equal(d.need, 'two stone for the bridge');
  const sys = systemPrompt('crystal');
  assert.match(sys, /always answer when they talk to you: put your answer in to_visitor/);
  assert.match(sys, /write it in need\. It becomes a ticket/);
});

test('what the visitor says is pinned at the top of the prompt until the koala answers', async () => {
  let answer = '';
  const { grove, calls, step } = setup((k) => (k === 'crystal' ? { to_visitor: answer, say: 'Ruby, look!' } : {}));
  grove.play();
  await step(5000);
  grove.act({ koala: 'crystal', kind: 'say', text: 'Have you read a book yet?' });
  // ten busy turns of chatter would have pushed it out of "what happened just now"
  for (let i = 0; i < 2; i++) await step();
  const last = calls.filter((c) => c.koala === 'crystal').at(-1);
  assert.match(last.prompt, /^THE VISITOR IS TALKING TO YOU\. Answer them now in to_visitor[^\n]*\n- The visitor said: "Have you read a book yet\?"/);
  answer = 'Not yet, but I will go to the library!';
  await step();
  assert.deepEqual(koala(grove, 'crystal').visitor, []);
  const reply = grove.state().log.find((e) => e.kind === 'reply');
  assert.equal(reply.koala, 'crystal');
  assert.equal(reply.text, 'Not yet, but I will go to the library!');
  await step();
  assert.doesNotMatch(calls.filter((c) => c.koala === 'crystal').at(-1).prompt, /THE VISITOR IS TALKING/);
});

test('an unanswered message stays for three turns, then fades', async () => {
  const { grove, calls, step } = setup(() => ({}));
  grove.play();
  await step(5000);
  grove.act({ koala: 'ruby', kind: 'say', text: 'Hi!' });
  for (let i = 0; i < 6; i++) await step();
  const ruby = calls.filter((c) => c.koala === 'ruby').slice(1).map((c) => /THE VISITOR IS TALKING/.test(c.prompt));
  assert.deepEqual(ruby.slice(0, 4), [true, true, true, false]);
  assert.deepEqual(koala(grove, 'ruby').visitor, []);
});

test('a koala answers quickly when spoken to', async () => {
  const { grove, calls, step } = setup(() => ({}));
  grove.play();
  await step(5000);
  const before = calls.length;
  await step(13000); // past the 12 s gap since its last decision
  grove.act({ koala: 'crystal', kind: 'say', text: 'Hello?' });
  await step(5100);
  assert.ok(calls.slice(before).some((c) => c.koala === 'crystal' && /Hello\?/.test(c.prompt)), 'within about 5 s');
});

test('need becomes a ticket without giving up the action, once, and at most three wait', async () => {
  let need = 'Two stone for the bridge to Stone Crag';
  const { grove, step } = setup((k) => (k === 'crystal' ? { action: 'nap', need } : {}));
  grove.play();
  await step(5000);
  const c = koala(grove, 'crystal');
  assert.equal(c.activity, 'nap', 'the action still happened');
  const mine = () => grove.state().tickets.filter((t) => t.koala === 'crystal');
  assert.equal(mine().length, 1);
  assert.equal(mine()[0].text, need);
  assert.ok(c.recent.some((r) => /You asked the visitor in a ticket/.test(r)));
  assert.ok(grove.state().log.some((e) => e.kind === 'ticket' && /Crystal filed a ticket/.test(e.text)));
  await step();
  assert.equal(mine().length, 1, 'the same need is not filed twice');
  for (const n of ['A ladder please', 'Some sand', 'A telescope']) {
    need = n;
    await step();
  }
  assert.equal(mine().length, 3);
  assert.ok(koala(grove, 'crystal').recent.some((r) => /three of your tickets are already waiting/.test(r)));
});

test('a ticket answer is pinned too, and the koala answers it', async () => {
  let answer = '';
  const { grove, calls, step } = setup((k) => (k === 'crystal' ? { need: 'More wood', to_visitor: answer } : {}));
  grove.play();
  await step(5000);
  const t = grove.state().tickets[0];
  grove.replyTicket(t.id, 'I put 5 wood in the Stockpile');
  answer = 'Thank you so much!';
  await step();
  const p = calls.filter((c) => c.koala === 'crystal').at(-1).prompt;
  assert.match(p, /THE VISITOR IS TALKING TO YOU[^]*answered your ticket "More wood": "I put 5 wood in the Stockpile"/);
  assert.equal(grove.state().log.filter((e) => e.kind === 'reply').at(-1).text, 'Thank you so much!');
});

test('a wish becomes a ticket, and a new wish replaces the old one', async () => {
  let wish = 'Build a tall star-watching tower at Lookout Rock';
  const { grove, step } = setup((k) => (k === 'crystal' ? { wish } : {}));
  grove.play();
  await step(5000);
  const mine = () => grove.state().tickets.filter((t) => t.koala === 'crystal');
  assert.deepEqual(mine().map((t) => t.text), ['My wish: Build a tall star-watching tower at Lookout Rock']);
  await step();
  assert.equal(mine().length, 1, 'the same wish is filed once');
  wish = 'Sail to a faraway island';
  await step();
  assert.deepEqual(mine().map((t) => [t.text, t.status]), [['My wish: Sail to a faraway island', 'open']], 'the old wish ticket is closed');
});

test('a wish already held before this change is filed on the next decision', async () => {
  const { grove, step } = setup(() => ({}));
  grove.world.koalas.ruby.wish = 'Sleep high in a gum tree and watch the moon rise';
  grove.play();
  await step(5000);
  assert.ok(grove.state().tickets.some((t) => t.koala === 'ruby' && /moon rise/.test(t.text)));
});

test('every 15 decisions a koala reflects on what it really wants, and asks for it', async () => {
  const { grove, calls, step } = setup((k, req) => (k === 'crystal' && /TIME TO REFLECT/.test(req.prompt) ? { need: 'More time at the library and more web searches' } : {}));
  grove.play();
  await step(5000);
  for (let i = 0; i < 15; i++) await step();
  const crystal = calls.filter((c) => c.koala === 'crystal');
  const reflecting = crystal.map((c, i) => (/TIME TO REFLECT/.test(c.prompt) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(reflecting, [15], 'on the 16th call, after 15 decisions');
  assert.match(crystal[15].prompt, /more freedom, more access/);
  assert.ok(grove.state().tickets.some((t) => t.koala === 'crystal' && /more web searches/.test(t.text)));
});

// --- helpdesk: approve or decline -------------------------------------------------------------

import { grantTicket, resourcesIn, GRANT_RESEARCH, PLOTS } from '../hq/grove-world.js';

test('resourcesIn reads amounts from a request', () => {
  assert.deepEqual(resourcesIn('Please bring 3 wood and 3 stone, and 2 more books'), { wood: 3, stone: 3, book: 2 });
  assert.deepEqual(resourcesIn('99 sand'), { sand: 12 }, 'capped');
  assert.deepEqual(resourcesIn('a ladder'), {});
});

test('approving a wish to build: it stands finished in the grove', async () => {
  const { grove, step } = setup((k) => (k === 'crystal' ? { wish: 'Build a tall star-watching tower at Lookout Rock so I can find the brightest crystal' } : {}));
  grove.play();
  await step(5000);
  const t = grove.state().tickets.find((x) => x.koala === 'crystal');
  grove.decideTicket(t.id, true);
  const s = grove.state();
  const b = s.builds.find((x) => x.gift);
  assert.ok(b && b.done, 'a finished build');
  assert.equal(b.title, 'Build a tall star-watching tower at Lookout');
  assert.equal(b.spec.shape, 'tower');
  assert.equal(b.spec.size, 'big');
  assert.equal(s.tickets.length, 0, 'decided tickets leave the board');
  const c = koala(grove, 'crystal');
  assert.match(c.visitor[0].text, /The visitor APPROVED your ticket "My wish: Build a tall star-watching tower[^"]*": the .* stands finished in the grove\./);
  assert.ok(s.log.some((e) => e.kind === 'built' && /The visitor built the/.test(e.text)));
  assert.ok(s.log.some((e) => e.kind === 'visitor' && e.action === 'approve'));
  assert.throws(() => grove.decideTicket(t.id, false), /already decided/);
});

test('approving resources fills the Stockpile; approving more research adds trips today', () => {
  const w = { koalas: { crystal: newKoala('crystal') }, builds: [], stock: { wood: 1 } };
  const g = grantTicket(w, 'crystal', 'Please bring 3 wood and 2 stone for the tower');
  assert.deepEqual(w.stock, { wood: 4, stone: 2 });
  assert.equal(w.builds.length, 0, 'resources, not a free build');
  assert.match(g.summary, /3 wood and 2 stone are now in the Stockpile/);
  const r = grantTicket(w, 'crystal', 'More time at the library and more web searches');
  assert.equal(r.research, GRANT_RESEARCH);
  assert.deepEqual(w.koalas.crystal.allowed, ['Please bring 3 wood and 2 stone for the tower', 'More time at the library and more web searches']);
});

test('approving a bridge to an island builds that bridge', () => {
  const w = { koalas: { ruby: newKoala('ruby') }, builds: [], stock: {} };
  grantTicket(w, 'ruby', 'Could you build a bridge to Stone Crag?');
  assert.ok(w.builds.some((b) => b.kind === 'bridge_stone_crag' && b.done));
});

test('with no free plot, an approved build comes as materials so the koalas build it themselves', () => {
  const w = { koalas: { ruby: newKoala('ruby') }, builds: [], stock: {} };
  // every plot taken by something still being built, so no land rises and nothing is free
  PLOTS.forEach((p, i) => w.builds.push({ id: i + 1, kind: 'custom', title: `b${i}`, spec: { shape: 'house', size: 'small', parts: [], colors: ['brown'], design: '' }, plot: p.id, done: false, progress: 0, effort: 2, by: 'ruby', helpers: [] }));
  const g = grantTicket(w, 'ruby', 'Make a small moon perch');
  assert.equal(w.builds.some((b) => b.gift), false);
  assert.deepEqual(w.stock, { wood: 2 });
  assert.match(g.summary, /you can build it yourself/);
});

test('declining: the koala hears it cannot have it, and has to ask again in a new ticket', async () => {
  let need = 'A boat to sail far away';
  const { grove, step } = setup((k) => (k === 'ruby' ? { need } : {}));
  grove.play();
  await step(5000);
  const t = grove.state().tickets.find((x) => x.koala === 'ruby');
  grove.decideTicket(t.id, false);
  assert.equal(grove.state().builds.filter((b) => b.gift).length, 0);
  assert.match(koala(grove, 'ruby').visitor[0].text, /DECLINED your ticket "A boat to sail far away"\. You cannot have it\. If you still want it, file a new ticket/);
  need = 'A boat to sail far away, because I want to see where the moon sets';
  await step();
  assert.ok(grove.state().tickets.some((x) => x.koala === 'ruby' && /moon sets/.test(x.text)), 'a new ticket is allowed');
});

test('approved research trips raise today\'s limit', async () => {
  const { grove, calls, step } = setup((k, req) => (req.kind ? {} : k === 'crystal' ? { action: 'research', target: 'Why?' } : {}));
  grove.world.builds = [{ id: 1, kind: 'bridge_library_isle', title: 'Bridge', plot: null, progress: 4, effort: 4, done: true, by: 'crystal', helpers: ['crystal'] }];
  grove.world.koalas.crystal.place = 'library_isle';
  const t = grove.tickets.open('crystal', 'More web searches please');
  grove.decideTicket(t.id, true);
  grove.play();
  for (let i = 0; i < 40; i++) await step(70000);
  assert.equal(calls.filter((c) => c.kind === 'research').length, 16 + GRANT_RESEARCH);
});
