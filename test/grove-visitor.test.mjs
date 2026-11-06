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
