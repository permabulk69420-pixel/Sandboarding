// The board: simple, readable riding physics on top of the course's height field. No three.js, so it is tested in node.
//
// On the ground, gravity pulls you down the slope, the board's edge grips sideways (turning your speed toward where the nose points, losing
// a little of it, like a carve), sand friction and air drag hold you back. Steering turns the nose, faster at low speed. If the ground falls
// away faster than you do (a kicker's lip, the crest of a roller at speed) you are in the air until you come down. Everything is per second
// and lives in BOARD so it is easy to tune.

import { clamp, mix, angleDelta } from './math.js';

export const BOARD = Object.freeze({
  gravity: 9.81,
  sandFriction: 0.07, // rolling friction coefficient on sand (snow would be ~0.03)
  airDrag: 0.0058, // per metre: deceleration = airDrag * speed^2 standing up
  tuckDrag: 0.0043, // crouched
  grip: 7.5, // per second: how quickly sideways slide is turned into the board's direction
  carveKeep: 0.86, // share of the sideways speed you keep (redirected forward) while carving
  turnSlow: 2.4, // radians per second of steering at walking pace
  turnFast: 1.15, // ... and at speed
  turnFastAt: 24, // metres per second where steering is at its slowest
  steerResponse: 9, // per second: how quickly the board follows the stick
  brakeFriction: 0.55, // extra friction at full brake (dragging the tail)
  brakeGripLoss: 0.6, // the board skids instead of carving while braking
  ollie: 4.3, // metres per second off the ground
  launchGap: 0.012, // metres above the sand before the ground counts as gone (a little give so tiny ripples don't hop you)
  airTurn: 2.8, // radians per second of spin in the air
  maxSpeed: 30,
  substep: 1 / 120,
  bailAngle: 1.15, // radians between the board's line and your travel on landing before it counts as a crash (about 66 degrees)
});

// state: { x, y, z, vx, vy, vz, yaw, steer, grounded, air, nx, ny, nz }
export function createBoardState({ x = 0, y = 0, z = 0, yaw = 0, speed = 0 } = {}) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return { x, y, z, vx: fx * speed, vy: 0, vz: fz * speed, yaw, steer: 0, grounded: true, air: 0, nx: 0, ny: 1, nz: 0, events: [] };
}

export const speedOf = st => Math.hypot(st.vx, st.vy, st.vz);

// input: { steer: -1..1 (positive = right), brake: 0..1, tuck: 0..1, ollie: bool (edge) }
// ground: { heightAt(x, z), normalAt(x, z, out) }
// Returns the state (mutated). `events` collects { type: 'launch' | 'land' | 'bail', ... } for sound and haptics; the caller clears it.
export function stepBoard(st, input, ground, dt) {
  const steps = Math.max(1, Math.ceil(dt / BOARD.substep));
  const h = dt / steps;
  let ollie = Boolean(input.ollie);
  for (let k = 0; k < steps; k += 1) { substep(st, input, ground, h, ollie); ollie = false; }
  return st;
}

const n = { x: 0, y: 1, z: 0 };

function substep(st, input, ground, dt, ollie) {
  const g = BOARD.gravity;
  const steerTarget = clamp(input.steer || 0, -1, 1);
  st.steer += (steerTarget - st.steer) * Math.min(1, BOARD.steerResponse * dt);
  const brake = clamp(input.brake || 0, 0, 1), tuck = clamp(input.tuck || 0, 0, 1);
  let speed = speedOf(st);

  if (st.grounded) {
    ground.normalAt(st.x, st.z, n);
    st.nx = n.x; st.ny = n.y; st.nz = n.z;
    // Steering turns the nose (right stick = right turn = yaw decreasing in three.js).
    const turnRate = mix(BOARD.turnSlow, BOARD.turnFast, clamp(speed / BOARD.turnFastAt, 0, 1));
    st.yaw -= st.steer * turnRate * dt;

    // Board axes on the slope: forward (nose) and side, both in the ground's plane.
    let fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw), fy = 0;
    const fd = fx * n.x + fz * n.z; fx -= n.x * fd; fy -= n.y * fd; fz -= n.z * fd;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const sx = fy * n.z - fz * n.y, sy = fz * n.x - fx * n.z, sz = fx * n.y - fy * n.x;

    // Full gravity: the ground only pushes back (below), so you leave it wherever it falls away faster than you do.
    const gn = -g * n.y; // gravity . normal
    st.vy -= g * dt;

    // Carving: sideways speed bleeds into the nose's direction.
    let vf = st.vx * fx + st.vy * fy + st.vz * fz;
    const vs = st.vx * sx + st.vy * sy + st.vz * sz;
    const grip = BOARD.grip * (1 - BOARD.brakeGripLoss * brake);
    const removed = vs * (1 - Math.exp(-grip * dt));
    const keep = BOARD.carveKeep * (1 - brake);
    const newVs = vs - removed;
    vf += Math.sign(vf || 1) * Math.abs(removed) * keep;
    st.vx = fx * vf + sx * newVs; st.vy = fy * vf + sy * newVs; st.vz = fz * vf + sz * newVs;

    // Friction and air drag against the direction of travel.
    speed = speedOf(st);
    if (speed > 1e-6) {
      const normalLoad = Math.max(0, -gn);
      const drag = (BOARD.sandFriction + BOARD.brakeFriction * brake) * normalLoad + mix(BOARD.airDrag, BOARD.tuckDrag, tuck) * speed * speed;
      const s2 = Math.max(0, speed - drag * dt);
      const scale = s2 / speed; st.vx *= scale; st.vy *= scale; st.vz *= scale;
    }

    if (ollie) {
      const pop = BOARD.ollie;
      st.vx += n.x * pop; st.vy += n.y * pop; st.vz += n.z * pop;
      st.grounded = false; st.air = 0; st.events.push({ type: 'launch', ollie: true, speed: speedOf(st) });
    }
  } else {
    st.vy -= g * dt;
    const s = speedOf(st);
    if (s > 1e-6) { const s2 = Math.max(0, s - BOARD.airDrag * s * s * dt); const k = s2 / s; st.vx *= k; st.vy *= k; st.vz *= k; }
    st.yaw -= st.steer * BOARD.airTurn * dt;
    st.air += dt;
  }

  // Never faster than the cap.
  speed = speedOf(st);
  if (speed > BOARD.maxSpeed) { const k = BOARD.maxSpeed / speed; st.vx *= k; st.vy *= k; st.vz *= k; }

  st.x += st.vx * dt; st.y += st.vy * dt; st.z += st.vz * dt;
  const ground_y = ground.heightAt(st.x, st.z);

  if (st.grounded) {
    if (st.y - ground_y > BOARD.launchGap) {
      st.grounded = false; st.air = 0; st.events.push({ type: 'launch', ollie: false, speed: speedOf(st) });
    } else {
      st.y = ground_y;
      // The ground pushes back: drop any speed into it (never pulls you down onto it).
      ground.normalAt(st.x, st.z, n);
      const vn = st.vx * n.x + st.vy * n.y + st.vz * n.z;
      if (vn < 0) { st.vx -= n.x * vn; st.vy -= n.y * vn; st.vz -= n.z * vn; }
    }
  } else if (st.y <= ground_y) {
    st.y = ground_y;
    ground.normalAt(st.x, st.z, n);
    const vn = st.vx * n.x + st.vy * n.y + st.vz * n.z;
    const impact = Math.max(0, -vn);
    st.vx -= n.x * vn; st.vy -= n.y * vn; st.vz -= n.z * vn;
    st.grounded = true;
    // Landing crosswise: the board can't carve that, you bail and lose most of your speed. Landing backwards (switch) is fine.
    const off = Math.abs(angleDelta(st.yaw, Math.atan2(-st.vx, -st.vz)));
    const crosswise = Math.min(off, Math.PI - off);
    if (crosswise > BOARD.bailAngle && speedOf(st) > 3) {
      st.vx *= 0.25; st.vy *= 0.25; st.vz *= 0.25;
      st.events.push({ type: 'bail', impact, air: st.air });
    } else {
      st.events.push({ type: 'land', impact, air: st.air });
    }
    st.air = 0;
  }
}
