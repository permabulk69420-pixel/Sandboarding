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
function lathe({ height, radius, profile, seed, rough = 0.12, squash = 1, segments = 36, rings = 28, lean = 0 }) {
  const rnd = mulberry(seed), ox = rnd() * 100, oz = rnd() * 100;
  const pos = [], idx = [];
  for (let r = 0; r <= rings; r += 1) {
    const t = r / rings, y = t * height;
    for (let s = 0; s < segments; s += 1) {
      const a = (s / segments) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      // Horizontal bands erode at different rates: a slow wobble with height, plus noise round the girth.
      const band = 1 + 0.08 * Math.sin(y * 0.9 + ox) + 0.05 * Math.sin(y * 2.3 + oz);
      const n = fbm(ca * 1.7 + ox + y * 0.05, sa * 1.7 + oz + y * 0.22, 4) - 0.5;
      const rad = radius * profile(t) * band * (1 + n * rough * 2.2);
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

const SHAPES = {
  // Tall pillar, waisted below a wider cap of harder rock.
  hoodoo: (o, seed) => lathe({ ...o, seed, rough: 0.14, profile: t => (t < 0.8 ? 1 - 0.38 * t + 0.1 * Math.sin(t * 9) : 0.9 + 0.5 * Math.sin((t - 0.8) / 0.2 * Math.PI) * 0.6) }),
  // A long thin wall of rock: a squashed lathe tapering to a ragged crest.
  fin: (o, seed) => lathe({ ...o, seed, rough: 0.18, squash: 3.2, profile: t => Math.pow(1 - t, 0.55) * 0.9 + 0.1 }),
  // Big flat-topped hill with steep stepped sides.
  butte: (o, seed) => lathe({ ...o, seed, rough: 0.08, segments: 48, rings: 18, profile: t => (t < 0.15 ? 1.25 - t : t < 0.9 ? 1.08 - 0.12 * t + 0.04 * Math.floor(t * 6) % 2 : 0.98 - (t - 0.9) * 1.2) }),
};

// course: needs pointAt and heightAt. landmarks: [{ type, s, side (-1 left / 1 right), out (metres from the centre line), height,
// radius, seed, turn }]. material: the sand material to draw them with.
export function createLandmarks(course, landmarks, material) {
  const parts = [];
  for (const [i, l] of landmarks.entries()) {
    const p = course.pointAt(l.s), fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const x = p.x + -fz * l.out * l.side, z = p.z + fx * l.out * l.side;
    const g = SHAPES[l.type]({ height: l.height, radius: l.radius, lean: l.lean ?? 0 }, l.seed ?? (i * 7919 + 13));
    // Sink the base well into the sand at its lowest point round the footprint, so it never floats on a slope.
    let low = Infinity;
    for (let a = 0; a < 8; a += 1) low = Math.min(low, course.heightAt(x + Math.cos(a) * l.radius, z + Math.sin(a) * l.radius));
    g.rotateY(l.turn ?? (i * 2.39996));
    g.translate(x, low - Math.max(2, l.height * 0.08), z);
    parts.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), material);
  mesh.name = 'Landmarks';
  return mesh;
}
