// Graphics quality: three tiers, how a device picks its starting tier, and the governor
// that steps down (resolution first, then effects) when frames get slow and carefully
// steps back up when there is headroom. Pure: the scene applies what these return.

export const TIERS = ['low', 'medium', 'high'];

// Everything a tier controls. Geometry is always built at the high capacity and drawn
// with a smaller `count`, so changing tier at run time never rebuilds anything.
export const SETTINGS = {
  low: {
    dprMax: 1.25, shadowMap: 1024, msaa: 0, bloom: false, grade: false, ao: false, sharpen: 0,
    grass: 3500, leaves: 0.4, shells: 0, forest: 0.35, particles: 160, butterflies: 0, texSize: 256,
    terrainRings: 40, terrainSegs: 96, skyOctaves: 3, envSize: 64, stars: 1200, islets: 2,
  },
  medium: {
    dprMax: 1.6, shadowMap: 2048, msaa: 4, bloom: true, grade: true, ao: false, sharpen: 0.25,
    grass: 9000, leaves: 0.7, shells: 3, forest: 0.7, particles: 320, butterflies: 3, texSize: 384,
    terrainRings: 56, terrainSegs: 128, skyOctaves: 4, envSize: 128, stars: 3500, islets: 4,
  },
  high: {
    dprMax: 2, shadowMap: 4096, msaa: 4, bloom: true, grade: true, ao: true, sharpen: 0.35,
    grass: 18000, leaves: 1, shells: 6, forest: 1, particles: 600, butterflies: 6, texSize: 512,
    terrainRings: 72, terrainSegs: 176, skyOctaves: 5, envSize: 256, stars: 7000, islets: 5,
  },
};

export function parseQuality(v) {
  return v === 'auto' || TIERS.includes(v) ? v : 'auto';
}

// A starting tier for this device. Phones start one tier lower than desktops: thermal
// limits matter more than peak speed on a device that is held in the hand.
export function pickInitialTier({ coarsePointer = false, mobile = false, deviceMemory, hardwareConcurrency, width = 1280 } = {}) {
  const cores = hardwareConcurrency ?? 4;
  const mem = deviceMemory ?? 4;
  if (coarsePointer || mobile || width < 700) return cores >= 6 && mem >= 4 ? 'medium' : 'low';
  return cores >= 8 || mem >= 8 ? 'high' : 'medium';
}

// The steps the governor walks, best first, starting from the chosen tier.
export function ladder(start) {
  const out = [];
  for (const tier of [...TIERS].reverse()) {
    if (TIERS.indexOf(tier) > TIERS.indexOf(start)) continue;
    out.push({ tier, scale: 1 });
    // ambient occlusion is the first thing to go: it costs the most for the least
    if (SETTINGS[tier].ao) out.push({ tier, scale: 1, noAO: true });
    out.push({ tier, scale: tier === 'low' ? 0.75 : 0.85, ...(SETTINGS[tier].ao ? { noAO: true } : {}) });
    if (tier === 'low') out.push({ tier, scale: 0.6 });
  }
  return out;
}

// Feeds on frame times; answers 'down', 'up' or null. Slow frames must persist for a few
// seconds before stepping down (a hiccup is not a trend), recovery needs a long calm
// stretch, and after any change it waits before judging again.
export class Governor {
  constructor({ slowMs = 24, fastMs = 18, downAfter = 3, upAfter = 25, settle = 3 } = {}) {
    Object.assign(this, { slowMs, fastMs, downAfter, upAfter, settle });
    this.ema = null;
    this.frames = 0;
    this.slow = 0;
    this.fast = 0;
    this.hold = settle;
  }

  reset() {
    this.ema = null;
    this.frames = 0;
    this.slow = 0;
    this.fast = 0;
    this.hold = this.settle;
  }

  // dt in seconds. Tab switches and other pauses (dt over 0.25 s) are ignored.
  sample(dt, canGoUp = true) {
    if (!(dt > 0) || dt > 0.25) return null;
    this.frames++;
    const ms = dt * 1000;
    this.ema = this.ema == null ? ms : this.ema + (ms - this.ema) * 0.08;
    if (this.hold > 0) {
      this.hold -= dt;
      return null;
    }
    if (this.ema > this.slowMs) {
      this.slow += dt;
      this.fast = 0;
    } else if (this.ema < this.fastMs) {
      this.fast += dt;
      this.slow = Math.max(0, this.slow - dt);
    } else {
      this.slow = Math.max(0, this.slow - dt);
      this.fast = Math.max(0, this.fast - dt * 0.5);
    }
    if (this.slow >= this.downAfter) {
      this.reset();
      return 'down';
    }
    if (canGoUp && this.fast >= this.upAfter) {
      this.reset();
      return 'up';
    }
    return null;
  }
}
