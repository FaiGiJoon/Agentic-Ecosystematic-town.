import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeAt } from '../public/js/gfx/grade.js';

const hour = (h) => h / 24;

test('golden hour warms the highlights; twilight cools the shadows', () => {
  const golden = gradeAt(0.74);
  assert.ok(golden.highlight[0] > golden.highlight[2] + 0.08, `golden highlight ${golden.highlight}`);
  const dusk = gradeAt(0.81);
  assert.ok(dusk.shadow[2] > dusk.shadow[0] + 0.05, `twilight shadow ${dusk.shadow}`);
  const noon = gradeAt(0.5);
  for (const c of [...noon.shadow, ...noon.highlight]) assert.ok(Math.abs(c - 1) < 0.08, 'midday stays close to neutral');
  assert.ok(noon.saturation > 1, 'eucalyptus greens a little richer by day');
});

test('night glows more than day', () => {
  assert.ok(gradeAt(hour(0)).bloom > gradeAt(0.5).bloom + 0.15);
  assert.ok(gradeAt(hour(23)).exposure > 0 && gradeAt(hour(23)).exposure < gradeAt(0.5).exposure + 0.25);
});

test('the grade changes smoothly through the whole day, with no popping', () => {
  let prev = gradeAt(0);
  for (let i = 1; i <= 400; i++) {
    const g = gradeAt(i / 400);
    const now = [...g.shadow, ...g.highlight, g.saturation, g.contrast, g.exposure, g.bloom];
    const was = [...prev.shadow, ...prev.highlight, prev.saturation, prev.contrast, prev.exposure, prev.bloom];
    now.forEach((v, k) => {
      assert.ok(Number.isFinite(v), `finite at ${i}`);
      assert.ok(Math.abs(v - was[k]) <= 0.08, `jump at ${i / 400}: ${was[k]} -> ${v}`);
    });
    prev = g;
  }
  assert.deepEqual(gradeAt(1.25), gradeAt(0.25), 'wraps around midnight');
});

test('glide eases in from rest, cruises, eases out and never overshoots', async () => {
  const { glide } = await import('../public/js/view.js');
  const opt = { max: 2, accel: 4 };
  let r = glide(0, 10, 1 / 60, opt);
  assert.ok(r.speed <= 4 / 60 + 1e-9 && r.speed > 0, `from rest: ${r.speed}`);
  let speed = 0;
  let dist = 20;
  let top = 0;
  for (let i = 0; i < 1200 && dist > 0; i++) {
    r = glide(speed, dist, 1 / 60, opt);
    assert.ok(r.step <= dist + 1e-9, 'never past the target');
    assert.ok(r.step >= 0);
    speed = r.speed;
    dist -= r.step;
    top = Math.max(top, speed);
    if (dist < 0.3) assert.ok(speed < 1.6, `slows near the end: ${speed} at ${dist}`);
  }
  assert.ok(top <= 2 + 1e-9 && top > 1.9, `cruises at the top speed: ${top}`);
  assert.ok(dist < 1e-6, 'arrives');
  assert.deepEqual(glide(1, 0, 1 / 60, opt), { speed: 0, step: 0 });
});
