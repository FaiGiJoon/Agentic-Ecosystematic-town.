// The Blender-made koala (public/assets/CR_Koala.glb) is read by koala-parts.js. These
// checks read the GLB header and JSON chunk directly, so they need neither three.js nor a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = new URL('../public/assets/CR_Koala.glb', import.meta.url);
const buf = fs.readFileSync(file);

function json() {
  assert.equal(buf.toString('ascii', 0, 4), 'glTF');
  assert.equal(buf.readUInt32LE(4), 2);
  assert.equal(buf.readUInt32LE(8), buf.length, 'header length matches the file');
  const len = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, 'first chunk is JSON');
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

// koala.js asks for these by name (koala-parts.js drops the "." glTF loaders strip from names).
const PARTS = ['Head', 'Muzzle', 'CheekL', 'CheekR', 'Nose', 'EarOuterL', 'EarOuterR', 'EarInnerL', 'EarInnerR', 'Torso', 'Belly',
  'ArmFurL', 'ArmFurR', 'PawArmL', 'PawArmR', 'LegFurL', 'LegFurR', 'PawLegL', 'PawLegR'];

test('the koala GLB has every part koala.js asks for', () => {
  const names = json().nodes.map((n) => n.name.replace(/^CR_Koala_/, '').replace(/\./g, ''));
  for (const p of PARTS) assert.ok(names.includes(p), `missing part ${p}`);
});

test('every part has normals and UVs (the fur shells need both) and the model fits its triangle budget', () => {
  const g = json();
  let tris = 0;
  for (const mesh of g.meshes) {
    for (const prim of mesh.primitives) {
      assert.ok('NORMAL' in prim.attributes && 'TEXCOORD_0' in prim.attributes, `${mesh.name} needs NORMAL and TEXCOORD_0`);
      tris += g.accessors[prim.indices].count / 3;
    }
  }
  assert.ok(tris > 8000 && tris <= 12000, `triangles ${tris}`);
});

test('parts sit on the rig joints: the head turns about (0, 1.36, 0.08), ears at +-0.52', () => {
  const nodes = Object.fromEntries(json().nodes.map((n) => [n.name.replace(/^CR_Koala_/, '').replace(/\./g, ''), n]));
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
  assert.ok(near(nodes.Head.translation, [0, 1.36, 0.08]));
  assert.ok(near(nodes.Torso.translation, [0, 0.68, 0]));
  assert.ok(near(nodes.EarOuterL.translation, [0.52, 1.64, 0.06]));
  assert.ok(near(nodes.EarOuterR.translation, [-0.52, 1.64, 0.06]));
});
