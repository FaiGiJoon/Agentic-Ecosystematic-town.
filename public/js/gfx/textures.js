// Procedural textures for the whole grove: albedo, normal and roughness-carrying maps
// baked once at load from tileable noise (no downloads, no binary assets), plus a few
// hand-drawn canvases (leaf sprays, the particle atlas, the ball). Everything tiles, and
// every material pulls from the same pool so surfaces stay consistent.

import * as THREE from 'three';
import { fbm, ridged, valueNoise, hash2, heightToNormal, smoothstep, rng } from './noise.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t, o) => {
  o[0] = mix(a[0], b[0], t);
  o[1] = mix(a[1], b[1], t);
  o[2] = mix(a[2], b[2], t);
};
const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];

// Runs sampler(u, v, out) over every texel: out = [r, g, b, height] with r, g, b in 0..1
// (sRGB for colour maps). Returns the bytes and the height field.
function bake(size, sampler) {
  const rgba = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      sampler((x + 0.5) / size, (y + 0.5) / size, out);
      const o = (y * size + x) * 4;
      rgba[o] = clamp01(out[0]) * 255;
      rgba[o + 1] = clamp01(out[1]) * 255;
      rgba[o + 2] = clamp01(out[2]) * 255;
      rgba[o + 3] = 255;
      heights[y * size + x] = out[3];
    }
  }
  return { rgba, heights };
}

function dataTexture(rgba, size, { srgb = false, aniso = 8 } = {}) {
  const t = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// An albedo map and its normal map from one sampler.
function pair(size, aniso, sampler, strength) {
  const { rgba, heights } = bake(size, sampler);
  return {
    map: dataTexture(rgba, size, { srgb: true, aniso }),
    normal: dataTexture(heightToNormal(heights, size, size, strength), size, { aniso }),
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function canvasTexture(c, { srgb = true, aniso = 8, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// --- the baked maps ----------------------------------------------------------------------
const GRASS = ['#697e45', '#8ca255', '#adbc72'].map(hex);
const DIRT = ['#c29d68', '#dcb985', '#eed3a3'].map(hex);
const BARK = ['#4a3a2e', '#9a8873', '#e8decd'].map(hex);
const ROCK = ['#7a7066', '#a79c8c', '#cfc6b4'].map(hex);
const WOOD = ['#5e4330', '#8d6a48', '#b88e62'].map(hex);

function grass(size, aniso) {
  const c = [0, 0, 0];
  return pair(size, aniso, (u, v, out) => {
    const patch = fbm(u * 6, v * 6, { octaves: 3, seed: 1, period: 6 });
    const fine = fbm(u * 40, v * 40, { octaves: 2, seed: 2, period: 40 });
    mix3(GRASS[0], GRASS[1], smoothstep(0.25, 0.75, patch), c);
    mix3(c, GRASS[2], smoothstep(0.55, 0.9, fine) * 0.5, c);
    const clover = fbm(u * 24, v * 24, { octaves: 1, seed: 9, period: 24 });
    if (clover > 0.78) mix3(c, [0.36, 0.55, 0.28], 0.5, c);
    const dark = 0.82 + 0.3 * fine;
    out[0] = c[0] * dark;
    out[1] = c[1] * dark;
    out[2] = c[2] * dark;
    out[3] = fine * 0.7 + patch * 0.3;
  }, 2.4);
}

function dirt(size, aniso) {
  const c = [0, 0, 0];
  return pair(size, aniso, (u, v, out) => {
    const big = fbm(u * 5, v * 5, { octaves: 3, seed: 21, period: 5 });
    const grit = fbm(u * 48, v * 48, { octaves: 2, seed: 22, period: 48 });
    const pebble = fbm(u * 28, v * 28, { octaves: 3, seed: 23, period: 28 });
    mix3(DIRT[0], DIRT[1], smoothstep(0.3, 0.7, big), c);
    mix3(c, DIRT[2], smoothstep(0.55, 0.85, grit) * 0.6, c);
    const peb = smoothstep(0.62, 0.76, pebble);
    mix3(c, [0.5, 0.44, 0.37], peb * 0.22, c);
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
    out[3] = grit * 0.5 + peb * 0.4;
  }, 2.4);
}

function bark(size, aniso) {
  const c = [0, 0, 0];
  return pair(size, aniso, (u, v, out) => {
    // long vertical fibres, fissures between them, and slow colour patches
    const fibre = fbm(u * 28, v * 3, { octaves: 3, seed: 31, period: 28 });
    const crack = ridged(u * 9, v * 2, { octaves: 3, seed: 32, period: 9 });
    const patch = fbm(u * 4, v * 4, { octaves: 3, seed: 33, period: 4 });
    const fiss = smoothstep(0.78, 0.97, crack);
    mix3(BARK[1], BARK[2], smoothstep(0.3, 0.75, patch), c);
    mix3(c, BARK[0], fiss * 0.8, c);
    const shade = 0.86 + fibre * 0.28;
    out[0] = c[0] * shade;
    out[1] = c[1] * shade;
    out[2] = c[2] * shade;
    out[3] = fibre * 0.5 - fiss * 0.9;
  }, 4);
}

function rock(size, aniso) {
  const c = [0, 0, 0];
  return pair(size, aniso, (u, v, out) => {
    const warp = fbm(u * 6, v * 6, { octaves: 2, seed: 41, period: 6 });
    const strata = 0.5 + 0.5 * Math.sin((v * 12 + warp * 2.2) * Math.PI * 2);
    const crack = ridged(u * 8, v * 8, { octaves: 4, seed: 42, period: 8 });
    const grain = fbm(u * 60, v * 60, { octaves: 2, seed: 43, period: 60 });
    mix3(ROCK[0], ROCK[1], smoothstep(0.2, 0.8, strata * 0.35 + warp * 0.6), c);
    mix3(c, ROCK[2], smoothstep(0.6, 0.9, grain) * 0.4, c);
    const fiss = smoothstep(0.84, 0.98, crack);
    mix3(c, ROCK[0], fiss * 0.75, c);
    const s = 0.88 + grain * 0.2;
    out[0] = c[0] * s;
    out[1] = c[1] * s;
    out[2] = c[2] * s;
    out[3] = strata * 0.12 + grain * 0.35 - fiss * 0.55 + crack * 0.12;
  }, 2.6);
}

function wood(size, aniso) {
  const c = [0, 0, 0];
  return pair(size, aniso, (u, v, out) => {
    const warp = fbm(u * 3, v * 3, { octaves: 2, seed: 51, period: 3 });
    const grain = 0.5 + 0.5 * Math.sin((u * 18 + warp * 3) * Math.PI * 2);
    const fine = fbm(u * 6, v * 90, { octaves: 2, seed: 52, period: 6 });
    mix3(WOOD[0], WOOD[1], smoothstep(0.1, 0.9, grain * 0.7 + fine * 0.5), c);
    mix3(c, WOOD[2], smoothstep(0.65, 0.95, fine) * 0.5, c);
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
    out[3] = fine * 0.6 + grain * 0.25;
  }, 3);
}

// Fine strands for the koala's fur shells. R is the strand height: a shell is cut where it
// falls below the shell's level, so strands taper toward the tips.
function fur(size, aniso) {
  const { rgba } = bake(size, (u, v, out) => {
    const cells = 120;
    const cx = Math.floor(u * cells);
    const cy = Math.floor(v * cells);
    const fu = u * cells - cx;
    const fv = v * cells - cy;
    // each cell holds one strand: a soft disc of random radius and height
    const rr = 0.28 + hash2(cx, cy, 61) * 0.2;
    const d = Math.hypot(fu - 0.5 - (hash2(cx, cy, 62) - 0.5) * 0.4, fv - 0.5 - (hash2(cx, cy, 63) - 0.5) * 0.4);
    const strand = clamp01(1 - d / rr) * (0.55 + 0.45 * hash2(cx, cy, 64));
    const clump = fbm(u * 14, v * 14, { octaves: 2, seed: 65, period: 14 });
    out[0] = clamp01(strand * (0.7 + clump * 0.5));
    out[1] = hash2(cx, cy, 66);
    out[2] = clump;
    out[3] = 0;
  });
  return dataTexture(rgba, size, { aniso });
}

function waterNormal(size, aniso) {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      heights[y * size + x] = fbm(u * 8, v * 8, { octaves: 4, seed: 71, period: 8 }) * 0.7 + ridged(u * 5, v * 5, { octaves: 2, seed: 72, period: 5 }) * 0.5;
    }
  }
  return dataTexture(heightToNormal(heights, size, size, 5), size, { aniso });
}

// Low-frequency greyscale for breaking up tiling over the whole island.
function macro(size) {
  const { rgba } = bake(size, (u, v, out) => {
    const n = fbm(u * 3, v * 3, { octaves: 3, seed: 81, period: 3 });
    out[0] = out[1] = out[2] = n;
  });
  return dataTexture(rgba, size, { aniso: 1 });
}

// A twisted rope and a woven cloth, as small normal maps.
function ropeNormal(size = 64) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = 0.5 + 0.5 * Math.sin(((x / size) * 3 + (y / size) * 4) * Math.PI * 2);
  return dataTexture(heightToNormal(h, size, size, 2.2), size, { aniso: 4 });
}
function clothNormal(size = 64) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = 0.5 + 0.25 * Math.sin((x / size) * 16 * Math.PI * 2) + 0.25 * Math.sin((y / size) * 16 * Math.PI * 2 + 1.6);
  return dataTexture(heightToNormal(h, size, size, 1.6), size, { aniso: 4 });
}

// --- hand-drawn canvases -------------------------------------------------------------------
// A spray of long, narrow, drooping gum leaves hanging from short twigs, light grey-green so
// each tree can tint it. Leaves have space between them, like a eucalypt's, not a fern's.
function leafSpray(S, aniso) {
  const [c, g] = canvas(S, S);
  const r = rng(5);
  g.lineCap = 'round';
  const twigs = [[0.5, 0.02, 0.5, 0.14], [0.3, 0.05, 0.36, 0.18], [0.7, 0.05, 0.62, 0.17]];
  const leaf = (x, y, len, w, ang, lit) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const grad = g.createLinearGradient(-w, 0, w, 0);
    grad.addColorStop(0, `rgb(${Math.round(222 * lit)},${Math.round(238 * lit)},${Math.round(206 * lit)})`);
    grad.addColorStop(1, `rgb(${Math.round(142 * lit)},${Math.round(184 * lit)},${Math.round(132 * lit)})`);
    g.fillStyle = grad;
    // a curved, tapering blade: a sickle, as on a real eucalypt
    const bend = (r() - 0.5) * w * 3.2;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-w + bend * 0.3, len * 0.28, -w * 0.8 + bend, len * 0.7, bend * 1.4, len);
    g.bezierCurveTo(w * 0.8 + bend, len * 0.7, w + bend * 0.3, len * 0.28, 0, 0);
    g.fill();
    g.strokeStyle = 'rgba(238,248,226,0.8)';
    g.lineWidth = Math.max(1, S / 220);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(bend * 0.4, len * 0.5, bend * 1.4, len * 0.97);
    g.stroke();
    g.restore();
  };
  for (const [tx, ty, ex, ey] of twigs) {
    g.strokeStyle = '#a8946f';
    g.lineWidth = Math.max(2, S / 110);
    g.beginPath();
    g.moveTo(S * tx, S * ty);
    g.lineTo(S * ex, S * ey);
    g.stroke();
    const n = 4 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const t = 0.15 + (i / n) * 0.85;
      const x = S * (tx + (ex - tx) * t);
      const y = S * (ty + (ey - ty) * t);
      const len = S * (0.42 + r() * 0.32);
      leaf(x, y, len, S * (0.03 + r() * 0.016), (r() - 0.5) * 0.85, 0.8 + r() * 0.2);
    }
  }
  return canvasTexture(c, { aniso });
}

// 4x2 atlas of particle shapes, white on transparent: glow, sparkle, heart, leaf,
// droplet, puff, ring, crumb.
export const ATLAS = { glow: 0, sparkle: 1, heart: 2, leaf: 3, drop: 4, puff: 5, ring: 6, crumb: 7 };
function particleAtlas() {
  const C = 64;
  const [c, g] = canvas(C * 4, C * 2);
  const cell = (i, draw) => {
    g.save();
    g.translate((i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2);
    draw();
    g.restore();
  };
  const radial = (r, stops) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [t, a] of stops) gr.addColorStop(t, `rgba(255,255,255,${a})`);
    return gr;
  };
  cell(0, () => {
    g.fillStyle = radial(28, [[0, 1], [0.35, 0.55], [1, 0]]);
    g.fillRect(-C / 2, -C / 2, C, C);
  });
  cell(1, () => {
    g.fillStyle = radial(26, [[0, 0.8], [1, 0]]);
    g.fillRect(-C / 2, -C / 2, C, C);
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 ? 4.5 : 27;
      g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
    g.fill();
  });
  cell(2, () => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, 20);
    g.bezierCurveTo(-34, -2, -20, -26, 0, -10);
    g.bezierCurveTo(20, -26, 34, -2, 0, 20);
    g.fill();
  });
  cell(3, () => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -26);
    g.bezierCurveTo(18, -8, 14, 14, 0, 26);
    g.bezierCurveTo(-14, 14, -18, -8, 0, -26);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -22);
    g.lineTo(0, 22);
    g.stroke();
  });
  cell(4, () => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -24);
    g.bezierCurveTo(14, -2, 16, 6, 0, 22);
    g.bezierCurveTo(-16, 6, -14, -2, 0, -24);
    g.fill();
  });
  cell(5, () => {
    const r = rng(12);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = radial(16, [[0, 0.5], [1, 0]]);
      g.save();
      g.translate((r() - 0.5) * 22, (r() - 0.5) * 22);
      g.fillRect(-16, -16, 32, 32);
      g.restore();
    }
  });
  cell(6, () => {
    g.strokeStyle = '#fff';
    g.lineWidth = 3.5;
    g.beginPath();
    g.arc(0, 0, 24, 0, Math.PI * 2);
    g.stroke();
  });
  cell(7, () => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.roundRect(-9, -6, 18, 12, 4);
    g.fill();
  });
  const t = canvasTexture(c, { srgb: false, aniso: 4 });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function blob() {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)');
  gr.addColorStop(0.5, 'rgba(0,0,0,0.45)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c, { srgb: false, aniso: 1 });
}

function ballTexture(aniso) {
  const [c, g] = canvas(512, 256);
  const cols = ['#f2c14e', '#e8664a', '#7fd1e8', '#e8664a', '#f2c14e', '#6bbf8a'];
  const r = rng(3);
  cols.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect((i * 512) / 6, 0, 512 / 6 + 1, 256);
    for (let k = 0; k < 260; k++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.06})`;
      g.fillRect((i * 512) / 6 + r() * 86, r() * 256, 2 + r() * 3, 2 + r() * 3);
    }
  });
  g.strokeStyle = 'rgba(40,24,18,0.55)';
  g.lineWidth = 3;
  for (let i = 0; i <= 6; i++) {
    g.beginPath();
    g.moveTo((i * 512) / 6, 0);
    g.lineTo((i * 512) / 6, 256);
    g.stroke();
  }
  g.fillStyle = 'rgba(40,24,18,0.5)';
  g.fillRect(0, 0, 512, 10);
  g.fillRect(0, 246, 512, 10);
  return canvasTexture(c, { aniso });
}

function lilyTexture() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, '#79ab5a');
  gr.addColorStop(1, '#4f8040');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(64, 64);
  g.arc(64, 64, 62, 0.35, Math.PI * 2 - 0.35 + 0.0);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(190,225,150,0.55)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 16; i++) {
    const a = 0.35 + (i / 15) * (Math.PI * 2 - 0.7);
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
    g.stroke();
  }
  return canvasTexture(c, { aniso: 4 });
}

// Tree rings for stump tops.
function ringTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#e2c9a0';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(120,80,45,0.5)';
  for (let i = 3; i < 62; i += 3 + (i % 5) * 0.4) {
    g.lineWidth = 0.8 + (i % 4) * 0.25;
    g.beginPath();
    g.ellipse(64 + Math.sin(i) * 1.5, 64 + Math.cos(i * 1.3) * 1.5, i, i * 0.97, 0, 0, Math.PI * 2);
    g.stroke();
  }
  return canvasTexture(c, { aniso: 4 });
}

// Everything, at the size the device can afford. `size` is the big maps' edge (256/384/512).
export function buildTextures({ size = 384, maxAniso = 8 } = {}) {
  const a = Math.min(8, maxAniso);
  const s = size;
  const small = Math.max(128, Math.round(size / 2));
  return {
    grass: grass(s, a),
    dirt: dirt(s, a),
    bark: bark(s, a),
    rock: rock(s, a),
    wood: wood(small, a),
    fur: fur(small * 2 > 512 ? 512 : small * 2, a),
    water: waterNormal(small, a),
    macro: macro(128),
    rope: ropeNormal(),
    cloth: clothNormal(),
    leaf: leafSpray(Math.max(192, small), a),
    atlas: particleAtlas(),
    blob: blob(),
    ball: ballTexture(a),
    lily: lilyTexture(),
    rings: ringTexture(),
  };
}
