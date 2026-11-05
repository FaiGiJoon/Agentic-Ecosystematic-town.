// The island's shape as pure functions: ground height (with the pond carved into it),
// worn-path coverage, and where trees may grow. The terrain mesh, the splat texture,
// the vegetation scatter and the koalas' footing all read these same numbers.

import { fbm, smoothstep, rng } from './noise.js';

// The island's radius in metres: the server's ISLAND_R (hq/grove-economy.js) is the same number.
export const ISLAND = 107;
export const POND_R = 4.6;
// The waterfall's pool, a smaller basin of the same shape.
export const POOL_R = 3.2;
export const WATER_Y = 0;
// Where the bank meets the water: terrain height crosses WATER_Y at about this radius.
export const SHORE_R = POND_R + 0.5;
export const POOL_SHORE_R = POOL_R + 0.5;
// How far out the beach of the Sandy Cove reaches.
const SAND_R = 10;

// The open water on the island: the pond, and a pool for each place marked pool.
export function poolsOf(places) {
  const out = [{ id: 'pond', x: places.pond.x, z: places.pond.z, r: POND_R, shore: SHORE_R }];
  for (const [id, p] of Object.entries(places)) if (p.pool) out.push({ id, x: p.x, z: p.z, r: POOL_R, shore: POOL_SHORE_R });
  return out;
}

// The rock face behind a waterfall pool: on its far side from the clearing.
export function fallOf(pool, c = { x: 0, z: 2 }) {
  const dx = pool.x - c.x;
  const dz = pool.z - c.z;
  const d = Math.hypot(dx, dz) || 1;
  return { ux: dx / d, uz: dz / d, x: pool.x + (dx / d) * (POOL_R + 1.4), z: pool.z + (dz / d) * (POOL_R + 1.4) };
}

// Places that are not trees keep a clear patch of lawn; trees keep a wider one.
const CLEAR = 1.7;
// A build plot keeps this much room around it.
const PLOT_CLEAR = 2.8;

// clear: extra spots (the build plots) where nothing big may stand, without a path to them.
export function makeTerrain(places, { clear = [], roads = [] } = {}) {
  const look = places.lookout;
  const c = places.clearing;
  const pools = poolsOf(places);
  const misty = places.misty_hill;
  const gully = places.fern_gully;
  const cove = places.sandy_cove;
  const falls = pools.filter((p) => p.id !== 'pond').map((p) => fallOf(p, c));

  // Hill under the lookout rock (the rock group sits 1.2 m off the place).
  const lx = look.x + 1.2;
  const lz = look.z + 1.2;
  const bump = (x, z, cx, cz, h, s) => {
    const dx = x - cx;
    const dz = z - cz;
    return h * Math.exp(-(dx * dx + dz * dz) / (2 * s * s));
  };

  // 0..1: how sandy the ground is (the beach of the Sandy Cove).
  function sandMask(x, z) {
    if (!cove) return 0;
    const d = Math.hypot(x - cove.x, z - cove.z);
    if (d > SAND_R + 2) return 0;
    return 1 - smoothstep(SAND_R - 4, SAND_R, d + (fbm(x * 0.35, z * 0.35, { octaves: 2, seed: 21 }) - 0.5) * 3);
  }

  function height(x, z) {
    const r = Math.hypot(x, z);
    // gentle rolling lawn, and out past the old grove broader swells
    let h = (fbm(x * 0.045 + 17, z * 0.045 - 9, { octaves: 3, seed: 3 }) - 0.5) * 0.9;
    if (r > 36) h += (fbm(x * 0.012 + 5, z * 0.012 - 3, { octaves: 3, seed: 6 }) - 0.5) * 1.6 * smoothstep(36, 70, r);
    // flattened toward each pool, so the shore is a clean shape
    // (the bank stays above the water out to r + 2, so the lawn never floods)
    for (const p of pools) {
      const dp = Math.hypot(x - p.x, z - p.z);
      if (dp > p.r + 8) continue;
      const away = smoothstep(p.r + 2.2, p.r + 7.5, dp);
      h = h * away + 0.06 * (1 - away);
      // the basin: a smooth bowl, deepest in the middle
      h -= 0.95 * (1 - smoothstep(p.r - 2.2, p.r + 0.9, dp));
    }
    // the lookout hill
    h += bump(x, z, lx, lz, 0.6, 3.4);
    // Misty Hill, a broad rise; the waterfall's rock shelf; Fern Gully, a damp dip
    if (misty) h += bump(x, z, misty.x, misty.z, 2.8, 11);
    for (const f of falls) h += bump(x, z, f.x + f.ux * 3.5, f.z + f.uz * 3.5, 1.4, 3);
    if (gully) h -= bump(x, z, gully.x, gully.z, 0.35, 6);
    // the cove slopes gently down to the sea
    if (cove) h -= 0.25 * sandMask(x, z);
    // the island rolls off toward its edge, into the cliff
    h -= 0.9 * smoothstep(ISLAND - 3.2, ISLAND, r);
    return h;
  }

  // Segments of the worn paths: clearing to every other place (to the shore for the pond).
  const segs = [];
  for (const [id, p] of Object.entries(places)) {
    if (id === 'clearing') continue;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const total = Math.hypot(dx, dz);
    const water = pools.find((p) => p.id === id);
    const len = total - (water ? water.shore + 0.2 : 1.2);
    segs.push({ ax: c.x, az: c.z, bx: c.x + (dx / total) * len, bz: c.z + (dz / total) * len });
  }

  // Extra roads: clearing to a point, e.g. a bridge foot that is not a place.
  for (const p of roads) segs.push({ ax: c.x, az: c.z, bx: p.x, bz: p.z });

  // 0..1: how worn the ground is here. Edges wobble so paths do not look ruled.
  function pathMask(x, z) {
    let d = Math.hypot(x - c.x, z - c.z) - 1.3; // the clearing itself
    for (const s of segs) {
      const vx = s.bx - s.ax;
      const vz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz)));
      d = Math.min(d, Math.hypot(x - (s.ax + vx * t), z - (s.az + vz * t)) - 0.55);
    }
    if (d > 0.9) return 0; // the wobble is at most 0.28: too far to be worn
    d += (fbm(x * 0.9, z * 0.9, { octaves: 2, seed: 8 }) - 0.5) * 0.55;
    return 1 - smoothstep(-0.05, 0.55, d);
  }

  // True if something big (a tree trunk, a rock) may not be put here.
  function blocked(x, z, pad = 0) {
    if (Math.hypot(x, z) > ISLAND - 1.6) return true;
    for (const p of pools) if (Math.hypot(x - p.x, z - p.z) < p.shore + 0.8 + pad) return true;
    for (const f of falls) if (Math.hypot(x - f.x, z - f.z) < 3 + pad) return true;
    if (sandMask(x, z) > 0.3) return true;
    if (pathMask(x, z) > 0.25) return true;
    for (const q of Object.values(places)) {
      const r = (q.tree ? 3.2 : CLEAR) + pad;
      if (Math.hypot(x - q.x, z - q.z) < r) return true;
    }
    for (const q of clear) if (Math.hypot(x - q.x, z - q.z) < PLOT_CLEAR + pad) return true;
    return false;
  }

  return { height, pathMask, sandMask, blocked, pools, falls, ISLAND, POND_R, SHORE_R };
}

// Where the bushland extras stand, the same every time for a seed: four paperbarks (Melaleuca,
// they like wet feet) on the pond's bank, and `count` termite mounds out on open grass, all clear
// of places, plots, paths, trees in `avoid` and each other.
export function bushlandSpots(T, places, { avoid = [], seed = 5, count = 3 } = {}) {
  const r = rng(seed * 977 + 13);
  const pond = places.pond;
  const taken = [...avoid];
  const free = (x, z, gap) => taken.every((q) => Math.hypot(q.x - x, q.z - z) > gap);
  const paperbarks = [];
  for (let i = 0; i < 400 && paperbarks.length < 4; i++) {
    const a = r() * Math.PI * 2;
    const d = SHORE_R + 1.6 + r() * 3;
    const x = pond.x + Math.cos(a) * d;
    const z = pond.z + Math.sin(a) * d;
    if (T.blocked(x, z, 0.2) || !free(x, z, 2.6)) continue;
    paperbarks.push({ x, z, yaw: r() * Math.PI * 2, k: 0.85 + r() * 0.35 });
    taken.push({ x, z });
  }
  const mounds = [];
  for (let i = 0; i < 200 * count && mounds.length < count; i++) {
    const a = r() * Math.PI * 2;
    const d = 6 + r() * (ISLAND - 10);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (T.blocked(x, z, 1) || !free(x, z, 3.2)) continue;
    if (Object.values(places).some((q) => Math.hypot(q.x - x, q.z - z) < 3.2)) continue;
    mounds.push({ x, z, yaw: r() * Math.PI * 2, k: 0.8 + r() * 0.45 });
    taken.push({ x, z });
  }
  return { paperbarks, mounds };
}
