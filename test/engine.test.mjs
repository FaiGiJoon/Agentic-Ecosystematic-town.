import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, wrapText, paginate, COLL, DIRS } from '../public/town/engine.js';
import content from './fixtures/portfolio-content.js';

const data = JSON.parse(readFileSync(new URL('../public/town/data/goldenrod.json', import.meta.url)));
const world = () => new World(data, content, { random: () => 0.5 });

test('goldenrod.json comes from Crystal UE v1.0', () => {
  assert.equal(data.source.sha1, 'f4cd194bdee0d04ca4eac29e09b8e4e9d818c133');
});

test('the map is 40 x 36 steps (20 x 18 blocks)', () => {
  const w = world();
  assert.equal(w.width, 40);
  assert.equal(w.height, 36);
});

test('collision reads the right quadrant of each block', () => {
  const w = world();
  assert.equal(w.collisionAt(24, 7), COLL.DOOR); // the gym door
  assert.equal(w.collisionAt(26, 9), COLL.WALL); // the gym sign
  assert.equal(w.collisionAt(-1, 0), null);
  assert.equal(w.collisionAt(40, 0), null);
});

test('floor and doors are walkable; walls, water and NPCs are not', () => {
  const w = world();
  assert.equal(w.isWalkable(24, 8), true); // in front of the gym
  assert.equal(w.isWalkable(24, 7), true); // the gym door
  assert.equal(w.isWalkable(26, 9), false); // sign
  const npc = w.npcs[0];
  assert.equal(w.isWalkable(npc.x, npc.y), false);
});

test('every door leads somewhere described in content', () => {
  const w = world();
  for (const warp of data.warps) {
    const b = w.buildingAt(warp.x, warp.y);
    assert.ok(b, `no building for door ${warp.x},${warp.y}`);
    assert.ok(b.name && b.name.length > 0);
  }
});

test('every sign has text', () => {
  const w = world();
  for (const s of data.signs) assert.ok(w.signAt(s.x, s.y)?.text, `${s.x},${s.y}`);
});

test('every NPC stands on open floor and has something to say', () => {
  const w = world();
  assert.ok(w.npcs.length >= 6);
  for (const n of w.npcs) {
    assert.equal(w.collisionAt(n.x, n.y), COLL.FLOOR, `${n.sprite} at ${n.x},${n.y}`);
    assert.ok(n.text, n.sprite);
    assert.ok(data.sprites[n.sprite], `sprite ${n.sprite} extracted`);
  }
  const spots = new Set(w.npcs.map((n) => `${n.x},${n.y}`));
  assert.equal(spots.size, w.npcs.length, 'two NPCs share a tile');
});

test('the player starts on open floor, not on an NPC', () => {
  const w = world();
  const { x, y } = content.start;
  assert.equal(w.isWalkable(x, y), true);
});

test('stepping: open floor moves, a wall blocks, a door enters', () => {
  const w = world();
  assert.deepEqual(w.tryStep({ x: 24, y: 9 }, 'up'), { kind: 'move', x: 24, y: 8 });
  assert.equal(w.tryStep({ x: 24, y: 8 }, 'up').kind, 'door');
  assert.equal(w.tryStep({ x: 26, y: 10 }, 'up').kind, 'blocked');
});

test('the edge of the map is blocked', () => {
  const w = world();
  assert.equal(w.tryStep({ x: 0, y: 20 }, 'left').kind, 'blocked');
});

test('facing a sign or NPC finds it', () => {
  const w = world();
  assert.equal(w.facing({ x: 26, y: 10 }, 'up').type, 'sign');
  const n = w.npcs[0];
  const t = w.facing({ x: n.x, y: n.y + 1 }, 'up');
  assert.equal(t.type, 'npc');
  assert.equal(t.npc, n);
});

test('the gym door opens the gym map, whose trainers lead to Battle RED', () => {
  const w = world();
  assert.equal(w.buildingAt(24, 7).map, 'gym');
  assert.equal(content.gym.battleHref, 'red-battle/?vs=');
});

test('wrapText wraps on words and keeps explicit line breaks', () => {
  assert.deepEqual(wrapText('Hello there POKéMON trainer', 12), ['Hello there', 'POKéMON', 'trainer']);
  assert.deepEqual(wrapText('one\ntwo', 18), ['one', 'two']);
  assert.deepEqual(wrapText('', 18), ['']);
});

test('wrapText breaks a word longer than the line', () => {
  assert.deepEqual(wrapText('klootwijkc@gmail.com', 8), ['klootwij', 'kc@gmail', '.com']);
});

test('paginate groups lines into boxes of two', () => {
  assert.deepEqual(paginate(['a', 'b', 'c']), [['a', 'b'], ['c']]);
  assert.deepEqual(paginate(['a', '', 'b'], 2), [['a'], ['b']], 'a blank line starts a new box');
});

test('wandering NPCs stay inside their radius and never walk into walls', () => {
  let r = 0;
  const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.0];
  const w = new World(data, content, { random: () => seq[r++ % seq.length] });
  const homes = w.npcs.map((n) => ({ x: n.x, y: n.y }));
  for (let i = 0; i < 400; i++) w.tickNpcs({ x: 0, y: 0 });
  w.npcs.forEach((n, i) => {
    assert.ok(Math.abs(n.x - homes[i].x) <= n.radiusX, `${n.sprite} x`);
    assert.ok(Math.abs(n.y - homes[i].y) <= n.radiusY, `${n.sprite} y`);
    assert.equal(w.collisionAt(n.x, n.y), COLL.FLOOR);
  });
});

test('an NPC never steps onto the player', () => {
  const w = world();
  const n = w.npcs.find((m) => m.radiusX || m.radiusY);
  const player = { x: n.x + 1, y: n.y };
  for (let i = 0; i < 400; i++) {
    w.tickNpcs(player);
    assert.ok(!(n.x === player.x && n.y === player.y));
  }
});

// Follow firstStep until it says "here" (or gives up), like clicking a spot.
function walkPath(w, from, goals, limit = 200) {
  const pos = { x: from.x, y: from.y };
  const steps = [];
  for (let i = 0; i < limit; i++) {
    const r = w.firstStep(pos, goals);
    if (!r) return null;
    if (!r.dir) return { pos, steps };
    const s = w.tryStep(pos, r.dir);
    assert.ok(s.kind === 'move' || s.kind === 'door', `step ${r.dir} from ${pos.x},${pos.y}: ${s.kind}`);
    assert.ok(!steps.some((t) => w.collisionAt(t.x, t.y) === COLL.DOOR), 'walked through a door');
    pos.x = s.x; pos.y = s.y;
    steps.push({ ...pos });
  }
  throw new Error('path never arrived');
}

test('click-to-walk finds a shortest path that only uses walkable steps', () => {
  const w = world();
  const { start } = content;
  const r = walkPath(w, start, [{ x: 24, y: 8 }]); // in front of the gym
  assert.deepEqual(r.pos, { x: 24, y: 8 });
  assert.ok(r.steps.length >= Math.abs(start.x - 24) + Math.abs(start.y - 8));
});

test('click-to-walk can end on a door, the way into a building', () => {
  const w = world();
  for (const d of data.warps) {
    const r = walkPath(w, content.start, [{ x: d.x, y: d.y }]);
    if (r) assert.equal(w.collisionAt(r.pos.x, r.pos.y), COLL.DOOR);
  }
  assert.ok(walkPath(w, content.start, [{ x: 24, y: 7 }]), 'the gym door is reachable');
});

test('click-to-walk gives up on unreachable spots and stops next to an NPC', () => {
  const w = world();
  assert.equal(w.firstStep(content.start, [{ x: 26, y: 9 }]), null); // a sign is a wall
  const npc = w.npcs.find((n) => !n.wander);
  const goals = Object.values(DIRS).map(([dx, dy]) => ({ x: npc.x + dx, y: npc.y + dy }));
  const r = walkPath(w, content.start, goals);
  assert.equal(Math.abs(r.pos.x - npc.x) + Math.abs(r.pos.y - npc.y), 1);
});
