// three.js view of the grove: a floating eucalyptus island with a pond, a rope
// swing, a ball, a mossy hollow log and a lookout rock. The server says where each
// koala is and what it is doing; this draws it, runs day and night, and lets the
// visitor walk around.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Koala } from './koala.js';
import { spotFor, animFor, skyAt } from './view.js';

const DAY_MS = 20 * 60000;
const ISLAND = 24;
const POND_R = 4.6;
const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...extra });
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shadowy(o, cast = true, receive = true) {
  o.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
  return o;
}

export class GroveScene {
  constructor(container, { places, koalas }) {
    this.container = container;
    this.places = places;
    this.koalas = new Map();
    this.state = null;
    this.mode = 'walk';
    this.selected = null;
    this.onPick = () => {};
    this.clockFrac = 0.35;
    this.ripples = [];
    this.keys = new Set();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rand = (this.rand = rng(7));

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf3c9a8, 70, 170);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.3, 700);
    this.camera.position.set(10, 14, 26);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 85;
    this.controls.target.set(0, 1, 4);

    this.hemi = new THREE.HemisphereLight(0xfff4e0, 0x6b7a4a, 0.8);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -30;
    sc.right = sc.top = 30;
    sc.far = 200;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.buildSky();
    this.buildIsland(rand);
    this.buildTrees();
    this.buildPond(rand);
    this.buildSwing();
    this.buildClearing();
    this.buildHollow();
    this.buildLookout();
    this.buildFlowers(rand);
    this.buildDecor(rand);
    this.buildNightLife(rand);
    this.buildVisitor();
    this.buildPlaceLabels();

    for (const k of koalas) {
      const view = new Koala(k);
      const s = spotFor(places, k.place, k.id, k.activity);
      view.place(s.x, s.y, s.z);
      view.tagEl.addEventListener('click', () => this.onPick(k.id));
      this.koalas.set(k.id, view);
      this.scene.add(view.root);
    }

    this.raycaster = new THREE.Raycaster();
    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    r.domElement.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) this.pick(e);
      down = null;
    });
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    const panel = document.getElementById('panel');
    const P = w > 820 && panel && !panel.classList.contains('collapsed') ? panel.offsetWidth + 12 : 0;
    this.camera.aspect = (w + P) / h;
    if (P) this.camera.setViewOffset(w + P, h, P, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // --- the world -----------------------------------------------------------------------
  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = smoothstep(-0.25, 0.65, vP.y); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), this.skyMat));

    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    const rs = rng(99);
    for (let i = 0; i < 500; i++) {
      const th = rs() * Math.PI * 2;
      const ph = Math.acos(rs() * 0.9);
      pts.push(Math.sin(ph) * Math.cos(th) * 380, Math.cos(ph) * 380, Math.sin(ph) * Math.sin(th) * 380);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xfff6e0, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.scene.add(new THREE.Points(starGeo, this.starMat));

    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: '#ffe3a3', fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(6, 24), new THREE.MeshBasicMaterial({ color: '#e8ecff', fog: false }));
    this.scene.add(this.sunDisc, this.moonDisc);
  }

  buildIsland(rand) {
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND, ISLAND - 0.3, 0.6, 48), flat('#a9b98a'));
    grass.position.y = -0.3;
    grass.receiveShadow = true;
    this.ground = grass;
    this.scene.add(grass);
    // The earth under the grass: ochre strata narrowing to a rocky point, jittered so it reads hand-made.
    const layers = [['#c7834a', ISLAND - 0.2, ISLAND - 3, 2.6, -1.9], ['#a9683b', ISLAND - 3, 13, 4, -5.2], ['#7c4f32', 13, 2, 5, -9.7]];
    for (const [color, top, bottom, h, y] of layers) {
      const geo = new THREE.CylinderGeometry(top, bottom, h, 28, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i)) < h / 2 - 0.01) {
          pos.setX(i, pos.getX(i) * (0.93 + rand() * 0.12));
          pos.setZ(i, pos.getZ(i) * (0.93 + rand() * 0.12));
        }
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, flat(color));
      m.position.y = y;
      this.scene.add(m);
    }
    // Hanging roots.
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const rr = ISLAND - 3 - rand() * 6;
      const root = new THREE.Mesh(new THREE.ConeGeometry(0.18, 2 + rand() * 3, 4), flat('#5e3f2a'));
      root.position.set(Math.cos(a) * rr, -4 - rand() * 2.5, Math.sin(a) * rr);
      root.rotation.x = Math.PI;
      this.scene.add(root);
    }
    // Worn paths from the clearing to every place.
    const c = this.places.clearing;
    const pathMat = flat('#d9c49e');
    for (const [id, p] of Object.entries(this.places)) {
      if (id === 'clearing') continue;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const total = Math.hypot(dx, dz);
      const len = total - (id === 'pond' ? POND_R : 1.2);
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(1.3, len), pathMat);
      seg.rotation.x = -Math.PI / 2;
      seg.rotation.z = Math.atan2(dx, dz);
      seg.position.set(c.x + (dx / total) * (len / 2), 0.012, c.z + (dz / total) * (len / 2));
      seg.receiveShadow = true;
      this.scene.add(seg);
    }
  }

  buildTrees() {
    this.trees = {};
    const looks = {
      big_gum: { bark: '#ede4d6', patch: '#c99a7a', leaves: ['#7fa38a', '#6b917c', '#8db39a'], h: 7.4 },
      river_gum: { bark: '#dacbb8', patch: '#a58d78', leaves: ['#6f9a83', '#82a88f', '#5f8a73'], h: 6.6 },
      blue_gum: { bark: '#cfc5bb', patch: '#8f9aa5', leaves: ['#8fb0b0', '#7a9ea3', '#a3c0bb'], h: 6.9 },
    };
    for (const [id, look] of Object.entries(looks)) {
      const p = this.places[id];
      if (!p) continue;
      const rand = rng(id.length * 31 + 5);
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      const bark = flat(look.bark, { roughness: 0.75 });
      let y = 0;
      let lean = 0;
      const segs = 4;
      for (let i = 0; i < segs; i++) {
        const h = look.h / segs;
        const r0 = 0.62 - i * 0.12;
        const s = new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.12, r0, h, 7), bark);
        lean += (rand() - 0.5) * 0.08;
        s.position.set(lean * 4, y + h / 2, 0);
        s.rotation.z = lean;
        g.add(s);
        y += h * 0.98;
      }
      // Bark peeling in patches.
      for (let i = 0; i < 9; i++) {
        const a = rand() * Math.PI * 2;
        const py = 0.5 + rand() * (look.h - 2);
        const patch = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5 + rand() * 0.6, 0.05), flat(look.patch));
        const rr = 0.55 - (py / look.h) * 0.4;
        patch.position.set(Math.cos(a) * rr, py, Math.sin(a) * rr);
        patch.rotation.y = -a + Math.PI / 2;
        g.add(patch);
      }
      // Branches with drooping leaf clumps.
      const leafMats = look.leaves.map((c) => flat(c));
      const clump = (x, cy, z, s) => {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leafMats[Math.floor(rand() * leafMats.length)]);
        m.position.set(x, cy, z);
        m.scale.y = 0.62;
        m.rotation.set(rand(), rand() * 3, rand());
        g.add(m);
      };
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rand() * 0.6;
        const by = look.h * (0.64 + rand() * 0.28); // high enough to see a koala on the trunk below
        const len = 1.8 + rand() * 1.4;
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, len, 5), bark);
        br.position.set(Math.cos(a) * len * 0.4, by + len * 0.3, Math.sin(a) * len * 0.4);
        br.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
        g.add(br);
        const ex = Math.cos(a) * len * 0.85;
        const ez = Math.sin(a) * len * 0.85;
        clump(ex, by + len * 0.65, ez, 1.4 + rand() * 0.6);
        clump(ex * 0.7, by + len * 0.3, ez * 0.7, 1.0 + rand() * 0.4);
      }
      clump(lean * 4, look.h + 0.6, 0, 2.0);
      clump(lean * 4 + 0.9, look.h - 0.3, 0.6, 1.5);
      this.scene.add(shadowy(g));
      this.trees[id] = g;
    }
  }

  buildPond(rand) {
    const p = this.places.pond;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(POND_R + 0.2, POND_R - 0.8, 0.5, 32), flat('#6f6250'));
    bed.position.y = -0.24;
    this.water = new THREE.Mesh(new THREE.CircleGeometry(POND_R, 40), new THREE.MeshStandardMaterial({ color: '#4e8fa3', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.88 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.03;
    this.water.receiveShadow = true;
    g.add(bed, this.water);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rand() * 0.25, 0), flat(rand() > 0.5 ? '#b8ab98' : '#9d927f'));
      s.position.set(Math.cos(a) * (POND_R + 0.1), 0.05, Math.sin(a) * (POND_R + 0.1));
      s.scale.y = 0.6;
      g.add(s);
    }
    this.lilies = [];
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const rr = 1 + rand() * (POND_R - 2);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 10, 1, false, 0.4, Math.PI * 1.8), flat('#5f8f4e'));
      pad.position.set(Math.cos(a) * rr, 0.06, Math.sin(a) * rr);
      pad.rotation.y = rand() * 6;
      if (i % 2 === 0) {
        const bloom = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 6), flat('#f2a7c3'));
        bloom.position.y = 0.12;
        pad.add(bloom);
      }
      g.add(pad);
      this.lilies.push(pad);
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.PI * 0.9 + rand() * 1.2;
      const reed = new THREE.Mesh(new THREE.ConeGeometry(0.05, 1.2 + rand() * 0.9, 3), flat('#7d8f4e'));
      reed.position.set(Math.cos(a) * (POND_R - 0.2), 0.6, Math.sin(a) * (POND_R - 0.2));
      reed.rotation.z = (rand() - 0.5) * 0.3;
      g.add(reed);
    }
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 24), new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      this.scene.add(ring);
      this.ripples.push({ mesh: ring, t: 1 });
    }
    this.scene.add(shadowy(g, false, true));
  }

  ripple(x, z) {
    const r = this.ripples.find((q) => q.t >= 1) ?? this.ripples[0];
    r.t = 0;
    r.mesh.position.set(x, 0.05, z);
  }

  buildSwing() {
    const p = this.places.swing;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    const log = flat('#8a6a4a');
    for (const s of [-1, 1]) {
      for (const d of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 3.8, 6), log);
        leg.position.set(s * 2.3, 1.8, d * 0.55);
        leg.rotation.x = d * -0.28;
        g.add(leg);
      }
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 5.2, 7), log);
    beam.rotation.z = Math.PI / 2;
    beam.position.y = 3.55;
    g.add(beam);
    this.seats = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 1.1, 3.45, 0);
      const rope = flat('#d8c8a4');
      for (const x of [-0.42, 0.42]) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.85, 4), rope);
        r.position.set(x, -1.42, 0);
        pivot.add(r);
      }
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.5), flat('#b98a5a'));
      seat.position.y = -2.88;
      pivot.add(seat);
      g.add(pivot);
      return pivot;
    });
    this.scene.add(shadowy(g));
  }

  buildClearing() {
    const p = this.places.clearing;
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.55, 9), flat('#8a6a4a'));
    stump.position.set(p.x - 0.2, 0.27, p.z - 0.3);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 9), flat('#e2c9a0'));
    top.position.y = 0.285;
    stump.add(top);
    this.scene.add(shadowy(stump));
    // A striped ball, drawn on a canvas.
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext('2d');
    ['#f2c14e', '#e8664a', '#7fd1e8', '#e8664a'].forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(i * 32, 0, 32, 64);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    this.ballRest = new THREE.Vector3(p.x + 1.4, 0.3, p.z + 0.4);
    this.ball.position.copy(this.ballRest);
    this.ball.castShadow = true;
    this.scene.add(this.ball);
  }

  buildHollow() {
    const p = this.places.hollow;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = 0.35;
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 5.5, 10, 1, true), flat('#7a5a40', { side: THREE.DoubleSide }));
    outer.rotation.x = Math.PI / 2;
    outer.position.set(-1.6, 1.0, 0);
    const inside = new THREE.Mesh(new THREE.CircleGeometry(0.9, 10), flat('#2e2219'));
    inside.position.set(-1.6, 1.0, 2.76);
    g.add(outer, inside);
    const moss = flat('#6f8f4a');
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), moss);
      m.position.set(-1.6 + (Math.random() - 0.5) * 1.2, 1.9, -2.2 + i * 0.85);
      m.scale.y = 0.35;
      g.add(m);
    }
    // A moss bed to nap on, and mushrooms that glow at night.
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.12, 12), moss);
    bed.position.set(0.6, 0.06, 0.6);
    g.add(bed);
    this.shroomMat = new THREE.MeshStandardMaterial({ color: '#f6e7c8', emissive: '#9fe0c0', emissiveIntensity: 0, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 5), flat('#efe7da'));
      stem.position.y = 0.11;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), this.shroomMat);
      cap.position.y = 0.22;
      s.add(stem, cap);
      s.position.set(-0.4 + Math.cos(i) * 0.5, 0, 1.9 + Math.sin(i * 2) * 0.4);
      g.add(s);
    }
    this.shroomLight = new THREE.PointLight('#9fe0c0', 0, 6, 2);
    this.shroomLight.position.set(-0.4, 0.6, 2);
    g.add(this.shroomLight);
    this.scene.add(shadowy(g));
  }

  buildLookout() {
    const p = this.places.lookout;
    const g = new THREE.Group();
    g.position.set(p.x + 1.2, 0, p.z + 1.2);
    const stones = [[0, 0.7, 0, 1.6, '#d9a46c'], [0.9, 0.5, -0.8, 1.1, '#c98f5a'], [-0.4, 1.9, 0.2, 1.0, '#e0b07a'], [-1.1, 0.4, 0.9, 0.8, '#c98f5a']];
    for (const [x, y, z, r, c] of stones) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), flat(c));
      s.position.set(x, y, z);
      s.scale.y = 0.75;
      s.rotation.y = x * 3;
      g.add(s);
    }
    this.scene.add(shadowy(g));
  }

  buildFlowers(rand) {
    const p = this.places.flowers;
    const n = 70;
    const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), flat('#ffffff'), n);
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 3), flat('#6f8f4a'), n);
    const cols = ['#f08aa0', '#e8584f', '#f6e7c8', '#f2c14e', '#f3b0c8'].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * 2.8;
      const x = p.x + Math.cos(a) * rr;
      const z = p.z + Math.sin(a) * rr;
      const h = 0.25 + rand() * 0.3;
      m.makeTranslation(x, h, z);
      heads.setMatrixAt(i, m);
      heads.setColorAt(i, cols[Math.floor(rand() * cols.length)]);
      m.makeTranslation(x, h / 2, z);
      stems.setMatrixAt(i, m);
    }
    heads.castShadow = true;
    this.scene.add(heads, stems);
  }

  buildDecor(rand) {
    const avoid = (x, z) => {
      const pond = this.places.pond;
      if (Math.hypot(x - pond.x, z - pond.z) < POND_R + 0.6) return true;
      return Object.values(this.places).some((q) => !q.tree && Math.hypot(x - q.x, z - q.z) < 1.6);
    };
    const n = 520;
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.11, 0.5, 3), flat('#ffffff'), n);
    const cols = ['#8fa36c', '#9fb27a', '#7f9560', '#b3c08a'].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let i = 0;
    while (i < n) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * (ISLAND - 0.8);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (avoid(x, z)) continue;
      const k = 0.6 + rand() * 0.9;
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * 3, (rand() - 0.5) * 0.4));
      s.set(k, k, k);
      m.compose(new THREE.Vector3(x, 0.2 * k, z), q, s);
      tufts.setMatrixAt(i, m);
      tufts.setColorAt(i, cols[Math.floor(rand() * cols.length)]);
      i++;
    }
    tufts.receiveShadow = true;
    this.scene.add(tufts);
    for (let j = 0; j < 16; j++) {
      const a = rand() * Math.PI * 2;
      const rr = ISLAND - 1.5 - rand() * 3;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (avoid(x, z)) continue;
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 + rand() * 0.6, 0), flat(rand() > 0.5 ? '#6f8f5e' : '#839f6a'));
      bush.position.set(x, 0.4, z);
      bush.scale.y = 0.7;
      this.scene.add(shadowy(bush));
    }
    for (let j = 0; j < 12; j++) {
      const a = rand() * Math.PI * 2;
      const rr = 6 + rand() * (ISLAND - 8);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rand() * 0.4, 0), flat('#b9ad9a'));
      rock.position.set(Math.cos(a) * rr, 0.1, Math.sin(a) * rr);
      rock.scale.y = 0.55;
      if (!avoid(rock.position.x, rock.position.z)) this.scene.add(shadowy(rock));
    }
  }

  // Fireflies at night and gum leaves drifting down by day.
  buildNightLife(rand) {
    const n = 70;
    this.flies = [];
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.flies.push({ x: (rand() - 0.5) * 40, z: (rand() - 0.5) * 40, y: 0.5 + rand() * 3, p: rand() * 10 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.flyMat = new THREE.PointsMaterial({ color: '#fff3a0', size: 0.22, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flyPoints = new THREE.Points(geo, this.flyMat);
    this.scene.add(this.flyPoints);

    this.leaves = [];
    const leafGeo = new THREE.PlaneGeometry(0.16, 0.42);
    const leafMat = flat('#8db39a', { side: THREE.DoubleSide });
    for (let i = 0; i < 18; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      this.scene.add(leaf);
      this.leaves.push({ mesh: leaf, t: rand() * 10 });
      this.#resetLeaf(this.leaves[i], rand);
    }
  }

  #resetLeaf(l, rand = Math.random) {
    const ids = Object.keys(this.trees);
    const tree = this.places[ids[Math.floor(rand() * ids.length)]];
    l.mesh.position.set(tree.x + (rand() - 0.5) * 5, 5 + rand() * 3, tree.z + (rand() - 0.5) * 5);
    l.spin = rand() * 3;
  }

  buildVisitor() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.9, 7), flat('#c9b48a'));
    body.position.y = 0.6;
    const headM = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 1), flat('#e8c4a0'));
    headM.position.y = 1.3;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 12), flat('#6b6a3a'));
    brim.position.y = 1.48;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.28, 9), flat('#6b6a3a'));
    crown.position.y = 1.62;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.22), flat('#8a6a4a'));
    pack.position.set(0, 0.75, -0.32);
    const lantern = new THREE.Group();
    lantern.position.set(0.42, 0.55, 0.15);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), new THREE.MeshStandardMaterial({ color: '#ffe3a3', emissive: '#f2a541', emissiveIntensity: 0.4 }));
    this.lanternGlass = glass;
    this.lanternLight = new THREE.PointLight('#ffcf80', 0, 9, 1.8);
    lantern.add(glass, this.lanternLight);
    g.add(body, headM, brim, crown, pack, lantern);
    g.position.set(4, 0, 10);
    this.visitor = { root: shadowy(g), heading: Math.PI, target: null, body, lantern };
    this.scene.add(g);
  }

  buildPlaceLabels() {
    for (const [id, p] of Object.entries(this.places)) {
      const el = document.createElement('div');
      el.className = 'place-label';
      el.textContent = p.name;
      const o = new CSS2DObject(el);
      o.position.set(p.x, id === 'lookout' ? 3.6 : p.tree ? 8.6 : id === 'swing' ? 4.4 : 1.4, p.z);
      this.scene.add(o);
    }
  }

  // --- following the server ------------------------------------------------------------
  // A straight walk, bent around the pond when it would cross it.
  route(from, to) {
    const c = this.places.pond;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((c.x - from.x) * dx + (c.z - from.z) * dz) / len2));
    const px = from.x + dx * u - c.x;
    const pz = from.z + dz * u - c.z;
    const d = Math.hypot(px, pz);
    if (d > POND_R + 0.6 || u <= 0 || u >= 1) return [];
    const nx = d > 0.01 ? px / d : -dz / Math.sqrt(len2);
    const nz = d > 0.01 ? pz / d : dx / Math.sqrt(len2);
    return [{ x: c.x + nx * (POND_R + 1.4), z: c.z + nz * (POND_R + 1.4), y: 0 }];
  }

  sync(state) {
    this.state = state;
    this.clockFrac = state.clock.frac;
    this.clockAt = performance.now();
    for (const k of state.koalas) {
      const view = this.koalas.get(k.id);
      if (!view) continue;
      view.thinking = k.thinking;
      const spot = spotFor(this.places, k.place, k.id, k.activity);
      const anim = animFor(k);
      const path = this.route(view.pos, spot);
      view.setGoal(spot, anim, path, this.#faceFor(k, spot));
      view.tagState.textContent = k.thinking ? 'thinking…' : `${k.mood}`;
      view.tagEl.classList.toggle('thinking', k.thinking);
    }
  }

  #faceFor(k, spot) {
    const p = this.places[k.place];
    if (!p) return null;
    const toward = (x, z) => Math.atan2(x - spot.x, z - spot.z);
    if (p.tree && (k.activity === 'climb' || k.activity === 'eat')) return toward(p.x, p.z);
    if (k.place === 'pond') return toward(p.x, p.z);
    if (k.place === 'swing' && k.activity === 'play') return 0;
    return null; // decided each frame: the friend, the visitor or the view
  }

  onLog(e) {
    const view = this.koalas.get(e.koala);
    if (!view) return;
    if (e.kind === 'say') view.say(e.text);
    if (e.kind === 'think') view.thought(e.text);
  }

  select(id) {
    this.selected = id;
    for (const [kid, v] of this.koalas) v.tagEl.classList.toggle('selected', kid === id);
  }

  setMode(mode) {
    this.mode = mode;
  }

  // Walk the visitor up to a koala (used when giving, saying or patting).
  visit(id) {
    const v = this.koalas.get(id);
    if (!v) return;
    const me = this.visitor.root.position;
    const dx = me.x - v.pos.x;
    const dz = me.z - v.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 2.6) return;
    this.visitor.target = { x: v.pos.x + (dx / d) * 1.9, z: v.pos.z + (dz / d) * 1.9 };
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const roots = [...this.koalas.values()].map((v) => v.root);
    const hit = this.raycaster.intersectObjects(roots, true).find((h) => h.object.userData.koala);
    if (hit) return this.onPick(hit.object.userData.koala);
    if (this.mode !== 'walk') return this.onPick(null);
    const g = this.raycaster.intersectObject(this.ground, false)[0];
    if (g) this.visitor.target = { x: g.point.x, z: g.point.z };
  }

  // --- each frame ----------------------------------------------------------------------
  update(dt, t) {
    const frac = (this.clockFrac + (this.clockAt ? (performance.now() - this.clockAt) / DAY_MS : 0)) % 1;
    this.#daylight(frac);
    this.#visitor(dt, t);
    this.#koalas(dt, t);
    this.#toys(dt, t);
    this.#life(dt, t);
    this.#camera(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  #daylight(frac) {
    const sky = skyAt(frac);
    this.skyMat.uniforms.top.value.setRGB(...sky.top);
    this.skyMat.uniforms.bottom.value.setRGB(...sky.bottom);
    this.scene.fog.color.setRGB(...sky.bottom);
    const a = (frac - 0.25) * Math.PI * 2;
    const sx = Math.cos(a);
    const sy = Math.sin(a);
    this.sunDisc.position.set(sx * 300, sy * 260, -120);
    this.sunDisc.lookAt(0, 0, 0);
    this.moonDisc.position.set(-sx * 300, -sy * 260, -120);
    this.moonDisc.lookAt(0, 0, 0);
    const day = sy > -0.05;
    const L = day ? { x: sx, y: Math.max(0.15, sy) } : { x: -sx, y: Math.max(0.2, -sy) };
    this.sun.position.set(L.x * 40, L.y * 50, 22);
    this.sun.color.set(day ? (sky.sun > 0.8 ? '#fff0d6' : '#ffb98a') : '#9fb2ff');
    this.sun.intensity = day ? 0.3 + sky.sun * 2.1 : 0.45;
    this.hemi.intensity = 0.28 + sky.sun * 0.6;
    this.hemi.color.setRGB(...sky.top.map((v) => 0.5 + v * 0.5));
    this.starMat.opacity = sky.night;
    this.flyMat.opacity = sky.night;
    this.shroomMat.emissiveIntensity = sky.night * 1.6;
    this.shroomLight.intensity = sky.night * 4;
    this.lanternLight.intensity = sky.night * 7;
    this.lanternGlass.material.emissiveIntensity = 0.3 + sky.night * 2.2;
    this.renderer.toneMappingExposure = 0.85 + sky.sun * 0.25;
    this.night = sky.night;
  }

  #visitor(dt, t) {
    const v = this.visitor;
    const p = v.root.position;
    let mx = 0;
    let mz = 0;
    if (this.mode === 'walk') {
      const k = this.keys;
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      if (f || s) {
        v.target = null;
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        mx = fwd.x * f + right.x * s;
        mz = fwd.z * f + right.z * s;
      }
    }
    if (v.target) {
      const dx = v.target.x - p.x;
      const dz = v.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1) v.target = null;
      else {
        mx = dx / d;
        mz = dz / d;
      }
    }
    const len = Math.hypot(mx, mz);
    const before = { x: p.x, z: p.z };
    if (len > 0) {
      const speed = (this.keys.has('shift') ? 6 : 3.4) * dt;
      p.x += (mx / len) * speed;
      p.z += (mz / len) * speed;
      const want = Math.atan2(mx, mz);
      let d = want - v.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.heading += d * Math.min(1, dt * 10);
    }
    // Stay on the island, out of the pond and out of the tree trunks.
    const r = Math.hypot(p.x, p.z);
    if (r > ISLAND - 1) {
      p.x *= (ISLAND - 1) / r;
      p.z *= (ISLAND - 1) / r;
    }
    const pushOut = (cx, cz, rad) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < rad && d > 0.001) {
        p.x = cx + (dx / d) * rad;
        p.z = cz + (dz / d) * rad;
      }
    };
    const pond = this.places.pond;
    pushOut(pond.x, pond.z, POND_R + 0.3);
    for (const id of Object.keys(this.trees)) pushOut(this.places[id].x, this.places[id].z, 0.9);
    const moved = Math.hypot(p.x - before.x, p.z - before.z);
    v.walk = (v.walk ?? 0) + moved * 3;
    v.body.position.y = 0.6 + (moved > 0 ? Math.abs(Math.sin(v.walk)) * 0.08 : 0);
    v.lantern.rotation.z = Math.sin(v.walk) * 0.2;
    v.root.rotation.y = v.heading;
    this.visitorMoved = { x: p.x - before.x, z: p.z - before.z };
  }

  #koalas(dt, t) {
    const vp = this.visitor.root.position;
    const list = [...this.koalas.values()];
    for (const v of list) {
      if (v.face == null && !v.moving && v.pos.y < 0.05) {
        // Look at the friend when close, else at the visitor when close, else take in the view.
        const f = list.find((o) => o !== v);
        const df = Math.hypot(f.pos.x - v.pos.x, f.pos.z - v.pos.z);
        const dv = Math.hypot(vp.x - v.pos.x, vp.z - v.pos.z);
        const look = dv < 4 && v.anim !== 'sleep' ? vp : df < 7 ? f.pos : { x: v.pos.x * 1.5, z: v.pos.z * 1.5 + 4 };
        const want = Math.atan2(look.x - v.pos.x, look.z - v.pos.z);
        let d = want - v.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.heading += d * Math.min(1, dt * 2.5);
      }
      v.update(dt, t);
      if (v.anim === 'splash' && v.arrived && Math.random() < dt * 1.8) {
        this.ripple(v.pos.x + Math.sin(v.heading) * 1.2, v.pos.z + Math.cos(v.heading) * 1.2);
      }
    }
  }

  #toys(dt, t) {
    // Swing seats rock with whoever is on them.
    this.seats.forEach((seat, i) => {
      const id = i === 0 ? 'mallee' : 'bramble';
      const v = this.koalas.get(id);
      const on = v && v.anim === 'swing' && v.arrived;
      const want = on ? Math.sin(t * 2.2 + (id === 'mallee' ? 0 : 1.4)) * 0.2 : 0;
      seat.rotation.x = damp(seat.rotation.x, want, 6, dt);
    });
    // The ball: tossed between two players, bounced by one, at rest otherwise.
    const players = [...this.koalas.values()].filter((v) => v.anim === 'ball' && v.arrived);
    const front = (v) => new THREE.Vector3(v.pos.x + Math.sin(v.heading) * 0.75, 0.3, v.pos.z + Math.cos(v.heading) * 0.75);
    let want;
    if (players.length === 2) {
      const per = 1.6;
      const u = (t % per) / per;
      const flip = Math.floor(t / per) % 2;
      const [a, b] = flip ? [front(players[1]), front(players[0])] : [front(players[0]), front(players[1])];
      want = a.lerp(b, u);
      want.y = 0.3 + Math.sin(u * Math.PI) * 1.6;
      this.ball.position.copy(want);
    } else if (players.length === 1) {
      want = front(players[0]);
      want.y = 0.5 + Math.abs(Math.sin(t * 3)) * 1.5;
      this.ball.position.copy(want);
    } else {
      this.ball.position.x = damp(this.ball.position.x, this.ballRest.x, 2, dt);
      this.ball.position.z = damp(this.ball.position.z, this.ballRest.z, 2, dt);
      this.ball.position.y = damp(this.ball.position.y, 0.3, 6, dt);
    }
    this.ball.rotation.x += dt * (players.length ? 6 : 0.2);
    for (const r of this.ripples) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt * 0.7);
      const s = 1 + r.t * 5;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = (1 - r.t) * 0.7;
    }
  }

  #life(dt, t) {
    if (this.night > 0.02) {
      const pos = this.flyPoints.geometry.attributes.position;
      this.flies.forEach((f, i) => {
        pos.setXYZ(i, f.x + Math.sin(t * 0.5 + f.p) * 1.5, f.y + Math.sin(t * 1.3 + f.p * 2) * 0.4, f.z + Math.cos(t * 0.4 + f.p) * 1.5);
      });
      pos.needsUpdate = true;
    }
    if (this.reduced) return;
    for (const l of this.leaves) {
      const m = l.mesh;
      m.position.y -= dt * 0.55;
      m.position.x += Math.sin(t * 1.3 + l.spin) * dt * 0.5;
      m.rotation.set(t * 1.1 + l.spin, t * 0.7, Math.sin(t + l.spin));
      if (m.position.y < 0.02) this.#resetLeaf(l);
    }
    this.lilies.forEach((p, i) => (p.position.y = 0.06 + Math.sin(t * 1.2 + i) * 0.015));
  }

  #camera(dt) {
    const c = this.controls;
    let want;
    if (this.mode === 'walk') {
      const p = this.visitor.root.position;
      want = new THREE.Vector3(p.x, 1.2, p.z);
    } else {
      const v = this.selected && this.koalas.get(this.selected);
      want = v ? new THREE.Vector3(v.pos.x, v.pos.y + 1, v.pos.z) : new THREE.Vector3(0, 1, 2);
    }
    const step = want.sub(c.target).multiplyScalar(1 - Math.exp(-4 * dt));
    c.target.add(step);
    this.camera.position.add(step);
  }
}
