import { createWorld } from './sim/world.js';
import { TownScene } from './render/scene.js';
import { createUI } from './ui.js';
import { connectHQ } from './hq-bridge.js';

const params = new URLSearchParams(location.search);
const world = createWorld({ seed: Number(params.get('seed')) || Math.floor(Math.random() * 1e6) });
world.speed = Number(params.get('speed') ?? 1);

const scene = new TownScene(document.getElementById('stage'), world);
const hq = connectHQ(world, scene);
const ui = createUI(world, scene, hq);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  world.advance(dt);
  hq.update(dt);
  scene.update(dt);
  ui.tick(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.district = { world, scene, ui, hq };
