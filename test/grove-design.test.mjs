import test from 'node:test';
import assert from 'node:assert/strict';
import { designSpec, designCost, SHAPES, PARTS, COLORS } from '../hq/grove-design.js';

test('an arcade machine with pink buttons is a medium pink machine with buttons', () => {
  const s = designSpec('Arcade', 'An arcade machine with pink buttons and a glowing screen.');
  assert.equal(s.shape, 'machine');
  assert.equal(s.size, 'medium');
  assert.ok(s.parts.includes('buttons') && s.parts.includes('screen'));
  assert.deepEqual(s.colors, ['pink']);
  assert.match(s.design, /arcade machine/);
});

test('size words, shapes and defaults', () => {
  assert.equal(designSpec('x', 'a tiny stone tower').size, 'small');
  assert.equal(designSpec('x', 'a tiny stone tower').shape, 'tower');
  assert.equal(designSpec('x', 'a giant castle').size, 'big');
  assert.equal(designSpec('x', 'a giant castle').shape, 'tower');
  assert.equal(designSpec('Footbridge', 'a little footbridge over the creek').shape, 'bridge');
  assert.equal(designSpec('x', 'a cosy cottage').shape, 'house');
  assert.equal(designSpec('x', 'a wooden ship').shape, 'boat');
  const plain = designSpec('Thing', 'something nice');
  assert.deepEqual([plain.shape, plain.size], ['shelter', 'medium']);
  assert.ok(plain.colors.length >= 1);
  for (const s of [plain, designSpec('a', 'a red roof, door, window, flag, wheel, chimney, slide, flowers, sign, dome, stairs, bell, star, lights')]) {
    assert.ok(SHAPES.includes(s.shape));
    assert.ok(s.parts.every((p) => PARTS.includes(p)));
    assert.ok(s.colors.every((c) => COLORS.includes(c)));
  }
});

test('parts are deduped and capped at 8; colors capped at 3; design capped at 160', () => {
  const s = designSpec('x', 'roof roof door window flag wheel screen buttons lights chimney slide flowers sign dome pink blue red green ' + 'z'.repeat(300));
  assert.equal(s.parts.length, 8);
  assert.equal(new Set(s.parts).size, 8);
  assert.equal(s.colors.length, 3);
  assert.equal(s.design.length, 160);
});

test('words need word boundaries and ignore case', () => {
  assert.equal(designSpec('x', 'A BIG Red TOWER').size, 'big');
  assert.deepEqual(designSpec('x', 'a scarred tower').colors.includes('red'), false);
  assert.equal(designSpec('x', 'a housework').shape, 'shelter');
});

test('cost and effort by size, with material words', () => {
  assert.deepEqual(designCost({ size: 'small', design: '' }), { cost: { wood: 2 }, effort: 2 });
  assert.deepEqual(designCost({ size: 'medium', design: '' }), { cost: { wood: 3, stone: 1 }, effort: 4 });
  assert.deepEqual(designCost({ size: 'big', design: '' }), { cost: { wood: 5, stone: 3 }, effort: 6 });
  assert.deepEqual(designCost(designSpec('x', 'a tiny stone tower')), { cost: { wood: 1, stone: 1 }, effort: 2 });
  assert.deepEqual(designCost(designSpec('x', 'a little fountain')).cost, { wood: 2, water: 1 });
  assert.deepEqual(designCost(designSpec('x', 'a little glass house')).cost, { wood: 2, sand: 1 });
  assert.deepEqual(designCost(designSpec('x', 'a little library')).cost, { wood: 2, book: 1 });
});
