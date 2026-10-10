// The board: simple, readable riding physics on top of the course's height field. No three.js, so it is tested in node.
//
// On the ground, gravity pulls you down the slope, sand friction and air drag hold you back, and the board's edge grips sideways with a
// limited force (like real friction). While the board points roughly where you're going, that grip carves: it turns your speed toward
// the nose. When the board is well across your travel, or you brake, it skids and scrubs speed off instead. The edge can only redirect or
// remove speed, never add it, so the only thing that ever speeds you up is going downhill.
//
// Steering is an edge, not a wheel: the stick sets how far the board is tipped on its edge, and it takes a moment to roll over (and longer
// to roll from one edge right across to the other, through a flat moment where it grips less). The tip turns the nose. Ask for more turn
// than the sand can hold at your speed and the nose comes round faster than your travel: the board goes crosswise, skids and scrubs speed.
// So smooth, early turns carve and keep your speed; yanking the stick at full speed is a skid (which is also how you check your speed).
// The old, direct steering is still here as the "classic" feel (useFeel('classic'), or ?feel=classic in the game).
// If the ground falls away faster than you do (a kicker's lip, the crest of a roller at speed) you are in the air until you come down.
// Everything is per second and lives in BOARD so it is easy to tune.

import { clamp, mix, smooth, angleDelta } from './math.js';

export const BOARD = Object.freeze({
  gravity: 9.81,
  sandFriction: 0.026, // rolling friction coefficient on sand (snow would be ~0.03)
  airDrag: 0.003, // per metre: deceleration = airDrag * speed^2 standing up
  tuckDrag: 0.0021, // crouched
  edgeGrip: 1.6, // how hard the edge can hold sideways, as a friction coefficient (times your weight on the board)
  carveKeep: 0.94, // share of the speed the edge turns that survives a clean carve (the rest is lost to the sand)
  carveFrom: 0.55, // cosine of the angle between board and travel: below this the board skids...
  carveTo: 0.85, // ...above this it carves cleanly (blended between)
  turnSlow: 2.4, // radians per second of steering at walking pace
  turnFast: 0.95, // ... and at speed
  turnFastAt: 24, // metres per second where steering is at its slowest
  steerResponse: 9, // per second: how quickly the stick's reading is smoothed (spins in the air use it directly)
  edgeRate: 4.2, // per second: how fast the board rolls onto its edge (full tip in about a quarter second, edge to edge in half)
  flatGrip: 0.5, // share of the edge's grip while the board is flat, rolling from one edge to the other...
  edgeFull: 0.35, // ...back to full grip by this much tip
  skidScrub: 0.8, // extra friction (times your weight) while the board is skidding: a hard skid is a real speed check
  skidFrom: 0.985, // cosine of the angle between board and travel where the skid starts to scrub (about 10 degrees)...
  skidTo: 0.87, // ...and where it scrubs fully (about 30 degrees)
  brakeFriction: 0.55, // extra friction at full brake (dragging the tail)
  brakeGripLoss: 0.5, // the edge holds less (you skid) while braking
  ollie: 4.3, // metres per second off the ground for a normal pop
  ollieTap: 0.55, // a quick tap of the button pops this share of it...
  ollieFull: 1.35, // ...a full charge this share
  launchGap: 0.012, // metres above the sand before the ground counts as gone (a little give so tiny ripples don't hop you)
  airTurn: 2.8, // radians per second of spin in the air
  maxSpeed: 45,
  substep: 1 / 120,
  bailAngle: 1.15, // radians between the board's line and your travel on landing before it counts as a crash (about 66 degrees)
  flipRate: 5.6, // radians per second of tilt (flip) in the air at full stick: a full flip in a little over a second
  flipResponse: 7, // per second: how quickly the tilt follows the stick
  settle: 6, // per second: with the stick centred, how quickly the board lines up with the ground below you
  landClean: 0.52, // radians (30 degrees) between the board and the ground on landing that still counts as clean...
  landBail: 0.96, // ...and beyond this (55 degrees) you bail; in between is a heavy landing
  heavyKeep: 0.72, // share of your speed a heavy landing keeps
});

// The original feel: the stick turns the nose directly, grips fully at once, and a skid costs only the speed it turns away.
export const CLASSIC = Object.freeze({ ...BOARD, turnFast: 1.15, edgeRate: 0, flatGrip: 1, skidScrub: 0 });
let FEEL = BOARD;
export function useFeel(name) { FEEL = name === 'classic' ? CLASSIC : BOARD; return FEEL; }

// state: { x, y, z, vx, vy, vz, yaw, steer, grounded, air, nx, ny, nz }
export function createBoardState({ x = 0, y = 0, z = 0, yaw = 0, speed = 0 } = {}) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return {
    x, y, z, vx: fx * speed, vy: 0, vz: fz * speed, yaw, steer: 0, edge: 0, grounded: true, air: 0, nx: 0, ny: 1, nz: 0, events: [],
    pitch: 0, pitchVel: 0, upx: 0, upy: 1, upz: 0, yaw0: yaw, // in the air: tilt from the ground's angle below, and the yaw you left at
  };
}

export const speedOf = st => Math.hypot(st.vx, st.vy, st.vz);

// input: { steer: -1..1 (positive = right), brake: 0..1, tuck: 0..1, ollie: false, or the jump's charge 0..1 on the frame you release it,
//   pitch: -1..1 in the air (positive = nose up, toward a backflip) }
// ground: { heightAt(x, z), normalAt(x, z, out) }
// Returns the state (mutated). `events` collects { type: 'launch' | 'land' | 'bail', ... } for sound and haptics; the caller clears it.
export function stepBoard(st, input, ground, dt) {
  const steps = Math.max(1, Math.ceil(dt / BOARD.substep));
  const h = dt / steps;
  let ollie = input.ollie === true ? 0.6 : (typeof input.ollie === 'number' ? clamp(input.ollie, 0, 1) : false);
  for (let k = 0; k < steps; k += 1) { substep(st, input, ground, h, ollie); ollie = false; }
  return st;
}

// Steering from leaning: how far your head has moved sideways over the board (metres, positive = right) to -1..1, with a small dead zone
// so standing naturally doesn't steer.
export const LEAN = Object.freeze({ dead: 0.035, full: 0.2 });
export function leanSteer(offset) {
  const a = Math.abs(offset);
  if (a <= LEAN.dead) return 0;
  return Math.sign(offset) * Math.min(1, (a - LEAN.dead) / (LEAN.full - LEAN.dead));
}


const n = { x: 0, y: 1, z: 0 };

function takeOff(st, ollie) {
  st.grounded = false; st.air = 0; st.pitch = 0; st.pitchVel = 0; st.yaw0 = st.yaw;
  st.upx = st.nx; st.upy = st.ny; st.upz = st.nz;
  st.events.push({ type: 'launch', ollie, speed: speedOf(st) });
}

// Which way the board faces: { f: forward (nose), u: up }. On the ground it lies on the sand. In the air it starts from the ground's angle
// below you (so with the stick centred you land square) and is tilted by your flip about its own side axis.
export function boardAttitude(st, out = { f: { x: 0, y: 0, z: -1 }, u: { x: 0, y: 1, z: 0 } }) {
  const ux = st.grounded ? st.nx : st.upx, uy = st.grounded ? st.ny : st.upy, uz = st.grounded ? st.nz : st.upz;
  let fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw), fy = 0;
  const d = fx * ux + fz * uz; fx -= ux * d; fy -= uy * d; fz -= uz * d;
  const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
  const p = st.grounded ? 0 : st.pitch, c = Math.cos(p), s = Math.sin(p);
  out.f.x = fx * c + ux * s; out.f.y = fy * c + uy * s; out.f.z = fz * c + uz * s;
  out.u.x = ux * c - fx * s; out.u.y = uy * c - fy * s; out.u.z = uz * c - fz * s;
  return out;
}
const att = { f: { x: 0, y: 0, z: -1 }, u: { x: 0, y: 1, z: 0 } };

function substep(st, input, ground, dt, ollie) {
  const B = FEEL;
  const g = BOARD.gravity;
  const steerTarget = clamp(input.steer || 0, -1, 1);
  st.steer += (steerTarget - st.steer) * Math.min(1, BOARD.steerResponse * dt);
  // The edge rolls toward where the stick asks, at a limited rate.
  if (B.edgeRate) st.edge += clamp(steerTarget - st.edge, -B.edgeRate * dt, B.edgeRate * dt); else st.edge = st.steer;
  const brake = clamp(input.brake || 0, 0, 1), tuck = clamp(input.tuck || 0, 0, 1);
  let speed = speedOf(st);

  if (st.grounded) {
    ground.normalAt(st.x, st.z, n);
    st.nx = n.x; st.ny = n.y; st.nz = n.z;
    // Steering turns the nose (right stick = right turn = yaw decreasing in three.js).
    const turnRate = mix(B.turnSlow, B.turnFast, clamp(speed / B.turnFastAt, 0, 1));
    st.yaw -= st.edge * turnRate * dt;

    // Board axes on the slope: forward (nose) and side, both in the ground's plane.
    let fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw), fy = 0;
    const fd = fx * n.x + fz * n.z; fx -= n.x * fd; fy -= n.y * fd; fz -= n.z * fd;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const sx = fy * n.z - fz * n.y, sy = fz * n.x - fx * n.z, sz = fx * n.y - fy * n.x;

    // Gravity along the slope only: the ground cancels the part pushing into it. You still leave the ground wherever it falls away faster
    // than you're travelling along it (a kicker's lip, a crest at speed), because you keep going straight while it curves away.
    const gn = -g * n.y; // gravity . normal
    st.vx -= n.x * gn * dt; st.vy += (-g - n.y * gn) * dt; st.vz -= n.z * gn * dt;

    // The edge: friction across the board, up to what the sand can hold under your weight.
    let vf = st.vx * fx + st.vy * fy + st.vz * fz;
    const vs = st.vx * sx + st.vy * sy + st.vz * sz;
    const vn = st.vx * n.x + st.vy * n.y + st.vz * n.z;
    const tip = B.flatGrip + (1 - B.flatGrip) * smooth(0, B.edgeFull, Math.abs(st.edge)); // a flat board grips less
    const hold = B.edgeGrip * tip * (1 - B.brakeGripLoss * brake) * Math.max(0, -gn) * dt;
    const newVs = Math.abs(vs) <= hold ? 0 : vs - Math.sign(vs) * hold;
    // Carving: when the board points roughly along your travel, the sideways speed the edge takes away is turned into the nose's direction
    // (minus a little). The new speed is never more than the old. Riding backwards (switch) carves the same way.
    const along = Math.abs(vf) / (Math.hypot(vf, vs) || 1);
    const carve = smooth(B.carveFrom, B.carveTo, along) * B.carveKeep * (1 - brake);
    const skidding = speed > 2 ? 1 - smooth(B.skidTo, B.skidFrom, along) : 0; // 0 carving cleanly, 1 well crosswise
    vf = Math.sign(vf) * Math.sqrt(vf * vf + (vs * vs - newVs * newVs) * carve);
    st.vx = fx * vf + sx * newVs + n.x * vn; st.vy = fy * vf + sy * newVs + n.y * vn; st.vz = fz * vf + sz * newVs + n.z * vn;

    // Friction and air drag against the direction of travel.
    speed = speedOf(st);
    if (speed > 1e-6) {
      const normalLoad = Math.max(0, -gn);
      const drag = (BOARD.sandFriction + BOARD.brakeFriction * brake + B.skidScrub * skidding) * normalLoad + mix(BOARD.airDrag, BOARD.tuckDrag, tuck) * speed * speed;
      const s2 = Math.max(0, speed - drag * dt);
      const scale = s2 / speed; st.vx *= scale; st.vy *= scale; st.vz *= scale;
    }

    if (ollie !== false) {
      const pop = BOARD.ollie * mix(BOARD.ollieTap, BOARD.ollieFull, ollie);
      st.vx += n.x * pop; st.vy += n.y * pop; st.vz += n.z * pop;
      takeOff(st, true);
    }
  } else {
    st.vy -= g * dt;
    const s = speedOf(st);
    if (s > 1e-6) { const s2 = Math.max(0, s - BOARD.airDrag * s * s * dt); const k = s2 / s; st.vx *= k; st.vy *= k; st.vz *= k; }
    st.yaw -= st.steer * BOARD.airTurn * dt;
    // Flip: the stick tilts the board about its side axis. The starting angle drifts toward the ground below so a plain jump lands square.
    const target = clamp(input.pitch || 0, -1, 1) * BOARD.flipRate;
    st.pitchVel += (target - st.pitchVel) * Math.min(1, BOARD.flipResponse * dt);
    st.pitch += st.pitchVel * dt;
    ground.normalAt(st.x, st.z, n);
    const k = Math.min(1, BOARD.settle * dt);
    st.upx += (n.x - st.upx) * k; st.upy += (n.y - st.upy) * k; st.upz += (n.z - st.upz) * k;
    const ul = Math.hypot(st.upx, st.upy, st.upz) || 1; st.upx /= ul; st.upy /= ul; st.upz /= ul;
    st.air += dt;
  }

  // Never faster than the cap.
  speed = speedOf(st);
  if (speed > BOARD.maxSpeed) { const k = BOARD.maxSpeed / speed; st.vx *= k; st.vy *= k; st.vz *= k; }

  st.x += st.vx * dt; st.y += st.vy * dt; st.z += st.vz * dt;
  const ground_y = ground.heightAt(st.x, st.z);

  if (st.grounded) {
    if (st.y - ground_y > BOARD.launchGap) {
      takeOff(st, false);
    } else {
      // Lifted onto the ground where it curves up under you (a dip, a compression): that climb is paid for out of your speed, so the
      // snap can never add energy (with the edge letting you slide across the dish more, it otherwise could, a little).
      const rise = ground_y - st.y;
      if (rise > 0) {
        const v = speedOf(st), v2 = Math.max(0, v * v - 2 * g * rise), k = v > 1e-6 ? Math.sqrt(v2) / v : 0;
        st.vx *= k; st.vy *= k; st.vz *= k;
      }
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
    // How the landing went: the board's angle to the ground (flips), and its line against your travel (crosswise can't carve).
    boardAttitude(st, att);
    const tilt = Math.acos(clamp(att.u.x * n.x + att.u.y * n.y + att.u.z * n.z, -1, 1));
    const off = Math.abs(angleDelta(st.yaw, Math.atan2(-st.vx, -st.vz)));
    const crosswise = Math.min(off, Math.PI - off);
    const trick = {
      flips: Math.round(st.pitch / (Math.PI * 2)), // + backflips, - frontflips
      spin: Math.round((st.yaw - st.yaw0) / Math.PI) * 180, // degrees, + to the left
    };
    st.grounded = true; st.nx = n.x; st.ny = n.y; st.nz = n.z; st.pitch = 0; st.pitchVel = 0;
    const fast = speedOf(st) > 3;
    if (fast && (tilt > BOARD.landBail || crosswise > BOARD.bailAngle)) {
      st.vx *= 0.25; st.vy *= 0.25; st.vz *= 0.25;
      st.events.push({ type: 'bail', impact, air: st.air, tilt, ...trick });
    } else {
      const heavy = tilt > BOARD.landClean;
      if (heavy) { st.vx *= BOARD.heavyKeep; st.vy *= BOARD.heavyKeep; st.vz *= BOARD.heavyKeep; }
      st.events.push({ type: 'land', impact, air: st.air, tilt, heavy, ...trick });
    }
    st.air = 0;
  }
}
