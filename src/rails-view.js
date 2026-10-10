import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { railAt } from './rails.js';

// What a rail looks like: a bright steel bar on dark posts, a striped ramp at each end, and a flag at each end so you can find it from a long
// way off. However many rails a run has, they are drawn in five calls (bars, ramps, posts, poles, flags): the pieces of every rail are merged,
// which matters on a headset. The shape comes from the same points the board rides (src/rails.js), so the board sits exactly on it.

export const RAIL_VIEW = Object.freeze({
  radius: 0.055, // the bar's radius, metres: fat enough to see from a distance
  postEvery: 4, // metres between posts
  bar: '#ffb52b',
  glow: '#ff8c1a', // a faint self-lit warmth, so the bar still shows at night
  flag: '#ffe03a',
  rampWidth: 0.8, // half width of the striped wedge you ride up onto the bar by
  stripe: Object.freeze(['#f2b705', '#2b2a2e']),
});

const UP = new THREE.Vector3(0, 1, 0);

// The bar: a tube through the rail's points, one radius under the line the board rides so the board sits on top of it.
export function railBarGeometry(rail, radius = RAIL_VIEW.radius) {
  const points = [];
  for (let i = 0; i < rail.n; i += 1) points.push(new THREE.Vector3(rail.x[i], rail.y[i] - radius, rail.z[i]));
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, Math.max(8, rail.n - 1), radius, 8, false);
}

function named(mesh, name) { mesh.name = name; return mesh; }

export function createRails(course, { radius = RAIL_VIEW.radius, postEvery = RAIL_VIEW.postEvery } = {}) {
  const group = new THREE.Group(); group.name = 'Rails';
  const rails = course.rails || [];
  if (!rails.length) return group;

  const barMat = new THREE.MeshStandardMaterial({ color: RAIL_VIEW.bar, metalness: 0.75, roughness: 0.32, emissive: RAIL_VIEW.glow, emissiveIntensity: 0.28 });
  const postMat = new THREE.MeshStandardMaterial({ color: '#2b2a2e', metalness: 0.4, roughness: 0.6 });
  const poleMat = new THREE.MeshStandardMaterial({ color: '#e9e2d6', roughness: 0.7 });
  const flagMat = new THREE.MeshBasicMaterial({ color: RAIL_VIEW.flag, side: THREE.DoubleSide, toneMapped: false });
  const rampMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

  const bars = [], ramps = [], flags = [], posts = [], poles = [];
  const at = {};
  for (const rail of rails) {
    bars.push(railBarGeometry(rail, radius));
    // The wedges you ride up onto the bar by, and off it by: striped, so the way on is easy to see from a long way off.
    ramps.push(rampGeometry(course, rail, 0, rail.entry), rampGeometry(course, rail, rail.length - rail.exit, rail.length));
    for (let u = postEvery; u < rail.length - 2; u += postEvery) {
      railAt(rail, u, at);
      const ground = course.heightAt(at.x, at.z), top = at.y - radius * 2;
      if (top - ground < 0.18) continue; // on the ramps, where the bar is hardly off the sand
      posts.push({ x: at.x, z: at.z, y: ground - 0.35, height: top - ground + 0.35 });
    }
    // A flag at each end, tall where you ride on and shorter where the bar ends, standing beside the bar on the side away from the lane.
    const outer = Math.sign(rail.offsetAt ? rail.offsetAt(rail.from) : 1) || 1;
    for (const [u, tall] of [[0, 2.6], [rail.length, 1.6]]) {
      railAt(rail, u, at);
      const px = at.x - at.tz * 1.1 * outer, pz = at.z + at.tx * 1.1 * outer; // the bar's right in plan is (-tz, tx)
      const y = course.heightAt(px, pz);
      poles.push({ x: px, z: pz, y: y - 0.05, height: tall });
      const flag = flagGeometry(tall);
      flag.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(px, y + tall - 0.05, pz),
        new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-at.tx, -at.tz)), // points the way the bar runs
        new THREE.Vector3(1, 1, 1),
      ));
      flags.push(flag);
    }
  }
  group.add(named(new THREE.Mesh(mergeGeometries(bars), barMat), 'Rail bars'));
  group.add(named(new THREE.Mesh(mergeGeometries(ramps), rampMat), 'Rail ramps'));
  group.add(named(new THREE.Mesh(mergeGeometries(flags), flagMat), 'Rail flags'));
  if (posts.length) group.add(named(stretched(new THREE.CylinderGeometry(0.035, 0.05, 1, 6), postMat, posts), 'Rail posts'));
  group.add(named(stretched(new THREE.CylinderGeometry(0.025, 0.03, 1, 6), poleMat, poles), 'Rail poles'));
  return group;
}

// Upright tubes of unit height standing on their own y, stretched to each one's height: one instanced mesh for all of them.
function stretched(geometry, material, items) {
  geometry.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  items.forEach((p, i) => { mesh.setMatrixAt(i, m.compose(pos.set(p.x, p.y, p.z), q, scale.set(1, p.height, 1))); });
  return mesh;
}

// A pennant flying from the top of a pole: a triangle pointing forward (-z), hung from the top.
function flagGeometry(tall) {
  const size = Math.min(0.9, tall * 0.34);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -size * 0.7, 0, 0, -size * 0.35, -size], 3));
  g.computeVertexNormals();
  return g;
}

// A striped wedge along the rail from distance `from` to `to`: a flat top just under the bar, a skirt down to the sand on both sides, and a
// face at the end where it stands clear of the ground. Stripes every half metre across it, in vertex colours, so there is no texture.
export function rampGeometry(course, rail, from, to) {
  const quads = Math.max(2, Math.round((to - from) / 0.5)), half = RAIL_VIEW.rampWidth;
  const stripe = RAIL_VIEW.stripe.map(c => new THREE.Color(c));
  const dark = new THREE.Color('#1d1c20');
  const at = {};
  const rings = [];
  for (let k = 0; k <= quads; k += 1) {
    railAt(rail, from + (to - from) * (k / quads), at);
    const l = Math.hypot(at.tx, at.tz) || 1, rx = -at.tz / l, rz = at.tx / l; // the bar's right, in plan
    const left = [at.x - rx * half, at.z - rz * half], right = [at.x + rx * half, at.z + rz * half];
    const top = at.y - 0.06;
    rings.push({ left: [left[0], top, left[1]], right: [right[0], top, right[1]], lowL: [left[0], course.heightAt(...left) - 0.08, left[1]], lowR: [right[0], course.heightAt(...right) - 0.08, right[1]] });
  }
  const positions = [], colours = [];
  const tri = (a, b, c, colour) => { positions.push(...a, ...b, ...c); for (let i = 0; i < 3; i += 1) colours.push(colour.r, colour.g, colour.b); };
  const quad = (a, b, c, d, colour) => { tri(a, b, c, colour); tri(a, c, d, colour); };
  for (let k = 0; k < quads; k += 1) {
    const a = rings[k], b = rings[k + 1], colour = stripe[k % 2];
    quad(a.left, a.right, b.right, b.left, colour); // the top
    quad(a.lowL, a.left, b.left, b.lowL, dark); // the sides
    quad(a.right, a.lowR, b.lowR, b.right, dark);
  }
  const first = rings[0], last = rings[quads];
  quad(last.lowL, last.lowR, last.right, last.left, dark); // the end that stands up out of the sand (the other is buried)
  quad(first.left, first.right, first.lowR, first.lowL, dark);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}
