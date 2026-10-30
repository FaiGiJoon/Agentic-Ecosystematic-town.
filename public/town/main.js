// Agent HQ: Goldenrod City (from the portfolio's town) where CLAUDE works on tickets.
import { World, DIRS, COLL, wrapText, paginate } from './engine.js';
import { Renderer, Page, SCREEN_H, timeOfDay } from './render.js';
import content from './content.js';
import {
  displayText, ticker, bubble, claudeGoal, nextPhase, boardItems,
  ticketLines, ticketMenu, claudeSays, outcomeDue,
} from './hq-view.js';
import { api, connect } from './live.js';

const STEP_FRAMES = 16; // NPCs' walking speed: one 16 px step per 16 frames
const WALK_FRAMES = 12; // the player walks a bit quicker than that
const RUN_FRAMES = 6; // and runs with Space held, or when walking to a click
const TURN_FRAMES = 4; // a tap turns the player without stepping
const NPC_PAUSE = [60, 180]; // frames between a wanderer's steps
const STUCK_FRAMES = 8 * 60; // CLAUDE gives up walking and is placed on its goal after ~8 s
const BUBBLE_MS = 3000;
const MAX_LINKS = 8; // menu rows on a page; longer menus scroll
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  z: 'A', Z: 'A', Enter: 'A', ' ': 'A', x: 'B', X: 'B', Escape: 'B', Backspace: 'B',
};

const canvas = document.getElementById('screen');
const status = document.getElementById('status');
const box = document.getElementById('ticket-box');
const boxTitle = document.getElementById('tb-title');
const boxBody = document.getElementById('tb-body');
const boxError = document.getElementById('tb-error');
const boxHint = document.getElementById('tb-hint');

const boxOpen = () => !box.hidden;

// ---------- input ----------
const held = new Set();
const pressed = new Set();
let lastDir = null;
let spaceHeld = false;
function press(btn) {
  if (!held.has(btn)) pressed.add(btn);
  held.add(btn);
  if (DIRS[btn]) lastDir = btn;
}
function release(btn) {
  held.delete(btn);
  if (lastDir === btn) lastDir = [...held].reverse().find((b) => DIRS[b]) || null;
}
function releaseAll() { held.clear(); lastDir = null; spaceHeld = false; }
addEventListener('keydown', (e) => {
  // The new-ticket box owns the keyboard while it is open.
  if (boxOpen() || (e.target instanceof Node && box.contains(e.target))) return;
  if (e.key === ' ') spaceHeld = true;
  const btn = KEYS[e.key];
  if (!btn) return;
  e.preventDefault();
  press(btn);
});
addEventListener('keyup', (e) => {
  if (e.key === ' ') spaceHeld = false;
  const btn = KEYS[e.key];
  if (btn) release(btn);
});
addEventListener('blur', releaseAll);
for (const el of document.querySelectorAll('[data-btn]')) {
  const btn = el.dataset.btn;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (boxOpen()) return;
    el.setPointerCapture?.(e.pointerId);
    press(btn);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => release(btn));
}
// Tapping the screen works as A while text is up; while walking, click (or hold
// and drag) to walk there, or click someone to go and talk to them.
let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  if (boxOpen()) return;
  if (ui.mode !== 'walk') { press('A'); return; }
  canvas.setPointerCapture?.(e.pointerId);
  dragging = true;
  aim(e);
});
canvas.addEventListener('pointermove', (e) => { if (dragging && ui.mode === 'walk') aim(e); });
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { dragging = false; release('A'); });

function aim(e) {
  const r = canvas.getBoundingClientRect();
  const px = cam.x + ((e.clientX - r.left) * view.w) / r.width;
  const py = cam.y + ((e.clientY - r.top) * SCREEN_H) / r.height;
  // NPCs are drawn 4 px above their step, so hit-test their sprite first.
  const npc = world.npcs.find((n) => px >= n.x * 16 && px < n.x * 16 + 16 && py >= n.y * 16 - 4 && py < n.y * 16 + 12);
  walkTo = npc ? { npc } : { x: Math.floor(px / 16), y: Math.floor(py / 16) };
}

// ---------- state ----------
let data;
let world;
let view;
let claude = null; // CLAUDE's NPC object in world.npcs
const player = { x: 0, y: 0, facing: 'down', sprite: 'CHRIS', palette: 0, step: 0, stepFrames: WALK_FRAMES, from: null, phase: 0, parity: 0, turn: 0 };
let ui = { mode: 'walk' };
let walkTo = null; // click-to-walk target: { x, y } or { npc }
let cam = { x: 0, y: 0 };
let talking = null; // the NPC the player is talking to

// Live HQ state, kept up to date by the event stream.
let tickets = [];
let agent = { status: 'idle', ticket: null, step: null };
let prevAgent = null;
let phase = 'idle'; // idle | pickup | work | handin
let phaseFrames = 0; // frames spent walking towards this phase's goal
let speech = { text: null, until: 0 }; // CLAUDE's bubble
let outcome = null; // '!' or '?' waiting for CLAUDE to reach the board
let offline = false; // the event stream dropped or the state did not load

// ?time=morn|day|nite previews another time of day; otherwise the visitor's clock decides.
const forcedTime = ['morn', 'day', 'nite'].find((t) => t === new URLSearchParams(location.search).get('time'));

const show = (s) => displayText(s, view.font);

function fit() {
  // Game Boy height (144 px), as wide as the window allows: 20 to 40 tiles, scaled by whole pixels.
  const coarse = matchMedia('(pointer: coarse)').matches;
  const stage = document.querySelector('.stage');
  const availW = stage.clientWidth - 32;
  const availH = stage.clientHeight - (coarse ? 210 : 40);
  const aspect = availW / Math.max(1, availH);
  view.resize(Math.max(20, Math.min(40, Math.floor((SCREEN_H * aspect) / 16) * 2)));
  const scale = Math.max(1, Math.floor(Math.min(availW / view.w, availH / SCREEN_H)));
  canvas.style.width = `${view.w * scale}px`;
  canvas.style.height = `${SCREEN_H * scale}px`;
  layout();
}

// ---------- text ----------
function say(text, then) {
  ui = { mode: 'dialog', raw: (Array.isArray(text) ? text : [text]).map(show), page: 0, shown: 0, then };
  layout();
}

// How many menu rows a page shows at once.
const shownLinks = (p) => Math.min(p.links.length, MAX_LINKS);

// Wrap the open text box or page to the current screen width.
function layout() {
  if (ui.mode === 'dialog') {
    ui.pages = paginate(ui.raw.flatMap((t) => [...wrapText(t, view.cols - 2), '']));
    ui.page = Math.min(ui.page, ui.pages.length - 1);
  } else if (ui.mode === 'page') {
    layoutPage(ui);
  } else if (ui.mode === 'box') {
    layoutPage(ui.back);
  }
}
function layoutPage(p) {
  // Pages keep their last column free for the ▼ arrow; '' is a blank line.
  p.lines = p.raw.flatMap((t) => (t === '' ? [''] : wrapText(show(t), view.cols - 3)));
  p.title = show(p.heading).slice(0, view.cols - 2);
  p.scroll = Math.min(p.scroll, Math.max(0, p.lines.length - Page.bodyRows(shownLinks(p))));
  p.cursor = Math.min(p.cursor, Math.max(0, p.links.length - 1));
  fixLinkTop(p);
}
function fixLinkTop(p) {
  const n = shownLinks(p);
  p.linkTop = Math.max(0, Math.min(p.linkTop || 0, p.cursor, p.links.length - n));
  if (p.cursor >= p.linkTop + n) p.linkTop = p.cursor - n + 1;
}
function closeUi() {
  for (const n of world.npcs) n.busy = false;
  talking = null;
  ui = { mode: 'walk' };
}

// ---------- the ticket board (POKéMON CENTER) ----------
function boardPage(door) {
  const n = tickets.length;
  const links = boardItems(tickets).map((label, i) => ({
    label,
    id: i === 0 ? null : Number(/^#(\d+)/.exec(label)?.[1]),
  }));
  return {
    mode: 'page', kind: 'board', heading: 'TICKET BOARD', door,
    raw: [`${n} TICKET${n === 1 ? '' : 'S'}.`, 'Pick one, or NEW TICKET to add one.'],
    links, scroll: 0, cursor: 0, linkTop: 0,
  };
}
function openBoard(door, cursorId) {
  ui = boardPage(door);
  if (cursorId !== undefined) ui.cursor = Math.max(0, ui.links.findIndex((l) => l.id === cursorId));
  layout();
}
// A new ticket or status change: rebuild the board in place, keeping the cursor on the same ticket.
function refreshBoard(p) {
  const id = p.links[p.cursor]?.id ?? null;
  const next = boardPage(p.door);
  p.raw = next.raw;
  p.links = next.links;
  const i = p.links.findIndex((l) => l.id === id);
  if (i >= 0) p.cursor = i;
  layoutPage(p);
}

// A blank line before REQUEST, HISTORY and RESULT.
function ticketRaw(t) {
  const lines = ticketLines(t, t.events);
  // The header is title, status, owner and maybe usage; REQUEST follows it.
  const request = lines.indexOf('REQUEST', 3);
  const history = request + 1 + String(t.body || '').split(/\r?\n/).length;
  const result = history + 1 + (t.events || []).length;
  for (const at of [result, history, request]) lines.splice(at, 0, '');
  return lines;
}
function ticketLinks(t) {
  return ticketMenu(t).map((label) => ({ label }));
}
async function openTicket(id, door) {
  const p = {
    mode: 'page', kind: 'ticket', ticketId: id, heading: `TICKET #${id}`, door,
    raw: ['Loading...'], links: [{ label: 'BACK' }], scroll: 0, cursor: 0, linkTop: 0, seq: 0,
  };
  ui = p;
  layout();
  await reloadTicket(p);
}
// Fetch the ticket again and re-layout the page, keeping scroll and cursor where they make sense.
async function reloadTicket(p) {
  const seq = ++p.seq;
  let t;
  try {
    t = await api.ticket(p.ticketId);
  } catch (err) {
    if (seq !== p.seq) return;
    p.raw = [`Could not load the ticket: ${err.message}`];
    layoutPage(p);
    return;
  }
  if (seq !== p.seq) return; // a newer reload is on its way
  // The first load puts the cursor on the first action; later loads keep it on the same one.
  const label = p.loaded ? p.links[p.cursor]?.label : null;
  p.loaded = true;
  p.raw = ticketRaw(t);
  p.links = ticketLinks(t);
  const i = p.links.findIndex((l) => l.label === label);
  p.cursor = i >= 0 ? i : 0;
  layoutPage(p);
}
async function ticketAction(p, label) {
  if (label === 'BACK') { openBoard(p.door, p.ticketId); return; }
  try {
    if (label === 'ASSIGN TO CLAUDE') await api.assign(p.ticketId);
    else if (label === 'RETRY') await api.retry(p.ticketId);
  } catch (err) {
    say(`Could not do that: ${err.message}`, () => openTicket(p.ticketId, p.door));
    return;
  }
  if (ui === p) reloadTicket(p);
}
function pickLink(p) {
  const link = p.links[p.cursor];
  if (!link) return;
  if (p.kind === 'board') {
    if (link.id === null) openBox(p);
    else openTicket(link.id, p.door);
  } else {
    ticketAction(p, link.label);
  }
}

// Repaint whichever ticket page is open (or under the new-ticket box).
function refreshPages(ticketId) {
  const p = ui.mode === 'box' ? ui.back : ui;
  if (p.mode !== 'page') return;
  if (p.kind === 'board') refreshBoard(p);
  else if (p.kind === 'ticket' && Number(p.ticketId) === Number(ticketId)) reloadTicket(p);
}

// ---------- the new-ticket box ----------
function boxStep(step) {
  for (const el of box.querySelectorAll('.tb-step')) el.hidden = el.dataset.step !== step;
  box.dataset.step = step;
  boxHint.textContent = step === 'title' ? 'ENTER next  ESC cancel' : 'ENTER save  SHIFT+ENTER new line  ESC cancel';
  (step === 'title' ? boxTitle : boxBody).focus();
}
function openBox(back) {
  releaseAll();
  ui = { mode: 'box', back };
  boxTitle.value = '';
  boxBody.value = '';
  boxError.textContent = '';
  box.hidden = false;
  boxStep('title');
}
function closeBox(next) {
  box.hidden = true;
  boxError.textContent = '';
  document.activeElement?.blur?.();
  next();
}
async function submitBox() {
  const back = ui.back;
  boxTitle.disabled = boxBody.disabled = true;
  try {
    const t = await api.create({ title: boxTitle.value, body: boxBody.value });
    if (!tickets.some((x) => x.id === t.id)) tickets.push(t);
    closeBox(() => openTicket(t.id, back.door));
  } catch (err) {
    boxError.textContent = err.message;
  } finally {
    boxTitle.disabled = boxBody.disabled = false;
    if (boxOpen()) (box.dataset.step === 'title' ? boxTitle : boxBody).focus();
  }
}
box.addEventListener('submit', (e) => e.preventDefault());
function cancelBox() {
  const back = ui.back;
  closeBox(() => { ui = back; refreshBoard(back); });
}
document.getElementById('tb-cancel').addEventListener('click', cancelBox);
box.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelBox();
    return;
  }
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.target.id === 'tb-cancel') return;
  e.preventDefault();
  if (e.repeat || boxTitle.disabled) return;
  if (box.dataset.step === 'title') {
    if (!boxTitle.value.trim()) { boxError.textContent = 'Type a title first.'; return; }
    boxError.textContent = '';
    boxStep('body');
  } else {
    submitBox();
  }
});

// ---------- doors ----------
// Leaving a door: the tile below it, or a free floor tile next to that one if CLAUDE
// stands there, or else the door tile itself. The player never lands on CLAUDE.
function placeOutside(door) {
  const front = { x: door.x, y: door.y + 1 };
  const free = (x, y) => world.collisionAt(x, y) === COLL.FLOOR && !world.npcAt(x, y);
  const spot = [front, { x: front.x - 1, y: front.y }, { x: front.x + 1, y: front.y }, { x: front.x, y: front.y + 1 }]
    .find((t) => free(t.x, t.y)) || door;
  Object.assign(player, { x: spot.x, y: spot.y, from: null, step: 0, facing: 'down' });
}

function enterDoor(b, door) {
  const stepBack = () => placeOutside(door);
  if (b?.kind === 'board') {
    ui = { mode: 'fade', t: 0, dir: 1, then: () => openBoard(door) };
  } else if (b?.kind === 'desk') {
    say(claudeSays(agent, tickets), stepBack);
  } else {
    say('CLOSED. Nobody works here yet.', stepBack);
  }
}

function exitBuilding(door) {
  ui = { mode: 'fade', t: 1, dir: -1, then: closeUi };
  if (door) placeOutside(door);
}

// ---------- CLAUDE ----------
function goalTile() {
  const goal = claudeGoal(agent, phase);
  if (goal === 'home') return { x: claude.homeX, y: claude.homeY };
  return content.spots[goal];
}
function claudeAtGoal() {
  const g = goalTile();
  return claude.x === g.x && claude.y === g.y && !claude.anim;
}
function advance(next) {
  const p = nextPhase(prevAgent, next, phase, claudeAtGoal());
  prevAgent = next;
  agent = next;
  const was = phase;
  if (p !== phase) { phase = p; phaseFrames = 0; }
  if (outcome && outcomeDue(was, phase)) { sayBubble(outcome); outcome = null; }
}
function sayBubble(text) {
  speech = { text, until: performance.now() + BUBBLE_MS };
}

// One frame of CLAUDE walking to where its phase wants it.
function driveClaude() {
  if (talking === claude || claudeAtGoal()) {
    if (claudeAtGoal()) claude.facing = 'up'; // facing the building
    return;
  }
  const g = goalTile();
  const playerOn = (t) => (player.x === t.x && player.y === t.y) || (player.from && player.from.x === t.x && player.from.y === t.y);
  if (++phaseFrames > STUCK_FRAMES && !playerOn(g)) {
    // Path blocked: put CLAUDE on its goal, but never onto the player.
    Object.assign(claude, { x: g.x, y: g.y, anim: 0 });
    phaseFrames = 0;
    return;
  }
  const next = world.firstStep(claude, [g]);
  if (!next?.dir) return;
  const [dx, dy] = DIRS[next.dir];
  const x = claude.x + dx;
  const y = claude.y + dy;
  claude.facing = next.dir;
  // The player's tile, and the one they are leaving, are taken.
  if (playerOn({ x, y })) return;
  claude.fromX = claude.x; claude.fromY = claude.y;
  claude.x = x; claude.y = y;
  claude.anim = STEP_FRAMES;
  claude.phase ^= 2;
}

function updateNpcs() {
  if (claude) {
    advance(agent);
    claude.busy = phase !== 'idle' || talking === claude;
  }
  for (const n of world.npcs) {
    if (n.anim > 0) { n.anim--; continue; }
    if (n === claude && phase !== 'idle') { driveClaude(); continue; }
    if (n.busy || !(n.radiusX || n.radiusY)) continue;
    n.wait = (n.wait ?? rand(NPC_PAUSE)) - 1;
    if (n.wait <= 0) {
      n.wait = rand(NPC_PAUSE);
      // The tile the player is leaving is still taken until the step ends.
      world.stepNpc(n, { x: player.x, y: player.y, toX: player.from?.x, toY: player.from?.y });
      if (n.moved) { n.moved = false; n.anim = STEP_FRAMES; n.phase ^= 2; }
    }
  }
}

// ---------- live updates ----------
function upsertTicket(t) {
  const i = tickets.findIndex((x) => x.id === t.id);
  if (i >= 0) tickets[i] = t;
  else tickets.push(t);
}
function startLive() {
  connect({
    onState(s) {
      offline = false;
      tickets = s.tickets || [];
      if (s.agent) advance(s.agent);
      const p = ui.mode === 'box' ? ui.back : ui;
      if (p.mode === 'page') refreshPages(p.ticketId);
    },
    onTicket(t) {
      upsertTicket(t);
      refreshPages(t.id);
    },
    onEvent(e) {
      // Shown when CLAUDE gets back to the board (see advance).
      if (e.kind === 'done') outcome = '!';
      else if (e.kind === 'failed') outcome = '?';
      refreshPages(e.ticket_id);
    },
    onOffline() { offline = true; },
    onAgent(a) {
      if (a.step) sayBubble(bubble(a.step));
      advance(a);
    },
  });
}

// ---------- update ----------
function updateWalk() {
  if (player.step > 0) {
    player.step--;
    if (player.step === 0) {
      player.from = null;
      if (world.collisionAt(player.x, player.y) === COLL.DOOR) {
        walkTo = null;
        enterDoor(world.buildingAt(player.x, player.y), { x: player.x, y: player.y });
        return;
      }
    }
    if (player.step > 0) return;
  }

  if (pressed.has('A') && interact()) return;

  const dir = lastDir;
  if (dir) walkTo = null; // the keys take over from a click
  else if (walkTo) { followClick(); return; }
  if (!dir) { player.turn = 0; return; }
  if (player.facing !== dir) {
    player.facing = dir;
    player.turn = TURN_FRAMES;
    return;
  }
  if (player.turn > 0) { player.turn--; return; }
  walk(dir, spaceHeld ? RUN_FRAMES : WALK_FRAMES);
}

// Talk to whoever or whatever the player is facing.
function interact() {
  const t = world.facing(player, player.facing);
  if (t?.type === 'npc') {
    t.npc.facing = OPPOSITE[player.facing];
    t.npc.busy = true;
    talking = t.npc;
    say(t.npc === claude ? claudeSays(agent, tickets) : t.npc.text);
    return true;
  }
  if (t?.type === 'sign') { say(t.sign.text); return true; }
  return false;
}

// One running step along the shortest path to the clicked spot. Clicking an NPC
// or a sign walks up to it and talks.
function followClick() {
  const tx = walkTo.npc ? walkTo.npc.x : walkTo.x;
  const ty = walkTo.npc ? walkTo.npc.y : walkTo.y;
  const talk = walkTo.npc || world.signAt(tx, ty);
  const goals = talk ? Object.values(DIRS).map(([dx, dy]) => ({ x: tx + dx, y: ty + dy })) : [{ x: tx, y: ty }];
  const next = world.firstStep(player, goals);
  if (next?.dir) {
    player.facing = next.dir;
    walk(next.dir, RUN_FRAMES);
    return;
  }
  walkTo = null;
  if (!next) return;
  if (talk) {
    player.facing = Object.keys(DIRS).find((d) => DIRS[d][0] === tx - player.x && DIRS[d][1] === ty - player.y);
    interact();
  }
}

function walk(dir, frames) {
  const r = world.tryStep(player, dir);
  if (r.kind === 'blocked' || r.kind === 'exit') return;
  player.from = { x: player.x, y: player.y };
  player.x = r.x;
  player.y = r.y;
  player.step = player.stepFrames = frames;
  player.parity ^= 1;
}

function rand([lo, hi]) { return lo + Math.floor(Math.random() * (hi - lo)); }

function updatePage(p) {
  const rows = Page.bodyRows(shownLinks(p));
  const maxScroll = Math.max(0, p.lines.length - rows);
  if (pressed.has('down') || (pressed.has('A') && p.scroll < maxScroll && !p.links.length)) {
    if (p.scroll < maxScroll) p.scroll = Math.min(maxScroll, p.scroll + (pressed.has('A') ? rows - 1 : 1));
    else if (p.links.length) p.cursor = (p.cursor + 1) % p.links.length;
  } else if (pressed.has('up')) {
    if (p.links.length && p.scroll >= maxScroll && p.cursor > 0) p.cursor--;
    else p.scroll = Math.max(0, p.scroll - 1);
  } else if (pressed.has('A')) {
    if (p.links.length) pickLink(p);
    else exitBuilding(p.door);
  } else if (pressed.has('B')) {
    if (p.kind === 'ticket') openBoard(p.door, p.ticketId);
    else exitBuilding(p.door);
  }
  fixLinkTop(p);
}

function updateUi() {
  if (ui.mode === 'dialog') {
    const page = ui.pages[ui.page] || [];
    const total = page.reduce((s, l) => s + l.length, 0);
    if (ui.shown < total) {
      ui.shown += held.has('A') || held.has('B') ? 4 : 1;
      return;
    }
    if (pressed.has('A') || pressed.has('B')) {
      if (ui.page + 1 < ui.pages.length) { ui.page++; ui.shown = 0; return; }
      const then = ui.then;
      closeUi();
      then?.();
    }
  } else if (ui.mode === 'page') {
    updatePage(ui);
  } else if (ui.mode === 'fade') {
    ui.t += ui.dir / 12;
    if (ui.t >= 1 || ui.t <= 0) { const then = ui.then; ui.t = Math.max(0, Math.min(1, ui.t)); then(); }
  }
}

// ---------- draw ----------
function actorPos(a, frames, total = STEP_FRAMES) {
  if (!a.from || !frames) return { px: a.x * 16, py: a.y * 16 };
  const k = frames / total;
  return { px: (a.x - (a.x - a.from.x) * k) * 16, py: (a.y - (a.y - a.from.y) * k) * 16 };
}

function drawPage(p) {
  const n = shownLinks(p);
  view.page({
    title: p.title,
    lines: p.lines,
    scroll: p.scroll,
    links: p.links.slice(p.linkTop, p.linkTop + n).map((l) => ({ label: show(l.label) })),
    cursor: p.cursor - p.linkTop,
    arrowDown: p.scroll < p.lines.length - Page.bodyRows(n),
  });
  // More menu rows below the visible ones.
  if (p.linkTop + n < p.links.length) view.text('▼', view.cols - 2, 16);
}

// A one-line box over CLAUDE's head, snapped to the 8 px text grid.
function drawBubble(at) {
  if (!speech.text || performance.now() > speech.until) return;
  const text = show(speech.text);
  const sx = at.px - cam.x;
  const sy = at.py - cam.y - 4;
  if (sx < -16 || sx > view.w || sy < 0 || sy > SCREEN_H) return;
  const w = text.length + 2;
  const col = Math.max(0, Math.min(view.cols - w, Math.round((sx + 8) / 8 - w / 2)));
  const row = Math.max(1, Math.min(18 - 3, Math.floor(sy / 8) - 3));
  view.box(col, row, w, 3);
  view.text(text, col + 1, row + 1);
}

function drawTicker() {
  const line = offline ? 'AGENT HQ  OFFLINE' : ticker(agent, tickets);
  view.text(show(line).padEnd(view.cols).slice(0, view.cols), 0, 0);
}

function draw() {
  view.setTime(forcedTime || timeOfDay(new Date().getHours()));
  if (ui.mode === 'page' || ui.mode === 'box') {
    drawPage(ui.mode === 'box' ? ui.back : ui);
    renderStatus();
    return;
  }
  const p = actorPos(player, player.step, player.stepFrames);
  const half = player.step > player.stepFrames / 2;
  const walkPhase = player.step ? (half ? 1 + 2 * player.parity : 0) : 0;
  let claudeAt = null;
  const actors = [
    { ...p, facing: player.facing, phase: walkPhase, sprite: player.sprite, palette: player.palette },
    ...world.npcs.map((n) => {
      const from = n.anim ? { x: n.fromX, y: n.fromY } : null;
      const q = actorPos({ x: n.x, y: n.y, from }, n.anim);
      if (n === claude) claudeAt = q;
      const ph = n.anim > STEP_FRAMES / 2 ? 1 + (n.phase & 2) : 0;
      return { ...q, facing: n.facing, phase: ph, sprite: n.sprite, palette: n.palette };
    }),
  ];
  // Camera: the player sits at screen (W/2 - 16, 64) like the GB's 10x9 view.
  cam = { x: p.px - (view.w / 2 - 16), y: p.py - 64 };
  view.drawWorld(cam.x, cam.y, actors);
  if (claudeAt) drawBubble(claudeAt);
  drawTicker();
  if (ui.mode === 'dialog') {
    const page = ui.pages[ui.page] || [];
    const total = page.reduce((s, l) => s + l.length, 0);
    const blink = Math.floor(performance.now() / 500) % 2 === 0;
    view.dialog(page, { shown: ui.shown, arrow: ui.shown >= total && blink && ui.page + 1 < ui.pages.length });
  } else if (ui.mode === 'fade') {
    view.fade(ui.t);
  }
  renderStatus();
}

let lastStatus = '';
function renderStatus() {
  // A plain-text copy of what is on screen for screen readers.
  let s = '';
  if (ui.mode === 'dialog') s = (ui.pages[ui.page] || []).join(' ');
  else if (ui.mode === 'page') s = `${ui.title}. ${ui.lines.join(' ')} ${ui.links.map((l) => l.label).join(', ')}`;
  if (s !== lastStatus) { status.textContent = s; lastStatus = s; }
}

// ---------- loop ----------
let acc = 0;
let last = performance.now();
function frame(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= 1000 / 60) {
    acc -= 1000 / 60;
    updateNpcs();
    if (ui.mode === 'walk') updateWalk();
    else updateUi();
    pressed.clear();
  }
  draw();
  requestAnimationFrame(frame);
}

async function boot() {
  data = await (await fetch(new URL('./data/goldenrod.json', import.meta.url))).json();
  world = new World(data, content);
  claude = world.npcs.find((n) => n.id === 'claude') || null;
  view = new Renderer(canvas, data);
  fit();
  addEventListener('resize', fit);
  Object.assign(player, { x: content.start.x, y: content.start.y, facing: content.start.facing });
  say(content.intro);
  document.body.classList.add('ready');
  // ?debug exposes the live state for automated checks.
  if (new URLSearchParams(location.search).has('debug')) {
    window.__town = {
      player, claude,
      get world() { return world; }, get ui() { return ui; }, get view() { return view; },
      get agent() { return agent; }, get phase() { return phase; }, get speech() { return speech; }, get tickets() { return tickets; },
    };
  }
  startLive();
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  document.body.classList.add('failed');
});
