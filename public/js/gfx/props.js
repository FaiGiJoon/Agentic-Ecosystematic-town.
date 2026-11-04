// The grove's landmarks, built from textured, smooth-shaded geometry: the rope swing, the
// stump and ball in the clearing, the mossy hollow log with glowing mushrooms, the lookout
// rocks, and the pond's lily pads, reeds and rim stones. Everything is placed on the terrain.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng } from './noise.js';
import { rockGeometry, rockMaterial, bladeGeometry } from './flora.js';
import { applyWind } from './materials.js';
import { SHORE_R, WATER_Y } from './terrain-math.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function shadowy(o, cast = true, receive = true) {
  o.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
  return o;
}

const wood = (tex, color, repeat = [1, 1]) => {
  const map = tex.wood.map.clone();
  const nm = tex.wood.normal.clone();
  for (const t of [map, nm]) {
    t.repeat.set(...repeat);
    t.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({ map, normalMap: nm, color, roughness: 0.78 });
};

// Cylinder UVs are (around, along); stretch them so the grain runs along the length.
function cyl(rt, rb, h, radial, hSegs = 1, open = false) {
  return new THREE.CylinderGeometry(rt, rb, h, radial, hSegs, open);
}

export function buildProps({ places, terrain, tex, rand }) {
  const out = { group: new THREE.Group(), blobs: [], caps: [], rockSpots: [] };
  const H = (x, z) => terrain.height(x, z);
  const place = (obj, x, z, dy = 0) => obj.position.set(x, H(x, z) + dy, z);
  const rocks = [1, 2, 3, 4].map((s) => rockGeometry(s * 7));
  const rockMat = rockMaterial(tex);

  // --- swing ---
  {
    const p = places.swing;
    const g = new THREE.Group();
    place(g, p.x, p.z);
    const post = wood(tex, '#a07a52', [1, 2.2]);
    for (const s of [-1, 1]) {
      for (const d of [-1, 1]) {
        const leg = new THREE.Mesh(cyl(0.13, 0.18, 3.85, 12), post);
        leg.position.set(s * 2.3, 1.8, d * 0.55);
        leg.rotation.x = d * -0.28;
        g.add(leg);
        out.blobs.push({ x: p.x + s * 2.3, z: p.z + d * 0.85, r: 0.9, s: 0.55 });
      }
    }
    const beam = new THREE.Mesh(cyl(0.16, 0.16, 5.3, 12), wood(tex, '#9a7650', [1, 2.6]));
    beam.rotation.z = Math.PI / 2;
    beam.position.y = 3.55;
    g.add(beam);
    const ropeN = tex.rope.clone();
    ropeN.repeat.set(1, 14);
    ropeN.needsUpdate = true;
    const rope = new THREE.MeshStandardMaterial({ color: '#d8c8a4', normalMap: ropeN, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.95 });
    const plank = wood(tex, '#c9a070', [1, 0.3]);
    out.seats = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 1.1, 3.45, 0);
      for (const x of [-0.42, 0.42]) {
        const r = new THREE.Mesh(cyl(0.03, 0.03, 2.85, 8), rope);
        r.position.set(x, -1.42, 0);
        pivot.add(r);
      }
      const seat = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.1, 0.5, 3, 0.035), plank);
      seat.position.y = -2.88;
      pivot.add(seat);
      g.add(pivot);
      return pivot;
    });
    out.group.add(shadowy(g));
  }

  // --- stump and ball in the clearing ---
  {
    const p = places.clearing;
    const pts = [[0.74, 0], [0.62, 0.12], [0.55, 0.3], [0.54, 0.5], [0.5, 0.56], [0, 0.56]].map(([x, y]) => new THREE.Vector2(x, y));
    const stump = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, color: '#a98763', roughness: 0.92 }));
    place(stump, p.x - 0.2, p.z - 0.3, -0.04);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshStandardMaterial({ map: tex.rings, roughness: 0.85 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.565;
    stump.add(top);
    out.group.add(shadowy(stump));
    out.blobs.push({ x: p.x - 0.2, z: p.z - 0.3, r: 1.15, s: 0.55 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 40, 28), new THREE.MeshPhysicalMaterial({ map: tex.ball, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.25 }));
    ball.castShadow = true;
    out.ball = ball;
    out.ballRest = V(p.x + 1.4, H(p.x + 1.4, p.z + 0.4) + 0.3, p.z + 0.4);
    ball.position.copy(out.ballRest);
    out.group.add(ball);
  }

  // --- mossy hollow log, moss bed and glowing mushrooms ---
  {
    const p = places.hollow;
    const g = new THREE.Group();
    place(g, p.x, p.z);
    g.rotation.y = 0.35;
    const logTex = tex.bark.map.clone();
    logTex.repeat.set(3, 2.4);
    logTex.needsUpdate = true;
    const logN = tex.bark.normal.clone();
    logN.repeat.set(3, 2.4);
    logN.needsUpdate = true;
    const barkMat = new THREE.MeshStandardMaterial({ map: logTex, normalMap: logN, color: '#8a6a4c', roughness: 0.95, side: THREE.DoubleSide });
    const outer = new THREE.Mesh(cyl(1.1, 1.2, 5.5, 28, 1, true), barkMat);
    outer.rotation.x = Math.PI / 2;
    outer.position.set(-1.6, 1.0, 0);
    // dark inside, lighter wood rim at the open ends
    const inner = new THREE.Mesh(cyl(0.93, 1.0, 5.45, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 1, side: THREE.BackSide }));
    inner.rotation.x = Math.PI / 2;
    inner.position.copy(outer.position);
    const rimMat = new THREE.MeshStandardMaterial({ color: '#b08a5c', roughness: 0.85 });
    for (const sgn of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.93, 1.13, 28), rimMat);
      rim.position.set(-1.6, 1.0, sgn * 2.75);
      rim.rotation.y = sgn > 0 ? 0 : Math.PI;
      g.add(rim);
    }
    g.add(outer, inner);
    const mossMat = new THREE.MeshStandardMaterial({ map: tex.grass.map, normalMap: tex.grass.normal, color: '#8fb35a', roughness: 0.95 });
    const mg = new THREE.SphereGeometry(0.5, 14, 10);
    const moss = new THREE.InstancedMesh(mg, mossMat, 16);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 16; i++) {
      const a = rand() * TAU;
      q.setFromEuler(new THREE.Euler(0, rand() * TAU, 0));
      m4.compose(V(-1.6 + Math.cos(a) * 0.7, 1.0 + Math.abs(Math.sin(a)) * 0.9 + 0.12, -2.4 + (i / 15) * 4.8), q, V(0.55 + rand() * 0.5, 0.22 + rand() * 0.12, 0.55 + rand() * 0.5));
      moss.setMatrixAt(i, m4);
    }
    moss.castShadow = true;
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.75, 0.16, 28), mossMat);
    bed.position.set(0.6, 0.05, 0.6);
    g.add(moss, bed);
    // mushrooms: spotted caps that glow at night
    out.shroomMat = new THREE.MeshStandardMaterial({ color: '#f1e3c4', emissive: '#8fe6c0', emissiveIntensity: 0, roughness: 0.55 });
    const stemGeo = new THREE.CylinderGeometry(0.035, 0.05, 1, 8);
    const capGeo = new THREE.SphereGeometry(0.5, 14, 8, 0, TAU, 0, Math.PI / 2);
    const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardMaterial({ color: '#efe7da', roughness: 0.8 }), 10);
    const caps = new THREE.InstancedMesh(capGeo, out.shroomMat, 10);
    for (let i = 0; i < 10; i++) {
      const x = -0.5 + Math.cos(i * 1.7) * 0.7 + rand() * 0.2;
      const z = 1.9 + Math.sin(i * 2.3) * 0.5;
      const h = 0.14 + rand() * 0.2;
      const cap = 0.07 + rand() * 0.07;
      m4.compose(V(x, 0.1 + h / 2, z), new THREE.Quaternion(), V(1, h, 1));
      stems.setMatrixAt(i, m4);
      m4.compose(V(x, 0.1 + h, z), new THREE.Quaternion(), V(cap * 2, cap * 1.6, cap * 2));
      caps.setMatrixAt(i, m4);
    }
    out.group.add(shadowy(g));
    stems.position.copy(g.position);
    caps.position.copy(g.position);
    stems.rotation.y = caps.rotation.y = 0.35;
    out.group.add(stems, caps);
    // the log as an elongated occluder on the ground (world space)
    const cs = Math.cos(0.35);
    const sn = Math.sin(0.35);
    const w = (lx, lz) => ({ x: p.x + lx * cs + lz * sn, z: p.z - lx * sn + lz * cs });
    const a = w(-1.6, -2.7);
    const b = w(-1.6, 2.7);
    out.caps.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r: 2.1, s: 0.7 });
    out.shroomSpot = V(p.x + 0.4, H(p.x, p.z) + 0.6, p.z + 1.9);
  }

  // --- lookout rocks ---
  {
    const p = places.lookout;
    const g = new THREE.Group();
    const stones = [[0, 0.7, 0, 1.6, 0], [0.9, 0.5, -0.8, 1.1, 1], [-0.4, 1.9, 0.2, 1.0, 2], [-1.1, 0.4, 0.9, 0.8, 3]];
    const cols = ['#e2d3bd', '#d4c3aa', '#ead9bf', '#d2c1a8'].map((c) => new THREE.Color(c));
    stones.forEach(([x, y, z, r, k], i) => {
      const m = new THREE.Mesh(rocks[k % rocks.length], rockMat.clone());
      m.material.color = cols[i];
      m.position.set(x, y, z);
      m.scale.setScalar(r * 0.9);
      m.rotation.y = x * 3;
      g.add(m);
    });
    g.position.set(p.x + 1.2, H(p.x + 1.2, p.z + 1.2) - 0.05, p.z + 1.2);
    out.group.add(shadowy(g));
    out.blobs.push({ x: p.x + 1.2, z: p.z + 1.2, r: 3.1, s: 0.65 });
  }

  // --- pond dressing: rim stones, lily pads, blooms, reeds ---
  {
    const pond = places.pond;
    const shoreAt = (a) => {
      for (let r = SHORE_R - 1.5; r < SHORE_R + 3; r += 0.04) if (H(pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r) >= WATER_Y + 0.03) return r;
      return SHORE_R;
    };
    const stones = new THREE.InstancedMesh(rocks[0], rockMat, 30);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * TAU + rand() * 0.15;
      const r = shoreAt(a) + 0.12 + rand() * 0.3;
      const x = pond.x + Math.cos(a) * r;
      const z = pond.z + Math.sin(a) * r;
      const k = 0.3 + rand() * 0.3;
      q.setFromEuler(new THREE.Euler(rand() * 0.4, rand() * TAU, rand() * 0.4));
      m4.compose(V(x, H(x, z) + k * 0.1, z), q, V(k * 1.2, k * 0.8, k));
      stones.setMatrixAt(i, m4);
      stones.setColorAt(i, c.set(rand() > 0.5 ? '#c4b8a4' : '#a99e8b'));
      out.rockSpots.push({ x, z, r: k });
    }
    stones.castShadow = stones.receiveShadow = true;
    out.group.add(stones);

    // lily pads: textured discs with a notch, bobbing
    const padGeo = new THREE.CircleGeometry(0.46, 26);
    padGeo.rotateX(-Math.PI / 2);
    const pads = new THREE.InstancedMesh(padGeo, new THREE.MeshStandardMaterial({ map: tex.lily, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.5 }), 9);
    pads.receiveShadow = true;
    out.pads = [];
    for (let i = 0; i < 9; i++) {
      const a = rand() * TAU;
      const r = 0.9 + rand() * (SHORE_R - 2.2);
      out.pads.push({ x: pond.x + Math.cos(a) * r, z: pond.z + Math.sin(a) * r, yaw: rand() * TAU, s: 0.8 + rand() * 0.5, ph: rand() * 6 });
    }
    out.padMesh = pads;
    const petal = new THREE.ConeGeometry(0.07, 0.24, 6);
    petal.translate(0, 0.12, 0);
    petal.rotateZ(0.6);
    const bloomParts = [];
    for (let i = 0; i < 8; i++) {
      const g = petal.clone();
      g.rotateY((i / 8) * TAU);
      bloomParts.push(g);
    }
    const blooms = new THREE.InstancedMesh(mergeGeometries(bloomParts), new THREE.MeshStandardMaterial({ color: '#f4b2cb', emissive: '#c0507f', emissiveIntensity: 0.12, roughness: 0.5, side: THREE.DoubleSide }), 5);
    out.bloomMesh = blooms;
    out.padSpots = out.pads.slice(0, 5);

    // reeds and cattails along the north-west bank
    const reedMat = applyWind(new THREE.MeshStandardMaterial({ color: '#7d9450', roughness: 0.8, side: THREE.DoubleSide }), 'clamp(transformed.y, 0.0, 1.0) * length(instanceMatrix[1].xyz) * 0.5', { key: 'reed' });
    const reeds = new THREE.InstancedMesh(bladeGeometry(), reedMat, 90);
    const heads = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.045, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#5a3d27', roughness: 0.8 }), 16);
    let hn = 0;
    for (let i = 0; i < 90; i++) {
      const a = Math.PI * 0.85 + rand() * 1.5;
      const r = shoreAt(a) - 0.25 + rand() * 0.9;
      const x = pond.x + Math.cos(a) * r;
      const z = pond.z + Math.sin(a) * r;
      const h = 1.1 + rand() * 1.0;
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.2, rand() * TAU, (rand() - 0.5) * 0.22));
      m4.compose(V(x, Math.max(H(x, z), WATER_Y - 0.15), z), q, V(1.1 + rand() * 0.6, h, 1.1));
      reeds.setMatrixAt(i, m4);
      if (hn < 16 && rand() < 0.28) {
        m4.compose(V(x, Math.max(H(x, z), WATER_Y - 0.15) + h * 0.82, z), new THREE.Quaternion(), V(1, 1, 1));
        heads.setMatrixAt(hn++, m4);
      }
    }
    heads.count = hn;
    reeds.castShadow = true;
    reeds.frustumCulled = heads.frustumCulled = false;
    out.group.add(pads, blooms, reeds, heads);
  }
  return out;
}

// Bob the pads and blooms; called every frame.
export function animatePond(props, t, terrain) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  props.pads.forEach((p, i) => {
    q.setFromAxisAngle(V(0, 1, 0), p.yaw + Math.sin(t * 0.3 + p.ph) * 0.12);
    m.compose(V(p.x, WATER_Y + 0.045 + Math.sin(t * 1.2 + p.ph) * 0.012, p.z), q, V(p.s, p.s, p.s));
    props.padMesh.setMatrixAt(i, m);
  });
  props.padMesh.instanceMatrix.needsUpdate = true;
  props.padSpots.forEach((p, i) => {
    m.compose(V(p.x, WATER_Y + 0.05 + Math.sin(t * 1.2 + p.ph) * 0.012, p.z), q.identity(), V(p.s, p.s, p.s));
    props.bloomMesh.setMatrixAt(i, m);
  });
  props.bloomMesh.instanceMatrix.needsUpdate = true;
}
