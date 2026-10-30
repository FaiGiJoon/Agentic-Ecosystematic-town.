// Canvas drawing for Goldenrod: map tiles, overworld sprites, text boxes and pages.
// Everything is drawn at Game Boy resolution (8x8 tiles, 144 px tall) and scaled up.

import { Font } from './font.js';

export const SCREEN_H = 144;
const BORDER_BLOCKS = 6; // border metatiles drawn around the map, like the overworld map buffer

// Overworld sprite frames (data/sprites/facings.asm): tile offsets of each 16x16 frame.
const FRAME = { down: 0, up: 4, left: 8, walkDown: 12, walkUp: 16, walkLeft: 20 };

// Crystal's day/night split (engine/overworld/time.asm): MORN 4-9, DAY 10-17, NITE 18-3.
export function timeOfDay(hour) {
  if (hour >= 4 && hour < 10) return 'morn';
  if (hour >= 10 && hour < 18) return 'day';
  return 'nite';
}

// GBC screen colour (Gambatte's colour correction): the raw 5-bit colours look far more
// saturated on a PC monitor than they did on the handheld's LCD.
function lcd([r8, g8, b8]) {
  const [r, g, b] = [r8 >> 3, g8 >> 3, b8 >> 3];
  return [
    Math.min(255, (r * 13 + g * 2 + b) >> 1),
    Math.min(255, (g * 3 + b) << 1),
    Math.min(255, (r * 3 + g * 2 + b * 11) >> 1),
  ];
}

function tileImage(px, pal, transparent) {
  const img = new ImageData(8, 8);
  for (let i = 0; i < 64; i++) {
    const c = parseInt(px[i], 16);
    const [r, g, b] = lcd(pal[c]);
    img.data.set([r, g, b, transparent && c === 0 ? 0 : 255], i * 4);
  }
  return img;
}

export class Renderer {
  constructor(canvas, data) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = data;
    this.font = new Font(data.font);
    this.spriteCache = new Map();
    this.time = null;
    this.w = 160;
  }

  // Switch to another map (the Gym interior): its own tiles, palettes and sprites.
  setData(data) {
    this.data = data;
    this.spriteCache.clear();
    const time = this.time;
    this.time = null;
    if (time) this.setTime(time);
  }

  resize(cols) {
    this.w = cols * 8;
    this.canvas.width = this.w;
    this.canvas.height = SCREEN_H;
    this.ctx.imageSmoothingEnabled = false;
  }

  setTime(time) {
    if (time === this.time) return;
    this.time = time;
    this.spriteCache.clear();
    this.buildMap();
  }

  // The whole map (plus border) pre-rendered once per palette set.
  buildMap() {
    const { map, metatiles, tiles } = this.data;
    const pal = this.data.palettes.bg[this.time];
    const bw = map.width + 2 * BORDER_BLOCKS;
    const bh = map.height + 2 * BORDER_BLOCKS;
    const c = document.createElement('canvas');
    c.width = bw * 32;
    c.height = bh * 32;
    const ctx = c.getContext('2d');
    const blockCanvas = new Map();
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const mx = bx - BORDER_BLOCKS;
        const my = by - BORDER_BLOCKS;
        const inside = mx >= 0 && my >= 0 && mx < map.width && my < map.height;
        const id = inside ? map.blocks[my * map.width + mx] : map.border;
        if (!blockCanvas.has(id)) {
          const b = document.createElement('canvas');
          b.width = b.height = 32;
          const bctx = b.getContext('2d');
          metatiles[id].forEach(([t, p], i) => {
            bctx.putImageData(tileImage(tiles[t], pal[p], false), (i % 4) * 8, (i >> 2) * 8);
          });
          blockCanvas.set(id, b);
        }
        ctx.drawImage(blockCanvas.get(id), bx * 32, by * 32);
      }
    }
    this.mapCanvas = c;
  }

  // One 16x16 frame per (sprite, palette, frame); flipped frames are drawn mirrored.
  spriteFrame(name, palette, frame) {
    const key = `${name}:${palette}:${frame}`;
    let c = this.spriteCache.get(key);
    if (!c) {
      const sprite = this.data.sprites[name];
      const pal = this.data.palettes.obj[this.time][palette];
      const base = sprite.tiles[frame] ? frame : frame % 12;
      c = document.createElement('canvas');
      c.width = c.height = 16;
      const tctx = c.getContext('2d');
      for (let i = 0; i < 4; i++) {
        const t = document.createElement('canvas');
        t.width = t.height = 8;
        t.getContext('2d').putImageData(tileImage(sprite.tiles[base + i], pal, true), 0, 0);
        tctx.drawImage(t, (i & 1) * 8, (i >> 1) * 8);
      }
      this.spriteCache.set(key, c);
    }
    return c;
  }

  // facing + walk phase (0 stand, 1 walk, 2 stand, 3 walk mirrored) -> frame and flip,
  // following FacingStep{Down,Up,Left,Right}{0..3}.
  static pose(facing, phase) {
    const walking = phase % 2 === 1;
    switch (facing) {
      case 'down': return { frame: walking ? FRAME.walkDown : FRAME.down, flip: phase === 3 };
      case 'up': return { frame: walking ? FRAME.walkUp : FRAME.up, flip: phase === 3 };
      case 'left': return { frame: walking ? FRAME.walkLeft : FRAME.left, flip: false };
      default: return { frame: walking ? FRAME.walkLeft : FRAME.left, flip: true };
    }
  }

  drawWorld(camX, camY, actors) {
    const { ctx } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, SCREEN_H);
    const off = BORDER_BLOCKS * 32;
    ctx.drawImage(this.mapCanvas, Math.round(-camX - off), Math.round(-camY - off));
    // Lower actors draw in front, the way OAM priority by y works out on screen.
    for (const a of [...actors].sort((p, q) => p.py - q.py)) {
      const { frame, flip } = Renderer.pose(a.facing, a.phase);
      const img = this.spriteFrame(a.sprite, a.palette, frame);
      // Overworld sprites sit 4 px above their tile.
      const x = Math.round(a.px - camX);
      const y = Math.round(a.py - camY - 4);
      if (flip) {
        ctx.save();
        ctx.translate(x + 16, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(img, x, y);
      }
    }
  }

  // ---- text (tile grid: col, row in 8 px units) ----
  glyphCanvas(ch) {
    const key = `glyph:${this.time}:${ch}`;
    let c = this.spriteCache.get(key);
    if (!c) {
      const pal = this.data.palettes.bg[this.time][7]; // PAL_BG_TEXT
      c = document.createElement('canvas');
      c.width = c.height = 8;
      c.getContext('2d').putImageData(tileImage(this.font.glyph(ch), pal, false), 0, 0);
      this.spriteCache.set(key, c);
    }
    return c;
  }

  frameCanvas(name) {
    const key = `frame:${this.time}:${name}`;
    let c = this.spriteCache.get(key);
    if (!c) {
      const pal = this.data.palettes.bg[this.time][7];
      c = document.createElement('canvas');
      c.width = c.height = 8;
      c.getContext('2d').putImageData(tileImage(this.font.frame(name), pal, false), 0, 0);
      this.spriteCache.set(key, c);
    }
    return c;
  }

  text(str, col, row) {
    let x = col;
    for (const ch of str) {
      this.ctx.drawImage(this.glyphCanvas(ch), x * 8, row * 8);
      x++;
    }
  }

  // A framed box like TextboxBorder (home/text.asm): corners, edges, blank inside.
  box(col, row, w, h) {
    const { ctx } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let t = ' ';
        if (y === 0) t = x === 0 ? '┌' : x === w - 1 ? '┐' : '─';
        else if (y === h - 1) t = x === 0 ? '└' : x === w - 1 ? '┘' : '─';
        else if (x === 0 || x === w - 1) t = '│';
        ctx.drawImage(t === ' ' ? this.glyphCanvas(' ') : this.frameCanvas(t), (col + x) * 8, (row + y) * 8);
      }
    }
  }

  get cols() { return this.w / 8; }

  // The overworld text box: bottom six rows, two lines of text on rows 14 and 16.
  dialog(lines, { arrow = false, shown = Infinity } = {}) {
    this.box(0, 12, this.cols, 6);
    let left = shown;
    lines.forEach((l, i) => {
      const part = l.slice(0, Math.max(0, left));
      left -= l.length;
      this.text(part, 1, 14 + 2 * i);
    });
    if (arrow) this.text('▼', this.cols - 2, 16);
  }

  // A YES/NO style menu box at the right, above the text box.
  menu(items, cursor, { col = null, row = null } = {}) {
    const w = Math.max(...items.map((s) => s.length)) + 4;
    const h = items.length * 2 + 1;
    const c = col ?? this.cols - w;
    const r = row ?? 12 - h;
    this.box(c, r, w, h);
    items.forEach((s, i) => {
      this.text(i === cursor ? '▶' : ' ', c + 1, r + 1 + 2 * i);
      this.text(s, c + 2, r + 1 + 2 * i);
    });
  }

  // The landmark sign shown when the town loads (engine/events/map_name_sign.asm).
  mapName(name) {
    const w = name.length + 2;
    this.box(0, 0, w, 3);
    this.text(name, 1, 1);
  }

  // A full-screen page: title, wrapped body lines (scrolled), and a link menu.
  page({ title, lines, scroll, links, cursor, arrowDown }) {
    const { ctx } = this;
    const pal = this.data.palettes.bg[this.time][7];
    ctx.fillStyle = `rgb(${lcd(pal[0]).join(',')})`;
    ctx.fillRect(0, 0, this.w, SCREEN_H);
    this.box(0, 0, this.cols, 18);
    this.text(title, 1, 1);
    const bodyRows = Page.bodyRows(links.length);
    lines.slice(scroll, scroll + bodyRows).forEach((l, i) => this.text(l, 1, 3 + i));
    if (arrowDown) this.text('▼', this.cols - 2, 3 + bodyRows - 1);
    links.forEach((l, i) => {
      const row = 17 - links.length + i;
      this.text(i === cursor ? '▶' : ' ', 1, row);
      this.text(l.label.slice(0, this.cols - 4), 2, row);
    });
  }

  fade(level, color = 'white') {
    if (level <= 0) return;
    this.ctx.fillStyle = color === 'white' ? `rgba(255,255,255,${level})` : `rgba(0,0,0,${level})`;
    this.ctx.fillRect(0, 0, this.w, SCREEN_H);
  }
}

// Page layout numbers shared by the renderer and the input code.
export const Page = {
  // Rows 3..16 hold text; links take the last rows of that space.
  bodyRows(nLinks) { return 14 - (nLinks ? nLinks + 1 : 0); },
};
