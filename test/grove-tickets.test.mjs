import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Tickets, MAX_OPEN_TICKETS } from '../hq/grove-tickets.js';
import { Grove } from '../hq/grove.js';

const USAGE = { cost_usd: 0.001, tokens_in: 100, tokens_out: 10, duration_ms: 5 };

function grove(decide) {
  let t = Date.UTC(2026, 10, 4, 12);
  const g = new Grove({ think: async ({ koala }) => decide(koala), now: () => t, rng: () => 0.5 });
  const step = async (ms = 70000) => {
    t += ms;
    g.heartbeat();
    g.tick();
    await g.idle();
  };
  return { g, step, now: () => t };
}

test('Tickets: open, reply, close, and count what is open', () => {
  const tk = new Tickets(new DatabaseSync(':memory:'));
  const a = tk.open('crystal', 'We cannot reach the sand. The shoal has no bridge and we have no stone.');
  assert.equal(a.status, 'open');
  assert.equal(a.title, 'We cannot reach the sand. The shoal has no bridge and we hav');
  assert.equal(a.title.length, 60);
  assert.equal(tk.openCount('crystal'), 1);
  const r = tk.reply(a.id, 'Try the Lookout Rock for stone!');
  assert.deepEqual([r.status, r.reply], ['answered', 'Try the Lookout Rock for stone!']);
  assert.equal(tk.openCount('crystal'), 0, 'an answered ticket no longer counts as open');
  assert.equal(tk.close(a.id).status, 'closed');
  assert.equal(tk.list().length, 0, 'closed tickets leave the board');
  assert.equal(MAX_OPEN_TICKETS, 3);
});

test('a koala files a ticket by deciding to; a fourth open one is refused', async () => {
  const { g, step } = grove((k) => ({ ok: true, raw: k === 'crystal' ? { action: 'file_ticket', say: 'We need more stone for the bridge' } : { action: 'sit' }, usage: USAGE }));
  g.play();
  for (let i = 0; i < 4; i++) await step();
  const s = g.state();
  const mine = s.tickets.filter((t) => t.koala === 'crystal');
  assert.equal(mine.length, 3);
  assert.equal(mine[0].text, 'We need more stone for the bridge');
  assert.match(s.koalas.find((k) => k.id === 'crystal').recent.join(' '), /already waiting for answers/);
});

test('a ticket with nothing in it is not filed', async () => {
  const { g, step } = grove(() => ({ ok: true, raw: { action: 'file_ticket', say: '' }, usage: USAGE }));
  g.play();
  await step();
  assert.equal(g.state().tickets.length, 0);
});

test('the visitor\'s reply reaches the koala and nudges it; bad replies are refused', async () => {
  const { g, step, now } = grove((k) => ({ ok: true, raw: k === 'ruby' ? { action: 'file_ticket', say: 'Crystal keeps taking my pebbles' } : { action: 'sit' }, usage: USAGE }));
  g.play();
  await step();
  const t = g.state().tickets[0];
  g.replyTicket(t.id, 'Maybe share them and build stepping stones together?');
  const ruby = g.state().koalas.find((k) => k.id === 'ruby');
  assert.match(ruby.recent.at(-1), /The visitor answered your ticket: "Maybe share them/);
  assert.ok(ruby.nextAt - now() <= 12000);
  const status = (fn) => { try { fn(); return 200; } catch (err) { return err.status; } };
  assert.equal(status(() => g.replyTicket(t.id, '')), 400);
  assert.equal(status(() => g.replyTicket(t.id, 'x'.repeat(301))), 400);
  assert.equal(status(() => g.replyTicket(999, 'hi')), 404);
  g.closeTicket(t.id);
  assert.equal(g.state().tickets.length, 0);
});
