import * as THREE from 'three';
import { buildTerrainGrids } from './terrain-grid.js';

// The look: a low twilight sun over a desert mountain, a ringed planet in a teal-to-rose sky with high streaks of cloud and the first
// stars (the Oasis family look), and sand drawn with a custom shader: real wind ripples up close (a CC0 texture), drawn ripples further
// out, colour drift, darker rock on the steep faces, sparkles where the sun glints, and haze that takes the sky's colour. Colours are written as sRGB hex and converted to linear for the shaders.

// NB: THREE.Color already turns an sRGB hex into linear, so this converts twice. That is how Ridgeline was tuned, and its look (and the other
// courses') depends on it: a hex here is "paler" than the colour it makes, and a mid-grey hex makes a dark colour. Keep it, and pick new
// colours by looking at them.
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();

// A look is everything that makes one run's world feel different from another's: the sky, the sun, the sand, the haze, the planet.
// The numbers below are Ridgeline's twilight, and every course starts from them. A course may carry a `look` (src/courses/) with only the
// parts it changes; makeLook() fills in the rest and turns colours (sRGB hex) into the linear colours the shaders use.
const BASE_LOOK = Object.freeze({
  sun: [-0.55, 0.21, -0.8], // low, ahead and to the left as you ride down: the way to the sun (the moon, on a night run)
  sunColor: '#ffe2c4', sunStrength: 1.9,
  zenith: '#163447',
  mid: '#4f8590',
  horizon: '#e6a68b',
  sunGlow: '#ffc58c',
  sand: '#d8b98f',
  sandShadow: '#9a8070',
  rock: '#8f6a55',
  bounce: '#c29e7c',
  sandstone: '#b67a55', // the landmarks' rock: sandstone a little redder than the sand, banded
  fogDensity: 0.0013, // at the level of the dune plain; the haze thins with height (fogHeight), so from up high you see a long way
  fogHeight: 220, // metres: the haze is e times thinner this far above the plain
  fogEnd: 3300, // metres: by here everything has faded into the air (the ground grid stops a little further out: GRID.farMargin)
  wind: [0.82, 0.57], // x, z: the way the wind blows (across the ripple crests); the blowing sand and the clouds follow it
  stars: 1, starCut: 0.9965, // how bright the stars are (0 for none, in daylight), and how few there are (the nearer to 1, the fewer)
  clouds: { amount: 1, cool: [0.74, 0.4, 0.4], warm: [1.25, 0.72, 0.42] }, // high streaks of cloud: how much, and their colour in shadow and in the sun
  exposure: 1, // the camera's: up for a dim night, down for a blazing noon
  dust: [1, 1, 1], dustLight: 1, // the blowing sand and the puffs: a tint on their (golden) colour, and how brightly they are lit
  // The ringed planet (the Oasis one: a banded teal gas giant with cream rings), hanging ahead and to the right as you ride down, so the
  // sun is on your left and the planet on your right for most of the run. Lit by the same sun, so you see it nearly half lit.
  planet: {
    dir: [0.7, 0.36, -0.62],
    radius: 0.085, // radians: about 10 degrees across; the rings reach a little past twice that
    ringInner: 1.22, // the rings, in planet radii from its centre
    ringOuter: 2.28,
    tilt: 69, // degrees between its spin axis (the rings' normal) and your line of sight: 90 would show the rings edge on
    roll: -24, // degrees: how far the axis leans over on the sky
  },
});

export function makeLook(over = {}) {
  const o = { ...BASE_LOOK, ...over, planet: { ...BASE_LOOK.planet, ...over.planet }, clouds: { ...BASE_LOOK.clouds, ...over.clouds } };
  return Object.freeze({
    sun: new THREE.Vector3(...o.sun).normalize(),
    sunColor: lin(o.sunColor).multiplyScalar(o.sunStrength),
    zenith: lin(o.zenith),
    mid: lin(o.mid),
    horizon: lin(o.horizon),
    sunGlow: lin(o.sunGlow),
    sand: lin(o.sand),
    sandShadow: lin(o.sandShadow),
    rock: lin(o.rock),
    bounce: lin(o.bounce),
    sandstone: lin(o.sandstone),
    fogDensity: o.fogDensity, fogHeight: o.fogHeight, fogEnd: o.fogEnd,
    wind: new THREE.Vector2(...o.wind),
    stars: o.stars, starCut: o.starCut,
    clouds: Object.freeze({ amount: o.clouds.amount, cool: new THREE.Vector3(...o.clouds.cool), warm: new THREE.Vector3(...o.clouds.warm) }),
    exposure: o.exposure,
    dust: new THREE.Vector3(...o.dust), dustLight: o.dustLight,
    planet: Object.freeze({
      dir: new THREE.Vector3(...o.planet.dir).normalize(), radius: o.planet.radius, ringInner: o.planet.ringInner, ringOuter: o.planet.ringOuter,
      tilt: THREE.MathUtils.degToRad(o.planet.tilt), roll: THREE.MathUtils.degToRad(o.planet.roll),
    }),
  });
}

export const LOOK = makeLook(); // Ridgeline's, and the default wherever a look isn't passed in
const glslVec3 = v => `vec3(${v.x.toFixed(6)}, ${v.y.toFixed(6)}, ${v.z.toFixed(6)})`;

// A small tileable noise texture (two channels of fractal value noise), for the clouds, the planet's bands and the blowing sand. Several
// differently scaled and turned samples of it break up the tiling, so 256 pixels is plenty.
let noiseTexture = null;
export function getNoiseTexture() {
  if (noiseTexture) return noiseTexture;
  const N = 256, data = new Uint8Array(N * N * 4);
  const hash = (x, y, seed) => {
    let h = Math.imul((x + seed) | 0, 0x45d9f3b) ^ Math.imul((y - seed) | 0, 0x27d4eb2d);
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967295;
  };
  const value = (u, v, f, seed) => {
    const x = u * f, y = v * f, x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = (x - x0) * (x - x0) * (3 - 2 * (x - x0)), ty = (y - y0) * (y - y0) * (3 - 2 * (y - y0));
    const w = q => ((q % f) + f) % f;
    const a = hash(w(x0), w(y0), seed), b = hash(w(x0 + 1), w(y0), seed), c = hash(w(x0), w(y0 + 1), seed), d = hash(w(x0 + 1), w(y0 + 1), seed);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    const u = x / N, v = y / N, i = (y * N + x) * 4;
    const broad = value(u, v, 3, 17) * 0.52 + value(u, v, 6, 31) * 0.26 + value(u, v, 12, 47) * 0.14 + value(u, v, 24, 71) * 0.08;
    const detail = value(u, v, 7, 113) * 0.54 + value(u, v, 14, 137) * 0.27 + value(u, v, 28, 163) * 0.13 + value(u, v, 56, 191) * 0.06;
    data[i] = Math.round(Math.min(1, Math.max(0, broad)) * 255);
    data[i + 1] = Math.round(Math.min(1, Math.max(0, detail)) * 255);
    data[i + 3] = 255;
  }
  noiseTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.magFilter = THREE.LinearFilter; noiseTexture.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTexture.generateMipmaps = true; noiseTexture.needsUpdate = true;
  return noiseTexture;
}

// One clock for everything in the world that moves on its own (clouds, the planet's bands, blowing sand). main.js sets it every frame.
export const worldTime = { value: 0 };

const NOISE_GLSL = /* glsl */`
  float hash2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
  }
`;

// The colour of the air looking along `d`: what the ground fades into with distance and what the sky is at the horizon, so the two meet
// with no line between them. Warmer toward the sun.
const AIR_GLSL = /* glsl */`
  vec3 airBase(vec3 d) { return mix(uHorizon, uMid, 0.25); }
  // The glow round the sun, in the air itself (so the haze toward the sun glows too): a broad part that hugs the horizon (high up it
  // would muddy the blue) and a tight halo round the disc.
  vec3 broadHalo(vec3 d) { float s = max(dot(d, uSun), 0.0); return uGlow * (pow(s, 2.0) * 0.08 + pow(s, 5.0) * 0.5); }
  vec3 tightHalo(vec3 d) { float s = max(dot(d, uSun), 0.0); return uGlow * (pow(s, 40.0) * 0.35 + pow(s, 400.0) * 0.9); }
  vec3 airColour(vec3 d) { return airBase(d) + broadHalo(d) + tightHalo(d); }
`;

// The planet's shader code for one look: where it hangs, how big it is and how its rings lie are constants written into the code.
const planetGlsl = planet => {
  const planetRight = new THREE.Vector3().crossVectors(planet.dir, new THREE.Vector3(0, 1, 0)).normalize();
  const planetUp = new THREE.Vector3().crossVectors(planetRight, planet.dir).normalize();
  const planetAxis = new THREE.Vector3(Math.sin(planet.tilt) * Math.sin(planet.roll), Math.sin(planet.tilt) * Math.cos(planet.roll), Math.cos(planet.tilt)).normalize();
  return /* glsl */`
  const vec3 PL_DIR = ${glslVec3(planet.dir)};
  const vec3 PL_RIGHT = ${glslVec3(planetRight)};
  const vec3 PL_UP = ${glslVec3(planetUp)};
  const vec3 PL_AXIS = ${glslVec3(planetAxis)};
  const float PL_RADIUS = ${planet.radius.toFixed(4)};
  const float PL_RING_IN = ${planet.ringInner.toFixed(4)};
  const float PL_RING_OUT = ${planet.ringOuter.toFixed(4)};
  const float PL_BOUND = ${Math.cos(planet.ringOuter * planet.radius * 1.12).toFixed(6)};

  // How solid the rings are, rho planet radii from its centre: a faint inner ring, a bright wide one, a dark gap, a thinner outer ring and
  // a hair-thin gap near the edge, with fine ringlets.
  float ringDensity(float rho) {
    float t = (rho - PL_RING_IN) / (PL_RING_OUT - PL_RING_IN);
    if (t <= 0.0 || t >= 1.0) return 0.0;
    float edge = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.93, 1.0, t));
    float d = mix(0.16, 0.94, smoothstep(0.17, 0.30, t));
    d *= 1.0 - 0.94 * smoothstep(0.58, 0.63, t) * (1.0 - smoothstep(0.69, 0.74, t));
    d *= mix(1.0, 0.72, smoothstep(0.72, 0.78, t));
    d *= 1.0 - 0.80 * smoothstep(0.88, 0.91, t) * (1.0 - smoothstep(0.925, 0.96, t));
    d *= 0.93 + 0.07 * sin(t * 37.0 + 0.8);
    return d * edge;
  }

  // The planet and its rings: lit by the sun so it shows a phase, the rings throwing their shadow on it and it on them. Drawn as seen
  // from far off. Returns premultiplied colour and coverage to lay over the sky. In this light the dark side still shows, faintly.
  vec4 planetLight(vec3 ray) {
    if (dot(ray, PL_DIR) < PL_BOUND) return vec4(0.0);
    vec2 p = vec2(dot(ray, PL_RIGHT), dot(ray, PL_UP)) / PL_RADIUS;
    float r2 = dot(p, p);
    vec3 L = vec3(dot(uSun, PL_RIGHT), dot(uSun, PL_UP), -dot(uSun, PL_DIR)); // the sun, in the planet's frame
    vec3 N = PL_AXIS;
    // the rings: where this line of sight crosses their plane
    float zr = -(N.x * p.x + N.y * p.y) / N.z;
    float rho = sqrt(r2 + zr * zr);
    float density = ringDensity(rho);
    vec3 ringPoint = vec3(p, zr);
    float underSun = dot(L, N);
    float sunSide = smoothstep(-0.3, 0.3, underSun * N.z);
    float grazing = 0.30 + 0.70 * smoothstep(0.0, 0.5, abs(underSun));
    float along = dot(ringPoint, L);
    float clear = along < 0.0 ? smoothstep(0.93, 1.03, sqrt(max(dot(ringPoint, ringPoint) - along * along, 0.0))) : 1.0; // the planet's shadow
    float across = clamp((rho - PL_RING_IN) / (PL_RING_OUT - PL_RING_IN), 0.0, 1.0);
    vec3 ringTint = mix(vec3(0.95, 0.86, 0.68), vec3(0.76, 0.84, 0.82), smoothstep(0.35, 0.9, across));
    vec3 ringColour = ringTint * (0.30 + 0.70 * sunSide) * grazing * (0.05 + 0.95 * clear);
    // the planet itself
    float cover = 1.0 - smoothstep(0.985, 1.0, sqrt(r2));
    vec3 body = vec3(0.0);
    float zs = sqrt(max(1.0 - r2, 0.0)), lit = 0.0;
    if (cover > 0.0) {
      vec3 n = vec3(p, zs);
      lit = smoothstep(-0.05, 0.30, dot(n, L));
      float lat = dot(n, N);
      vec3 t1 = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
      vec3 t2 = cross(N, t1);
      float lon = atan(dot(n, t2), dot(n, t1)) * 0.3183099; // two whole texture repeats round the planet, so no seam
      vec2 uv = vec2(lon + uTime * 0.0006, lat * 0.5);
      float warp = (texture2D(uNoise, uv * vec2(1.0, 1.7)).r - 0.5) * 0.9 + (texture2D(uNoise, uv * vec2(2.0, 3.1) + 0.3).g - 0.5) * 0.35;
      float b1 = 0.5 + 0.5 * sin(lat * 17.0 + warp * 4.0 + 0.6);
      float b2 = 0.5 + 0.5 * sin(lat * 7.0 - warp * 3.0 + 2.2);
      vec3 col = mix(vec3(0.16, 0.42, 0.50), vec3(0.50, 0.78, 0.74), b1);
      col = mix(col, vec3(0.86, 0.80, 0.62), smoothstep(0.58, 0.92, b2) * 0.55);
      col = mix(col, vec3(0.62, 0.40, 0.30), smoothstep(0.86, 1.0, 0.5 + 0.5 * sin(lat * 29.0 + warp * 6.0)) * 0.30);
      col = mix(col, vec3(0.12, 0.26, 0.34), smoothstep(0.72, 0.97, abs(lat)) * 0.65);
      float ringShadow = 0.0;
      if (abs(underSun) > 0.04) { float s = -dot(n, N) / underSun; if (s > 0.0) ringShadow = ringDensity(length(n + L * s)); }
      float limb = 0.55 + 0.45 * pow(zs, 0.4);
      float rim = pow(1.0 - zs, 3.0);
      body = col * limb * (0.03 + 0.97 * lit * (1.0 - 0.8 * ringShadow)) + vec3(0.25, 0.55, 0.58) * rim * (0.45 * lit + 0.06);
    }
    float bodyAlpha = cover * mix(0.9, 1.0, lit); // the night side is a dim disc, a little see-through
    float ringAlpha = density * 0.8;
    vec3 bodyRGB = body * 0.95, ringRGB = ringColour * 0.95;
    bool ringInFront = zr > zs; // the near half of the rings crosses in front of the planet
    float alpha = ringInFront ? ringAlpha + (1.0 - ringAlpha) * bodyAlpha : bodyAlpha + (1.0 - bodyAlpha) * ringAlpha;
    vec3 rgb = ringInFront ? ringRGB * ringAlpha + (1.0 - ringAlpha) * bodyRGB * bodyAlpha : bodyRGB * bodyAlpha + (1.0 - bodyAlpha) * ringRGB * ringAlpha;
    return vec4(rgb, alpha);
  }
`;
};

export const skyFragment = look => /* glsl */`
  uniform vec3 uSun, uZenith, uMid, uHorizon, uGlow;
  uniform vec2 uWind;
  uniform sampler2D uNoise;
  uniform float uTime;
  uniform float uStars, uStarCut, uCloudAmount; // how bright the stars are, the hash above which a cell holds one (fewer as it nears 1), how much cloud
  uniform vec3 uCloudCool, uCloudWarm; // the cloud's colour on the shadow side and toward the sun
  varying vec3 vWorld;
  ${NOISE_GLSL}
  ${AIR_GLSL}
  ${planetGlsl(look.planet)}

  float starHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

  void main() {
    vec3 d = normalize(vWorld - cameraPosition); // exact per pixel, whatever the dome's centre is doing
    float h = max(d.y, 0.0);
    float s = max(dot(d, uSun), 0.0);
    // The gradient: the air colour at the horizon, warm and deep on the sun's side, up through teal to the deep zenith.
    // At the horizon it is exactly the air colour, so the haze over the far desert meets it with no line.
    float warmth = pow(s, 3.0);
    vec3 col = mix(airBase(d), uMid, smoothstep(0.0, 0.30 + 0.30 * warmth, h));
    col = mix(col, uZenith, smoothstep(0.25, 0.95, h));
    col += broadHalo(d) * (1.0 - smoothstep(0.0, 0.42, h)) + tightHalo(d);
    // Over the sun the warm band climbs higher and turns pale gold, so it meets the teal through light colours, not a muddy brown.
    col = mix(col, vec3(1.05, 0.80, 0.55), pow(s, 6.0) * smoothstep(0.0, 0.22, h) * (1.0 - smoothstep(0.1, 0.55, h)) * 0.45);

    // A few stars where the sky is darkest, away from the sun. Each is a soft dot a pixel or two across, twinkling slowly.
    float dark = smoothstep(0.3, 0.75, h) * (1.0 - smoothstep(0.0, 0.5, warmth));
    if (dark > 0.0) {
      vec3 g = d * 190.0, cell = floor(g);
      float r = starHash(cell);
      if (r > uStarCut) {
        vec3 c = cell + 0.5 + (vec3(starHash(cell + 7.1), starHash(cell + 3.3), starHash(cell + 1.7)) - 0.5) * 0.5;
        float star = 1.0 - smoothstep(0.08, 0.3, length(g - c));
        float twinkle = 0.75 + 0.25 * sin(uTime * (1.3 + 2.0 * r) + r * 90.0);
        col += vec3(0.75, 0.85, 1.0) * star * dark * twinkle * (0.25 + 0.75 * starHash(cell + 11.0)) * 0.55 * uStars;
      }
    }

    // The ringed planet.
    vec4 planet = planetLight(d);
    col = col * (1.0 - planet.a * 0.8) + planet.rgb; // a little of the sky still shows over it: the air in front

    // High thin cloud, streaked out along the wind and drifting with it: rose on the shadow side, gold toward the sun.
    if (d.y > 0.0) {
      vec2 p = d.xz / (d.y + 0.12);
      vec2 w = uWind, side = vec2(-w.y, w.x);
      vec2 a = vec2(dot(p, w) * 0.16, dot(p, side) * 0.55) + vec2(uTime * 0.0012, 0.0);
      vec2 b = vec2(dot(p, w) * 0.37 + 0.31, dot(p, side) * 1.3 + 0.62) + vec2(uTime * 0.0021, 0.0);
      float n = texture2D(uNoise, a).r * 0.7 + texture2D(uNoise, b).g * 0.42;
      float cloud = smoothstep(0.6, 0.88, n) * smoothstep(0.03, 0.22, d.y) * (1.0 - 0.7 * smoothstep(0.5, 1.0, d.y));
      vec3 cloudCol = mix(uCloudCool, uCloudWarm, smoothstep(0.0, 1.0, warmth)) * (0.8 + 0.4 * texture2D(uNoise, b * 2.3).g);
      col = mix(col, cloudCol, cloud * 0.5 * uCloudAmount * (1.0 - planet.a * 0.6));
    }

    col += uGlow * 6.0 * smoothstep(0.99955, 0.9998, s); // the sun's disc
    if (d.y < 0.0) col = airColour(d); // below the horizon: past the edge of the desert, only the haze
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SAND_VERT = /* glsl */`
  attribute vec2 shape; // metres past the lane's edge, and how far the point stands above its neighbours (near ground only)
  uniform float uShapeOn;
  varying vec3 vWorld; varying vec3 vNormal; varying vec2 vShape;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
    vShape = uShapeOn > 0.5 ? shape : vec2(100.0, 0.0); // the far ground is all wild dunes
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;

const SAND_FRAG = /* glsl */`
  uniform vec3 uSun, uSunColor, uSand, uShadow, uRock, uBounce, uZenith, uMid, uHorizon, uGlow;
  uniform float uFog, uFogFloor, uFogHeight, uFogEnd, uDetail, uTexOn;
  varying vec2 vShape;
  uniform sampler2D uSandTex; // ripple normal in red/green, brightness detail in blue (ambientCG Ground098, CC0)
  varying vec3 vWorld; varying vec3 vNormal;
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  ${AIR_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormal);
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 V = toEye / dist;
    vec2 q = vWorld.xz;
    float steep = smoothstep(0.42, 0.62, 1.0 - N.y);
    // The run: inside the lane (and a couple of metres up its walls) the sand is groomed and packed by riders: smoother and a touch
    // lighter than the wild dunes either side, so the line you ride always reads. Crests and lips (anything standing proud of the sand
    // round it) are scoured pale by the wind; hollows hold darker sand. That's what makes a kicker's lip or a roller's top stand out.
    float lane = 1.0 - smoothstep(-2.0, 4.0, vShape.x);
    float crest = smoothstep(0.02, 0.22, vShape.y), hollow = smoothstep(0.03, 0.3, -vShape.y);

    // Up close, real sand: a photographed wind-rippled sand texture, its crests turned to face the wind. Two samples at different sizes and
    // angles, swapped by a slow noise, so the tiling never lines up. It fades out with distance (and before the texture has loaded).
    float tex = (1.0 - smoothstep(12.0, 30.0, dist)) * (1.0 - steep) * uDetail * uTexOn;
    float grain = 1.0;
    if (tex > 0.0) {
      vec2 U = vec2(-0.57, 0.82), W = vec2(0.82, 0.57); // along the crests, and across them (the wind)
      vec2 uvA = vec2(dot(q, U), dot(q, W)) / 1.8;
      vec2 r = vec2(dot(q, vec2(0.92, -0.39)), dot(q, vec2(0.39, 0.92)));
      vec2 uvB = vec2(dot(r, U), dot(r, W)) / 2.9 + 0.37;
      vec3 t = mix(texture2D(uSandTex, uvA).rgb, texture2D(uSandTex, uvB).rgb, smoothstep(0.35, 0.65, vnoise(q * 0.12)));
      vec2 nxy = t.rg * 2.0 - 1.0;
      vec3 T = normalize(vec3(U.x, 0.0, U.y) - N * dot(vec3(U.x, 0.0, U.y), N));
      vec3 B = normalize(vec3(W.x, 0.0, W.y) - N * dot(vec3(W.x, 0.0, W.y), N));
      N = normalize(N + (T * nxy.x + B * nxy.y) * tex * mix(1.0, 0.45, max(lane, crest))); // packed sand: softer ripples
      grain = mix(1.0, t.b * 2.0, tex);
    }

    // Further out, drawn wind ripples: long wavy crests, fading out with distance so they never shimmer.
    // They also fade wherever one ripple would cover fewer than about four pixels (in a headset that comes much sooner at a glancing angle
    // than distance alone says), so they never crawl or flicker.
    float near = (1.0 - smoothstep(14.0, 60.0, dist)) * (1.0 - steep) * uDetail * (1.0 - tex);
    float phBase = dot(q, vec2(0.82, 0.57)) * 4.6;
    near *= 1.0 - smoothstep(0.9, 1.6, fwidth(phBase)); // radians of ripple per pixel: 6.28 / 4 pixels is about 1.6
    if (near > 0.0) {
      float ph = phBase + vnoise(q * 0.27) * 6.0 + vnoise(q * 1.9) * 0.9;
      float slope = cos(ph) * 0.11 * near * (0.6 + 0.4 * vnoise(q * 0.08)) * mix(1.0, 0.35, max(lane, crest));
      N = normalize(N + vec3(0.82, 0.0, 0.57) * slope);
    }

    // Colour: broad drift, fine grain, rock on the steep faces.
    float drift = vnoise(q * 0.012) * 0.6 + vnoise(q * 0.06) * 0.4;
    vec3 albedo = mix(uSand * 0.86, uSand * 1.08, drift);
    albedo *= mix(1.0, 0.94 + 0.12 * vnoise(q * 2.3), uDetail); // fine grain up close; its average far away, so near and far match
    albedo *= grain;
    albedo *= 1.0 + 0.06 * lane + 0.2 * crest - 0.1 * hollow;
    float strata = 0.85 + 0.15 * sin(vWorld.y * 1.3 + vnoise(q * 0.05) * 3.0);
    albedo = mix(albedo, uRock * strata, steep);

    // Light: the low sun wraps a little round the dunes; the shadow side takes the sky (teal overhead, warm round the horizon) and the
    // sand's own bounce, so a lee face is a cool soft shade, never black.
    float nl = dot(N, uSun);
    float diff = clamp((nl + 0.18) / 1.18, 0.0, 1.0);
    vec3 sky = uMid * 0.95 + uHorizon * 0.42;
    vec3 ambient = mix(uBounce * 0.62, sky, N.y * 0.5 + 0.5) * 0.95;
    vec3 col = albedo * (uSunColor * diff + ambient);
    col = mix(col, col * uShadow / uSand, (1.0 - smoothstep(-0.05, 0.25, nl)) * 0.25);

    // Sparkles: a few grains catch the sun.
    float cellPx = 1.0 / max(fwidth(q.x * 38.0) + fwidth(q.y * 38.0), 1e-4); // pixels across one sparkle cell
    if (uDetail > 0.0 && cellPx > 2.5) {
      vec2 cell = floor(q * 38.0);
      float g = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
      vec2 f = fract(q * 38.0) - 0.5;
      float dotShape = 1.0 - smoothstep(0.08, 0.22, length(f));
      float glint = step(0.992, g) * dotShape * pow(max(dot(reflect(-V, N), uSun), 0.0), 18.0) * (1.0 - smoothstep(3.0, 14.0, dist));
      col += uSunColor * glint * 0.5 * smoothstep(2.5, 6.0, cellPx); // only where a grain is several pixels across: no pixel-sized flicker
    }

    // Haze: the colour of the air that way (the same as the sky at the horizon), warmer toward the sun.
    // How much haze lies between here and the eye: thick down on the plain, thinning with height (the average of an exponential
    // falloff along the line of sight), and everything gone to haze before the edge of the world.
    float ya = (cameraPosition.y - uFogFloor) / uFogHeight, yb = (vWorld.y - uFogFloor) / uFogHeight;
    float thick = abs(yb - ya) > 0.01 ? (exp(-ya) - exp(-yb)) / (yb - ya) : exp(-ya);
    float fog = max(1.0 - exp(-pow(uFog * dist * thick, 1.6)), smoothstep(uFogEnd - 500.0, uFogEnd, dist));
    col = mix(col, airColour(-V), fog);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function shared(look) {
  return {
    uSun: { value: look.sun }, uZenith: { value: look.zenith }, uMid: { value: look.mid }, uHorizon: { value: look.horizon },
    uGlow: { value: look.sunGlow },
  };
}

export function createSky(look = LOOK) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared(look), uWind: { value: look.wind }, uNoise: { value: getNoiseTexture() }, uTime: worldTime,
      uStars: { value: look.stars }, uStarCut: { value: look.starCut }, uCloudAmount: { value: look.clouds.amount },
      uCloudCool: { value: look.clouds.cool }, uCloudWarm: { value: look.clouds.warm },
    },
    vertexShader: 'varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 p = projectionMatrix * viewMatrix * w; gl_Position = p.xyww; }',
    fragmentShader: skyFragment(look), side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  sky.name = 'Sky'; sky.frustumCulled = false; sky.renderOrder = -10;
  sky.onBeforeRender = (r, s, camera) => { sky.position.setFromMatrixPosition(camera.matrixWorld); };
  sky.scale.setScalar(100);
  return sky;
}

export function createSandMaterial({ detail = 1, offset = 0, floor = -16, shapeOn = false, look = LOOK, rock = look.rock } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared(look), uSunColor: { value: look.sunColor }, uSand: { value: look.sand }, uShadow: { value: look.sandShadow },
      uRock: { value: rock }, uBounce: { value: look.bounce }, uFog: { value: look.fogDensity }, uFogFloor: { value: floor },
      uFogHeight: { value: look.fogHeight }, uFogEnd: { value: look.fogEnd }, uDetail: { value: detail }, uShapeOn: { value: shapeOn ? 1 : 0 },
      uSandTex: { value: null }, uTexOn: { value: 0 },
    },
    vertexShader: SAND_VERT, fragmentShader: SAND_FRAG,
  });
  if (offset) { material.polygonOffset = true; material.polygonOffsetFactor = offset; material.polygonOffsetUnits = offset * 2; }
  return material;
}

function tileGeometry(tile) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(tile.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(tile.normals, 3));
  if (tile.shapes) geometry.setAttribute('shape', new THREE.BufferAttribute(tile.shapes, 2));
  geometry.setIndex(new THREE.BufferAttribute(tile.indices, 1));
  geometry.computeBoundingSphere(); // per tile, so tiles out of view are skipped
  return geometry;
}

// Builds the ground from baked heights when they load, or works them out live (slower) if the file is missing.
export async function createTerrain(course, { url, sandUrl, onStatus = () => {}, look = LOOK } = {}) {
  let baked = null;
  if (url) {
    try {
      const res = await fetch(url);
      if (res.ok) baked = new Float32Array(await res.arrayBuffer());
    } catch { /* fall back to live */ }
  }
  if (!baked) onStatus('Shaping the mountain (this takes a few seconds)…');
  let grids;
  try { grids = buildTerrainGrids(course, baked); } catch (error) {
    console.warn(error); onStatus('Shaping the mountain (this takes a few seconds)…'); // an out-of-date terrain file: work it out live (slow)
    grids = buildTerrainGrids(course);
  }
  const group = new THREE.Group(); group.name = 'Terrain';
  const floor = course.plain ?? -16;
  const nearMaterial = createSandMaterial({ detail: 1, floor, shapeOn: true, look });
  const near = new THREE.Group(); near.name = 'Terrain near';
  for (const tile of grids.near.tiles) near.add(new THREE.Mesh(tileGeometry(tile), nearMaterial));
  if (sandUrl) {
    new THREE.TextureLoader().load(sandUrl, texture => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.NoColorSpace; // data, not colour
      texture.anisotropy = 4;
      nearMaterial.uniforms.uSandTex.value = texture;
      nearMaterial.uniforms.uTexOn.value = 1;
    });
  }
  const farMaterial = createSandMaterial({ detail: 0, floor, look }); // no overlap with the fine grid any more, so no depth offset
  const far = new THREE.Group(); far.name = 'Terrain far';
  for (const tile of grids.far.tiles) far.add(new THREE.Mesh(tileGeometry(tile), farMaterial));
  group.add(far, near);
  group.userData.ground = grids.near.lattice; // the fine grid's heights, for the blowing sand
  return group;
}
