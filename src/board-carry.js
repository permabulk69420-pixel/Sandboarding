import * as THREE from 'three';
import { pulseHaptics } from './haptics.js';

// The board when you are not racing. It lies on the ground until you pick it up: squeeze a grip with your hand right on it and it stays
// in your hand wherever you took hold, so you can carry it (out of the cabin, up to the gate). Let go low and near your feet and it snaps
// flat under them (mounted); let go anywhere else and it drops. On foot, A near a board on the ground hops on, and B hops off.
// Racing never touches this: drop-in and the physics take the board over, and placeOnSummit puts it back on the ground.

export const CARRY = Object.freeze({
  pickup: 0.12, // metres: how close your hand has to be to the board itself
  halfSize: Object.freeze({ x: 0.16, y: 0.05, z: 0.8 }), // the board's rough box, in its own space (half the width, thickness and length)
  mountRadius: 0.7, // let go within this of your feet (sideways), and...
  mountHeight: 0.65, // ...no higher than this above the ground, to land on it
  hopOn: 1.3, // A hops on a board on the ground this close
  squeezeOn: 0.6, squeezeOff: 0.35,
});

export function createBoardCarry({ scene, hands, boardMesh, groundAt }) {
  let state = 'ground'; // 'ground' | 'carried' | 'mounted'
  let holder = null, vy = 0, falling = false;
  const local = new THREE.Vector3(), hand = new THREE.Vector3(), inv = new THREE.Matrix4();
  const level = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), up = new THREE.Vector3(0, 1, 0);

  const squeezeOf = h => h.inputSource?.gamepad?.buttons?.[1]?.value ?? 0;
  const yawOf = () => euler.setFromQuaternion(boardMesh.quaternion, 'YXZ').y;
  const restHeight = (x, z) => groundAt(x, z) + 0.03;

  // How far a point (world) is from the board's box.
  function distanceToBoard(point) {
    boardMesh.updateMatrixWorld(true);
    local.copy(point).applyMatrix4(inv.copy(boardMesh.matrixWorld).invert());
    const h = CARRY.halfSize;
    return Math.hypot(Math.max(Math.abs(local.x) - h.x, 0), Math.max(Math.abs(local.y) - h.y, 0), Math.max(Math.abs(local.z) - h.z, 0));
  }

  function release() {
    if (holder) { scene.attach(boardMesh); holder = null; }
  }

  function drop() { falling = true; vy = 0; }

  function mountUnder(head, yaw) {
    release(); state = 'mounted'; falling = false;
    boardMesh.position.set(head.x, restHeight(head.x, head.z), head.z);
    boardMesh.quaternion.setFromAxisAngle(up, yaw);
  }

  return {
    CARRY,
    get state() { return state; },
    // Back to lying on the ground (the caller puts it where it belongs).
    reset() { release(); state = 'ground'; falling = false; },
    canHopOn(head) { return state === 'ground' && Math.hypot(boardMesh.position.x - head.x, boardMesh.position.z - head.z) < CARRY.hopOn; },
    hopOn(head, yaw) { mountUnder(head, yaw); },
    hopOff() { if (state === 'mounted') { state = 'ground'; boardMesh.position.y += 0.15; drop(); } },
    // head: world position of your head; yaw: the way you face. Call each frame while on foot.
    update(dt, head, yaw) {
      if (state === 'mounted') {
        boardMesh.position.set(head.x, restHeight(head.x, head.z), head.z);
        boardMesh.quaternion.setFromAxisAngle(up, yaw);
      }
      for (const h of hands.states) {
        const sq = squeezeOf(h), on = sq > CARRY.squeezeOn, wasOn = h.carryWasSqueezed;
        h.carryWasSqueezed = on;
        const node = h.gripSocket || h.objectGrip;
        if (state === 'carried' && holder === h) {
          if (sq < CARRY.squeezeOff) {
            // Let go: low and over your feet it goes under them, otherwise it falls.
            boardMesh.getWorldPosition(hand);
            const over = Math.hypot(hand.x - head.x, hand.z - head.z) < CARRY.mountRadius && hand.y - groundAt(hand.x, hand.z) < CARRY.mountHeight;
            release();
            if (over) { mountUnder(head, yaw); pulseHaptics(h, 0.4, 60); } else { state = 'ground'; drop(); }
          }
        } else if (on && !wasOn && state !== 'carried') {
          node.updateWorldMatrix(true, false); node.getWorldPosition(hand);
          if (distanceToBoard(hand) < CARRY.pickup) {
            falling = false; state = 'carried'; holder = h;
            h.objectGrip.attach(boardMesh); // keeps the board exactly where it was, in the hand where you took hold of it
            pulseHaptics(h, 0.5, 45);
          }
        }
      }
      if (state === 'ground' && falling) {
        vy -= 9.8 * dt;
        const p = boardMesh.position, floor = restHeight(p.x, p.z);
        p.y += vy * dt;
        level.setFromAxisAngle(up, yawOf());
        boardMesh.quaternion.slerp(level, Math.min(1, dt * 8));
        if (p.y <= floor) { p.y = floor; falling = false; vy = 0; boardMesh.quaternion.copy(level); }
      }
    },
  };
}
