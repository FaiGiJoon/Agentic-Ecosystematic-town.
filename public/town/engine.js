// Goldenrod City rules: collision, doors, signs, NPC wandering and text layout.
// No DOM here, so Node tests can drive it.

// constants/collision_constants.asm
export const COLL = { FLOOR: 0x00, WALL: 0x07, WATER: 0x29, WARP_DOWN: 0x70, DOOR: 0x71 };
const WALKABLE = new Set([COLL.FLOOR, COLL.DOOR, COLL.WARP_DOWN]);

export const DIRS = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const DIR_NAMES = Object.keys(DIRS);

export class World {
  constructor(data, content, { random = Math.random } = {}) {
    this.data = data;
    this.content = content;
    this.random = random;
    this.width = data.map.width * 2;
    this.height = data.map.height * 2;
    this.npcs = content.npcs.map((n) => ({
      ...n,
      homeX: n.x, homeY: n.y,
      radiusX: n.wander ? n.wander[0] : 0,
      radiusY: n.wander ? n.wander[1] : 0,
      facing: n.facing || 'down',
      palette: n.palette ?? data.sprites[n.sprite].palette,
      phase: 0, anim: 0,
    }));
  }

  blockAt(bx, by) {
    const { map } = this.data;
    if (bx < 0 || by < 0 || bx >= map.width || by >= map.height) return map.border;
    return map.blocks[by * map.width + bx];
  }

  // Each 32x32 block holds four 16x16 steps: [top-left, top-right, bottom-left, bottom-right].
  collisionAt(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const block = this.blockAt(x >> 1, y >> 1);
    return this.data.collision[block][(y & 1) * 2 + (x & 1)];
  }

  npcAt(x, y, except = null) {
    return this.npcs.find((n) => n !== except && n.x === x && n.y === y) || null;
  }

  isWalkable(x, y) {
    return WALKABLE.has(this.collisionAt(x, y)) && !this.npcAt(x, y);
  }

  buildingAt(x, y) {
    return this.content.buildings[`${x},${y}`] || null;
  }

  signAt(x, y) {
    const text = this.content.signs[`${x},${y}`];
    return text ? { x, y, text } : null;
  }

  // Where a step in `dir` from `pos` would go.
  tryStep(pos, dir) {
    // Walking down off an exit mat (COLL_WARP_CARPET_DOWN) leaves the building.
    if (dir === 'down' && this.collisionAt(pos.x, pos.y) === COLL.WARP_DOWN) return { kind: 'exit', x: pos.x, y: pos.y };
    const [dx, dy] = DIRS[dir];
    const x = pos.x + dx;
    const y = pos.y + dy;
    if (!this.isWalkable(x, y)) return { kind: 'blocked', x: pos.x, y: pos.y };
    if (this.collisionAt(x, y) === COLL.DOOR) return { kind: 'door', x, y, building: this.buildingAt(x, y) };
    return { kind: 'move', x, y };
  }

  // What the player is looking at: an NPC or a sign, or nothing.
  facing(pos, dir) {
    const [dx, dy] = DIRS[dir];
    const x = pos.x + dx;
    const y = pos.y + dy;
    const npc = this.npcAt(x, y);
    if (npc) return { type: 'npc', npc };
    const sign = this.signAt(x, y);
    if (sign) return { type: 'sign', sign };
    return null;
  }

  // Click-to-walk: the first step of a shortest path from `pos` to any of `goals`,
  // or null if none can be reached. Doors only end a path (stepping on one goes
  // inside), and the path never steps down off an exit mat.
  firstStep(pos, goals) {
    const key = (x, y) => `${x},${y}`;
    const want = new Set(goals.map((g) => key(g.x, g.y)));
    if (want.has(key(pos.x, pos.y))) return { dir: null };
    const seen = new Map([[key(pos.x, pos.y), null]]);
    let frontier = [pos];
    while (frontier.length) {
      const next = [];
      for (const p of frontier) {
        const first = seen.get(key(p.x, p.y));
        if (first && this.collisionAt(p.x, p.y) === COLL.DOOR) continue;
        for (const dir of DIR_NAMES) {
          if (dir === 'down' && this.collisionAt(p.x, p.y) === COLL.WARP_DOWN) continue;
          const [dx, dy] = DIRS[dir];
          const x = p.x + dx;
          const y = p.y + dy;
          const k = key(x, y);
          if (seen.has(k) || !this.isWalkable(x, y)) continue;
          seen.set(k, first || dir);
          if (want.has(k)) return { dir: first || dir };
          next.push({ x, y });
        }
      }
      frontier = next;
    }
    return null;
  }

  // One movement decision per NPC. Wanderers step within their radius, the way
  // SPRITEMOVEDATA_WANDER keeps an object near its home tile; others just stand.
  tickNpcs(player) {
    for (const n of this.npcs) this.stepNpc(n, player);
  }

  stepNpc(n, player) {
    if (n.busy || !(n.radiusX || n.radiusY)) return;
    const dir = DIR_NAMES[Math.floor(this.random() * 4) % 4];
    n.facing = dir;
    const [dx, dy] = DIRS[dir];
    const x = n.x + dx;
    const y = n.y + dy;
    if (Math.abs(x - n.homeX) > n.radiusX || Math.abs(y - n.homeY) > n.radiusY) return;
    if (this.collisionAt(x, y) !== COLL.FLOOR || this.npcAt(x, y, n)) return;
    if (player && player.x === x && player.y === y) return;
    if (player && player.toX === x && player.toY === y) return;
    n.fromX = n.x; n.fromY = n.y;
    n.x = x; n.y = y;
    n.moved = true;
  }
}

// A trainer's ROM dialogue (red-battle/trainers.json) made drawable with the overworld font.
export function speech(paras, player = 'TRAINER') {
  return paras.map((p) => p.replaceAll('{PLAYER}', player).replaceAll('…', '...'));
}

// Word-wrap to `cols` characters; explicit "\n" always breaks.
export function wrapText(text, cols) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (let word of para.split(' ')) {
      while (word.length > cols) {
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, cols));
        word = word.slice(cols);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= cols) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// Lines into text boxes of `per` lines; a blank line forces a new box.
export function paginate(lines, per = 2) {
  const pages = [];
  let cur = [];
  for (const l of lines) {
    if (l === '') {
      if (cur.length) pages.push(cur);
      cur = [];
      continue;
    }
    cur.push(l);
    if (cur.length === per) { pages.push(cur); cur = []; }
  }
  if (cur.length) pages.push(cur);
  return pages;
}
