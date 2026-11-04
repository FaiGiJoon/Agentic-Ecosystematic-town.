// The island's shape as pure functions: ground height (with the pond carved into it),
// worn-path coverage, and where trees may grow. The terrain mesh, the splat texture,
// the vegetation scatter and the koalas' footing all read these same numbers.

import { fbm, smoothstep } from './noise.js';

export const ISLAND = 24;
export const POND_R = 4.6;
export const WATER_Y = 0;
// Where the bank meets the water: terrain height crosses WATER_Y at about this radius.
export const SHORE_R = POND_R + 0.5;

// Places that are not trees keep a clear patch of lawn; trees keep a wider one.
const CLEAR = 1.7;
// A build plot keeps this much room around it.
const PLOT_CLEAR = 2.8;

// clear: extra spots (the build plots) where nothing big may stand, without a path to them.
export function makeTerrain(places, { clear = [] } = {}) {
  const pond = places.pond;
  const look = places.lookout;
  const c = places.clearing;

  // Hill under the lookout rock (the rock group sits 1.2 m off the place).
  const lx = look.x + 1.2;
  const lz = look.z + 1.2;

  function height(x, z) {
    const r = Math.hypot(x, z);
    const dp = Math.hypot(x - pond.x, z - pond.z);
    // gentle rolling lawn, flattened toward the pond so the shore is a clean shape
    let h = (fbm(x * 0.045 + 17, z * 0.045 - 9, { octaves: 3, seed: 3 }) - 0.5) * 0.9;
    // (the bank stays above the water out to POND_R + 2, so the lawn never floods)
    const away = smoothstep(POND_R + 2.2, POND_R + 7.5, dp);
    h = h * away + 0.06 * (1 - away);
    // the basin: a smooth bowl, deepest in the middle
    h -= 0.95 * (1 - smoothstep(POND_R - 2.2, POND_R + 0.9, dp));
    // the lookout hill
    const dl = Math.hypot(x - lx, z - lz);
    h += 0.6 * Math.exp(-(dl * dl) / (2 * 3.4 * 3.4));
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
    const len = total - (id === 'pond' ? SHORE_R + 0.2 : 1.2);
    segs.push({ ax: c.x, az: c.z, bx: c.x + (dx / total) * len, bz: c.z + (dz / total) * len });
  }

  // 0..1: how worn the ground is here. Edges wobble so paths do not look ruled.
  function pathMask(x, z) {
    let d = Math.hypot(x - c.x, z - c.z) - 1.3; // the clearing itself
    for (const s of segs) {
      const vx = s.bx - s.ax;
      const vz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz)));
      d = Math.min(d, Math.hypot(x - (s.ax + vx * t), z - (s.az + vz * t)) - 0.55);
    }
    d += (fbm(x * 0.9, z * 0.9, { octaves: 2, seed: 8 }) - 0.5) * 0.55;
    return 1 - smoothstep(-0.05, 0.55, d);
  }

  // True if something big (a tree trunk, a rock) may not be put here.
  function blocked(x, z, pad = 0) {
    if (Math.hypot(x, z) > ISLAND - 1.6) return true;
    if (Math.hypot(x - pond.x, z - pond.z) < SHORE_R + 0.8 + pad) return true;
    if (pathMask(x, z) > 0.25) return true;
    for (const q of Object.values(places)) {
      const r = (q.tree ? 3.2 : CLEAR) + pad;
      if (Math.hypot(x - q.x, z - q.z) < r) return true;
    }
    for (const q of clear) if (Math.hypot(x - q.x, z - q.z) < PLOT_CLEAR + pad) return true;
    return false;
  }

  return { height, pathMask, blocked, ISLAND, POND_R, SHORE_R };
}
