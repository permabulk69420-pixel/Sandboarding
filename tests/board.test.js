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
    for (const e of st.events) { if (e.type === 'land' && e.air > 0.3) out.airs.push(e.air); if (e.type === 'bail') out.bails += 1; }
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
  assert.equal(r.airs.length, 2, `airs ${r.airs}`);
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
