// Shader work on top of MeshStandardMaterial, so everything keeps the scene's lights,
// shadows, fog and environment: wind that bends grass, flowers and leaves (and parts
// them around the koalas and the visitor), the island's ground blend, the pond water,
// and shell fur. Each patch is injected with onBeforeCompile and given a distinct
// program cache key.

import * as THREE from 'three';

// Uniforms shared by every patched material; the scene updates them once per frame.
export const shared = {
  uTime: { value: 0 },
  uWindAmp: { value: 1 },
  // xyz = position, w = radius of the bend (0 disables a slot): 2 koalas, the visitor, a spare
  uPush: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
};

const WIND_DECL = /* glsl */ `
  uniform float uTime;
  uniform float uWindAmp;
  uniform vec4 uPush[4];
  vec2 windOffset(vec3 wp, float h){
    float t = uTime;
    float g = sin(wp.x * 0.33 + t * 1.25) + 0.7 * sin(wp.z * 0.27 + t * 1.65 + 1.3) + 0.25 * sin((wp.x + wp.z) * 0.9 + t * 3.1);
    vec2 o = vec2(g * 0.55, g * 0.3 + 0.15 * sin(t * 0.9 + wp.x * 0.5)) * h * uWindAmp;
    for (int i = 0; i < 4; i++) {
      vec2 d = wp.xz - uPush[i].xz;
      float r = length(d);
      float k = clamp(1.0 - r / max(uPush[i].w, 0.001), 0.0, 1.0);
      float f = k * k * (3.0 - 2.0 * k) * min(h * 4.0, 1.0);
      o += d / (r + 0.001) * f * 0.55;
    }
    return o;
  }
`;

// Wind for an instanced or plain mesh whose model matrix is the identity. `hExpr` is GLSL
// for how far the vertex is from its root, 0..1+ (quadratic falloff applied here).
export function applyWind(material, hExpr, { key = hExpr } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWindAmp = shared.uWindAmp;
    shader.uniforms.uPush = shared.uPush;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_DECL}`).replace(
      '#include <project_vertex>',
      THREE.ShaderChunk.project_vertex.replace(
        'mvPosition = modelViewMatrix * mvPosition;',
        `{
          float wh = ${hExpr};
          mvPosition.xz += windOffset(mvPosition.xyz, wh * wh);
        }
        mvPosition = modelViewMatrix * mvPosition;`,
      ),
    );
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|wind:${key}`;
  return material;
}

// --- the island's ground ----------------------------------------------------------------
// uv = world xz / TILE. The splat map (island-sized): R = worn path, B = baked occlusion,
// A = water depth, used for caustics. Dirt, macro variation and caustics blend in the shader.
export const TILE = 3.2;
export function groundMaterial({ tex, splat, island }) {
  const m = new THREE.MeshStandardMaterial({
    map: tex.grass.map, normalMap: tex.grass.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.94, metalness: 0,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSplat = { value: splat };
    shader.uniforms.uDirt = { value: tex.dirt.map };
    shader.uniforms.uMacro = { value: tex.macro };
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uIsland = { value: island };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform sampler2D uSplat; uniform sampler2D uDirt; uniform sampler2D uMacro;
        uniform float uTime; uniform float uIsland;
        float caustic(vec2 p){
          float t = uTime * 0.35;
          vec2 a = p + vec2(sin(p.y * 1.7 + t), cos(p.x * 1.9 - t)) * 0.45;
          float c = sin(a.x * 3.1 + t) * sin(a.y * 3.3 - t * 1.1) + sin((a.x + a.y) * 2.3 + t * 0.7) * 0.5;
          return pow(clamp(0.5 + 0.5 * c, 0.0, 1.0), 4.0);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 gw = vWPos.xz;
          vec4 sp = texture2D(uSplat, gw / (2.0 * uIsland) + 0.5);
          vec3 dirtC = texture2D(uDirt, gw / ${(TILE * 1.1).toFixed(2)}).rgb;
          float macro = texture2D(uMacro, gw * 0.021).r;
          float macro2 = texture2D(uMacro, gw * 0.083 + 0.37).r;
          diffuseColor.rgb = mix(diffuseColor.rgb, dirtC, sp.r);
          // the beach of the Sandy Cove: pale sand, a little grain from the dirt texture
          vec3 sandC = vec3(0.74, 0.6, 0.33) * mix(0.9, 1.08, dot(dirtC, vec3(0.333)) * 1.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, sandC, smoothstep(0.05, 0.6, sp.g));
          diffuseColor.rgb *= mix(0.88, 1.12, macro) * mix(0.95, 1.05, macro2);
          // dry patches and lush patches, so the lawn is never one green
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.05, 0.72), smoothstep(0.62, 0.9, macro2) * (1.0 - sp.r) * 0.6);
          diffuseColor.rgb *= 1.0 - sp.b * 0.6;
          float depth = sp.a;
          float under = smoothstep(0.0, 0.08, depth);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.62, 0.6), under);
          diffuseColor.rgb *= 1.0 + under * caustic(gw * 0.8) * 1.5;
        }`);
  };
  m.customProgramCacheKey = () => 'ground';
  return m;
}

// --- the pond ------------------------------------------------------------------------------
// Transparent, with a baked-depth tint and shoreline foam (splat alpha), two flowing normal
// layers, ripple rings from play, and fresnel reflection of the baked sky via the scene's
// environment. Lit by the sun like everything else, so it glitters.
export const RIPPLES = 6;
export function waterMaterial({ tex, splat, island }) {
  const m = new THREE.MeshStandardMaterial({ color: '#2f6a78', roughness: 0.04, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 1.4 });
  const ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 1, 0));
  m.userData.ripples = ripples;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWaterN = { value: tex.water };
    shader.uniforms.uSplat = { value: splat };
    shader.uniforms.uIsland = { value: island };
    shader.uniforms.uRip = { value: ripples };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform float uTime; uniform float uIsland;
        uniform sampler2D uWaterN; uniform sampler2D uSplat; uniform vec4 uRip[${RIPPLES}];
        float shoreDepth;
        float foamV;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec4 sp = texture2D(uSplat, vWPos.xz / (2.0 * uIsland) + 0.5);
          float wob = texture2D(uWaterN, vWPos.xz * 0.35 + uTime * 0.02).r;
          shoreDepth = sp.a;
          float d = shoreDepth + (wob - 0.5) * 0.05;
          vec3 shallow = vec3(0.12, 0.3, 0.26);
          vec3 deep = vec3(0.004, 0.045, 0.07);
          float k = smoothstep(0.0, 0.85, shoreDepth);
          diffuseColor.rgb = mix(shallow, deep, pow(k, 0.7));
          diffuseColor.a = mix(0.18, 0.94, smoothstep(0.0, 0.45, shoreDepth));
          foamV = smoothstep(0.0, 0.02, d) * (1.0 - smoothstep(0.03, 0.12, d));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.96, 0.95), foamV * 0.55);
          diffuseColor.a = max(diffuseColor.a, foamV * 0.7);
        }`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec2 w1 = vWPos.xz * 0.21 + vec2(uTime * 0.030, uTime * 0.021);
          vec2 w2 = vWPos.xz * 0.53 + vec2(-uTime * 0.026, uTime * 0.041);
          vec3 n1 = texture2D(uWaterN, w1).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uWaterN, w2).xyz * 2.0 - 1.0;
          vec2 nx = (n1.xy + n2.xy) * 0.5;
          for (int i = 0; i < ${RIPPLES}; i++) {
            float age = uRip[i].z;
            if (age < 1.0) {
              vec2 dd = vWPos.xz - uRip[i].xy;
              float r = length(dd);
              float front = age * 2.4;
              float ring = exp(-pow((r - front) / 0.22, 2.0)) * (1.0 - age);
              nx += normalize(dd + 0.0001) * ring * sin((r - front) * 20.0) * 0.55;
            }
          }
          vec3 wn = normalize(vec3(nx.x * 0.8, 1.0, nx.y * 0.8));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'water';
  return m;
}

// --- shell fur ---------------------------------------------------------------------------------
// One InstancedMesh per body part: instance i is shell i, pushed out along the normal and
// cut by the strand texture, with the colour darkening toward the root. gl_InstanceID picks the
// shell, so a whole furry part is one draw call. The solid body below it casts the shadow.
export function furMaterial({ color, tip = null, tex, shells, length = 0.05, density = 7, gravity = 0.012 }) {
  const base = new THREE.Color(color);
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.96, metalness: 0, side: THREE.FrontSide });
  // uniforms are created up front so the shell count can change with the quality tier
  const U = {
    uFurTex: { value: tex },
    uShells: { value: shells },
    uFurLen: { value: length },
    uDensity: { value: density },
    uGravity: { value: gravity },
    uTip: { value: new THREE.Color(tip ?? color).multiplyScalar(1.12) },
  };
  m.userData.fur = U;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uShells; uniform float uFurLen; uniform float uGravity; varying float vShell; varying vec2 vFurUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vShell = (float(gl_InstanceID) + 1.0) / uShells;
        vFurUv = uv;
        transformed += normalize(objectNormal) * uFurLen * vShell;
        transformed.y -= uGravity * vShell * vShell;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFurTex; uniform float uDensity; uniform vec3 uTip; varying float vShell; varying vec2 vFurUv;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec4 f = texture2D(uFurTex, vFurUv * uDensity);
          if (f.r < vShell * 0.92 + 0.04) discard;
          // darker toward the root (cheap occlusion), lighter and warmer at the tips
          diffuseColor.rgb = mix(diffuseColor.rgb * 0.68, mix(diffuseColor.rgb, uTip, 0.5), vShell);
          diffuseColor.rgb *= 0.9 + 0.2 * f.g;
        }`);
  };
  m.customProgramCacheKey = () => 'fur';
  return m;
}
