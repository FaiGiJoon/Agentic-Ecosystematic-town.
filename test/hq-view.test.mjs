import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, COLL } from '../public/town/engine.js';
import { Font } from '../public/town/font.js';
import content from '../public/town/content.js';
import portfolio from './fixtures/portfolio-content.js';
import {
  displayText, ticker, bubble, claudeGoal, nextPhase, boardItems,
  ticketLines, ticketMenu, claudeSays, outcomeDue,
} from '../public/town/hq-view.js';

const data = JSON.parse(readFileSync(new URL('../public/town/data/goldenrod.json', import.meta.url)));
const world = new World(data, content, { random: () => 0.5 });
const font = new Font(data.font);
const { board, desk } = content.spots;

test('the board and desk spots are floor and connected', () => {
  assert.equal(world.collisionAt(board.x, board.y), COLL.FLOOR);
  assert.equal(world.collisionAt(desk.x, desk.y), COLL.FLOOR);
  assert.notEqual(world.firstStep(board, [desk]), null);
  assert.notEqual(world.firstStep(desk, [board]), null);
});

test('claude never stands in front of the board or desk door', () => {
  const claude = content.npcs[0];
  const fronts = Object.entries(content.buildings)
    .filter(([, b]) => b.kind === 'board' || b.kind === 'desk')
    .map(([key]) => key.split(',').map(Number))
    .map(([x, y]) => `${x},${y + 1}`);
  assert.equal(fronts.length, 2);
  for (const [name, p] of [['board', board], ['desk', desk], ['home', claude]]) {
    assert.ok(!fronts.includes(`${p.x},${p.y}`), name);
  }
  // Idle wandering stays off them too.
  const [rx, ry] = claude.wander || [0, 0];
  for (const f of fronts) {
    const [fx, fy] = f.split(',').map(Number);
    assert.ok(Math.abs(fx - claude.x) > rx || Math.abs(fy - claude.y) > ry, `wander reaches ${f}`);
  }
  assert.notEqual(world.firstStep(claude, [board]), null);
});

test('claude starts on floor and every building key is a door', () => {
  const claude = content.npcs[0];
  assert.equal(world.collisionAt(claude.x, claude.y), COLL.FLOOR);
  assert.ok(data.sprites[claude.sprite]);
  for (const key of Object.keys(content.buildings)) {
    const [x, y] = key.split(',').map(Number);
    assert.equal(world.collisionAt(x, y), COLL.DOOR, key);
  }
});

test('content covers every portfolio door; only two open', () => {
  assert.deepEqual(Object.keys(content.buildings).sort(), Object.keys(portfolio.buildings).sort());
  assert.deepEqual(content.start, portfolio.start);
  for (const [key, b] of Object.entries(content.buildings)) {
    assert.equal(b.name, portfolio.buildings[key].name);
    if (key !== '15,27' && key !== '5,15') assert.equal(b.kind, 'closed');
  }
  assert.deepEqual(content.buildings['15,27'], { name: 'POKéMON CENTER', kind: 'board' });
  assert.deepEqual(content.buildings['5,15'], { name: 'RADIO TOWER', kind: 'desk' });
});

test('displayText only keeps characters the font has', () => {
  const out = displayText('Héllo 🙂 <x> ñ', font);
  for (const ch of out) assert.ok(font.has(ch), ch);
  assert.ok(out.startsWith('Héllo'));
  assert.ok(out.includes('n'));
});

test('# is drawn by the font', () => {
  assert.equal(font.has('#'), true);
  assert.equal(displayText('#3', font), '#3');
  assert.notEqual(font.glyph('#'), font.glyph('?'));
});

test('fixed strings are drawable', () => {
  const strings = [
    content.title, ...content.intro, ...Object.values(content.signs),
    ...Object.values(content.buildings).map((b) => b.name), content.npcs[0].text,
    claudeSays({ status: 'idle' }, []), 'ASSIGN TO CLAUDE', 'RETRY', 'BACK', 'NEW TICKET',
    'REQUEST', 'HISTORY', 'RESULT', 'FOR: NOBODY',
  ];
  for (const s of strings) for (const ch of s) assert.ok(font.has(ch), `${ch} in ${s}`);
});

test('ticker and bubble', () => {
  assert.equal(ticker({ status: 'idle', ticket: null, step: null }, []), 'CLAUDE  IDLE');
  assert.equal(ticker({ status: 'working', ticket: 3, step: { label: 'WEB', detail: 'x' } }, []), 'CLAUDE  #3  WEB SEARCH');
  assert.equal(bubble({ label: 'THINK' }), '...');
  assert.equal(bubble(null), '...');
  for (const l of ['READ', 'WEB', 'WRITE', 'SEARCH']) assert.equal(bubble({ label: l }), l);
});

test('claude walks idle -> pickup -> work -> handin -> idle', () => {
  const idle = { status: 'idle', ticket: null, step: null };
  const working = { status: 'working', ticket: 1, step: null };
  let p = 'idle';
  assert.equal(claudeGoal(idle, p), 'home');
  p = nextPhase(idle, idle, p, true); assert.equal(p, 'idle');
  p = nextPhase(idle, working, p, false); assert.equal(p, 'pickup');
  assert.equal(claudeGoal(working, p), 'board');
  p = nextPhase(working, working, p, false); assert.equal(p, 'pickup');
  p = nextPhase(working, working, p, true); assert.equal(p, 'work');
  assert.equal(claudeGoal(working, p), 'desk');
  p = nextPhase(working, working, p, true); assert.equal(p, 'work');
  p = nextPhase(working, idle, p, false); assert.equal(p, 'handin');
  assert.equal(claudeGoal(idle, p), 'board');
  p = nextPhase(idle, idle, p, false); assert.equal(p, 'handin');
  p = nextPhase(idle, idle, p, true); assert.equal(p, 'idle');
  assert.equal(claudeGoal(idle, p), 'home');
});

const t = (id, status, title, extra = {}) => ({
  id, title, body: 'do it\nnow', assignee: null, status, output: null,
  note_path: null, created_at: `2026-10-30T10:0${id}:00Z`, updated_at: '', ...extra,
});

test('ticketMenu', () => {
  assert.deepEqual(ticketMenu(t(1, 'open', 'a')), ['ASSIGN TO CLAUDE', 'BACK']);
  assert.deepEqual(ticketMenu(t(1, 'failed', 'a')), ['RETRY', 'BACK']);
  assert.deepEqual(ticketMenu(t(1, 'done', 'a')), ['BACK']);
  assert.deepEqual(ticketMenu(t(1, 'queued', 'a')), ['BACK']);
});

test('boardItems: new ticket first, newest first, max 18 chars', () => {
  const items = boardItems([t(1, 'open', 'old'), t(3, 'queued', 'a very long ticket title indeed'), t(2, 'done', 'mid')]);
  assert.equal(items[0], 'NEW TICKET');
  assert.equal(items[1], '#3 QUEUED  a very ');
  assert.equal(items[1].length, 18);
  assert.equal(items[2], '#2 DONE  mid');
  assert.equal(items[3], '#1 OPEN  old');
  assert.deepEqual(boardItems([]), ['NEW TICKET']);
});

test('ticketLines', () => {
  const at = '2026-10-30T10:05:00Z';
  const d = new Date(at);
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const lines = ticketLines(t(4, 'done', 'Fix', { assignee: 'claude', output: 'all good' }),
    [{ id: 1, ticket_id: 4, at, kind: 'step', text: 'READ a.md' }]);
  assert.deepEqual(lines, ['Fix', 'STATUS: DONE', 'FOR: CLAUDE', 'REQUEST', 'do it', 'now',
    'HISTORY', `${hh} STEP READ a.md`, 'RESULT', 'all good']);
  assert.equal(ticketLines(t(5, 'open', 'x'), [])[2], 'FOR: NOBODY');
});

test('ticketLines shows usage once a run has it', () => {
  const lines = ticketLines(t(6, 'done', 'Fix', { assignee: 'claude', cost_usd: 0.4123, tokens_in: 52010, tokens_out: 3100, duration_ms: 23400 }), []);
  assert.equal(lines[3], 'USAGE: 0.41 USD  52K IN  3.1K OUT  23S');
  assert.ok([...lines[3]].every((c) => font.has(c)));
  assert.equal(ticketLines(t(7, 'done', 'Tiny', { cost_usd: 0.004, tokens_in: 900, tokens_out: 12, duration_ms: 400 }), [])[3],
    'USAGE: 0.00 USD  900 IN  12 OUT  0S');
  assert.equal(ticketLines(t(8, 'open', 'x'), [])[3], 'REQUEST');
});

test('claudeSays', () => {
  assert.equal(claudeSays({ status: 'idle', ticket: null, step: null }, []), 'No tickets for me. Add one at the POKéMON CENTER!');
  assert.equal(
    claudeSays({ status: 'working', ticket: 2, step: { label: 'READ', detail: 'a.md' } }, [t(2, 'working', 'Fix it')]),
    'Working on #2: Fix it. Now: READING a.md');
  assert.equal(
    claudeSays({ status: 'working', ticket: 2, step: { label: 'WEB', detail: 'goldenrod' } }, []),
    'Working on #2. Now: WEB SEARCH goldenrod');
  assert.equal(claudeSays({ status: 'working', ticket: 2, step: { label: 'THINK', detail: '' } }, []),
    'Working on #2. Now: THINKING');
  assert.equal(claudeSays({ status: 'working', ticket: 9, step: null }, []), 'Working on #9. Now: THINKING');
});

test('claudeSays when idle and the newest ticket failed', () => {
  const idle = { status: 'idle', ticket: null, step: null };
  assert.equal(claudeSays(idle, [t(1, 'done', 'a'), t(3, 'failed', 'c'), t(2, 'done', 'b')]),
    "I couldn't finish #3. Try RETRY at the board.");
  assert.equal(claudeSays(idle, [t(1, 'failed', 'a'), t(2, 'done', 'b')]),
    'No tickets for me. Add one at the POKéMON CENTER!');
  for (const ch of claudeSays(idle, [t(3, 'failed', 'c')])) assert.ok(font.has(ch), ch);
});

test('fast ticket: pickup drops straight to handin, or idle at the board', () => {
  const idle = { status: 'idle', ticket: null, step: null };
  const working = { status: 'working', ticket: 1, step: null };
  assert.equal(nextPhase(working, idle, 'pickup', false), 'handin');
  assert.equal(nextPhase(working, idle, 'pickup', true), 'idle');
});

test('ticket A -> B between polls hands A in; B starts pickup after handin', () => {
  const a = { status: 'working', ticket: 1, step: null };
  const b = { status: 'working', ticket: 2, step: null };
  let p = nextPhase(a, b, 'work', true);
  assert.equal(p, 'handin');
  p = nextPhase(b, b, p, false); assert.equal(p, 'handin');
  p = nextPhase(b, b, p, true); assert.equal(p, 'pickup');
  assert.equal(claudeGoal(b, p), 'board');
});

test('second ticket starting during handin ends in pickup at the board', () => {
  const idle = { status: 'idle', ticket: null, step: null };
  const b = { status: 'working', ticket: 2, step: null };
  let p = nextPhase(idle, b, 'handin', false);
  assert.equal(p, 'handin');
  assert.equal(nextPhase(b, b, p, true), 'pickup');
});

test('minor: CRLF text, numeric-string ids, spaced titles, emoji titles', () => {
  assert.deepEqual(ticketLines(t(1, 'open', 'x', { body: 'a\r\nb', output: 'c\r\nd' }), []).slice(4, 6), ['a', 'b']);
  assert.match(claudeSays({ status: 'working', ticket: '2', step: null }, [t(2, 'working', 'Fix')]), /#2: Fix\./);
  assert.equal(boardItems([t(1, 'open', 'a   \n  b')])[1], '#1 OPEN  a b');
  const says = displayText(claudeSays({ status: 'working', ticket: 2, step: null }, [t(2, 'working', 'Héllo 🙂 ñ')]), font);
  for (const ch of says) assert.ok(font.has(ch), ch);
});

test('outcomeDue: the done/failed bubble waits until the hand-in reaches the board', () => {
  assert.equal(outcomeDue('work', 'work'), false);
  assert.equal(outcomeDue('work', 'handin'), false);
  assert.equal(outcomeDue('handin', 'handin'), false);
  assert.equal(outcomeDue('pickup', 'pickup'), false);
  assert.equal(outcomeDue('handin', 'idle'), true);
  assert.equal(outcomeDue('handin', 'pickup'), true);
  assert.equal(outcomeDue('pickup', 'idle'), true);
  assert.equal(outcomeDue('idle', 'idle'), true);
});
