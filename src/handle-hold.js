import * as THREE from 'three';
import { setHeldGripProfile, clearHeldGripProfile, GRIP_PROFILE } from './grip-poses.js';
import { attachHeldObject, setGripSurface } from './grip-contact.js';

// (From Oasis, with one addition for Sandboarding: a handle can say which way is `inward`, and the hand is then turned about the handle so
// its palm faces that way. A board's edge is held like that, palm toward the middle of the deck, so the deck runs out between thumb and
// fingers instead of through the wrist.)
//
// Holding a handle that belongs to something else: the sand kart's handlebar, the glider's bar, any handle to come. One rule for all of them, so a new
// handle needs no fitting by hand: the hollow of the closed hand goes on the handle's axis.
//
// How: the same contact solver that fits the hand round a held tool (src/adaptive-grip.js) is given an invisible bar exactly as thick as the handle, in
// the hand. The solver slides that bar out of the palm until it clears the skin and closes each finger until it touches it, so the bar ends up in the
// hollow of the hand, where a real bar that thick would sit. Then every frame the hand model is moved (from where the controller really holds it) so that
// solved bar lies on the real handle: same axis, the nearest point along it to where your hand is, clamped to the handle's ends. The fingers then close
// round the handle itself, centred, whatever its thickness and wherever the bone called the grip socket happens to be.
//
// A handle is a marker node in the object's model (an empty) plus, in the marker's own space, the handle's axis and how far either side of the marker the
// hand may sit. Its thickness is measured from the model's own mesh (`measureHandleRadius`), so it always matches what you see.
//
//   const hold = createHandleHold();
//   const handle = { node: model.getObjectByName('Grip_Left'), axis: [0, 0, 1], halfLength: 0.1, radius: measureHandleRadius(model, marker, axis, 0.1) };
//   (maxRadius: let a thicker hold than a tool's handle through, as the Colossus's crystals do: the hand clamps on rather than closing round it)
//   hold.grab(state, handle);     // when the squeeze starts
//   hold.place(state);            // every frame after the object (and the rig) has moved
//   hold.release(state);          // when the squeeze ends
export const HANDLE_HOLD = Object.freeze({
  minRadius: 0.012,         // metres: thinner handles are held as this thick (the hand's finest grip)
  maxRadius: 0.032,         // and thicker as this (the solver can move a bar at most 6 cm out of the palm)
  barLength: 0.12,          // the invisible bar's length: about a hand's width, so it stays inside the handle's ends
});

// The handle's radius from the mesh round it: the vertices within `halfLength` of the marker along `axis` (marker space) and within 6 cm of the axis,
// their median distance from it. (The median, so a flare or a seam at one end does not count.)
export function measureHandleRadius(model, marker, axis, halfLength, { reach = 0.06 } = {}) {
  model.updateWorldMatrix(true, true);
  const toMarker = new THREE.Matrix4().copy(marker.matrixWorld).invert();
  const a = new THREE.Vector3().fromArray(axis).normalize();
  const m = new THREE.Matrix4(), v = new THREE.Vector3(), radial = [];
  model.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    m.multiplyMatrices(toMarker, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const along = v.dot(a);
      if (Math.abs(along) > halfLength) continue;
      const r = v.addScaledVector(a, -along).length();
      if (r < reach) radial.push(r);
    }
  });
  if (!radial.length) return null;
  radial.sort((x, y) => x - y);
  // the outer skin: the median of the outer half (the inner half is the tube inside the rubber, the far side of a hollow pipe, and so on)
  return radial[Math.floor(radial.length * 0.75)];
}

export function createHandleHold() {
  const holds = new Map();            // hand state -> { home: the hand model's own offset on the controller, bar, handle }
  const anchorWorld = new THREE.Matrix4(), socketInAnchor = new THREE.Matrix4(), barInAnchor = new THREE.Matrix4(), want = new THREE.Matrix4();
  const barWorld = new THREE.Matrix4(), mat = new THREE.Matrix4();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Vector3(), axis = new THREE.Vector3(), barAxis = new THREE.Vector3();
  const nq = new THREE.Quaternion(), align = new THREE.Quaternion(), ps = new THREE.Vector3(), handleQ = new THREE.Quaternion();
  const inward = new THREE.Vector3(), palm = new THREE.Vector3(), anchorQ = new THREE.Quaternion(), roll = new THREE.Quaternion(), cross = new THREE.Vector3();
  const scratchP = new THREE.Vector3(), scratchS = new THREE.Vector3();
  const PALM = new THREE.Vector3(0, -1, 0); // the hand models face their palms along -y (src/hands.js)

  function bar(radius, big = false) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, HANDLE_HOLD.barLength, 16),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    mesh.name = 'Handle hold bar';
    mesh.userData.handleHold = true;
    // a thick hold (wider than a hand closes round) may be pushed further out of the palm, starting about where it will end up
    setGripSurface(mesh, { axis: [0, 1, 0], point: [0, 0, 0], halfLength: HANDLE_HOLD.barLength / 2,
      ...(big ? { maxShift: radius + 0.06, startShift: Math.max(0, radius - 0.02) } : {}) });
    return mesh;
  }

  function restore(state) {
    const hold = holds.get(state);
    if (hold && state.handAnchor) { state.handAnchor.position.copy(hold.home.position); state.handAnchor.quaternion.copy(hold.home.quaternion); }
  }

  // Start holding `handle` with this hand. False if the hand has no model yet or is already holding something else.
  function grab(state, handle) {
    if (!state?.handAnchor || !state.gripSocket || !handle?.node) return false;
    if (holds.has(state)) { holds.get(state).handle = handle; return true; }
    if (state.objectGrip.children.length) return false;
    const radius = THREE.MathUtils.clamp(handle.radius ?? 0.02, HANDLE_HOLD.minRadius, handle.maxRadius ?? HANDLE_HOLD.maxRadius);
    const b = bar(radius, radius > HANDLE_HOLD.maxRadius);
    if (!attachHeldObject(state, b)) return false;
    holds.set(state, { home: { position: state.handAnchor.position.clone(), quaternion: state.handAnchor.quaternion.clone() }, bar: b, handle });
    setHeldGripProfile(state, radius < 0.017 ? GRIP_PROFILE.THIN : radius > 0.026 ? GRIP_PROFILE.LARGE : GRIP_PROFILE.MEDIUM);
    return true;
  }

  // Where the hand really is (the controller's pose, before any hold moved the model): the grip socket's world position.
  function realSocket(state, target) {
    restore(state);
    const node = state.gripSocket || state.objectGrip;
    node.updateWorldMatrix(true, false);
    return node.getWorldPosition(target);
  }

  // Move the hand model so the solved bar lies on the handle. Call every frame, after whatever carries the handle has moved.
  function place(state) {
    const hold = holds.get(state);
    if (!hold) return;
    const anchor = state.handAnchor, socket = state.gripSocket;
    if (!anchor || !socket) return;
    restore(state);
    anchor.updateMatrixWorld(true);
    anchorWorld.copy(anchor.matrixWorld);
    socketInAnchor.copy(anchorWorld).invert().multiply(socket.matrixWorld);
    // the bar as the solver left it, in the hand model's frame (objectGrip is the socket's frame: src/hands.js keeps it there)
    hold.bar.updateMatrix();
    barInAnchor.multiplyMatrices(socketInAnchor, hold.bar.matrix);
    barWorld.multiplyMatrices(anchorWorld, barInAnchor).decompose(p, q, s);
    // the handle: its axis through the marker
    const node = hold.handle.node;
    node.updateWorldMatrix(true, false);
    node.getWorldPosition(c);
    node.getWorldQuaternion(handleQ);
    axis.fromArray(hold.handle.axis || [0, 1, 0]).applyQuaternion(handleQ).normalize();
    const half = hold.handle.halfLength ?? 0;
    // turn the bar (as little as it takes, either way round) onto the handle's axis, then put it on the axis at the nearest point
    barAxis.set(0, 1, 0).applyQuaternion(q);
    if (barAxis.dot(axis) < 0) axis.negate();
    const along = THREE.MathUtils.clamp(ps.copy(p).sub(c).dot(axis), -half, half);
    align.setFromUnitVectors(barAxis, axis);
    nq.copy(q).premultiply(align);
    p.copy(c).addScaledVector(axis, along);
    want.compose(p, nq, s);
    mat.copy(barInAnchor).invert();
    if (hold.handle.inward) {
      // Turn the hand about the handle until its palm (as near as it can, square to the handle) faces inward.
      want.multiply(mat).decompose(scratchP, anchorQ, scratchS);
      palm.copy(PALM).applyQuaternion(anchorQ);
      palm.addScaledVector(axis, -palm.dot(axis));
      inward.fromArray(hold.handle.inward).applyQuaternion(handleQ);
      inward.addScaledVector(axis, -inward.dot(axis));
      if (palm.lengthSq() > 1e-8 && inward.lengthSq() > 1e-8) {
        palm.normalize(); inward.normalize();
        const angle = Math.atan2(cross.crossVectors(palm, inward).dot(axis), palm.dot(inward));
        roll.setFromAxisAngle(axis, angle);
        nq.premultiply(roll);
      }
      want.compose(p, nq, s);
    }
    // and the hand model where that puts it
    want.multiply(mat);
    mat.copy(anchor.parent.matrixWorld).invert().multiply(want);
    mat.decompose(anchor.position, anchor.quaternion, ps);
    anchor.updateMatrixWorld(true);
  }

  function release(state) {
    const hold = holds.get(state);
    if (!hold) return;
    restore(state);
    hold.bar.removeFromParent();
    hold.bar.geometry.dispose(); hold.bar.material.dispose();
    clearHeldGripProfile(state);
    holds.delete(state);
  }

  return {
    grab, place, release, realSocket,
    holding: state => holds.has(state),
    handleOf: state => holds.get(state)?.handle ?? null,
    releaseAll() { for (const state of [...holds.keys()]) release(state); },
  };
}
