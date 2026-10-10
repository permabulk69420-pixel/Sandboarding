import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourse } from '../src/course.js';
import { createBoardState, stepBoard, speedOf, BOARD } from '../src/board.js';
import { angleDelta, clamp } from '../src/math.js';

const course = createCourse();

function ride({ tuck = 0, brake = 0, limit = 200 } = {}) {
  const p = course.pointAt(course.startS);
  const st = createBoardState({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: 2 });
  const out = { time: 0, maxSpeed: 0, airs: [], bails: 0, maxOff: 0, finished: false };
  while (out.time < limit) {
    const loc = course.locate(st.x, st.z);
    if (loc.s >= course.finishS) { out.finished = true; break; }
    const aim = course.pointAt(Math.min(course.length, loc.s + 14));
    const want = Math.atan2(-(aim.x - st.x), -(aim.z - st.z));
    stepBoard(st, { steer: clamp(-angleDelta(st.yaw, want) * 2.5, -1, 1), tuck, brake }, course, 1 / 72);
    for (const e of st.events) { if (e.type === 'land' && e.air > 0.3) out.airs.push(loc.s); if (e.type === 'bail') out.bails += 1; }
    st.events.length = 0;
    assert.ok([st.x, st.y, st.z, st.vx, st.vy, st.vz].every(Number.isFinite));
    out.time += 1 / 72;
    out.maxSpeed = Math.max(out.maxSpeed, speedOf(st));
    out.maxOff = Math.max(out.maxOff, loc.distance);
  }
  return out;
}

test('a clean run reaches the finish in about a minute, with air off both kickers', () => {
  const r = ride();
  assert.ok(r.finished, 'finished');
  assert.ok(r.time > 45 && r.time < 95, `time ${r.time}`);
  for (const k of course.kickers) assert.ok(r.airs.some(s => s > k && s < k + 40), `no air off the kicker at ${k.toFixed(0)} (landed at ${r.airs.map(Math.round)})`);
  assert.equal(r.bails, 0);
  assert.ok(r.maxOff < 4, `strayed ${r.maxOff}`);
});

test('tucking is faster but stays under the speed cap', () => {
  const stand = ride(), tuck = ride({ tuck: 1 });
  assert.ok(tuck.time < stand.time - 5, `tuck ${tuck.time} vs ${stand.time}`);
  assert.ok(tuck.maxSpeed <= BOARD.maxSpeed + 1e-6);
  assert.ok(tuck.maxSpeed < 28, `top speed ${tuck.maxSpeed}`);
});

test('braking slows you right down', () => {
  const r = ride({ brake: 1, limit: 30 });
  assert.ok(r.maxSpeed < 10, `braking top speed ${r.maxSpeed}`);
});

test('an ollie lifts you off flat ground and you land again', () => {
  const ground = { heightAt: () => 0, normalAt: (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; } };
  const st = createBoardState({ speed: 5 });
  stepBoard(st, { ollie: true }, ground, 1 / 72);
  assert.equal(st.grounded, false);
  let t = 0;
  while (!st.grounded && t < 3) { stepBoard(st, {}, ground, 1 / 72); t += 1 / 72; }
  assert.ok(st.grounded && t > 0.6 && t < 1.1, `air ${t}`);
  assert.ok(st.events.some(e => e.type === 'land'));
});

test('landing crosswise is a bail and costs most of your speed', () => {
  const ground = { heightAt: () => 0, normalAt: (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; } };
  const st = createBoardState({ speed: 12 });
  st.y = 1; st.grounded = false; st.yaw = Math.PI / 2; // nose pointing across the travel
  while (!st.grounded) stepBoard(st, {}, ground, 1 / 72);
  assert.ok(st.events.some(e => e.type === 'bail'));
  assert.ok(speedOf(st) < 5);
});

// Total energy (speed plus height) per kilogram. Nothing in the physics may ever add to it; only going downhill turns height into speed.
const energy = st => 0.5 * speedOf(st) ** 2 + BOARD.gravity * st.y;

test('the board never gains energy, however you steer', () => {
  for (const seed of [1, 2, 3]) {
    const p = course.pointAt(course.startS + 60 * seed);
    const st = createBoardState({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: 10 });
    let e0 = energy(st), worst = 0, t = 0, steer = 0, r = seed;
    while (t < 40) {
      r = (r * 16807) % 2147483647;
      if (r % 50 === 0) steer = (r % 3) - 1; // hold full left, straight or full right for a while
      stepBoard(st, { steer, brake: (r % 7 === 0) ? 1 : 0 }, course, 1 / 72);
      if (st.grounded) { const e = energy(st); worst = Math.max(worst, e - e0); e0 = Math.min(e0, e); }
      st.events.length = 0; t += 1 / 72;
    }
    assert.ok(worst < 1, `gained ${worst.toFixed(3)} J/kg (seed ${seed})`); // 1 J/kg is 10 cm of height: rounding from snapping onto curved ground; the old bug made 100+ m
  }
});

test('turning up the hill slows you down; you never climb higher than your speed allows', () => {
  const p = course.pointAt(300);
  const v0 = 14;
  const st = createBoardState({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: v0 });
  const limit = p.y + v0 * v0 / (2 * BOARD.gravity);
  let top = -Infinity;
  for (let t = 0; t < 12; t += 1 / 72) {
    stepBoard(st, { steer: 1 }, course, 1 / 72); st.events.length = 0;
    top = Math.max(top, st.y);
  }
  assert.ok(top < limit, `climbed to ${top.toFixed(2)}, limit ${limit.toFixed(2)}`);
});

test('standing across the slope with no speed, the edge holds you still', () => {
  const p = course.pointAt(250);
  const n = course.normalAt(p.x, p.z); // board across the fall line (the fall line is where the ground's normal leans)
  const st = createBoardState({ x: p.x, y: p.y, z: p.z, yaw: Math.atan2(n.z, -n.x), speed: 0 });
  for (let t = 0; t < 3; t += 1 / 72) { stepBoard(st, {}, course, 1 / 72); st.events.length = 0; }
  assert.ok(speedOf(st) < 0.5, `slid at ${speedOf(st).toFixed(2)} m/s`);
});
