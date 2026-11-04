// Post-processing: the scene renders into a half-float (HDR) target with MSAA, then bloom,
// a grade pass (sharpen, contrast, saturation, vignette, time-of-day tint) and the final
// tone-mapping / colour-space pass. Low tier skips all of it and renders straight to the
// screen. Resolution scale and every pass are switchable at run time.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// GTAO from the solid things only: grass, leaf cards, water, sky, particles and anything
// see-through would make it crawl with the wind, so they are left out of its depth/normal pass.
class GroundingAO extends GTAOPass {
  overrideVisibility() {
    super.overrideVisibility();
    this.scene.traverse((o) => {
      const m = o.material;
      if (o.userData.noAO || o.isSprite || (m && (m.transparent || m.alphaTest > 0 || m.depthWrite === false))) o.visible = false;
    });
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uSharpen: { value: 0.3 },
    uVignette: { value: 0.28 },
    uSaturation: { value: 1.03 },
    uContrast: { value: 1.07 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uShadow: { value: new THREE.Color(1, 1, 1) },
    uHighlight: { value: new THREE.Color(1, 1, 1) },
    uExposure: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSharpen, uVignette, uSaturation, uContrast, uExposure; uniform vec3 uTint, uShadow, uHighlight;
    varying vec2 vUv;
    float sstep(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 n = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
             + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 sharp = c + (c - n * 0.25) * uSharpen;
      c = clamp(sharp, c * 0.72, c * 1.4 + 0.015); // no halos around the HDR sun
      c *= uExposure;
      c = max((c - 0.16) * uContrast + 0.16, 0.0);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // split-toning: one tint for the shade, one for the light (golden hour, twilight)
      c *= mix(uShadow, uHighlight, sstep(0.04, 0.85, l));
      l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation) * uTint;
      float v = sstep(1.25, 0.25, length((vUv - 0.5) * vec2(1.0, 0.9) * 1.6));
      c *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class Post {
  constructor({ renderer, scene, camera }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.size = new THREE.Vector2(1280, 720);
    this.dpr = 1;
    this.mode = 'direct';
    this.composer = null;
    this.settings = null;
  }

  #build(settings) {
    const { renderer } = this;
    const rt = new THREE.WebGLRenderTarget(this.size.x * this.dpr, this.size.y * this.dpr, { type: THREE.HalfFloatType, samples: settings.msaa });
    this.composer?.dispose?.();
    const c = new EffectComposer(renderer, rt);
    c.setPixelRatio(this.dpr);
    c.setSize(this.size.x, this.size.y);
    c.addPass(new RenderPass(this.scene, this.camera));
    // soft contact shading where things meet the ground: feet, trunks, rocks, builds
    this.ao = new GroundingAO(this.scene, this.camera, this.size.x * this.dpr, this.size.y * this.dpr);
    this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 0.85;
    c.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.size.x, this.size.y), 0.34, 0.55, 1.05);
    c.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  // settings: one tier's entry from SETTINGS. Cheap to call again when the tier changes.
  configure(settings) {
    const direct = !settings.bloom && !settings.grade;
    this.mode = direct ? 'direct' : 'composer';
    if (!direct && (!this.composer || this.settings?.msaa !== settings.msaa)) this.#build(settings);
    this.settings = settings;
    if (this.composer) {
      this.bloom.enabled = settings.bloom;
      this.ao.enabled = !!settings.ao;
      this.grade.enabled = settings.grade;
      this.grade.uniforms.uSharpen.value = settings.sharpen;
    }
  }

  setSize(w, h, dpr) {
    this.size.set(w, h);
    this.dpr = dpr;
    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
      this.grade.uniforms.uTexel.value.set(1 / (w * dpr), 1 / (h * dpr));
    }
  }

  // tint and exposure follow the time of day; bloom a little stronger in the dark
  // grade: gradeAt(frac) from grade.js — the cinematic palette for this time of day
  look({ tint, night, vignette = 0.28, grade = null }) {
    if (!this.composer) return;
    const u = this.grade.uniforms;
    u.uTint.value.copy(tint);
    u.uVignette.value = vignette + night * 0.1;
    if (grade) {
      u.uShadow.value.setRGB(...grade.shadow);
      u.uHighlight.value.setRGB(...grade.highlight);
      u.uSaturation.value = grade.saturation;
      u.uContrast.value = grade.contrast;
      u.uExposure.value = grade.exposure;
      this.bloom.strength = grade.bloom;
    } else {
      this.bloom.strength = 0.3 + night * 0.28;
    }
  }

  render(dt) {
    if (this.mode === 'composer') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
