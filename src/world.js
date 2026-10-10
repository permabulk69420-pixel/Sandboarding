import * as THREE from 'three';
import { buildTerrainGrids } from './terrain-grid.js';

// The look: a low twilight sun over a desert mountain, a ringed planet in a teal-to-rose sky (the Oasis family look), and sand drawn
// with a cheap custom shader (no textures to download): wind ripples up close, colour drift, darker rock on the steep faces, sparkles
// where the sun glints, and haze that takes the sky's colour. Colours are written as sRGB hex and converted to linear for the shaders.

const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

export const LOOK = Object.freeze({
  sun: new THREE.Vector3(-0.55, 0.21, -0.8).normalize(), // low, ahead and to the left as you ride down
  sunColor: lin('#ffe2c4').multiplyScalar(1.9),
  zenith: lin('#163447'),
  mid: lin('#4f8590'),
  horizon: lin('#e6a68b'),
  sunGlow: lin('#ffc58c'),
  sand: lin('#d8b98f'),
  sandShadow: lin('#9a8070'),
  rock: lin('#8f6a55'),
  bounce: lin('#c29e7c'),
  fogDensity: 0.00105,
  planet: new THREE.Vector3(0.42, 0.52, 0.74).normalize(),
});

const NOISE_GLSL = /* glsl */`
  float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uSun, uZenith, uMid, uHorizon, uGlow, uPlanet;
  varying vec3 vWorld;
  ${NOISE_GLSL}
  void main() {
    vec3 d = normalize(vWorld - cameraPosition); // exact per pixel, whatever the dome's centre is doing
    float h = d.y;
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));
    col = mix(col, uZenith, smoothstep(0.22, 0.95, h));
    float s = max(dot(d, uSun), 0.0);
    vec3 haze = mix(uHorizon, uMid, 0.25) + uGlow * pow(s, 5.0) * 0.5; // the same haze the ground fades into
    col = mix(col, haze, smoothstep(0.02, -0.04, h)); // below the horizon (past the edge of the desert)
    col += uGlow * (pow(s, 6.0) * 0.55 + pow(s, 60.0) * 0.8);
    col += uGlow * 6.0 * smoothstep(0.99955, 0.9998, s); // the sun's disc
    // The ringed planet: a pale disc lit from the sun's side, and a thin tilted ring.
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 px = normalize(cross(up, uPlanet)), py = cross(uPlanet, px);
    float pd = dot(d, uPlanet);
    if (pd > 0.0) {
      vec2 q = vec2(dot(d, px), dot(d, py)) / pd; // tangent-plane coordinates
      float r = length(q);
      float R = 0.085;
      if (r < R) {
        vec3 nrm = normalize(px * q.x / R + py * q.y / R + uPlanet * -sqrt(max(0.0, 1.0 - r * r / (R * R))));
        float lit = smoothstep(-0.2, 0.6, dot(-nrm, uSun));
        float bands = 0.85 + 0.15 * sin(q.y * 140.0 + vnoise(q * 40.0) * 2.0);
        vec3 pc = mix(vec3(0.18, 0.2, 0.26), vec3(0.95, 0.86, 0.74) * bands, lit);
        col = mix(col, pc, 0.85 * smoothstep(R, R * 0.97, r));
      }
      vec2 rq = vec2(q.x * cos(0.35) - q.y * sin(0.35), q.x * sin(0.35) + q.y * cos(0.35));
      float e = length(vec2(rq.x, rq.y * 4.2));
      float ring = smoothstep(0.13, 0.135, e) * smoothstep(0.19, 0.185, e) * (0.7 + 0.3 * sin(e * 300.0));
      float behind = step(R, r) + step(0.0, rq.y); // the ring passes in front of the planet on its lower half
      col = mix(col, vec3(0.92, 0.84, 0.72), ring * 0.55 * min(behind, 1.0));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SAND_VERT = /* glsl */`
  varying vec3 vWorld; varying vec3 vNormal;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;

const SAND_FRAG = /* glsl */`
  uniform vec3 uSun, uSunColor, uSand, uShadow, uRock, uBounce, uZenith, uMid, uHorizon, uGlow;
  uniform float uFog, uDetail;
  varying vec3 vWorld; varying vec3 vNormal;
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormal);
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 V = toEye / dist;
    vec2 q = vWorld.xz;
    float steep = smoothstep(0.42, 0.62, 1.0 - N.y);

    // Wind ripples: long wavy crests, fading out with distance so they never shimmer.
    float near = (1.0 - smoothstep(14.0, 60.0, dist)) * (1.0 - steep) * uDetail;
    if (near > 0.0) {
      float ph = dot(q, vec2(0.82, 0.57)) * 4.6 + vnoise(q * 0.27) * 6.0 + vnoise(q * 1.9) * 0.9;
      float slope = cos(ph) * 0.11 * near * (0.6 + 0.4 * vnoise(q * 0.08));
      N = normalize(N + vec3(0.82, 0.0, 0.57) * slope);
    }

    // Colour: broad drift, fine grain, rock on the steep faces.
    float drift = vnoise(q * 0.012) * 0.6 + vnoise(q * 0.06) * 0.4;
    vec3 albedo = mix(uSand * 0.86, uSand * 1.08, drift);
    albedo *= mix(1.0, 0.94 + 0.12 * vnoise(q * 2.3), uDetail); // fine grain up close; its average far away, so near and far match
    float strata = 0.85 + 0.15 * sin(vWorld.y * 1.3 + vnoise(q * 0.05) * 3.0);
    albedo = mix(albedo, uRock * strata, steep);

    // Light: the low sun wraps a little round the dunes; the shadow side takes the sky and the sand's own bounce.
    float nl = dot(N, uSun);
    float diff = clamp((nl + 0.18) / 1.18, 0.0, 1.0);
    vec3 sky = mix(uMid, uZenith, 0.35);
    vec3 ambient = mix(uBounce * 0.7, sky * 1.25, N.y * 0.5 + 0.5) * 0.95;
    vec3 col = albedo * (uSunColor * diff + ambient);
    col = mix(col, col * uShadow / uSand, (1.0 - smoothstep(-0.05, 0.25, nl)) * 0.25);

    // Sparkles: a few grains catch the sun.
    if (uDetail > 0.0) {
      vec2 cell = floor(q * 38.0);
      float g = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
      vec2 f = fract(q * 38.0) - 0.5;
      float dotShape = 1.0 - smoothstep(0.08, 0.22, length(f));
      float glint = step(0.992, g) * dotShape * pow(max(dot(reflect(-V, N), uSun), 0.0), 18.0) * (1.0 - smoothstep(3.0, 14.0, dist));
      col += uSunColor * glint * 0.5;
    }

    // Haze: sky coloured, warmer toward the sun.
    float fog = 1.0 - exp(-pow(uFog * dist, 1.6));
    vec3 haze = mix(uHorizon, uMid, 0.25) + uGlow * pow(max(dot(-V, uSun), 0.0), 5.0) * 0.5;
    col = mix(col, haze, fog);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function shared() {
  return {
    uSun: { value: LOOK.sun }, uZenith: { value: LOOK.zenith }, uMid: { value: LOOK.mid }, uHorizon: { value: LOOK.horizon },
    uGlow: { value: LOOK.sunGlow },
  };
}

export function createSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...shared(), uPlanet: { value: LOOK.planet } },
    vertexShader: 'varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 p = projectionMatrix * viewMatrix * w; gl_Position = p.xyww; }',
    fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  sky.name = 'Sky'; sky.frustumCulled = false; sky.renderOrder = -10;
  sky.onBeforeRender = (r, s, camera) => { sky.position.setFromMatrixPosition(camera.matrixWorld); };
  sky.scale.setScalar(100);
  return sky;
}

export function createSandMaterial({ detail = 1, offset = 0 } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared(), uSunColor: { value: LOOK.sunColor }, uSand: { value: LOOK.sand }, uShadow: { value: LOOK.sandShadow },
      uRock: { value: LOOK.rock }, uBounce: { value: LOOK.bounce }, uFog: { value: LOOK.fogDensity }, uDetail: { value: detail },
    },
    vertexShader: SAND_VERT, fragmentShader: SAND_FRAG,
  });
  if (offset) { material.polygonOffset = true; material.polygonOffsetFactor = offset; material.polygonOffsetUnits = offset * 2; }
  return material;
}

function gridGeometry(grid) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(grid.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// Builds the ground from baked heights when they load, or works them out live (slower) if the file is missing.
export async function createTerrain(course, { url, onStatus = () => {} } = {}) {
  let baked = null;
  if (url) {
    try {
      const res = await fetch(url);
      if (res.ok) baked = new Float32Array(await res.arrayBuffer());
    } catch { /* fall back to live */ }
  }
  if (!baked) onStatus('Shaping the mountain (this takes a few seconds)…');
  let grids;
  try { grids = buildTerrainGrids(course, baked); } catch (error) { console.warn(error); grids = buildTerrainGrids(course); }
  const group = new THREE.Group(); group.name = 'Terrain';
  const near = new THREE.Mesh(gridGeometry(grids.near), createSandMaterial({ detail: 1 }));
  near.name = 'Terrain near';
  const far = new THREE.Mesh(gridGeometry(grids.far), createSandMaterial({ detail: 0, offset: 2 }));
  far.name = 'Terrain far';
  group.add(far, near);
  return group;
}
