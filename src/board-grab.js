import * as THREE from 'three';
import { createHandleHold } from './handle-hold.js';
import { pulseHaptics } from './haptics.js';

// Grabbing the board in the air. Squeeze a grip button with your hand anywhere near the board and the board comes up to meet it (as if
// you'd tucked your knees), then your hand closes on the nearest edge: the nose, the tail, or either side between the bindings. Which hand
// on which part names the grab. You can spin and flip while holding; let go before you land (still holding when you touch down lets go
// for you, at a small cost: main.js). The physics never changes; the board and hands only move for the eye.
//
// The hand itself is fitted onto the edge by the Oasis handle hold (src/handle-hold.js): the edge is a very thin handle, and the palm is
// turned to face the middle of the deck.

export const GRAB = Object.freeze({
  squeezeOn: 0.6, // grip button travel that starts a grab...
  squeezeOff: 0.35, // ...and that ends one (a little lower, so it doesn't flicker)
  maxLift: 0.45, // metres the board can come up toward your hand (a tuck of the knees, not a yank across the room)
  reach: 0.15, // and how far your hand can still be from the edge after that: so your hand has to be within 0.6 m of the part you grab
  follow: 16, // per second: how quickly the board comes up (and settles back when you let go)
  between: 0.17, // side grabs sit between the bindings, within this of the middle
  plate: Object.freeze({ thickness: 0.016, width: 0.1 }), // the edge is held as a plate this thick (the deck), the fingers on one face
});

const names = {
  nose: () => 'Nose grab', tail: () => 'Tail grab',
  right: hand => (hand === 'right' ? 'Indy' : 'Stalefish'),
  left: hand => (hand === 'left' ? 'Melon' : 'Mute'),
};

// The board's outline from its deck mesh, in the board's own space (nose toward -z, right toward +x, up +y).
function outline(boardMesh) {
  let deck = null;
  boardMesh.traverse(o => { if (o.isMesh && !deck && /deck/i.test(o.name + (o.parent?.name || ''))) deck = o; });
  if (!deck) boardMesh.traverse(o => { if (o.isMesh && !deck) deck = o; });
  if (!deck) return null;
  boardMesh.updateMatrixWorld(true);
  const toBoard = new THREE.Matrix4().copy(boardMesh.matrixWorld).invert().multiply(deck.matrixWorld);
  const pos = deck.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
  for (let i = 0; i < pos.count; i += 1) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(toBoard).clone());
  return {
    // the side edge at z: its outermost point that way, halfway up the deck's thickness there
    side(sign, z) {
      const near = pts.filter(p => Math.abs(p.z - z) < 0.015);
      if (!near.length) return new THREE.Vector3(sign * 0.15, 0.03, z);
      const out = Math.max(...near.map(p => p.x * sign)), rim = near.filter(p => p.x * sign > out - 0.006);
      return new THREE.Vector3(sign * out, (Math.min(...rim.map(p => p.y)) + Math.max(...rim.map(p => p.y))) / 2, z);
    },
    // the very tip at x (sign -1: the nose, +1: the tail), halfway up its thickness
    tip(sign, x) {
      const near = pts.filter(p => Math.abs(p.x - x) < 0.02);
      if (!near.length) return new THREE.Vector3(x, 0.05, sign * 0.78);
      const out = Math.max(...near.map(p => p.z * sign)), rim = near.filter(p => p.z * sign > out - 0.006);
      return new THREE.Vector3(x, (Math.min(...rim.map(p => p.y)) + Math.max(...rim.map(p => p.y))) / 2, sign * out);
    },
  };
}

export function createBoardGrab({ hands, boardMesh }) {
  const hold = createHandleHold();
  const grabs = new Map(); // hand state -> { part, name, marker, time }
  const offset = new THREE.Vector3(), want = new THREE.Vector3(), socket = new THREE.Vector3(), mark = new THREE.Vector3(), local = new THREE.Vector3();
  const toBoard = new THREE.Matrix4();
  let shape = null;
  const log = []; // finished grabs this jump: { name, time } (for points, later)

  const squeezeOf = state => state.inputSource?.gamepad?.buttons?.[1]?.value ?? 0;

  function start(state) {
    shape ||= outline(boardMesh);
    if (!shape || !state.handAnchor) return false;
    hold.realSocket(state, socket);
    boardMesh.updateMatrixWorld(true);
    local.copy(socket).applyMatrix4(toBoard.copy(boardMesh.matrixWorld).invert());
    // Grab whichever part your hand is actually closest to: the nose, the tail, or the side edge level with your hand (between the bindings).
    const cx = THREE.MathUtils.clamp(local.x, -0.07, 0.07), cz = THREE.MathUtils.clamp(local.z, -GRAB.between, GRAB.between);
    const options = [
      { part: 'nose', point: shape.tip(-1, cx), axis: [1, 0, 0], inward: [0, 0, 1] },
      { part: 'tail', point: shape.tip(1, cx), axis: [1, 0, 0], inward: [0, 0, -1] },
      { part: 'right', point: shape.side(1, cz), axis: [0, 0, 1], inward: [-1, 0, 0] },
      { part: 'left', point: shape.side(-1, cz), axis: [0, 0, 1], inward: [1, 0, 0] },
    ];
    let best = options[0], bestD = Infinity;
    for (const o of options) { const d = o.point.distanceTo(local); if (d < bestD) { bestD = d; best = o; } }
    const { part, point, axis, inward } = best;
    const marker = new THREE.Object3D();
    marker.name = `Grab ${part}`;
    marker.position.copy(point);
    boardMesh.add(marker);
    marker.updateMatrixWorld(true);
    marker.getWorldPosition(mark);
    if (mark.distanceTo(socket) > GRAB.maxLift + GRAB.reach) { marker.removeFromParent(); return false; }
    if (!hold.grab(state, { node: marker, axis, halfLength: 0, plate: GRAB.plate, inward, wristSide: [0, 1, 0] })) { marker.removeFromParent(); return false; }
    grabs.set(state, { part, name: names[part](state.handedness), marker, time: 0, inward });
    pulseHaptics(state, 0.5, 45);
    return true;
  }

  function stop(state) {
    const g = grabs.get(state);
    if (!g) return;
    hold.release(state);
    g.marker.removeFromParent();
    grabs.delete(state);
    if (g.time > 0.1) log.push({ name: g.name, time: g.time });
  }

  return {
    GRAB,
    log,
    holding: () => grabs.size > 0,
    names: () => [...grabs.values()].map(g => g.name),
    // After main.js has put the board where the physics says. `air`: in the air and riding (grabs only start then).
    update(dt, air) {
      for (const state of hands.states) {
        const sq = squeezeOf(state), g = grabs.get(state);
        if (g && (!air || sq < GRAB.squeezeOff)) stop(state);
        else if (!g && air && sq > GRAB.squeezeOn && !state.wasSqueezed) start(state);
        state.wasSqueezed = sq > GRAB.squeezeOn;
      }
      // Bring the board up so the grabbed edges meet the hands (the average, with both), no further than it can come.
      want.set(0, 0, 0);
      if (grabs.size) {
        boardMesh.updateMatrixWorld(true);
        for (const [state, g] of grabs) {
          g.time += dt;
          hold.realSocket(state, socket);
          g.marker.getWorldPosition(mark);
          want.add(socket.sub(mark));
        }
        want.divideScalar(grabs.size).clampLength(0, GRAB.maxLift);
      }
      offset.lerp(want, Math.min(1, GRAB.follow * dt));
      if (offset.lengthSq() > 1e-8) { boardMesh.position.add(offset); boardMesh.updateMatrixWorld(true); }
    },
    // After the hands have posed: fit each holding hand onto its edge.
    place() { for (const state of grabs.keys()) hold.place(state); },
    releaseAll() { for (const state of [...grabs.keys()]) stop(state); },
    clearLog() { log.length = 0; },
    // dev: each grab with the inward direction it asked for, in the world
    debug() {
      const m = new Map(), q = new THREE.Quaternion();
      for (const [state, g] of grabs) { g.marker.getWorldQuaternion(q); m.set(state, { name: g.name, inwardWorld: new THREE.Vector3().fromArray(g.inward).applyQuaternion(q) }); }
      return m;
    },
  };
}
