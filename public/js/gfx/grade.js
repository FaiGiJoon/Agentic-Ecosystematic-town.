// The grove's colour grade through the day: split-toning (a tint for the shadows and one for the
// highlights), saturation, contrast, exposure and bloom. Pure, so it can be tested in Node.
// frac is the time of day: 0 is midnight, 0.5 noon (the same as skyAt in view.js).

// [frac, shadow tint, highlight tint, saturation, contrast, exposure, bloom]
const NIGHT = [[0.82, 0.9, 1.12], [0.92, 0.96, 1.08], 0.92, 1.05, 0.95, 0.62];
const KEYS = [
  [0.0, ...NIGHT],
  [0.2, ...NIGHT],
  [0.25, [0.92, 0.9, 1.04], [1.12, 0.98, 0.88], 1.0, 1.06, 1.0, 0.45], // dawn: peach light, cool shade
  [0.32, [0.98, 1.0, 1.02], [1.04, 1.0, 0.96], 1.06, 1.07, 1.02, 0.32], // morning
  [0.5, [0.98, 1.0, 1.03], [1.02, 1.01, 0.98], 1.08, 1.08, 1.0, 0.3], // noon: clean, eucalyptus greens a touch richer
  [0.66, [0.98, 1.0, 1.0], [1.06, 1.0, 0.94], 1.08, 1.08, 1.0, 0.32], // afternoon
  [0.74, [0.96, 0.98, 0.9], [1.16, 1.0, 0.8], 1.12, 1.1, 1.03, 0.42], // golden hour: honey light, olive shade
  [0.81, [0.84, 0.9, 1.1], [1.1, 0.94, 0.98], 1.02, 1.08, 0.98, 0.55], // twilight: rose sky, teal shade
  [0.87, ...NIGHT],
  [1.0, ...NIGHT],
];

const ease = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

export function gradeAt(frac) {
  const f = ((frac % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && f > KEYS[i + 1][0]) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = ease(Math.min(1, Math.max(0, (f - a[0]) / (b[0] - a[0]))));
  return {
    shadow: a[1].map((v, k) => mix(v, b[1][k], t)),
    highlight: a[2].map((v, k) => mix(v, b[2][k], t)),
    saturation: mix(a[3], b[3], t),
    contrast: mix(a[4], b[4], t),
    exposure: mix(a[5], b[5], t),
    bloom: mix(a[6], b[6], t),
  };
}
