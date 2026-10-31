// three.js view of the town. Reads the world each frame and listens to its
// bus for one-off effects (blocks popping in, coins flying, confetti).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DISTRICTS } from '../sim/builders.js';
import { fmt } from '../sim/core.js';

const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...extra });

export class TownScene {
  constructor(container, world) {
    this.world = world;
    this.container = container;
    this.agentViews = new Map();
    this.plotViews = new Map();
    this.pops = [];
    this.flyers = [];
    this.floaters = [];
    this.selected = null;
    this.follow = true;
    this.hubPulse = 0;
    this.screenTimer = 0;

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
    this.scene.fog = new THREE.Fog(0x9fd4ff, 90, 190);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 500);
    this.camera.position.set(46, 52, 58);
    if (container.clientWidth < 820) this.camera.position.set(70, 95, 95);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.38;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 150;
    this.controls.target.set(-2, 0, 2);

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5a7a4a, 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.far = 260;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.buildGround();
    this.buildHub();
    this.buildExchange();
    this.buildPlaza();
    this.buildDepot();
    this.buildBoard();
    this.buildLibrary();
    this.buildDecor();
    this.buildParticles();
    for (const a of world.agents) this.addAgent(a);
    for (const p of world.construction.plots) this.addPlot(p);

    const bus = world.bus;
    bus.on('plot:open', (p) => this.addPlot(p));
    bus.on('block', (e) => this.onBlock(e));
    bus.on('plot:done', ({ plot }) => this.onPlotDone(plot));
    bus.on('chat', (e) => this.showBubble(e.speaker, e.text, 'say'));
    bus.on('transfer', (e) => this.onTransfer(e));
    bus.on('tokens', () => (this.hubPulse = Math.min(1, this.hubPulse + 0.08)));
    bus.on('trade', (t) => this.onTrade(t));

    this.raycaster = new THREE.Raycaster();
    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    r.domElement.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) this.pick(e);
      down = null;
    });
    this.controls.addEventListener('start', () => (this.userMoved = true));

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    // keep the town centred in the area the side panel leaves visible
    const panel = document.getElementById('panel');
    const P = w > 820 && panel && !panel.classList.contains('collapsed') ? panel.offsetWidth + 12 : 0;
    this.camera.aspect = (w + P) / h;
    if (P) this.camera.setViewOffset(w + P, h, P, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // --- static town --------------------------------------------------------------
  buildGround() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 64), std('#86b86a'));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const water = new THREE.Mesh(new THREE.RingGeometry(66, 150, 64), std('#4f9fd1', { roughness: 0.2, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.02;
    this.scene.add(water);
    const sand = new THREE.Mesh(new THREE.RingGeometry(62, 66.5, 64), std('#e8d8a8'));
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = 0.015;
    this.scene.add(sand);

    const roadMat = std('#5a5f68', { roughness: 0.95 });
    for (const [k, d] of Object.entries(DISTRICTS)) {
      if (k === 'hub') continue;
      const len = Math.hypot(d.x, d.z);
      const road = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, len), roadMat);
      road.position.set(d.x / 2, 0.03, d.z / 2);
      road.rotation.y = Math.atan2(d.x, d.z);
      road.receiveShadow = true;
      this.scene.add(road);
    }
    const pad = (d, color, r) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 48), std(color));
      m.position.set(d.x, 0.06, d.z);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    pad(DISTRICTS.hub, '#c9ccd4', 7.5);
    pad(DISTRICTS.exchange, '#d8cfb8', 8.5);
    pad(DISTRICTS.plaza, '#e2d6c2', 6.5);
    pad(DISTRICTS.depot, '#b59b74', 5.5);
    pad(DISTRICTS.board, '#c9ccd4', 3);
    pad(DISTRICTS.yard, '#b59b74', 4);
    pad(DISTRICTS.library, '#cfc3e6', 5.5);

    for (const [k, d] of Object.entries(DISTRICTS)) {
      if (k === 'yard') continue;
      const el = document.createElement('div');
      el.className = 'district-label';
      el.textContent = d.label;
      const o = new CSS2DObject(el);
      o.position.set(d.x, k === 'hub' ? 19 : k === 'exchange' ? 11 : k === 'library' ? 9.5 : 7, d.z);
      this.scene.add(o);
    }
  }

  buildHub() {
    const d = DISTRICTS.hub;
    const g = new THREE.Group();
    g.position.set(d.x, 0, d.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5, 1.2, 8), std('#3a4150'));
    base.position.y = 0.6;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.6, 13, 8), std('#e9edf3', { metalness: 0.3, roughness: 0.4 }));
    tower.position.y = 7.6;
    this.hubOrbMat = new THREE.MeshStandardMaterial({ color: '#7fd1e8', emissive: '#3fb6e0', emissiveIntensity: 1.5 });
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), this.hubOrbMat);
    orb.position.y = 15.6;
    this.hubOrb = orb;
    this.hubRings = [];
    const ringMat = new THREE.MeshStandardMaterial({ color: '#c48af0', emissive: '#8a4ad0', emissiveIntensity: 1.2 });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2 + i * 0.7, 0.12, 8, 48), ringMat);
      ring.position.y = 5 + i * 3.2;
      ring.rotation.x = Math.PI / 2;
      this.hubRings.push(ring);
      g.add(ring);
    }
    // token meter: a glowing bar that fills with today's town usage
    this.hubMeter = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 1, 8, 1, true), new THREE.MeshStandardMaterial({ color: '#f2c14e', emissive: '#f2a541', emissiveIntensity: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    this.hubMeter.position.y = 1.2;
    for (const m of [base, tower, orb]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    g.add(base, tower, orb, this.hubMeter);
    this.hubLight = new THREE.PointLight('#7fd1e8', 30, 40, 1.6);
    this.hubLight.position.y = 15.6;
    g.add(this.hubLight);

    this.hubScreen = canvasTexture(640, 160);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hubScreen.tex, depthWrite: false }));
    sprite.scale.set(13, 3.25, 1);
    sprite.position.y = 21.5;
    g.add(sprite);
    this.scene.add(g);
  }

  buildExchange() {
    const d = DISTRICTS.exchange;
    const g = new THREE.Group();
    g.position.set(d.x, 0, d.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(11, 5, 7), std('#f1ece2'));
    body.position.y = 2.5;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 8), std('#2f3542'));
    roof.position.y = 5.4;
    const pedi = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 6.4, 2.2, 4, 1), std('#2f3542'));
    pedi.rotation.y = Math.PI / 4;
    pedi.scale.z = 0.62;
    pedi.position.y = 6.9;
    g.add(body, roof, pedi);
    for (let i = 0; i < 5; i++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 5, 10), std('#ffffff'));
      col.position.set(-4.4 + i * 2.2, 2.5, 4);
      col.castShadow = true;
      g.add(col);
    }
    for (const m of [body, roof, pedi]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    // ticker screen
    this.exScreen = canvasTexture(768, 384);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: this.exScreen.tex }));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(10.6, 5.6, 0.4), std('#1b1f27'));
    const stand = new THREE.Group();
    stand.add(frame, screen);
    screen.position.z = 0.21;
    frame.castShadow = true;
    for (const x of [-3.5, 3.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), std('#1b1f27'));
      post.position.set(x, -4.6, 0);
      stand.add(post);
    }
    stand.position.set(-8, 6.6, 6.5);
    stand.rotation.y = 0.65;
    g.add(stand);
    // spinning coins on the roof, one per market coin
    this.roofCoins = [];
    Object.values(this.world.market.coins).forEach((c, i) => {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.22, 28), new THREE.MeshStandardMaterial({ color: c.color, metalness: 0.8, roughness: 0.25, emissive: c.color, emissiveIntensity: 0.15 }));
      coin.rotation.x = Math.PI / 2;
      coin.position.set(-3.6 + i * 3.6, 9.4, 0);
      coin.castShadow = true;
      coin.userData.sym = c.sym;
      g.add(coin);
      this.roofCoins.push(coin);
    });
    this.scene.add(g);
  }

  buildPlaza() {
    const d = DISTRICTS.plaza;
    const g = new THREE.Group();
    g.position.set(d.x, 0, d.z);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.8, 24), std('#cfd6de'));
    basin.position.y = 0.4;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.1, 24), std('#6cc3ef', { roughness: 0.1 }));
    water.position.y = 0.78;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 10), std('#cfd6de'));
    col.position.y = 1.6;
    g.add(basin, water, col);
    this.fountainDrops = [];
    const dropMat = std('#bfe8ff', { transparent: true, opacity: 0.85 });
    for (let i = 0; i < 18; i++) {
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), dropMat);
      drop.userData = { a: (i / 18) * Math.PI * 2, t: i / 18 };
      g.add(drop);
      this.fountainDrops.push(drop);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.7), std('#9a6a44'));
      bench.position.set(Math.cos(a) * 5.2, 0.4, Math.sin(a) * 5.2);
      bench.rotation.y = -a + Math.PI / 2;
      bench.castShadow = true;
      g.add(bench);
    }
    basin.castShadow = col.castShadow = true;
    this.scene.add(g);
  }

  buildDepot() {
    const d = DISTRICTS.depot;
    const colors = ['#e8774a', '#f2c14e', '#efe0bd', '#86b8de', '#b8c0cc', '#c4553b'];
    const n = 64;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 0.96, 0.96), std('#ffffff'), n);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const pile = i % 4;
      const k = Math.floor(i / 4);
      const px = d.x - 2.5 + (pile % 2) * 4 + (k % 2);
      const pz = d.z - 2.5 + Math.floor(pile / 2) * 4 + (Math.floor(k / 2) % 2);
      m.setPosition(px, 0.6 + Math.floor(k / 4), pz);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(colors[pile + (k % 2)]));
    }
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    // crane
    const crane = new THREE.Group();
    crane.position.set(d.x + 4.5, 0, d.z - 4.5);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.5, 12, 0.5), std('#f2c14e'));
    mast.position.y = 6;
    this.craneArm = new THREE.Group();
    this.craneArm.position.y = 12;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 0.4), std('#f2c14e'));
    arm.position.x = -3;
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 5, 0.06), std('#333'));
    cable.position.set(-7, -2.5, 0);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), std('#e8774a'));
    hook.position.set(-7, -5.4, 0);
    this.craneArm.add(arm, cable, hook);
    crane.add(mast, this.craneArm);
    for (const o of [mast, arm, hook]) o.castShadow = true;
    this.scene.add(crane);
  }

  buildBoard() {
    const d = DISTRICTS.board;
    this.boardScreen = canvasTexture(512, 400);
    const g = new THREE.Group();
    g.position.set(d.x, 0, d.z);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4), new THREE.MeshBasicMaterial({ map: this.boardScreen.tex }));
    panel.position.set(0, 3.6, 0.13);
    const back = new THREE.Mesh(new THREE.BoxGeometry(5.6, 4.4, 0.25), std('#7a5236'));
    back.position.y = 3.6;
    back.castShadow = true;
    g.add(back, panel);
    for (const x of [-2.2, 2.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), std('#7a5236'));
      leg.position.set(x, 0.8, 0);
      g.add(leg);
    }
    g.rotation.y = 0.65;
    this.scene.add(g);
  }

  // The Obsidian vault: one glowing book per note Claude's answers were saved as.
  buildLibrary() {
    const d = DISTRICTS.library;
    const g = new THREE.Group();
    g.position.set(d.x, 0, d.z);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(7, 4.2, 5), std('#5b4a86'));
    hall.position.y = 2.1;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.6, 4), std('#3a2f5c'));
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 0.75;
    roof.position.y = 5.5;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshStandardMaterial({ color: '#a78bfa', emissive: '#7c3aed', emissiveIntensity: 1.4 }));
    gem.position.y = 7.6;
    this.libraryGem = gem;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.1), std('#2a2140'));
    door.position.set(1.6, 1.1, -2.52);
    for (const m of [hall, roof, gem]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    g.add(hall, roof, gem, door);
    // outdoor shelf in front of the hall, filled with one book per vault note
    this.shelf = new THREE.Group();
    this.shelf.position.set(-1.6, 0, -3.2);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 0.7), std('#7a5236'));
    frame.position.y = 1.3;
    frame.castShadow = true;
    this.shelf.add(frame);
    g.add(this.shelf);
    this.books = [];
    this.scene.add(g);
  }

  setBooks(n) {
    while (this.books.length < Math.min(n, 24)) this.addBook(false);
  }

  addBook(celebrate = true) {
    const i = this.books.length;
    if (i >= 24) return;
    const colors = ['#a78bfa', '#f2c14e', '#7fd1e8', '#4fd18b', '#f07fb0', '#e8774a'];
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.62, 0.5), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], emissive: colors[i % colors.length], emissiveIntensity: 0.35 }));
    book.position.set(-1.45 + (i % 8) * 0.4, 0.5 + Math.floor(i / 8) * 0.82, -0.12);
    this.shelf.add(book);
    this.books.push(book);
    if (celebrate) {
      const d = DISTRICTS.library;
      this.burst(d.x - 1.6, 3, d.z - 3.2, ['#a78bfa', '#f2c14e', '#ffffff'], 60, 6);
    }
  }

  buildDecor() {
    const rng = this.world.rng;
    const trunk = std('#7a5236');
    const leaf = [std('#4f8a3a'), std('#5e9e45'), std('#3f7a34')];
    const slots = this.world.construction.slots;
    const clear = (x, z) =>
      Object.values(DISTRICTS).every((d) => Math.hypot(x - d.x, z - d.z) > d.r + 3) && slots.every((s) => Math.hypot(x - s.x - 2.5, z - s.z - 2.5) > 6) && Math.hypot(x, z) < 60;
    let placed = 0;
    for (let i = 0; i < 400 && placed < 70; i++) {
      const a = rng() * Math.PI * 2;
      const r = 20 + rng() * 42;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!clear(x, z)) continue;
      const s = 0.7 + rng() * 0.7;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.3 * s, 1.4 * s, 6), trunk);
      t.position.set(x, 0.7 * s, z);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.3 * s, 3 * s, 7), rng.pick(leaf));
      top.position.set(x, 2.6 * s, z);
      t.castShadow = top.castShadow = true;
      this.scene.add(t, top);
      placed++;
    }
    // lamp posts along the roads; their bulbs glow at night
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd36b', emissiveIntensity: 0 });
    const pole = std('#2f3542');
    for (const d of Object.values(DISTRICTS)) {
      for (const f of [0.35, 0.7]) {
        const x = d.x * f + 1.8;
        const z = d.z * f + 1.8;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6), pole);
        p.position.set(x, 1.7, z);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), this.lampMat);
        b.position.set(x, 3.5, z);
        this.scene.add(p, b);
      }
    }
  }

  buildParticles() {
    const N = 600;
    this.particles = { n: N, next: 0, life: new Float32Array(N), vel: new Float32Array(N * 3) };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3).fill(-999), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 14);
  }

  burst(x, y, z, colors, count = 80, power = 7) {
    const P = this.particles;
    const pos = this.points.geometry.attributes.position;
    const col = this.points.geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const k = P.next;
      P.next = (P.next + 1) % P.n;
      pos.setXYZ(k, x, y, z);
      c.set(colors[i % colors.length]);
      col.setXYZ(k, c.r, c.g, c.b);
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * power * 0.5;
      P.vel[k * 3] = Math.cos(a) * s;
      P.vel[k * 3 + 1] = power * (0.6 + Math.random() * 0.6);
      P.vel[k * 3 + 2] = Math.sin(a) * s;
      P.life[k] = 1.6 + Math.random();
    }
    pos.needsUpdate = col.needsUpdate = true;
  }

  // --- agents -------------------------------------------------------------------
  addAgent(a) {
    const g = new THREE.Group();
    const bodyMat = std(a.color, { roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 4, 12), bodyMat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), std('#f4f1ea', { roughness: 0.4 }));
    head.position.y = 1.78;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.12), new THREE.MeshStandardMaterial({ color: '#1b2230', emissive: '#4fd1ff', emissiveIntensity: 0.6 }));
    visor.position.set(0, 1.8, 0.37);
    g.add(body, head, visor);
    const acc = this.accessory(a);
    if (acc) g.add(acc);
    const carry = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), std('#e8774a'));
    carry.position.y = 2.75;
    carry.visible = false;
    g.add(carry);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), new THREE.MeshBasicMaterial({ color: '#ffe066', side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.visible = false;
    g.add(ring);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.userData.agentId = a.id;
      }
    });

    const label = document.createElement('div');
    label.className = 'agent-label';
    label.innerHTML = `<span class="dot" style="background:${a.color}"></span>${a.name}`;
    label.addEventListener('click', () => this.onSelect?.(a));
    const labelObj = new CSS2DObject(label);
    labelObj.position.y = 2.6;
    g.add(labelObj);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const bubbleObj = new CSS2DObject(bubble);
    bubbleObj.position.y = 3.2;
    bubbleObj.center.set(0.5, 1);
    g.add(bubbleObj);

    this.scene.add(g);
    const spin = acc?.children.find((c) => c.userData.spin) ?? null;
    this.agentViews.set(a.id, { a, g, body, carry, ring, label, bubble, spin, bubbleUntil: 0, lastThought: a.thought, phase: Math.random() * 6 });
  }

  accessory(a) {
    const g = new THREE.Group();
    if (a.role === 'builder') {
      const hat = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std('#ffd23f'));
      hat.position.y = 1.9;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.06, 18), std('#ffd23f'));
      brim.position.y = 1.92;
      g.add(hat, brim);
    } else if (a.role === 'mayor') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 18), std('#2a2233'));
      brim.position.y = 2.12;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.6, 18), std('#2a2233'));
      top.position.y = 2.45;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 18), std('#c48af0'));
      band.position.y = 2.22;
      g.add(brim, top, band);
    } else if (a.role === 'keeper') {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), std('#333'));
      ant.position.y = 2.4;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: '#7fd1e8', emissive: '#7fd1e8', emissiveIntensity: 2 }));
      bulb.position.y = 2.72;
      g.add(ant, bulb);
    } else if (a.role === 'auditor') {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.05), std('#8a5a3a'));
      board.position.set(0.5, 1.0, 0.25);
      board.rotation.y = -0.4;
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.02), std('#ffffff'));
      paper.position.set(0.51, 0.98, 0.28);
      paper.rotation.y = -0.4;
      g.add(board, paper);
    } else if (a.role === 'trader') {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 14), new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.9, roughness: 0.2 }));
      coin.rotation.x = Math.PI / 2;
      coin.position.set(0.18, 1.15, 0.42);
      const shades = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.1), std('#111'));
      shades.position.set(0, 1.82, 0.4);
      g.add(coin, shades);
    } else if (a.role === 'claude') {
      const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: '#f4a37f', emissive: '#d97757', emissiveIntensity: 1.6 }));
      star.position.y = 2.55;
      star.userData.spin = true;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 32), new THREE.MeshStandardMaterial({ color: '#f4a37f', emissive: '#d97757', emissiveIntensity: 1.2 }));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.06;
      g.add(star, halo);
        } else if (a.role === 'gossip') {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 12, 1, true), std('#fff1a8', { side: THREE.DoubleSide }));
      horn.rotation.x = -Math.PI / 2;
      horn.position.set(0.4, 1.3, 0.45);
      const bow = new THREE.Mesh(new THREE.TorusKnotGeometry(0.12, 0.05, 32, 6), std('#f07fb0'));
      bow.position.y = 2.2;
      g.add(horn, bow);
    }
    return g;
  }

  showBubble(agent, text, kind) {
    const v = this.agentViews.get(agent.id);
    if (!v) return;
    v.bubble.className = `bubble show ${kind}`;
    v.bubble.textContent = text;
    v.bubbleUntil = performance.now() + (kind === 'say' ? 2600 : 2200);
  }

  select(agent) {
    for (const v of this.agentViews.values()) v.ring.visible = false;
    this.selected = agent;
    if (agent) {
      this.agentViews.get(agent.id).ring.visible = true;
      this.follow = true;
    }
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [];
    for (const v of this.agentViews.values()) v.g.traverse((o) => o.isMesh && o.visible && meshes.push(o));
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const agent = hit ? this.agentViews.get(hit.object.userData.agentId)?.a ?? null : null;
    this.onSelect?.(agent);
  }

  // --- plots ----------------------------------------------------------------------
  addPlot(p) {
    const n = p.voxels.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const solid = new THREE.InstancedMesh(geo, std('#ffffff', { roughness: 0.7 }), n);
    solid.count = p.placed;
    solid.castShadow = solid.receiveShadow = true;
    const ghost = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#6fc3ff', transparent: true, opacity: 0.13, depthWrite: false }), n);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    p.voxels.forEach((v, i) => {
      m.makeScale(0.92, 0.92, 0.92).setPosition(p.x + v.x + 0.5, v.y + 0.5, p.z + v.z + 0.5);
      ghost.setMatrixAt(i, m);
      m.makeTranslation(p.x + v.x + 0.5, v.y + 0.5, p.z + v.z + 0.5);
      solid.setMatrixAt(i, m);
      solid.setColorAt(i, c.set(v.color));
    });
    solid.instanceColor.needsUpdate = true;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.1, 7.6), std(p.status === 'done' ? '#c9ccd4' : '#b59b74'));
    pad.position.set(p.x + 2.5, 0.05, p.z + 2.5);
    pad.receiveShadow = true;
    const el = document.createElement('div');
    el.className = 'plot-label';
    const lbl = new CSS2DObject(el);
    const top = Math.max(...p.voxels.map((v) => v.y));
    lbl.position.set(p.x + 2.5, top + 2.2, p.z + 2.5);
    this.scene.add(pad, ghost, solid, lbl);
    if (p.status === 'done') ghost.visible = false;
    this.plotViews.set(p.id, { p, solid, ghost, pad, el });
  }

  onBlock({ plot, index, voxel }) {
    const v = this.plotViews.get(plot.id);
    if (!v) return;
    v.solid.count = plot.placed;
    this.pops.push({ mesh: v.solid, index, t: 0, x: plot.x + voxel.x + 0.5, y: voxel.y + 0.5, z: plot.z + voxel.z + 0.5 });
    if (Math.random() < 0.3) this.burst(plot.x + voxel.x + 0.5, voxel.y + 0.6, plot.z + voxel.z + 0.5, ['#d8c8a8', '#ffffff'], 4, 2);
  }

  onPlotDone(plot) {
    const v = this.plotViews.get(plot.id);
    if (!v) return;
    v.ghost.visible = false;
    v.pad.material = std('#c9ccd4');
    const top = Math.max(...plot.voxels.map((x) => x.y));
    this.burst(plot.x + 2.5, top + 1.5, plot.z + 2.5, ['#f2c14e', '#f07fb0', '#7fd1e8', '#4fd18b', '#c48af0'], 120, 9);
  }

  // --- money in motion ----------------------------------------------------------------
  anchor(id) {
    const a = this.world.byId(id) ?? this.agentViews.get(id)?.a;
    if (a) return new THREE.Vector3(a.pos.x, 1.8, a.pos.z);
    if (id === 'treasury') return new THREE.Vector3(DISTRICTS.hub.x, 3, DISTRICTS.hub.z);
    return new THREE.Vector3(DISTRICTS.exchange.x, 4, DISTRICTS.exchange.z);
  }

  onTransfer({ from, to, asset, amount }) {
    const coins = this.world.market.coins;
    const color = asset === 'cash' ? '#ffe066' : coins[asset].color;
    const n = Math.min(6, 2 + Math.floor(Math.log10(1 + amount)));
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.coinGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.3 }));
      this.scene.add(mesh);
      this.flyers.push({ mesh, from, to, t: -i * 0.12, dur: 1.3 });
    }
    const label = asset === 'cash' ? `+¢${fmt.num(amount)}` : `+${fmt.num(amount, 2)} ${asset}`;
    this.floatText(to, label, color);
  }

  onTrade(t) {
    if (Math.random() < 0.5) return;
    const coin = this.roofCoins.find((c) => c.userData.sym === t.sym);
    if (coin) coin.userData.kick = 1;
  }

  floatText(id, text, color) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.style.color = color;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.copy(this.anchor(id)).add(new THREE.Vector3(0, 1.4, 0));
    this.scene.add(obj);
    this.floaters.push({ obj, el, t: 0, delay: 1.2 });
  }

  // --- screens ----------------------------------------------------------------------
  drawScreens() {
    const w = this.world;
    {
      const { ctx, canvas, tex } = this.exScreen;
      ctx.fillStyle = '#0d1220';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#7fd1e8';
      ctx.font = 'bold 34px "JetBrains Mono", monospace';
      ctx.fillText('TOWN EXCHANGE', 28, 50);
      ctx.fillStyle = '#5c6b85';
      ctx.font = '20px "JetBrains Mono", monospace';
      ctx.fillText('play money · simulated', 470, 48);
      Object.values(w.market.coins).forEach((c, i) => {
        const y = 110 + i * 92;
        const ch = c.price / c.open - 1;
        ctx.fillStyle = c.color;
        ctx.font = 'bold 40px "JetBrains Mono", monospace';
        ctx.fillText(c.sym, 28, y + 14);
        ctx.fillStyle = '#e9eef5';
        ctx.fillText(c.price.toFixed(2), 160, y + 14);
        ctx.fillStyle = ch >= 0 ? '#4fd18b' : '#ff6b6b';
        ctx.font = 'bold 30px "JetBrains Mono", monospace';
        ctx.fillText(fmt.pct(ch), 340, y + 12);
        const h = c.history.slice(-90);
        const lo = Math.min(...h);
        const hi = Math.max(...h);
        ctx.strokeStyle = ch >= 0 ? '#4fd18b' : '#ff6b6b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        h.forEach((p, j) => {
          const x = 520 + (j / (h.length - 1)) * 220;
          const yy = y + 25 - ((p - lo) / (hi - lo || 1)) * 55;
          j ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
        });
        ctx.stroke();
      });
      tex.needsUpdate = true;
    }
    {
      const { ctx, canvas, tex } = this.boardScreen;
      ctx.fillStyle = '#f4ecd8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#3a2a1a';
      ctx.font = 'bold 34px "Space Grotesk", sans-serif';
      ctx.fillText('TICKETS', 20, 44);
      const live = w.board.tickets.filter((t) => t.status !== 'done').slice(0, 7);
      ctx.font = '22px "Space Grotesk", sans-serif';
      live.forEach((t, i) => {
        const y = 88 + i * 44;
        ctx.fillStyle = t.status === 'open' ? '#f2c14e' : '#7fd1e8';
        ctx.fillRect(18, y - 26, 380, 36);
        ctx.fillStyle = '#1b1f27';
        ctx.fillText(`${t.id} ${t.title}`.slice(0, 30), 26, y);
        ctx.fillStyle = '#6a5a4a';
        const who = t.assignee ? w.byId(t.assignee)?.name ?? '' : 'open';
        ctx.fillText(who.slice(0, 9), 406, y);
      });
      if (!live.length) {
        ctx.fillStyle = '#6a5a4a';
        ctx.fillText('All clear. Mayor is thinking...', 20, 100);
      }
      tex.needsUpdate = true;
    }
    {
      const { ctx, canvas, tex } = this.hubScreen;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(13,18,32,0.82)';
      ctx.beginPath();
      ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 24);
      ctx.fill();
      const T = w.tokens.total;
      const rate = w.tokens.history.slice(-5).reduce((s, x) => s + x, 0) / 5;
      ctx.fillStyle = '#7fd1e8';
      ctx.font = 'bold 54px "JetBrains Mono", monospace';
      const tokText = `${fmt.tokens(T.in + T.out)} tok`;
      ctx.fillText(tokText, 28, 74);
      ctx.fillStyle = '#f2c14e';
      ctx.fillText(fmt.usd(T.cost), 28 + ctx.measureText(tokText).width + 30, 74);
      ctx.fillStyle = '#c48af0';
      ctx.font = '30px "JetBrains Mono", monospace';
      ctx.fillText(`${fmt.tokens(rate)} tok/s · ${T.calls} calls`, 28, 128);
      tex.needsUpdate = true;
    }
  }

  // --- per frame ----------------------------------------------------------------------
  update(dt) {
    const w = this.world;
    const now = performance.now();
    const tod = (w.time % w.config.dayLength) / w.config.dayLength;
    const s = Math.sin(tod * Math.PI * 2);
    const dayness = smooth(-0.25, 0.2, s);
    const dusk = 1 - Math.min(1, Math.abs(s) * 3);
    this.sun.position.set(Math.cos(tod * Math.PI * 2) * 80, Math.max(8, s * 90), 40);
    this.sun.intensity = 0.15 + 2.3 * dayness;
    this.hemi.intensity = 0.4 + 0.5 * dayness;
    const sky = new THREE.Color('#0b1430').lerp(new THREE.Color('#9fd4ff'), dayness).lerp(new THREE.Color('#f5a46b'), dusk * 0.35 * (0.4 + dayness));
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.lampMat.emissiveIntensity = (1 - dayness) * 2.5;
    this.renderer.toneMappingExposure = 0.85 + 0.25 * dayness;

    // hub
    const rate = w.tokens.history.at(-1) ?? 0;
    this.hubRings.forEach((r, i) => (r.rotation.z += dt * (0.3 + rate / 900) * (i % 2 ? -1 : 1)));
    this.hubPulse *= Math.pow(0.1, dt);
    this.hubOrbMat.emissiveIntensity = 1 + this.hubPulse * 3 + (1 - dayness);
    this.hubOrb.rotation.y += dt * 0.6;
    this.hubOrb.scale.setScalar(1 + this.hubPulse * 0.25);
    this.hubLight.intensity = 20 + this.hubPulse * 60 + (1 - dayness) * 40;
    const today = w.agents.reduce((acc, a) => acc + a.tokens.today, 0);
    const cap = w.agents.reduce((acc, a) => acc + a.budget, 0);
    const fill = Math.max(0.02, Math.min(1, today / cap));
    this.hubMeter.scale.y = fill * 12;
    this.hubMeter.position.y = 1.2 + (fill * 12) / 2;

    for (const c of this.roofCoins) {
      const k = c.userData.kick ?? 0;
      c.rotation.z += dt * (1.2 + k * 10);
      c.userData.kick = k * Math.pow(0.05, dt);
      const ch = w.market.change(c.userData.sym);
      c.position.y = lerp(c.position.y, 9.4 + Math.max(-1.5, Math.min(3, ch * 30)), dt * 2);
    }
    this.craneArm.rotation.y += dt * 0.25;
    this.libraryGem.rotation.y += dt * 0.8;
    this.libraryGem.position.y = 7.6 + Math.sin(performance.now() / 600) * 0.25;
    for (const d of this.fountainDrops) {
      d.userData.t = (d.userData.t + dt * 0.8) % 1;
      const t = d.userData.t;
      const r = 0.3 + t * 1.7;
      d.position.set(Math.cos(d.userData.a) * r, 2.7 + t * 2.2 - t * t * 4, Math.sin(d.userData.a) * r);
    }

    // agents
    for (const v of this.agentViews.values()) {
      const a = v.a;
      v.phase += dt * (a.state.includes('walk') || a.state.includes('carry') || a.state.includes('fetch') || a.state.includes('head') ? 10 : 2);
      const moving = a.queue[0]?.k === 'walk' && !a.talking;
      v.g.position.set(a.pos.x, moving ? Math.abs(Math.sin(v.phase)) * 0.18 : 0, a.pos.z);
      let dh = a.heading - v.g.rotation.y;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      v.g.rotation.y += dh * Math.min(1, dt * 8);
      v.g.rotation.z = a.state === 'napping' ? lerp(v.g.rotation.z, 1.2, dt * 3) : lerp(v.g.rotation.z, a.state === 'building' ? Math.sin(v.phase * 3) * 0.08 : 0, dt * 6);
      if (v.spin) v.spin.rotation.y += dt * 2;
      v.carry.visible = a.carry > 0;
      if (v.carry.visible) v.carry.scale.y = 0.4 + (a.carry / w.config.carry) * 1.2;
      v.label.classList.toggle('napping', a.state === 'napping');
      v.label.classList.toggle('selected', this.selected === a);
      if (a.thought !== v.lastThought) {
        v.lastThought = a.thought;
        const notable = /^(Understand|Plan|Act|Verify|Bought|Sold|Filed|No open)/.test(a.thought);
        if (!a.talking && (notable || this.selected === a)) this.showBubble(a, a.thought, 'think');
      }
      if (a.state === 'napping' && now > v.bubbleUntil) this.showBubble(a, 'Zz… rate-limited', 'think');
      if (v.bubbleUntil && now > v.bubbleUntil) {
        v.bubble.className = 'bubble';
        v.bubbleUntil = 0;
      }
    }

    // follow the selected agent
    if (this.selected && this.follow) {
      const a = this.selected;
      const target = new THREE.Vector3(a.pos.x, 1, a.pos.z);
      const delta = target.sub(this.controls.target).multiplyScalar(Math.min(1, dt * 3));
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }

    // block pop-in
    const m = new THREE.Matrix4();
    for (const p of this.pops) {
      p.t += dt / 0.28;
      const k = Math.max(0.01, easeOutBack(Math.min(1, p.t)));
      m.makeScale(k, k, k).setPosition(p.x, p.y + (1 - Math.min(1, p.t)) * 1.5, p.z);
      p.mesh.setMatrixAt(p.index, m);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    this.pops = this.pops.filter((p) => p.t < 1);

    // flying coins
    for (const f of this.flyers) {
      f.t += dt;
      const k = Math.max(0, f.t / f.dur);
      const a = this.anchor(f.from);
      const b = this.anchor(f.to);
      f.mesh.visible = f.t > 0;
      f.mesh.position.lerpVectors(a, b, k);
      f.mesh.position.y += Math.sin(k * Math.PI) * (3 + a.distanceTo(b) * 0.25);
      f.mesh.rotation.x += dt * 12;
      if (k >= 1) this.scene.remove(f.mesh);
    }
    this.flyers = this.flyers.filter((f) => f.t < f.dur);

    for (const f of this.floaters) {
      f.t += dt;
      f.obj.position.y += dt * 0.9;
      f.el.style.opacity = f.t < f.delay ? 0 : String(Math.max(0, 1 - (f.t - f.delay) / 1.8));
      if (f.t > f.delay + 1.8) this.scene.remove(f.obj);
    }
    this.floaters = this.floaters.filter((f) => f.t <= f.delay + 1.8);

    // particles
    const P = this.particles;
    const pos = this.points.geometry.attributes.position;
    let alive = false;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      alive = true;
      P.life[i] -= dt;
      P.vel[i * 3 + 1] -= 14 * dt;
      pos.setXYZ(i, pos.getX(i) + P.vel[i * 3] * dt, Math.max(0.1, pos.getY(i) + P.vel[i * 3 + 1] * dt), pos.getZ(i) + P.vel[i * 3 + 2] * dt);
      if (P.life[i] <= 0) pos.setXYZ(i, 0, -999, 0);
    }
    if (alive) pos.needsUpdate = true;

    // plot labels
    for (const v of this.plotViews.values()) {
      const p = v.p;
      if (p.status === 'done') {
        v.el.className = 'plot-label done';
        v.el.textContent = p.name;
      } else {
        v.el.className = 'plot-label';
        v.el.innerHTML = `${p.name} <b>${Math.round((p.placed / p.voxels.length) * 100)}%</b>`;
      }
    }

    this.screenTimer -= dt;
    if (this.screenTimer <= 0) {
      this.screenTimer = 0.5;
      this.drawScreens();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
