// The sky: one dome shader draws gradient, sunrise glow, a sun with corona and rays, a
// textured moon with phases, three layers of twinkling stars, a Milky Way band, a rare
// shooting star and fbm clouds that are lit from the sun (or the moon). A second shader
// draws a sea of cloud far under the island. The same sky is baked into an
// image-based light (PMREM) every few seconds, so every material is lit by the sky above it.

import * as THREE from 'three';

const GLSL_COMMON = /* glsl */ `
  // GLSL leaves smoothstep undefined when the first edge is above the second; this is defined both ways
  float sstep(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*f*(f*(f*6.-15.)+10.);
    return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float s = 0.0, a = 0.5;
    for (int i = 0; i < OCT; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
`;

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main(){
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;

const DOME_FRAG = /* glsl */ `
  uniform vec3 uGround, uTop, uBottom, uSunDir, uMoonDir, uSunColor, uCloudLit, uCloudShade, uCloudDir;
  uniform float uNight, uTime, uCover, uTwilight, uPhase, uSunR, uMoonR, uShoot;
  varying vec3 vDir;
  ${GLSL_COMMON}

  vec3 starLayer(vec3 dir, float scale, float density, float seed, float px, float gain){
    vec3 p = dir * scale;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(id + seed);
    if (h > density) return vec3(0.0);
    vec3 off = (vec3(hash13(id + 1.7 + seed), hash13(id + 3.1 + seed), hash13(id + 5.3 + seed)) - 0.5) * 0.5;
    float d = length(f - off) / scale;
    float mag = pow(hash13(id + 9.1 + seed), 5.0);
    float rad = max(0.0011, px * 1.25) * (0.65 + 1.5 * mag);
    float core = sstep(rad, 0.0, d);
    float glow = exp(-d / (rad * 3.2)) * 0.12 * (0.3 + mag) * sstep(0.2 / scale, 0.08 / scale, d);
    vec3 tint = mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.8, 0.58), hash13(id + 13.7 + seed));
    float tw = 0.7 + 0.3 * sin(uTime * (1.5 + hash13(id) * 4.5) + h * 100.0);
    return tint * (core + glow) * tw * gain * (0.35 + 1.9 * mag);
  }

  vec3 milkyWay(vec3 dir){
    vec3 n = normalize(vec3(0.32, 0.78, 0.53));
    float lat = dot(dir, n);
    float band = exp(-pow(lat / 0.16, 2.0));
    vec2 q = vec2(atan(dir.x, dir.z) * 2.2, lat * 9.0);
    float cloud = fbm(q * 1.6 + 4.0);
    float lanes = smoothstep(0.42, 0.62, fbm(q * 3.4 + 11.0));
    float core = pow(max(dot(dir, normalize(vec3(-0.5, 0.35, -0.8))), 0.0), 5.0);
    vec3 c = vec3(0.30, 0.36, 0.62) * (0.35 + 0.9 * cloud) + vec3(0.7, 0.5, 0.36) * core * 0.55;
    return c * band * (1.0 - 0.55 * lanes) * 0.55;
  }

  void main(){
    vec3 dir = normalize(vDir);
    float y = dir.y;
    float px = length(fwidth(dir));

    // gradient, haze at the horizon, sinking to the haze colour below it
    vec3 col = mix(uBottom, uTop, 1.0 - exp(-clamp(y, 0.0, 1.0) * 5.5));
    col = mix(col, uBottom * 0.9, sstep(0.0, -0.4, y));
    col = mix(col, uBottom, exp(-abs(y) * 9.0) * 0.4);

    // in the baked environment the ground below is olive earth, not haze: green bounce light
    #ifdef ENV
    col = mix(col, uGround, sstep(0.02, -0.16, y));
    #endif

    // sunrise / sunset band around the sun's side of the horizon
    float sd = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * exp(-abs(y) * 5.5) * pow(sd, 2.5) * uTwilight * 0.7;
    col += uSunColor * pow(sd, 6.0) * uTwilight * 0.25 * smoothstep(-0.1, 0.3, y);

    // stars and the Milky Way, only in a dark sky and above the horizon
    float dark = uNight * uNight * smoothstep(-0.02, 0.1, y);
    #ifndef ENV
    if (dark > 0.001) {
      vec3 st = milkyWay(dir);
      st += starLayer(dir, 46.0, 0.34, 0.0, px, 1.6);
      st += starLayer(dir, 96.0, 0.24, 7.0, px, 1.0);
      #if STAR_LAYERS > 2
      st += starLayer(dir, 200.0, 0.14, 19.0, px, 0.7);
      #endif
      col += st * dark;
      // a rare shooting star: one streak every ~19 s, lasting under a second
      float k = floor(uTime / 19.0);
      float f = (uTime - k * 19.0) / 0.9;
      if (f < 1.0 && uShoot > 0.5) {
        vec2 sp = vec2(atan(dir.x, dir.z), asin(clamp(y, -1.0, 1.0)));
        vec2 s0 = vec2(hash12(vec2(k, 1.0)) * 6.28 - 3.14, 0.35 + hash12(vec2(k, 2.0)) * 0.7);
        vec2 sv = normalize(vec2(hash12(vec2(k, 3.0)) - 0.5, -0.35 - hash12(vec2(k, 4.0)) * 0.3));
        vec2 head = s0 + sv * f * 0.45;
        vec2 rel = sp - head;
        float along = clamp(dot(rel, -sv), 0.0, 0.22);
        float d = length(rel + sv * along);
        float trail = sstep(0.0035, 0.0, d) * (1.0 - along / 0.22) * (1.0 - f * f);
        col += vec3(0.85, 0.92, 1.0) * trail * 2.2 * dark;
      }
    }
    #endif

    // clouds on a plane above: warped fbm, lit from the sun side, darker underneath
    float cl = 0.0;
    vec3 cloudCol = uCloudLit;
    float fadeH = smoothstep(0.0, 0.2, y);
    if (fadeH > 0.0) {
      vec2 cp = dir.xz / (y + 0.14) * 0.85 + vec2(uTime * 0.010, uTime * 0.004);
      cp += (vec2(vnoise(cp * 1.9 + 3.0), vnoise(cp * 1.9 + 9.0)) - 0.5) * 0.7;
      float d = fbm(cp);
      cl = smoothstep(1.0 - uCover, 1.0 - uCover + 0.3, d);
      float dl = fbm(cp + uCloudDir.xz * 0.09);
      float lit = clamp(0.5 + (d - dl) * 5.5, 0.0, 1.0);
      cloudCol = mix(uCloudShade, uCloudLit, lit);
      cloudCol *= 0.78 + 0.22 * smoothstep(0.3, 0.9, 1.0 - cl);
      // silver lining toward the sun
      cloudCol += uSunColor * pow(sd, 10.0) * (1.0 - cl) * 0.45 * (1.0 - uNight);
      cl *= fadeH;
    }

    // the sun: hot core, corona, soft rays (in front of the stars, behind the clouds)
    float ang = acos(clamp(sd, 0.0, 1.0));
    float day = 1.0 - uNight;
    vec3 sun = vec3(0.0);
    sun += uSunColor * sstep(uSunR * 1.12, uSunR * 0.92, ang) * 7.0;
    sun += uSunColor * (pow(sd, 700.0) * 2.4 + pow(sd, 80.0) * 0.5 + pow(sd, 14.0) * 0.20 + pow(sd, 3.0) * 0.05);
    vec3 sx = normalize(cross(vec3(0.0, 1.0, 0.0), uSunDir));
    vec3 sy = cross(uSunDir, sx);
    float a2 = atan(dot(dir, sy), dot(dir, sx));
    float rays = 0.5 + 0.5 * sin(a2 * 11.0 + vnoise(vec2(a2 * 3.0, uTime * 0.05)) * 6.0);
    sun += uSunColor * pow(rays, 3.0) * pow(sd, 22.0) * 0.28;
    // the baked environment keeps the sky's colour but not the sun or moon: the real lights are those
    #ifdef ENV
    sun = vec3(0.0);
    #endif
    col += sun * day * smoothstep(-0.12, 0.05, uSunDir.y) * (1.0 - cl * 0.92);

    // the moon: a lit sphere with maria and craters, phase from uPhase, and a halo
    float mAng = acos(clamp(dot(dir, uMoonDir), 0.0, 1.0));
    vec3 halo = vec3(0.55, 0.68, 1.0) * (pow(max(dot(dir, uMoonDir), 0.0), 140.0) * 0.55 + pow(max(dot(dir, uMoonDir), 0.0), 16.0) * 0.07);
    vec3 moon = vec3(0.0);
    vec3 mz = uMoonDir;
    vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), mz));
    vec3 my = cross(mz, mx);
    vec2 mp = vec2(dot(dir, mx), dot(dir, my)) / uMoonR;
    float mr = length(mp);
    if (mr < 1.05 && dot(dir, mz) > 0.0) {
      vec3 n = vec3(mp, sqrt(max(1.0 - mr * mr, 0.0)));
      float maria = smoothstep(0.46, 0.62, fbm(mp * 1.9 + 5.0));
      vec2 cq = mp * 6.0;
      vec2 ci = floor(cq);
      vec2 cf = fract(cq) - 0.5 - (vec2(hash12(ci), hash12(ci + 7.0)) - 0.5) * 0.4;
      float crad = 0.12 + hash12(ci + 3.0) * 0.18;
      float crater = hash12(ci + 11.0) > 0.45 ? sstep(crad, crad * 0.7, length(cf)) - 0.6 * sstep(crad * 0.7, crad * 0.3, length(cf)) : 0.0;
      vec3 alb = mix(vec3(0.90, 0.88, 0.82), vec3(0.46, 0.48, 0.54), maria * 0.85) * (1.0 + crater * 0.22);
      float a = uPhase * 6.2831853;
      vec3 L = normalize(vec3(sin(a), 0.0, -cos(a)));
      float lit = smoothstep(-0.04, 0.16, dot(n, L));
      vec3 mc = alb * (lit * 1.25 + 0.04) * (0.72 + 0.28 * n.z);
      moon = mc * sstep(1.03, 0.975, mr);
    }
    float moonUp = smoothstep(-0.15, 0.08, uMoonDir.y);
    #ifdef ENV
    moon = vec3(0.0);
    halo = vec3(0.0);
    #endif
    col += (moon + halo * (0.35 + 0.65 * uNight)) * moonUp * (1.0 - cl * 0.9) * (0.25 + 0.75 * uNight);

    col = mix(col, cloudCol, cl * 0.96);
    col += (hash12(gl_FragCoord.xy + fract(uTime)) - 0.5) / 200.0; // dither against banding
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SEA_VERT = /* glsl */ `
  varying vec3 vW;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const SEA_FRAG = /* glsl */ `
  uniform vec3 uCloudLit, uCloudShade, uBottom, uCloudDir;
  uniform float uTime;
  varying vec3 vW;
  ${GLSL_COMMON}
  void main(){
    vec2 q = vW.xz * 0.011 + vec2(uTime * 0.006, uTime * 0.002);
    q += (vec2(vnoise(q * 2.1), vnoise(q * 2.1 + 5.0)) - 0.5) * 0.8;
    float d = fbm(q);
    float dl = fbm(q + uCloudDir.xz * 0.07);
    float lit = clamp(0.5 + (d - dl) * 5.0, 0.0, 1.0);
    float cover = smoothstep(0.38, 0.72, d);
    float r = length(vW.xz);
    float edge = 1.0 - smoothstep(160.0, 420.0, r);
    vec3 c = mix(uCloudShade, uCloudLit, lit * (0.55 + 0.45 * cover));
    c = mix(c, uBottom, smoothstep(120.0, 380.0, r) * 0.7); // melts into the horizon haze
    gl_FragColor = vec4(c, cover * edge * 0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const V3 = () => new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Sky {
  constructor({ scene, renderer, settings }) {
    this.scene = scene;
    this.renderer = renderer;
    this.settings = settings;
    this.sunDir = V3();
    this.moonDir = V3();
    this.sunElev = 0.5;
    this.envAt = -1e9;
    this.envRT = null;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const defines = { OCT: settings.skyOctaves, STAR_LAYERS: settings.stars > 2000 ? 3 : 2 };
    this.u = {
      uGround: { value: new THREE.Color(0.1, 0.13, 0.06) },
      uTop: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunColor: { value: new THREE.Color('#fff2d8') },
      uCloudLit: { value: new THREE.Color('#ffffff') },
      uCloudShade: { value: new THREE.Color('#9aa6b8') },
      uCloudDir: { value: V3() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCover: { value: 0.46 },
      uTwilight: { value: 0 },
      uPhase: { value: 0.45 },
      uSunR: { value: 0.042 },
      uMoonR: { value: 0.05 },
      uShoot: { value: 1 },
    };
    const domeMat = (extra = {}) => new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, defines: { ...defines, ...extra },
    });
    const geo = new THREE.SphereGeometry(500, 48, 32);
    this.dome = new THREE.Mesh(geo, domeMat());
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.seaU = { uCloudLit: this.u.uCloudLit, uCloudShade: this.u.uCloudShade, uBottom: this.u.uBottom, uCloudDir: this.u.uCloudDir, uTime: this.u.uTime };
    const seaMat = new THREE.ShaderMaterial({ uniforms: this.seaU, vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, transparent: true, depthWrite: false, fog: false, defines: { OCT: Math.max(3, settings.skyOctaves - 1) } });
    this.sea = new THREE.Mesh(new THREE.CircleGeometry(520, 64), seaMat);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -19;
    this.sea.renderOrder = -9;
    this.sea.frustumCulled = false;
    scene.add(this.sea);

    // the copy of the sky that gets baked into the environment light: no stars needed
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(geo, domeMat({ ENV: 1, STAR_LAYERS: 1 }));
    envDome.frustumCulled = false;
    this.envScene.add(envDome);
  }

  // palette: skyAt(frac). Returns the numbers the scene needs to light itself.
  update({ frac, day, time, palette, quality }) {
    const a = (frac - 0.25) * Math.PI * 2;
    // The sun climbs in the north (this is Australia) and peaks around 20 degrees, so it and
    // the moon are in frame from the default camera, and shadows stay long and readable.
    // rotated a little so the sun's noon position sits ahead of the default camera
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.34, -Math.sin(a) * 0.9);
    this.sunDir.applyAxisAngle(AXIS_Y, 0.3).normalize();
    this.moonDir.copy(this.sunDir).negate();
    const elev = this.sunDir.y;
    this.sunElev = elev;
    const warm = 1 - smooth(0.0, 0.22, elev);
    const twilight = smooth(-0.14, 0.02, elev) * (1 - smooth(0.02, 0.2, elev));
    const sunColor = new THREE.Color().setRGB(1, lerp(0.96, 0.52, warm), lerp(0.86, 0.26, warm));
    const night = palette.night;
    const u = this.u;
    u.uTop.value.setRGB(...palette.top, THREE.SRGBColorSpace);
    u.uBottom.value.setRGB(...palette.bottom, THREE.SRGBColorSpace);
    u.uSunColor.value.copy(sunColor);
    u.uNight.value = night;
    u.uGround.value.setRGB(0.1, 0.13, 0.06).multiplyScalar(0.12 + 0.88 * (1 - night));
    u.uTime.value = time;
    u.uTwilight.value = twilight;
    u.uPhase.value = (0.42 + 0.115 * (day - 1)) % 1;
    // clouds catch the sun's colour at dusk, and the cold moonlight at night
    const dayLit = new THREE.Color(1, 1, 1).lerp(sunColor, warm * 0.75);
    u.uCloudLit.value.copy(dayLit).lerp(new THREE.Color(0.55, 0.62, 0.85), night * 0.85).multiplyScalar(lerp(0.35, 1, 1 - night * 0.8));
    u.uCloudShade.value.setRGB(...palette.top, THREE.SRGBColorSpace).multiplyScalar(0.55).lerp(new THREE.Color(0.06, 0.07, 0.14), night * 0.7);
    u.uCloudDir.value.copy(night > 0.5 ? this.moonDir : this.sunDir);
    u.uCover.value = 0.44 + 0.06 * Math.sin(time * 0.01);
    u.uShoot.value = quality === 'low' ? 0 : 1;
  }

  // Bake the sky into the scene's environment light. Cheap enough to do every few seconds.
  updateEnv(now, everyMs) {
    if (now - this.envAt < everyMs) return false;
    this.envAt = now;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    return true;
  }
}
