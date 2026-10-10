// A simulated rider for checking courses: follows the centre line from the start gate to the finish with simple steering, no tricks,
// and reports how it went. Used by the tests and by `npm run ride-check`. Not used by the game itself.

import { createBoardState, stepBoard, speedOf } from './board.js';
import { angleDelta, clamp } from './math.js';

export function rideCourse(course, { tuck = 0, brake = 0, limit = 600, dt = 1 / 72 } = {}) {
  const p = course.pointAt(course.startS);
  const st = createBoardState({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: 2 });
  const out = {
    finished: false, time: 0, maxSpeed: 0, maxOff: 0,
    airs: [], // { s, air, impact, heavy }: every landing after more than 0.3 s in the air
    bails: [], // { s, tilt }
    stalls: [], // { s }: places the rider sat below walking pace for more than 3 seconds (the run is too flat there)
    speeds: [], // [s, speed] every 10 m, for spotting slow stretches
    nonFinite: false,
  };
  let slowFor = 0, nextSample = 0;
  while (out.time < limit) {
    const loc = course.locate(st.x, st.z);
    if (loc.s >= course.finishS) { out.finished = true; break; }
    const aim = course.pointAt(Math.min(course.length, loc.s + 14));
    const want = Math.atan2(-(aim.x - st.x), -(aim.z - st.z));
    stepBoard(st, { steer: clamp(-angleDelta(st.yaw, want) * 2.5, -1, 1), tuck, brake }, course, dt);
    for (const e of st.events) {
      if (e.type === 'land' && e.air > 0.3) out.airs.push({ s: loc.s, air: e.air, impact: e.impact, heavy: Boolean(e.heavy) });
      if (e.type === 'bail') out.bails.push({ s: loc.s, tilt: e.tilt });
    }
    st.events.length = 0;
    if (![st.x, st.y, st.z, st.vx, st.vy, st.vz].every(Number.isFinite)) { out.nonFinite = true; break; }
    out.time += dt;
    const v = speedOf(st);
    out.maxSpeed = Math.max(out.maxSpeed, v);
    out.maxOff = Math.max(out.maxOff, loc.distance);
    if (loc.s >= nextSample) { out.speeds.push([Math.round(loc.s), v]); nextSample = loc.s + 10; }
    slowFor = v < 1.4 && st.grounded ? slowFor + dt : 0;
    if (slowFor > 3 && (!out.stalls.length || Math.abs(out.stalls[out.stalls.length - 1].s - loc.s) > 20)) out.stalls.push({ s: loc.s });
    if (slowFor > 20) break; // properly stuck
  }
  return out;
}
