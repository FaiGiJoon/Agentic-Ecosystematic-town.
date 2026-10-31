// Pure helpers between the grove's server state and what the page draws.
// No three.js or DOM here, so the tests can run them under Node.

const SIDE = { mallee: -1, bramble: 1 };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Where a koala stands for a place and activity: apart from its friend, beside
// the pond rather than in it, up the trunk when climbing or eating.
export function spotFor(places, placeId, koalaId, activity) {
  const p = places[placeId];
  if (!p) return { x: 0, z: 0, y: 0 };
  const side = SIDE[koalaId] ?? 1;
  if (p.tree && (activity === 'climb' || activity === 'eat')) {
    const a = Math.atan2(-p.z, -p.x) + side * 0.9;
    return { x: p.x + Math.cos(a) * 0.62, z: p.z + Math.sin(a) * 0.62, y: activity === 'climb' ? 3.0 : 2.4 };
  }
  if (placeId === 'swing' && activity === 'play') return { x: p.x + side * 1.1, z: p.z, y: 0 };
  const r = placeId === 'pond' ? 5.4 : p.tree ? 1.9 : placeId === 'swing' ? 2.4 : 1.6;
  const a = Math.atan2(-p.z, -p.x) + side * 0.55;
  return { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, y: 0 };
}

export function animFor({ activity, place }) {
  if (activity === 'nap') return 'sleep';
  if (activity === 'eat') return 'eat';
  if (activity === 'climb') return 'cling';
  if (activity === 'play') return place === 'swing' ? 'swing' : place === 'pond' ? 'splash' : 'ball';
  return 'idle';
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
  if (!s) return { key: 'offline', text: 'The HQ server is not answering. Is it running?' };
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
