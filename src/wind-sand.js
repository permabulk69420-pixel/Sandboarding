import * as THREE from 'three';
import { LOOK } from './world.js';

// Wind-blown sand (from Oasis): the desert's constant, quiet motion, and at riding speed a stream of grains whipping past.
//
// Four layers of camera-facing quads, all moved on the GPU from one time uniform (no per-particle JavaScript, no allocation):
//   near:    grains skimming past your feet in short hops, stretched along the wind,
//   streaks: the same further out,
//   veils:   long, soft, low sheets of sand hugging the ground and spilling over the crests,
//   wisps:   a few big, very soft clouds of dust rolling past.
// Each layer lives in a box that follows the rider and wraps around, so the density never changes however fast you go. The wind blows
// across the sand ripples (LOOK.wind), gusts sweep over the land as slow waves, and sand lifts off crests a little more. Heights come from
// the fine terrain grid, packed into a texture once at load; off the fine grid (far up the mountain's sides) the sand fades out.

export const WIND_SAND = Object.freeze({
  layers: Object.freeze({
    near: Object.freeze({
      radius: 8, count: 380, speed: [1.9, 4.6], length: [0.05, 0.20], width: [0.004, 0.010], height: 0.50, hop: 0.07, alpha: 0.32,
      near: [0.35, 1.1], round: 0.0, crest: 0.6, haze: 0.0, soft: 1.1, seed: 20261002,
    }),
    streaks: Object.freeze({
      radius: 26, count: 320, speed: [1.7, 4.8], length: [0.10, 0.40], width: [0.006, 0.015], height: 0.70, hop: 0.10, alpha: 0.30,
      near: [0.5, 1.6], round: 0.0, crest: 0.9, haze: 0.1, soft: 1.15, seed: 20261003,
    }),
    // Soft veils hugging the ground and spilling over the crests: thick and patchy, so they read as drifting plumes, not bright bars.
    veils: Object.freeze({
      radius: 24, count: 300, speed: [2.2, 4.4], length: [1.4, 3.6], width: [0.30, 0.80], height: 0.42, hop: 0.0, alpha: 0.30,
      near: [1.5, 4.0], round: 0.7, crest: 1.4, haze: 0.25, breakup: 0.7, soft: 1.4, seed: 20261005,
    }),
    wisps: Object.freeze({
      radius: 34, count: 30, speed: [0.9, 1.7], length: [3.0, 7.0], width: [1.2, 2.4], height: 1.2, hop: 0.0, alpha: 0.16,
      near: [2.5, 7.0], round: 0.9, crest: 1.6, haze: 0.55, breakup: 0.5, soft: 1.8, seed: 20261004,
    }),
  }),
  vrViewHeight: 2000, // pixels tall that one eye renders in VR, to keep thin grains from shimmering (desktop uses its canvas)
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The fine terrain grid as a texture: height packed in red and green (16 bits over the grid's own range), blue 255 where there is ground.
// Bilinear filtering of the two bytes separately is still exact (the unpacking is linear in both).
export function groundTexture(lattice) {
  const { cols, rows, heights, used } = lattice;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < heights.length; i += 1) if (used[i]) { lo = Math.min(lo, heights[i]); hi = Math.max(hi, heights[i]); }
  const range = Math.max(1, hi - lo + 2), min = lo - 1;
  const data = new Uint8Array(cols * rows * 4);
  for (let i = 0; i < heights.length; i += 1) {
    if (!used[i]) continue;
    const v = Math.round(Math.min(1, Math.max(0, (heights[i] - min) / range)) * 65535);
    data[i * 4] = v >> 8; data[i * 4 + 1] = v & 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, min, range };
}

const VERTEX = /* glsl */`
  attribute vec4 aSeedA; // x, z: place in the box, y: height, w: speed
  attribute vec4 aSeedB; // x: length, y: width, z: hop phase, w: brightness
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec2 uWind;
  uniform float uRadius;
  uniform float uGain;
  uniform sampler2D uGroundMap;
  uniform vec4 uGroundGrid; // x0, z0, step, unused
  uniform vec2 uGroundCells; // cols, rows
  uniform vec2 uGroundRange; // min, range
  uniform float uViewHeight;
  uniform vec2 uSpeed;
  uniform vec2 uLength;
  uniform vec2 uWidth;
  uniform vec2 uNear;
  uniform float uHeight;
  uniform float uHop;
  uniform float uAlpha;
  uniform float uRound;
  uniform float uCrest;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTone;
  varying float vSeed;
  varying vec3 vWorld;

  // A slow wave of stronger wind rolling across the dunes: 0 in a lull, 1 in a gust.
  float windGust(vec2 xz, vec2 wind, float t) {
    vec2 side = vec2(-wind.y, wind.x);
    float g = 0.5 + 0.5 * sin(dot(xz, wind) * 0.045 - t * 0.85 + 1.8 * sin(dot(xz, side) * 0.028 + t * 0.11));
    return g * g * (3.0 - 2.0 * g);
  }

  vec3 groundSample(vec2 p) { // height, and how sure we are of it (0 off the fine grid)
    vec4 t = texture2D(uGroundMap, ((p - uGroundGrid.xy) / uGroundGrid.z + 0.5) / uGroundCells);
    return vec3(dot(t.rg, vec2(256.0, 1.0)) * (255.0 / 65535.0) * uGroundRange.y + uGroundRange.x, t.b, 0.0);
  }

  void main() {
    float box = uRadius * 2.0;
    float speed = uSpeed.x + uSpeed.y * aSeedA.w;
    vec2 start = aSeedA.xy * box;
    vec2 rel = mod(start + uWind * speed * uTime - uCenter.xz + uRadius, box) - uRadius;
    vec2 xz = uCenter.xz + rel;

    float gust = windGust(xz, uWind, uTime);

    // Sand lifts off where the ground turns over: a crest.
    vec3 here = groundSample(xz);
    float ground = here.x;
    float turning = groundSample(xz + uWind * 5.0).x + groundSample(xz - uWind * 5.0).x - 2.0 * ground;
    float crest = smoothstep(0.08, 0.9, -turning) * uCrest;

    float hop = abs(sin(uTime * (1.8 + 3.2 * aSeedB.z) + aSeedB.z * 61.0));
    float rise = 0.03 + pow(aSeedA.z, 2.2) * uHeight * (0.45 + 0.55 * gust) * (1.0 + 1.3 * crest) + hop * hop * uHop;
    vec3 world = vec3(xz.x, ground + rise, xz.y);
    vWorld = world;

    // The streak is a line in the world along the wind: project both of its ends, so it points the way perspective says it should,
    // then draw a quad around that line.
    vec4 mv = viewMatrix * vec4(world, 1.0);
    float depth = max(-mv.z, 0.05);
    vec3 windView = mat3(viewMatrix) * vec3(uWind.x, 0.0, uWind.y);
    float len = (uLength.x + uLength.y * aSeedB.x) * (0.75 + 0.5 * gust);
    float wid = uWidth.x + uWidth.y * aSeedB.y;
    float reach = abs(windView.z) > 0.001 ? (depth - 0.08) / abs(windView.z) : 10000.0; // keep both ends in front of the camera
    float halfLen = min(len * 0.5, max(reach, 0.0));
    vec4 clipA = projectionMatrix * vec4(mv.xyz - windView * halfLen, 1.0);
    vec4 clipB = projectionMatrix * vec4(mv.xyz + windView * halfLen, 1.0);
    vec4 clipC = projectionMatrix * mv;
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    vec2 ndcA = clipA.xy / clipA.w;
    vec2 ndcB = clipB.xy / clipB.w;
    vec2 along = vec2((ndcB.x - ndcA.x) * aspect, ndcB.y - ndcA.y);
    float screenLen = length(along);
    vec2 dir = screenLen > 1e-6 ? along / screenLen : vec2(1.0, 0.0);
    float pixel = 2.0 / uViewHeight;
    float widthNdc = wid * projectionMatrix[1][1] / depth;
    float shownWid = max(widthNdc, pixel * 1.2);
    float shownLen = max(max(screenLen, pixel * 1.6), shownWid * uRound);
    vec2 offset = dir * (position.x * 0.5 * shownLen) + vec2(-dir.y, dir.x) * (position.y * 0.5 * shownWid);
    vec2 ndc = clipC.xy / clipC.w + vec2(offset.x / aspect, offset.y);
    gl_Position = vec4(ndc * clipC.w, clipC.z, clipC.w);
    vUv = position.xy;

    float edge = 1.0 - smoothstep(uRadius * 0.5, uRadius, length(rel));
    float nearFade = smoothstep(uNear.x, uNear.y, depth);
    float known = smoothstep(0.9, 1.0, here.y); // fades out at the edge of the fine grid
    float thin = clamp(widthNdc / shownWid, 0.0, 1.0) * clamp(screenLen / shownLen, 0.0, 1.0);
    vAlpha = uGain * uAlpha * (0.45 + 0.55 * aSeedB.w) * (0.3 + 0.7 * gust) * (1.0 + 0.8 * crest) * edge * nearFade * known * thin;
    vTone = aSeedB.w;
    vSeed = fract(aSeedB.z * 7.31 + aSeedA.x * 3.17);
  }
`;

const FRAGMENT = /* glsl */`
  uniform vec3 uSun;
  uniform float uSoft;
  uniform float uHaze;
  uniform float uBreakup;
  uniform float uTime;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTone;
  varying float vSeed;
  varying vec3 vWorld;

  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float valueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float shape = (1.0 - vUv.x * vUv.x) * (1.0 - vUv.y * vUv.y);
    shape = pow(max(shape, 0.0), uSoft);
    shape *= 0.55 + 0.45 * (0.5 + 0.5 * vUv.x); // a little brighter at the leading end
    float a = shape * vAlpha;
    if (uBreakup > 0.0) {
      // Patches of denser and thinner sand, stretched along the wind and sliding down it: ragged wisps, not smooth bars.
      vec2 q = vec2(vUv.x * 1.3 - uTime * 0.25, vUv.y * 0.8) + vSeed * 41.0;
      float n = 0.65 * valueNoise(q * vec2(2.2, 1.4)) + 0.35 * valueNoise(q * vec2(5.5, 3.2) + 7.1);
      a *= mix(1.0, mix(0.30, 1.0, smoothstep(0.15, 0.90, n)), uBreakup);
    }
    if (a < 0.004) discard;
    vec3 ray = normalize(vWorld - cameraPosition);
    float backlit = pow(max(dot(ray, uSun), 0.0), 4.0); // dust glows when the sun is behind it
    vec3 sand = mix(vec3(0.80, 0.58, 0.35), vec3(0.96, 0.82, 0.60), vTone); // a little paler than the ground
    sand = mix(sand, vec3(0.88, 0.72, 0.52), uHaze); // big soft clouds are paler and greyer: dust haze
    vec3 ambient = vec3(0.34, 0.33, 0.36);
    vec3 sun = vec3(1.30, 1.00, 0.74) * (0.55 + 0.9 * backlit);
    float glint = smoothstep(0.86, 1.0, vTone) * (0.5 + 0.5 * sin(uTime * 13.0 + vWorld.x * 7.0 + vWorld.z * 3.0)); // grains flashing
    float lift = mix(1.15, 0.92, smoothstep(0.0, 0.4, uHaze));
    gl_FragColor = vec4(sand * (ambient + sun) * (lift + 1.3 * glint * (1.0 - uHaze)), min(1.0, a * (1.0 + 0.8 * glint)));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildLayer(name, layer, shared, center) {
  const random = mulberry32(layer.seed);
  const a = new Float32Array(layer.count * 4), b = new Float32Array(layer.count * 4);
  for (let i = 0; i < layer.count * 4; i += 1) { a[i] = random(); b[i] = random(); }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aSeedA', new THREE.InstancedBufferAttribute(a, 4));
  geometry.setAttribute('aSeedB', new THREE.InstancedBufferAttribute(b, 4));
  geometry.instanceCount = layer.count;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uCenter: { value: center },
      uRadius: { value: layer.radius },
      uSpeed: { value: new THREE.Vector2(layer.speed[0], layer.speed[1] - layer.speed[0]) },
      uLength: { value: new THREE.Vector2(layer.length[0], layer.length[1] - layer.length[0]) },
      uWidth: { value: new THREE.Vector2(layer.width[0], layer.width[1] - layer.width[0]) },
      uNear: { value: new THREE.Vector2(...layer.near) },
      uHeight: { value: layer.height },
      uHop: { value: layer.hop },
      uAlpha: { value: layer.alpha },
      uRound: { value: layer.round },
      uCrest: { value: layer.crest },
      uSoft: { value: layer.soft },
      uHaze: { value: layer.haze },
      uBreakup: { value: layer.breakup ?? 0 },
    },
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Wind sand ${name}`;
  mesh.frustumCulled = false; // positions are worked out in the vertex shader
  mesh.renderOrder = name === 'wisps' ? 3 : name === 'veils' ? 4 : 5; // fine grains on top of the soft clouds
  return mesh;
}

// lattice: the fine terrain grid (terrain.userData.ground). sun: the shared { value: Vector3 } sun uniform.
export function createWindSand({ scene, lattice, sun, layers = WIND_SAND.layers }) {
  const ground = groundTexture(lattice);
  const center = new THREE.Vector3();
  const shared = {
    uSun: sun,
    uTime: { value: 0 },
    uWind: { value: LOOK.wind.clone().normalize() },
    uGain: { value: 1 },
    uViewHeight: { value: 720 },
    uGroundMap: { value: ground.texture },
    uGroundGrid: { value: new THREE.Vector4(lattice.x0, lattice.z0, lattice.step, 0) },
    uGroundCells: { value: new THREE.Vector2(lattice.cols, lattice.rows) },
    uGroundRange: { value: new THREE.Vector2(ground.min, ground.range) },
  };
  const group = new THREE.Group();
  group.name = 'Wind sand';
  for (const [name, layer] of Object.entries(layers)) group.add(buildLayer(name, layer, shared, center));
  scene.add(group);
  return {
    group, uniforms: shared,
    // seconds: any steady clock. position: where the rider is. viewHeight: pixels tall of one eye's view.
    update(seconds, position, viewHeight = 720) {
      shared.uTime.value = Number.isFinite(seconds) ? seconds % 3600 : 0;
      center.set(position.x, position.y, position.z);
      shared.uViewHeight.value = Math.max(1, viewHeight);
    },
  };
}
