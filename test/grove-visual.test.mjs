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
