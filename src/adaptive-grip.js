import * as THREE from 'three';
import { createGripContact } from './grip-contact.js';

const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'];
const CONTACT_MARGIN = 0.001; // One millimetre of clearance for the low-poly skin.
const CLOSE_STEPS = 20;
const REFINE_STEPS = 5;
const CLOSE_TIME = 0.12;
const MAX_PALM_SHIFT = 0.06;

function endQuaternion(clip, bone) {
  const track = clip?.tracks.find(track => track.name === `${bone.name}.quaternion`);
  if (!track) return bone.quaternion.clone();
  return new THREE.Quaternion().fromArray(track.createInterpolant().evaluate(clip.duration)).normalize();
}

function setJoint(joint, amount) {
  // Use the asset's own mirrored rotation axes, including thumb opposition and
  // pinky metacarpal motion. Do not aim every finger at one common palm point.
  if (amount <= 0.65) joint.bone.quaternion.copy(joint.open).slerp(joint.grip, amount / 0.65);
  else joint.bone.quaternion.copy(joint.grip).slerp(joint.fist, (amount - 0.65) / 0.35);
}

function collectSkin(root, fingers) {
  const meshes = [];
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!skinIndex || !skinWeight) return;
    const positions = mesh.geometry.getAttribute('position');
    const entry = { mesh, points: Array.from({ length: positions.count }, () => new THREE.Vector3()), toGrip: new THREE.Matrix4() };
    meshes.push(entry);
    const memberships = Array.from({ length: positions.count }, () => new Set());
    for (let i = 0; i < positions.count; i++) {
      for (let channel = 0; channel < 4; channel++) {
        if (skinWeight.getComponent(i, channel) < 0.01) continue;
        const bone = mesh.skeleton.bones[skinIndex.getComponent(i, channel)];
        for (const finger of fingers) {
          if (finger.joints.some(joint => joint.bone === bone)) memberships[i].add(finger);
        }
      }
    }
    for (const finger of fingers) {
      const indices = new Set();
      const triangles = [];
      const index = mesh.geometry.index;
      const count = index?.count ?? positions.count;
      for (let i = 0; i < count; i += 3) {
        const a = index ? index.getX(i) : i;
        const b = index ? index.getX(i + 1) : i + 1;
        const c = index ? index.getX(i + 2) : i + 2;
        if (![a, b, c].some(id => memberships[id].has(finger))) continue;
        indices.add(a); indices.add(b); indices.add(c);
        triangles.push([a, b, c]);
      }
      finger.skin.push({ entry, indices: [...indices], triangles });
    }
  });
  return meshes;
}

export function createAdaptiveGrip({ root, clips, objectGrip, handedness, debug = false }) {
  const side = handedness === 'left' ? 'l' : 'r';
  const openClip = clips.find(clip => clip.name === 'Open');
  const gripClip = clips.find(clip => clip.name === 'Grip');
  const fistClip = clips.find(clip => clip.name === 'Fist');
  if (!openClip || !gripClip || !fistClip) return null;

  const fingers = FINGERS.map(name => {
    const joints = (name === 'pinky' ? [0, 1, 2, 3] : [1, 2, 3])
      .map(number => root.getObjectByName(`b_${side}_${name}${number}`))
      .filter(Boolean)
      .map(bone => ({ bone, open: endQuaternion(openClip, bone), grip: endQuaternion(gripClip, bone), fist: endQuaternion(fistClip, bone) }));
    return { name, joints, skin: [], amounts: joints.map(() => 0), path: [] };
  });
  if (fingers.some(finger => finger.joints.length < 3)) return null;
  const meshes = collectSkin(root, fingers);
  if (!meshes.length || fingers.some(finger => !finger.skin.some(skin => skin.indices.length))) return null;
  const debugMaterials = [];
  if (debug) for (const { mesh } of meshes) {
    const original = mesh.material;
    const outline = (Array.isArray(original) ? original : [original]).map(material => {
      const copy = material.clone();
      copy.wireframe = true;
      return copy;
    });
    mesh.material = Array.isArray(original) ? outline : outline[0];
    debugMaterials.push({ mesh, original, outline });
  }

  const inverseGrip = new THREE.Matrix4();
  const normal = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  let held = null;
  let contact = null;
  let elapsed = 0;
  let diagnostics = null;
  const solvedGrips = new WeakMap();

  function prepareSpace() {
    objectGrip.updateWorldMatrix(true, false);
    root.updateWorldMatrix(true, false);
    // SkinnedMesh refreshes bindMatrixInverse in updateMatrixWorld, not in the
    // inherited updateWorldMatrix. Without this, collision skin doubles the rig's
    // translation/rotation after the player walks away from world origin.
    root.updateMatrixWorld(true);
    inverseGrip.copy(objectGrip.matrixWorld).invert();
    for (const entry of meshes) entry.toGrip.multiplyMatrices(inverseGrip, entry.mesh.matrixWorld);
  }

  function collides(finger) {
    root.updateMatrixWorld(true);
    for (const { entry, indices, triangles } of finger.skin) {
      for (const id of indices) {
        entry.mesh.getVertexPosition(id, entry.points[id]).applyMatrix4(entry.toGrip);
        if (contact.contains(entry.points[id], CONTACT_MARGIN)) return true;
      }
      // Clip the complete skin faces against the hull, including a shaft passing
      // between vertices. The triangle test reuses allocation-free scratch buffers.
      for (const [a, b, c] of triangles) {
        if (contact.intersectsTriangle(entry.points[a], entry.points[b], entry.points[c], CONTACT_MARGIN)) return true;
      }
    }
    return false;
  }

  function openIntersects() {
    for (const entry of meshes) {
      for (let i = 0; i < entry.points.length; i++) {
        if (contact.contains(entry.points[i], CONTACT_MARGIN)) return true;
      }
      const index = entry.mesh.geometry.index;
      const count = index?.count ?? entry.points.length;
      for (let i = 0; i < count; i += 3) {
        const a = index ? index.getX(i) : i;
        const b = index ? index.getX(i + 1) : i + 1;
        const c = index ? index.getX(i + 2) : i + 2;
        if (contact.intersectsTriangle(entry.points[a], entry.points[b], entry.points[c], CONTACT_MARGIN)) return true;
      }
    }
    return false;
  }

  function applyAmounts(finger, amounts) {
    for (let i = 0; i < finger.joints.length; i++) setJoint(finger.joints[i], amounts[i]);
  }

  function advance(finger, jointIndices) {
    const start = finger.amounts.slice();
    let low = 0;
    let high = 1;
    function sample(amount) {
      for (const index of jointIndices) setJoint(finger.joints[index], THREE.MathUtils.lerp(start[index], 1, amount));
      return collides(finger);
    }
    // Search forward from the open pose. A binary search of endpoints alone can
    // jump through a thin shaft and find a falsely safe pose on its other side.
    for (let step = 1; step <= CLOSE_STEPS; step++) {
      const next = step / CLOSE_STEPS;
      if (sample(next)) {
        high = next;
        for (let iteration = 0; iteration < REFINE_STEPS; iteration++) {
          const middle = (low + high) / 2;
          if (sample(middle)) high = middle;
          else low = middle;
        }
        break;
      }
      low = next;
      finger.path.push(finger.joints.map((joint, index) => jointIndices.includes(index) ? THREE.MathUtils.lerp(start[index], 1, low) : start[index]));
    }
    for (const index of jointIndices) finger.amounts[index] = THREE.MathUtils.lerp(start[index], 1, low);
    applyAmounts(finger, finger.amounts);
    finger.path.push(finger.amounts.slice());
  }

  function solve(object) {
    object.updateMatrix();
    const baseMatrix = object.matrix.clone();
    const cached = solvedGrips.get(object);
    // Scene.attach/decompose can introduce tiny rounding changes on release.
    // Ignore sub-micrometre matrix noise, while actual scale/grip changes re-solve.
    const sameTransform = cached && cached.baseMatrix.elements.every((value, i) => Math.abs(value - baseMatrix.elements[i]) < 1e-7);
    if (cached?.surface === object.userData.gripSurface && sameTransform) {
      contact = cached.contact;
      object.position.add(cached.offset);
      for (let i = 0; i < fingers.length; i++) {
        fingers[i].amounts = cached.fingers[i].amounts.slice();
        fingers[i].path = cached.fingers[i].path;
      }
      elapsed = 0;
      object.updateMatrixWorld(true);
      updateDiagnostics();
      return true;
    }
    contact = createGripContact(object);
    if (!contact) return false;
    const saved = fingers.flatMap(finger => finger.joints.map(joint => joint.bone.quaternion.clone()));
    const originalPosition = object.position.clone();
    for (const finger of fingers) {
      finger.amounts.fill(0);
      finger.path = [finger.amounts.slice()];
      applyAmounts(finger, finger.amounts);
    }
    prepareSpace();
    // Open skin does not change while the palm offset is fitted. Skin it once,
    // then test the cached points as the contact outline moves outward.
    for (const entry of meshes) for (let i = 0; i < entry.points.length; i++) {
      entry.mesh.getVertexPosition(i, entry.points[i]).applyMatrix4(entry.toGrip);
    }

    // The original socket can put a thick handle inside the palm/knuckles.
    // Move the object toward the authored palm normal until its outline clears
    // the open skin. This offset is applied once and remains rigid thereafter.
    root.getWorldQuaternion(quaternion);
    normal.set(0, -1, 0).applyQuaternion(quaternion);
    objectGrip.getWorldQuaternion(quaternion).invert();
    normal.applyQuaternion(quaternion).normalize();
    // (a surface may allow a bigger shift than a tool's handle, and start part way out: the Colossus's crystals, src/colossus-climb.js)
    const maxShift = object.userData.gripSurface?.maxShift ?? MAX_PALM_SHIFT;
    let shift = Math.min(object.userData.gripSurface?.startShift ?? 0, maxShift);
    if (shift > 0) { offset.copy(normal).multiplyScalar(shift); object.position.add(offset); contact.translate(offset); }
    while (openIntersects() && shift < maxShift) {
      const step = Math.min(0.0015, maxShift - shift);
      offset.copy(normal).multiplyScalar(step);
      object.position.add(offset);
      contact.translate(offset);
      shift += step;
    }
    if (openIntersects()) {
      // An unsupported oversized shape falls back to its authored hand pose.
      object.position.copy(originalPosition);
      let i = 0;
      for (const finger of fingers) for (const joint of finger.joints) joint.bone.quaternion.copy(saved[i++]);
      contact = null;
      return false;
    }

    for (const finger of fingers) {
      advance(finger, finger.joints.map((_, i) => i));
      // Once a proximal segment meets the handle, let distal joints continue
      // wrapping. Locking the entire finger at its first contact leaves tips open.
      for (let i = finger.joints.length - 1; i >= 0; i--) advance(finger, [i]);
    }
    elapsed = 0;
    solvedGrips.set(object, {
      surface: object.userData.gripSurface,
      baseMatrix,
      contact,
      offset: object.position.clone().sub(originalPosition),
      fingers: fingers.map(finger => ({ amounts: finger.amounts.slice(), path: finger.path.map(pose => pose.slice()) })),
    });
    object.updateMatrixWorld(true);
    updateDiagnostics();
    return true;
  }

  function updateDiagnostics() {
    if (!debug) return;
    if (!diagnostics) {
      diagnostics = new THREE.Group();
      diagnostics.name = 'Grip contact diagnostics';
      // A sibling, never a child of objectGrip: debug helpers cannot occupy a hand.
      objectGrip.parent.add(diagnostics);
      diagnostics.add(new THREE.AxesHelper(0.07));
    }
    const old = diagnostics.getObjectByName('Grip surface outline');
    if (old) { old.geometry.dispose(); old.material.dispose(); diagnostics.remove(old); }
    if (!contact) return;
    const positions = [];
    for (const { hull } of contact.parts) for (const face of hull.faces) {
      let edge = face.edge;
      do {
        positions.push(...edge.tail().point.toArray(), ...edge.head().point.toArray());
        edge = edge.next;
      } while (edge !== face.edge);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x65ffb6, depthTest: false, transparent: true, opacity: 0.7 }));
    lines.name = 'Grip surface outline';
    lines.renderOrder = 30;
    diagnostics.add(lines);
  }

  return {
    update(object, dt = 0) {
      if (object !== held) {
        held = object || null;
        contact = null;
        if (held) solve(held);
        else updateDiagnostics();
      }
      if (diagnostics) {
        diagnostics.visible = Boolean(held && contact);
        diagnostics.position.copy(objectGrip.position);
        diagnostics.quaternion.copy(objectGrip.quaternion);
        diagnostics.scale.copy(objectGrip.scale);
      }
      if (!held || !contact) return false;
      elapsed = Math.min(CLOSE_TIME, elapsed + Math.max(0, Number.isFinite(dt) ? dt : 0));
      for (const finger of fingers) {
        const t = elapsed / CLOSE_TIME * (finger.path.length - 1);
        const index = Math.floor(t);
        const a = finger.path[index];
        const b = finger.path[Math.min(index + 1, finger.path.length - 1)];
        for (let i = 0; i < finger.joints.length; i++) setJoint(finger.joints[i], THREE.MathUtils.lerp(a[i], b[i], t - index));
      }
      root.updateMatrixWorld(true);
      return true;
    },
    getState: () => ({ held, contact, fingers, elapsed }),
    dispose() {
      for (const { mesh, original, outline } of debugMaterials) {
        mesh.material = original;
        for (const material of outline) material.dispose();
      }
      if (!diagnostics) return;
      diagnostics.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
      diagnostics.removeFromParent();
      diagnostics = null;
    },
  };
}
