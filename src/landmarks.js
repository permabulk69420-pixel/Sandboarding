import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from './math.js';

// Sandstone landmarks: hoodoos (tall weathered pillars with a cap rock), fins (long thin walls of rock) and buttes (big flat-topped
// hills out on the dune sea). Each is a lathe round a wobbly profile, roughened with noise, so no two are alike; they are drawn with
// the sand's own material, which paints anything steep as banded rock and anything flat as sand, in the same light and haze as the
// ground. Placement is data in the course (`landmarks`): where along the run, which side, how far out. They have no collision, so
// they stand well clear of anywhere you can ride.

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A closed lathe: `profile(t)` gives the radius at height fraction t (0 base, 1 top); the top is capped flat. Noise roughens the surface
// sideways (stronger on the sides than up the height, like wind-cut sandstone), and `squash` makes it oval (fins).
function lathe({ height, radius, profile, seed, rough = 0.12, squash = 1, segments = 48, rings = 44, lean = 0 }) {
  const rnd = mulberry(seed), ox = rnd() * 100, oz = rnd() * 100;
  const pos = [], idx = [];
  for (let r = 0; r <= rings; r += 1) {
    const t = r / rings, y = t * height;
    for (let s = 0; s < segments; s += 1) {
      const a = (s / segments) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      // In plan it's lobed and irregular, never a circle (low-frequency noise round the girth, drifting slowly with height); the layers erode
      // unevenly too, so the bands wander instead of making rings.
      const lobes = 1 + 0.42 * (fbm(ca * 0.9 + ox, sa * 0.9 + oz + y * 0.004, 3) - 0.5) * 2;
      const band = 1 + 0.045 * Math.sin(y * 0.6 + 1.8 * Math.sin(a * 2 + ox) + oz) + 0.025 * Math.sin(y * 1.7 + a * 3 + ox);
      const n = fbm(ca * 2.4 + ox + y * 0.02, sa * 2.4 + oz + y * 0.09, 3) - 0.5;
      const rad = radius * profile(t) * lobes * band * (1 + n * rough * 2.2);
      pos.push(ca * rad * squash + lean * y, y, sa * rad);
    }
  }
  for (let r = 0; r < rings; r += 1) for (let s = 0; s < segments; s += 1) {
    const a = r * segments + s, b = r * segments + (s + 1) % segments, c = a + segments, d = b + segments;
    idx.push(a, c, b, b, c, d);
  }
  // flat top
  const top = pos.length / 3; pos.push(lean * height, height + radius * 0.04, 0);
  for (let s = 0; s < segments; s += 1) idx.push(top, rings * segments + (s + 1) % segments, rings * segments + s);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SHAPES = {
  // Tall pillar: a sloping skirt of fallen rock at the foot, a column that thins toward the top, then a wider cap of harder rock.
  hoodoo: (o, seed) => lathe({ ...o, seed, rough: 0.07, profile: t => {
    const skirt = 1 + 0.9 * (1 - smoothstep(0, 0.18, t)) ** 2;
    const column = 1 - 0.32 * smoothstep(0.1, 0.82, t);
    const cap = 1 + 0.55 * smoothstep(0.82, 0.88, t) - 0.25 * smoothstep(0.9, 1, t);
    return skirt * column * cap;
  } }),
  // A long thin wall of rock, tapering to a crest.
  fin: (o, seed) => lathe({ ...o, seed, rough: 0.09, squash: 3.4, profile: t => (1 + 0.7 * (1 - smoothstep(0, 0.15, t)) ** 2) * (0.25 + 0.75 * (1 - smoothstep(0.1, 1, t) ** 1.4)) }),
  // Big flat-topped hill: a slope of fallen rock round the foot, sheer cliffs, a flat top.
  butte: (o, seed) => lathe({ ...o, seed, rough: 0.05, segments: 64, rings: 36, profile: t => (1 + 0.55 * (1 - smoothstep(0, 0.4, t)) ** 1.5) * (1 - 0.16 * t) * (1 - 0.1 * smoothstep(0.88, 1, t)) }),
};

// course: needs pointAt and heightAt. landmarks: [{ type, s, side (-1 left / 1 right), out (metres from the centre line), height,
// radius, seed, turn }]. material: the sand material to draw them with.
export function createLandmarks(course, landmarks, material) {
  const parts = [];
  for (const [i, l] of landmarks.entries()) {
    const p = course.pointAt(l.s), fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const x = p.x + -fz * l.out * l.side, z = p.z + fx * l.out * l.side;
    // The base sinks well into the sand at the lowest point round the footprint (so it never floats on a slope); the top stands `height`
    // above the lane there, so it always rises over the ridges you see from the run, however far down the mountain's side it stands.
    let low = Infinity;
    for (let a = 0; a < 12; a += 1) low = Math.min(low, course.heightAt(x + Math.cos(a) * l.radius * 1.6, z + Math.sin(a) * l.radius * 1.6));
    const base = low - Math.max(2, l.height * 0.06), top = Math.max(p.y + l.height, low + l.height * 0.6);
    const g = SHAPES[l.type]({ height: top - base, radius: l.radius, lean: l.lean ?? 0 }, l.seed ?? (i * 7919 + 13));
    g.rotateY(l.turn ?? (i * 2.39996));
    g.translate(x, base, z);
    parts.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), material);
  mesh.name = 'Landmarks';
  return mesh;
}
