// Pure procedural helpers behind the grove's look: seeded hashing, tileable value
// noise and fbm, and a height-to-normal conversion. No three.js and no DOM, so the
// tests run them under Node and the same numbers drive terrain, textures and scattering.

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod = (n, m) => ((n % m) + m) % m;

// A well-mixed integer hash to [0, 1).
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Lattices for tiling noise are hashed once and reused: texture baking samples the same few
// lattices millions of times, and a table lookup is several times cheaper than four hashes.
const tables = new Map();
function table(seed, period) {
  const key = seed * 8192 + period;
  let t = tables.get(key);
  if (!t) {
    t = new Float32Array(period * period);
    for (let y = 0; y < period; y++) for (let x = 0; x < period; x++) t[y * period + x] = hash2(x, y, seed);
    tables.set(key, t);
  }
  return t;
}

// Value noise in [0, 1]. With period > 0 the lattice wraps every `period` cells, so a
// texture sampled over 0..period tiles without a seam.
export function valueNoise(x, y, seed = 0, period = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  let a;
  let b;
  let c;
  let d;
  if (period > 0) {
    const t = table(seed, period);
    const ix = mod(x0, period);
    const iy = mod(y0, period);
    const jx = ix + 1 === period ? 0 : ix + 1;
    const jy = iy + 1 === period ? 0 : iy + 1;
    a = t[iy * period + ix];
    b = t[iy * period + jx];
    c = t[jy * period + ix];
    d = t[jy * period + jx];
  } else {
    a = hash2(x0, y0, seed);
    b = hash2(x0 + 1, y0, seed);
    c = hash2(x0, y0 + 1, seed);
    d = hash2(x0 + 1, y0 + 1, seed);
  }
  const u = fade(fx);
  const v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal noise in [0, 1]. Lacunarity must be an integer when `period` is used.
export function fbm(x, y, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0, period = 0 } = {}) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, seed + o * 101, period ? period * f : 0);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

// Sharp creases: 1 along the ridges of the noise, 0 in the valleys.
export function ridged(x, y, opts) {
  return 1 - Math.abs(fbm(x, y, opts) * 2 - 1);
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Tangent-space normal map (RGBA bytes) from a height field. `heights` is row-major with
// row 0 at v = 0; the field wraps, so a tiling height map gives a tiling normal map.
export function heightToNormal(heights, w, h, strength = 2) {
  const out = new Uint8Array(w * h * 4);
  const at = (x, y) => heights[mod(y, h) * w + mod(x, w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const o = (y * w + x) * 4;
      out[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}
