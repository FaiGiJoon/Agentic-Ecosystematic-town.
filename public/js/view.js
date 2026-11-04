// Pure helpers between the grove's server state and what the page draws.
// No three.js or DOM here, so the tests can run them under Node.

const SIDE = { crystal: -1, ruby: 1 };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Where a koala stands for a place and activity: apart from its friend, beside
// the pond rather than in it, up the trunk when climbing or eating. reach (0 to 1) is how much of
// the tree this koala is strong enough to climb: babies stay low on the trunk.
export function spotFor(places, placeId, koalaId, activity, reach = 1) {
  const p = places[placeId];
  if (!p) return { x: 0, z: 0, y: 0 };
  const side = SIDE[koalaId] ?? 1;
  if (p.tree && (activity === 'climb' || activity === 'eat')) {
    const a = Math.atan2(-p.z, -p.x) + side * 0.9;
    return { x: p.x + Math.cos(a) * 0.62, z: p.z + Math.sin(a) * 0.62, y: (activity === 'climb' ? 3.0 : 2.4) * reach };
  }
  if (placeId === 'swing' && activity === 'play') return { x: p.x + side * 1.1, z: p.z, y: 0 };
  const r = placeId === 'pond' ? 5.4 : p.tree ? 1.9 : placeId === 'swing' || p.build ? 2.4 : p.land ? 1.4 : 1.6;
  const a = Math.atan2(-p.z, -p.x) + side * 0.55;
  return { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, y: 0 };
}

export function animFor({ activity, place }) {
  if (activity === 'nap') return 'sleep';
  if (activity === 'eat') return 'eat';
  if (activity === 'climb') return 'cling';
  if (activity === 'play') return place === 'swing' ? 'swing' : place === 'pond' ? 'splash' : 'ball';
  if (activity === 'build') return 'build';
  return 'idle';
}

// New land is reached only over its bridge, which runs straight from the island toward the
// land's centre. Returns the waypoints to walk through (none when no bridge is crossed).
export const BRIDGE_IN = 2.5; // the island end of a bridge, this far in from the island's edge
export const bridgeEnds = (land, island = 24) => {
  const d = Math.hypot(land.x, land.z);
  const ux = land.x / d;
  const uz = land.z / d;
  return {
    island: { x: ux * (island - BRIDGE_IN), z: uz * (island - BRIDGE_IN), y: 0 },
    land: { x: land.x - ux * (land.r - 1.2), z: land.z - uz * (land.r - 1.2), y: 0 },
  };
};

export function landRoute(from, to, lands, island = 24) {
  const on = (p) => lands.find((l) => Math.hypot(p.x - l.x, p.z - l.z) < l.r + 0.5) ?? null;
  const a = on(from);
  const b = on(to);
  if (a === b) return [];
  const out = [];
  if (a) {
    const e = bridgeEnds(a, island);
    out.push(e.land, e.island);
  }
  if (b) {
    const e = bridgeEnds(b, island);
    out.push(e.island, e.land);
  }
  return out;
}

export function fmtUsd(v) {
  const n = Number(v) || 0;
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

export function freshLog(log, lastId) {
  return (log || []).filter((e) => e.id > lastId);
}

// Why the koalas are, or are not, thinking right now.
export function statusOf(s) {
  if (!s) return { key: 'offline', text: 'The grove server is not answering. Is it running?' };
  if (!s.playing) return { key: 'paused', text: s.pausedReason ? `Paused: ${s.pausedReason}` : 'Paused. Press Play to wake the koalas.' };
  if (s.capped) return { key: 'capped', text: "Today's spend cap is reached. The koalas rest until tomorrow." };
  if (!s.present) return { key: 'away', text: 'Waiting for this page to check in.' };
  if (s.koalas.some((k) => k.thinking)) return { key: 'thinking', text: 'A koala is thinking. This is a real model call.' };
  return { key: 'live', text: 'Live. Each koala decides every 20 to 60 seconds.' };
}

// Sky colours through the grove day; frac 0 is midnight, 0.5 is noon.
const SKY = [
  [0.0, [0.06, 0.08, 0.18], [0.12, 0.13, 0.26], 0.05],
  [0.21, [0.08, 0.1, 0.22], [0.2, 0.17, 0.3], 0.08],
  [0.26, [0.36, 0.32, 0.52], [0.98, 0.7, 0.55], 0.4],
  [0.33, [0.45, 0.72, 0.86], [0.86, 0.93, 0.9], 1],
  [0.72, [0.45, 0.72, 0.86], [0.86, 0.93, 0.9], 1],
  [0.79, [0.42, 0.33, 0.55], [0.98, 0.62, 0.45], 0.45],
  [0.86, [0.08, 0.1, 0.22], [0.2, 0.17, 0.3], 0.08],
  [1.0, [0.06, 0.08, 0.18], [0.12, 0.13, 0.26], 0.05],
];

export function skyAt(frac) {
  const f = ((frac % 1) + 1) % 1;
  let i = 0;
  while (i < SKY.length - 2 && f > SKY[i + 1][0]) i++;
  const [f0, top0, bot0, sun0] = SKY[i];
  const [f1, top1, bot1, sun1] = SKY[i + 1];
  const t = clamp01((f - f0) / (f1 - f0));
  const sun = lerp(sun0, sun1, t);
  return {
    top: top0.map((v, k) => lerp(v, top1[k], t)),
    bottom: bot0.map((v, k) => lerp(v, bot1[k], t)),
    sun,
    night: clamp01((0.45 - sun) / 0.35),
  };
}

// --- resources -------------------------------------------------------------------------
const RESOURCE_ORDER = ['wood', 'water', 'sand', 'stone', 'book'];
export const RESOURCE_COLORS = { wood: '#8a6a4a', water: '#4e8fa3', sand: '#e6d29a', stone: '#a9a196', book: '#b05a3c' };

// "6 wood · 1 sand", or "empty".
export function stockText(stock) {
  const parts = RESOURCE_ORDER.filter((r) => stock?.[r] > 0).map((r) => `${stock[r]} ${r}`);
  return parts.length ? parts.join(' · ') : 'empty';
}

// One entry per resource unit in a koala's paws, in resource order (drawn as little blocks).
export function carried(k) {
  return RESOURCE_ORDER.flatMap((r) => Array(Math.max(0, k.res?.[r] ?? 0)).fill(r));
}

// --- critters --------------------------------------------------------------------------
// Where a critter is at time t (seconds), around its home. Deterministic, so every page agrees.
// Turtles crawl a slow loop, frogs hop between three spots by the water, birds circle up high.
export function critterPath(kind, t, home, phase = 0) {
  if (kind === 'turtle') {
    const a = phase + t * 0.06;
    return { x: home.x + Math.cos(a) * 3, z: home.z + Math.sin(a) * 3, y: 0, yaw: -a };
  }
  if (kind === 'frog') {
    const spot = (i) => {
      const a = phase + (i % 3) * 2.1;
      return { x: home.x + Math.cos(a) * 5.3, z: home.z + Math.sin(a) * 5.3 };
    };
    const per = 3.2;
    const n = Math.floor(t / per);
    const u = Math.min(1, (t - n * per) / 0.55); // a hop takes 0.55 s, then it sits
    const a = spot(n);
    const b = spot(n + 1);
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, y: u < 1 ? Math.sin(u * Math.PI) * 0.5 : 0, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  }
  const a = phase + t * 0.45;
  return { x: home.x + Math.cos(a) * 6, z: home.z + Math.sin(a) * 6, y: 10 + Math.sin(t * 0.7 + phase) * 1.5, yaw: -a };
}

// --- motion ----------------------------------------------------------------------------
// One frame of easing toward a target `distance` away: speed builds up at `accel`, cruises at
// `max`, and follows a braking curve so it arrives gently, never past the target.
export function glide(speed, distance, dt, { max, accel }) {
  if (!(distance > 0)) return { speed: 0, step: 0 };
  const brake = Math.sqrt(2 * accel * distance); // the fastest speed that can still stop in time
  const want = Math.min(max, brake);
  let v = speed < want ? Math.min(want, speed + accel * dt) : Math.max(want, speed - accel * 2 * dt);
  if (brake < max) v = Math.max(v, Math.min(0.15, want)); // braking: never crawl forever at the very end
  const step = Math.min(distance, v * dt);
  return { speed: step === distance ? 0 : v, step };
}
