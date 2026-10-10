import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

// Contact surfaces are authored in model space. A tool uses just its handle,
// never its blade, bindings, flame or light. This is a conservative outline of
// the render mesh, calculated on pickup rather than raycasting every XR frame.
const surfaces = new WeakMap();
const meshParts = new WeakMap();
const vertex = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const inverse = new THREE.Matrix4();
const origin = new THREE.Vector3();
const axis = new THREE.Vector3();
const axisTarget = new THREE.Vector3();
const axisCorrection = new THREE.Quaternion();

export function setGripSurface(object, surface) {
  object.userData.gripSurface = surface;
  surfaces.delete(object);
}

export function attachHeldObject(state, object, rotation = null) {
  if (!state?.objectGrip || !object || state.objectGrip.children.length > 0) return false;
  state.objectGrip.add(object);
  if (rotation) object.quaternion.copy(rotation);
  else object.quaternion.identity();
  const surface = object.userData.gripSurface;
  if (surface?.axis && surface.alignAxis) {
    axis.fromArray(surface.axis).normalize();
    axisTarget.fromArray(surface.alignAxis).normalize();
    axisCorrection.setFromUnitVectors(axis, axisTarget);
    object.quaternion.multiply(axisCorrection);
  }

  // Scaling matters: loose resources have different authored instance sizes.
  // A grip point must stay at the palm even when the object is not unit scale.
  origin.fromArray(surface?.point || object.userData.gripPoint || [0, 0, 0]);
  object.position.copy(origin).multiply(object.scale).applyQuaternion(object.quaternion).negate();
  object.updateMatrixWorld(true);
  return true;
}

export function getGripMeshParts(geometry) {
  if (meshParts.has(geometry)) return meshParts.get(geometry);
  const positions = geometry.getAttribute('position');
  const keys = new Map();
  const welded = [];
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(value => Math.round(value * 1e6)).join(',');
    if (!keys.has(key)) keys.set(key, keys.size);
    welded.push(keys.get(key));
  }
  const parents = Array.from({ length: keys.size }, (_, i) => i);
  function find(index) {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  }
  const index = geometry.index;
  const count = index?.count ?? positions.count;
  const triangles = [];
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
    triangles.push(ids);
    parents[find(welded[ids[1]])] = find(welded[ids[0]]);
    parents[find(welded[ids[2]])] = find(welded[ids[0]]);
  }
  const groups = new Map();
  for (let i = 0; i < positions.count; i++) {
    const key = find(welded[i]);
    if (!groups.has(key)) groups.set(key, { indices: [], triangles: [] });
    groups.get(key).indices.push(i);
  }
  for (const ids of triangles) groups.get(find(welded[ids[0]])).triangles.push(ids);
  const parts = [...groups.values()];
  meshParts.set(geometry, parts);
  return parts;
}

function getSurfacePoints(object) {
  if (surfaces.has(object)) return surfaces.get(object);
  const surface = object.userData.gripSurface;
  if (!surface) return null;

  object.updateWorldMatrix(true, true);
  inverse.copy(object.matrixWorld).invert();
  origin.fromArray(surface.point || [0, 0, 0]);
  axis.fromArray(surface.axis || [0, 1, 0]).normalize();
  const all = [];
  const cropped = [];
  const parts = [];
  object.traverse(child => {
    if (!child.isMesh || child.isSkinnedMesh) return;
    if (surface.meshes && !surface.meshes.includes(child.name)) return;
    const positions = child.geometry?.getAttribute('position');
    if (!positions) return;
    matrix.multiplyMatrices(inverse, child.matrixWorld);
    const points = Array.from({ length: positions.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix));
    if (surface.compound) {
      // A branched stick is several connected solids in one mesh. Keep their
      // hulls separate so empty space between the shaft and twigs stays empty.
      const distances = points.map(point => vertex.copy(point).sub(origin).dot(axis));
      const halfLength = surface.halfLength ?? 0.11;
      for (const component of getGripMeshParts(child.geometry)) {
        const group = component.indices.filter(i => !surface.axis || Math.abs(distances[i]) <= halfLength).map(i => points[i]);
        if (surface.axis) for (const ids of component.triangles) {
          for (let edge = 0; edge < 3; edge++) {
            const a = ids[edge]; const b = ids[(edge + 1) % 3];
            for (const boundary of [-halfLength, halfLength]) {
              if ((distances[a] < boundary) === (distances[b] < boundary)) continue;
              const t = (boundary - distances[a]) / (distances[b] - distances[a]);
              group.push(points[a].clone().lerp(points[b], t));
            }
          }
        }
        if (group.length >= 4) parts.push(group);
      }
      return;
    }
    for (let i = 0; i < positions.count; i++) {
      const point = points[i];
      all.push(point);
      if (!surface.axis || Math.abs(vertex.copy(point).sub(origin).dot(axis)) <= (surface.halfLength ?? 0.11)) {
        cropped.push(point);
      }
    }
  });
  const groups = surface.compound ? parts : [cropped.length >= 4 ? cropped : all];
  surfaces.set(object, groups);
  return groups;
}

export function createGripContact(object) {
  const source = getSurfacePoints(object);
  if (!source) return null;
  object.updateMatrix();
  const parts = source.map(group => createConvexContact(group.map(point => point.clone().applyMatrix4(object.matrix)))).filter(Boolean);
  if (!parts.length) return null;
  return {
    parts,
    contains: (point, margin = 0) => parts.some(part => part.contains(point, margin)),
    intersectsTriangle: (a, b, c, margin = 0) => parts.some(part => part.intersectsTriangle(a, b, c, margin)),
    translate: offset => { for (const part of parts) part.translate(offset); },
  };
}

function createConvexContact(points) {
  if (points.length < 4) return null;
  let hull;
  try { hull = new ConvexHull().setFromPoints(points); }
  catch { return null; } // A flat/missing future collision mesh uses the authored pose.
  if (hull.faces.length < 4) return null;

  // Normals and distances are in the stable palm/socket frame. World translation,
  // locomotion, controller rotation and animation cannot change this solved grip.
  const planes = hull.faces.map(face => ({ normal: face.normal.clone(), constant: face.constant }));
  const bounds = new THREE.Box3().setFromPoints(points);
  // Scratch buffers for clipping a skin triangle against the convex contact hull.
  // Checking only tips/vertices misses a long finger face crossing a thin shaft.
  const polygonA = new Float64Array((planes.length + 3) * 3);
  const polygonB = new Float64Array(polygonA.length);
  return {
    hull,
    points,
    planes,
    contains(point, margin = 0) {
      if (point.x <= bounds.min.x - margin || point.x >= bounds.max.x + margin
        || point.y <= bounds.min.y - margin || point.y >= bounds.max.y + margin
        || point.z <= bounds.min.z - margin || point.z >= bounds.max.z + margin) return false;
      for (const plane of planes) {
        if (plane.normal.dot(point) - plane.constant >= margin) return false;
      }
      return true;
    },
    intersectsTriangle(a, b, c, margin = 0) {
      if (Math.max(a.x, b.x, c.x) <= bounds.min.x - margin || Math.min(a.x, b.x, c.x) >= bounds.max.x + margin
        || Math.max(a.y, b.y, c.y) <= bounds.min.y - margin || Math.min(a.y, b.y, c.y) >= bounds.max.y + margin
        || Math.max(a.z, b.z, c.z) <= bounds.min.z - margin || Math.min(a.z, b.z, c.z) >= bounds.max.z + margin) return false;
      let input = polygonA;
      let output = polygonB;
      let count = 3;
      input[0] = a.x; input[1] = a.y; input[2] = a.z;
      input[3] = b.x; input[4] = b.y; input[5] = b.z;
      input[6] = c.x; input[7] = c.y; input[8] = c.z;
      for (const { normal, constant } of planes) {
        let nextCount = 0;
        let previous = (count - 1) * 3;
        let previousDistance = normal.x * input[previous] + normal.y * input[previous + 1] + normal.z * input[previous + 2] - constant - margin;
        for (let i = 0; i < count * 3; i += 3) {
          const distance = normal.x * input[i] + normal.y * input[i + 1] + normal.z * input[i + 2] - constant - margin;
          const inside = distance < 0;
          if (inside !== (previousDistance < 0)) {
            const t = previousDistance / (previousDistance - distance);
            for (let component = 0; component < 3; component++) {
              output[nextCount * 3 + component] = THREE.MathUtils.lerp(input[previous + component], input[i + component], t);
            }
            nextCount++;
          }
          if (inside) {
            for (let component = 0; component < 3; component++) output[nextCount * 3 + component] = input[i + component];
            nextCount++;
          }
          previous = i;
          previousDistance = distance;
        }
        if (!nextCount) return false;
        count = nextCount;
        const previousInput = input;
        input = output;
        output = previousInput;
      }
      return true;
    },
    translate(offset) {
      bounds.translate(offset);
      for (const plane of planes) plane.constant += plane.normal.dot(offset);
      for (const point of points) point.add(offset);
    },
  };
}
