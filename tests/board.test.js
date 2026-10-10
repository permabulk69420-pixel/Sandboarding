import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourse } from '../src/course.js';
import { createBoardState, stepBoard, speedOf, BOARD, perfectBalance, perfectLanding, grindName } from '../src/board.js';
import { angleDelta, clamp } from '../src/math.js';

const course = createCourse();

test('braking slows you right down', async () => {
  const { rideCourse } = await import('../src/ride-sim.js');
  const r = rideCourse(course, { brake: 1, limit: 30 });
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

test('a charged jump goes higher than a tap', () => {
  const ground = { heightAt: () => 0, normalAt: (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; } };
  const peak = charge => {
    const st = createBoardState({ speed: 5 });
    stepBoard(st, { ollie: charge }, ground, 1 / 72);
    let top = 0; while (!st.grounded) { stepBoard(st, {}, ground, 1 / 72); top = Math.max(top, st.y); }
    return top;
  };
  const tap = peak(0.02), full = peak(1);
  assert.ok(tap > 0.1 && tap < 0.45, `tap ${tap}`);
  assert.ok(full > 1.4 && full < 2.2, `full ${full}`);
});

test('leaning steers past a small dead zone, up to full lock', async () => {
  const { leanSteer } = await import('../src/board.js');
  assert.equal(leanSteer(0.02), 0);
  assert.ok(leanSteer(0.1) > 0.2 && leanSteer(0.1) < 0.6);
  assert.equal(leanSteer(-0.4), -1);
});

// A big flat-ground launch: hold the flip stick until the board has turned `turn` radians, let go, and report the landing.
async function flipAndLand(turn, direction = 1) {
  const ground = { heightAt: () => 0, normalAt: (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; } };
  const st = createBoardState({ speed: 10 });
  stepBoard(st, { ollie: 1 }, ground, 1 / 72);
  st.vy = 9; // plenty of air time
  let landing = null;
  for (let t = 0; t < 4 && !landing; t += 1 / 120) {
    const holding = Math.abs(st.pitch) < turn - 0.35; // let go a little early: the board coasts on briefly
    stepBoard(st, { pitch: holding ? direction : 0 }, ground, 1 / 120);
    landing = st.events.find(e => e.type === 'land' || e.type === 'bail') || null;
  }
  return landing;
}

test('a full backflip lands clean and counts as one flip', async () => {
  const l = await flipAndLand(Math.PI * 2, 1);
  assert.equal(l.type, 'land', `tilt ${(l.tilt * 57.3).toFixed(0)} deg`);
  assert.equal(l.flips, 1);
});

test('a full frontflip counts as minus one', async () => {
  const l = await flipAndLand(Math.PI * 2, -1);
  assert.equal(l.type, 'land');
  assert.equal(l.flips, -1);
});

test('landing a half flip (upside down) is a bail', async () => {
  const l = await flipAndLand(Math.PI, 1);
  assert.equal(l.type, 'bail');
});

test('landing a bit over-rotated is a heavy landing that costs speed', async () => {
  const l = await flipAndLand(Math.PI * 2 + 0.15, 1); // lands about 30 to 40 degrees past square
  assert.equal(l.type, 'land', `tilt ${(l.tilt * 57.3).toFixed(0)} deg`);
  assert.ok(l.heavy, `tilt ${(l.tilt * 57.3).toFixed(0)} deg`);
});

// A kicker: a ramp up at 25 degrees ending in a lip at z = -20, then ground falling away at 25 degrees (a landing slope).
const kickerGround = (() => {
  const t = Math.tan(25 * Math.PI / 180);
  const heightAt = (x, z) => (z > -20 ? Math.max(0, -z) * t : 20 * t - (-z - 20) * t);
  return { heightAt, normalAt: (x, z, out = {}) => { const e = 0.05, dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e); const l = Math.hypot(dz, 1); out.x = 0; out.y = 1 / l; out.z = -dz / l; return out; } };
})();
function flyOffKicker(skilled) {
  const st = createBoardState({ x: 0, y: kickerGround.heightAt(0, -2), z: -2, yaw: 0, speed: 0 });
  st.vz = -16 * Math.cos(25 * Math.PI / 180); st.vy = 16 * Math.sin(25 * Math.PI / 180); // up the ramp
  let landing = null, apexPitch = 0;
  for (let t = 0; t < 6 && !landing; t += 1 / 120) {
    const pitch = skilled && !st.grounded ? perfectLanding(st, kickerGround) : 0;
    stepBoard(st, { pitch }, kickerGround, 1 / 120);
    landing = st.events.find(e => e.type === 'land' || e.type === 'bail') || null;
    apexPitch = Math.max(apexPitch, Math.abs(st.pitch));
  }
  return { landing, apexPitch };
}

test('the board does not level itself in the air: a jump off a kicker onto a landing slope has to be matched with the stick', () => {
  const hands = flyOffKicker(false), skilled = flyOffKicker(true);
  assert.ok(hands.landing, 'it landed');
  assert.ok(hands.landing.type === 'bail' && hands.landing.tilt > 0.8, `hands off: ${hands.landing.type}, ${(hands.landing.tilt * 57.3).toFixed(0)} degrees off the slope`);
  assert.equal(skilled.landing.type, 'land', `pitched to meet it: ${skilled.landing.type}`);
  assert.ok(!skilled.landing.heavy && skilled.landing.tilt < 0.25, `landed ${(skilled.landing.tilt * 57.3).toFixed(0)} degrees off the slope`);
  assert.ok(skilled.apexPitch > 0.5, 'by pitching it nose down a good way');
  assert.equal(BOARD.settle, 0, 'nothing levels the board');
});

test('a small push of the stick pitches the board gently, a full push fast', () => {
  const flat = { heightAt: () => 0, normalAt: (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; } };
  const spin = push => { const st = createBoardState({ speed: 10 }); stepBoard(st, { ollie: 1 }, flat, 1 / 72); st.vy = 12; for (let t = 0; t < 0.4; t += 1 / 120) stepBoard(st, { pitch: push }, flat, 1 / 120); return st.pitch; };
  assert.ok(spin(0.3) < spin(1) * 0.25 && spin(0.3) > 0.05, `${spin(0.3).toFixed(2)} against ${spin(1).toFixed(2)}`);
  assert.ok(spin(-0.3) < 0 && Math.abs(spin(-0.3) + spin(0.3)) < 0.01, 'the same the other way');
});

test('stick axis snapping: near-sideways is a pure spin, near-vertical a pure flip, diagonals keep both', async () => {
  const { axisSnap } = await import('../src/math.js');
  const at = deg => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];
  assert.equal(axisSnap(...at(15), 20)[1], 0);    // 15 degrees off sideways: no flip
  assert.equal(axisSnap(...at(78), 20)[0], 0);    // 12 degrees off vertical: no spin
  const [dx, dy] = axisSnap(...at(45), 20);
  assert.ok(dx > 0.6 && dy > 0.6);                 // a real diagonal does both
  assert.deepEqual(axisSnap(-1, 0, 20), [-1, 0]);
});

test('carving: a smooth turn keeps your speed, yanking the stick at speed skids and scrubs it, and edge changes take a moment', () => {
  const flat = { heightAt: () => 0, normalAt: (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; } };
  const turn = stick => {
    const st = createBoardState({ speed: 30 });
    for (let t = 0; t < 1.5; t += 1 / 72) stepBoard(st, { steer: stick }, flat, 1 / 72);
    return speedOf(st);
  };
  assert.ok(turn(0.6) - turn(1) > 2, `smooth ${turn(0.6).toFixed(1)} vs yanked ${turn(1).toFixed(1)} m/s`);
  const st = createBoardState({ speed: 20 });
  for (let t = 0; t < 1; t += 1 / 72) stepBoard(st, { steer: 1 }, flat, 1 / 72);
  let t = 0;
  for (; t < 2; t += 1 / 72) { const y = st.yaw; stepBoard(st, { steer: -1 }, flat, 1 / 72); if (st.yaw > y) break; }
  assert.ok(t > 0.15 && t < 0.4, `edge to edge took ${(t * 1000).toFixed(0)} ms`);
});

// ---------------------------------------------------------------- rails
import { railFromPoints, buildRail, railYaw } from '../src/rails.js';
const flatGround = (rails, y = 0) => ({ heightAt: () => y, normalAt: (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; }, rails });

// A straight bar running toward -z (the way a board at yaw 0 faces), one metre between points, from z = 0. `y(d)` is its height d metres along.
function bar({ length = 60, y = () => 0.7, x = 0, entry = 0, exit = 0 } = {}) {
  const pts = []; for (let d = 0; d <= length; d += 1) pts.push([x, y(d), -d]);
  return railFromPoints(pts, { entry, exit });
}
// A board in the air at (x, y, z) travelling at `speed` toward -z, ready to come down on a bar (whatever way it is turned: `yaw`).
const flyer = (x, y, z, speed, rest = {}) => Object.assign(createBoardState({ x, y, z, speed }), { grounded: false }, rest);
// Steps `st` for `seconds`, collecting its events. On a rail the rider balances perfectly with the stick unless `balance` is false.
function run(st, ground, seconds, input = {}, balance = true) {
  const seen = [];
  for (let t = 0; t < seconds; t += 1 / 72) {
    const steer = st.grind && balance ? perfectBalance(st.grind.bal, st.grind.balv) : (input.steer || 0);
    stepBoard(st, { ...input, steer }, ground, 1 / 72); seen.push(...st.events); st.events.length = 0;
  }
  return seen;
}
const started = events => events.find(e => e.type === 'grind' && e.phase === 'start');
const ended = events => events.find(e => e.type === 'grind' && e.phase === 'end');

test('rails: coming down on a bar catches you, carries you along it, and lets you go at the end', () => {
  const rail = bar({ length: 60 }), ground = flatGround([rail]);
  const st = flyer(0, 1.6, -5, 12);
  const events = run(st, ground, 2);
  assert.ok(started(events), 'never caught');
  assert.ok(st.grind && st.grounded, 'should be on the bar');
  assert.ok(Math.abs(st.y - 0.7) < 0.02, `riding at ${st.y.toFixed(3)}`);
  assert.ok(speedOf(st) > 9 && speedOf(st) < 12, `speed ${speedOf(st).toFixed(2)}`);
  const later = run(st, ground, 8);
  const end = ended(later);
  assert.ok(end && end.reason === 'end', 'should run off the end');
  assert.ok(end.distance > 40 && end.time > 3, `ground ${end.distance.toFixed(1)} m in ${end.time.toFixed(1)} s`);
  assert.equal(st.grind, null);
  assert.ok(later.some(e => e.type === 'launch'), 'the bar stands clear of the sand, so you leave it in the air');
  assert.ok(later.some(e => e.type === 'land'), 'and come down on the sand');
});

test('rails: a bar leaning downhill speeds you up (never by more than the height you drop), a level one only slows you', () => {
  const down = bar({ length: 80, y: d => 0.7 - d * Math.tan(10 * Math.PI / 180) }), level = bar({ length: 80 });
  const ground = r => flatGround([r], -200);
  const a = flyer(0, 1.5, -3, 10), b = flyer(0, 1.5, -3, 10);
  run(a, ground(down), 3); run(b, ground(level), 3);
  assert.ok(a.grind && b.grind);
  assert.ok(speedOf(a) > 12.5 && speedOf(a) > speedOf(b) + 3, `downhill ${speedOf(a).toFixed(1)}`);
  assert.ok(0.5 * speedOf(a) ** 2 + BOARD.gravity * a.y < 0.5 * 10 ** 2 + BOARD.gravity * 1.5, 'and nowhere near more than the height it dropped');
  assert.ok(speedOf(b) < 10 && speedOf(b) > 7, `level ${speedOf(b).toFixed(1)}`);
});

test('rails: the bar never adds energy: speed plus height only ever falls', () => {
  const rail = bar({ length: 100, y: d => 0.7 - d * 0.12 }), ground = flatGround([rail], -300);
  const st = flyer(0.4, 1.0, -4, 14);
  let e0 = null, worst = -Infinity;
  for (let t = 0; t < 6; t += 1 / 72) {
    stepBoard(st, { steer: st.grind ? perfectBalance(st.grind.bal, st.grind.balv) : 0 }, ground, 1 / 72); st.events.length = 0;
    if (!st.grind) continue;
    const e = energy(st); if (e0 === null) e0 = e;
    worst = Math.max(worst, e - e0); e0 = Math.min(e0, e);
  }
  assert.ok(e0 !== null && worst < 0.5, `gained ${worst.toFixed(3)} J/kg`);
});

test('rails: hopping off pops you away from the bar, and you can hop back on', () => {
  const rail = bar({ length: 80 }), ground = flatGround([rail]);
  const st = flyer(0, 1.4, -3, 12);
  run(st, ground, 1);
  assert.ok(st.grind);
  const hop = []; stepBoard(st, { ollie: 1 }, ground, 1 / 72); hop.push(...st.events); st.events.length = 0;
  assert.equal(st.grind, null);
  assert.equal(st.grounded, false);
  assert.ok(st.vy > 3, `popped at ${st.vy.toFixed(1)} m/s`);
  assert.ok(hop.some(e => e.type === 'grind' && e.reason === 'jump') && hop.some(e => e.type === 'launch'));
  // still next to the bar for a moment, but it does not grab you straight back (and it never grabs you on the way up)
  run(st, ground, 0.15);
  assert.equal(st.grind, null);
  const after = run(st, ground, 1.2);
  assert.ok(started(after), 'came down on the bar again');
  assert.ok(st.grind, 'riding it again');
});

test('rails: only a board over the bar, coming down onto it, travelling along it, fast enough and the right way up is caught, and nothing pulls it in', () => {
  const rail = bar({ length: 60 }), ground = flatGround([rail]);
  const caught = (st, seconds = 1.2) => Boolean(started(run(st, ground, seconds)));
  assert.ok(caught(flyer(0.5, 1.5, -5, 12)), 'half a metre off to one side, board along the bar: the bar is under the board');
  assert.ok(!caught(flyer(0.7, 1.5, -5, 12)), 'seven tenths off with the board along the bar: the bar misses it');
  assert.ok(caught(flyer(0.7, 1.5, -5, 12, { yaw: Math.PI / 2 })), 'but the same miss with the board across the bar is under its length');
  assert.ok(!caught(flyer(1.6, 1.5, -5, 12)), 'well to the side');
  assert.ok(!caught(flyer(0, 0.1, -5, 12, { vy: 5 }), 0.3), 'rising up through it from underneath');
  assert.ok(!caught(flyer(0, 1.5, -5, 1)), 'too slow: you step over it');
  const across = flyer(-4, 1.5, -20, 0); across.vx = 12; across.vz = 0; assert.ok(!caught(across, 0.8), 'crossing it');
  const slanted = flyer(-1.5, 1.5, -20, 0); slanted.vx = 12 * Math.sin(0.5); slanted.vz = -12 * Math.cos(0.5); assert.ok(caught(slanted, 0.6), 'coming at it at an angle is fine');
  const wrongWay = flyer(0, 1.5, -40, 12); wrongWay.vz = 12; assert.ok(!caught(wrongWay, 0.5), 'going back up it');
  assert.ok(!caught(flyer(0, 1.5, -5, 12, { pitch: Math.PI })), 'upside down');
  assert.ok(caught(flyer(0, 1.5, -5, 12, { pitch: Math.PI * 2 + 0.3 })), 'a full flip you land is fine');
  // Missing is just missing: the board is not drawn toward the bar.
  const miss = flyer(0.9, 1.5, -5, 12), x0 = miss.x;
  assert.ok(!started(run(miss, ground, 0.5)));
  assert.ok(Math.abs(miss.x - x0) < 1e-9 && !miss.grind, 'it carries straight on');
});

test('rails: the board stays at the angle you landed it, the bar does not turn it', () => {
  const rail = bar({ length: 80 }), ground = flatGround([rail]);
  for (const yaw of [0.6, -0.9, Math.PI / 2, Math.PI]) {
    const st = flyer(0, 1.4, -5, 12, { yaw });
    run(st, ground, 1.2);
    assert.ok(st.grind, `caught at yaw ${yaw}`);
    assert.ok(Math.abs(angleDelta(st.yaw, yaw)) < 1e-6, `landed at ${yaw}, now ${st.yaw.toFixed(3)}`);
    assert.ok(Math.abs(angleDelta(railYaw(0, -1) + st.grind.rel, st.yaw)) < 1e-6);
  }
  assert.equal(grindName(0), '50-50'); assert.equal(grindName(Math.PI), '50-50');
  assert.equal(grindName(Math.PI / 2), 'Boardslide'); assert.equal(grindName(-Math.PI / 2), 'Boardslide');
  assert.equal(grindName(0.9), 'Slide');
});

test('rails: a boardslide: land crosswise, slide the bar sideways on, pop off and come down straight', () => {
  const rail = bar({ length: 22 }), ground = flatGround([rail]);
  const st = flyer(0.2, 1.5, -4, 12, { yaw: Math.PI / 2 });
  const events = run(st, ground, 1.3);
  const start = started(events);
  assert.ok(start && start.name === 'Boardslide', JSON.stringify(start));
  assert.ok(st.grind && speedOf(st) > 10, `sliding at ${speedOf(st).toFixed(1)} m/s`);
  assert.ok(Math.abs(angleDelta(st.yaw, Math.PI / 2)) < 1e-6, 'still across the bar');
  // pop off before the end of the bar: the board eases round to the way you are going, so you fly clear of it and come down square on the sand
  stepBoard(st, { ollie: 0.9 }, ground, 1 / 72);
  const off = [...st.events]; st.events.length = 0;
  off.push(...run(st, ground, 2));
  assert.ok(ended(off)?.reason === 'jump');
  assert.ok(off.some(e => e.type === 'land') && !off.some(e => e.type === 'bail'), 'landed, no crash');
  assert.ok(Math.min(Math.abs(angleDelta(st.yaw, 0)), Math.abs(angleDelta(st.yaw, Math.PI))) < 0.15, `pointing the way it travels again: ${st.yaw.toFixed(2)}`);
  assert.ok(speedOf(st) > 8, `kept its speed: ${speedOf(st).toFixed(1)}`);
});

test('rails: balance: left alone you roll off the side, a push of the stick rolls the board the way you push, and landing off to one side starts you off balance that way', () => {
  const rail = bar({ length: 120 });
  const ground = flatGround([rail]);
  // no stick: you slip off in a second or two, to the side you were leaning, losing some speed, and do not crash
  const lean = flyer(0.3, 1.2, -4, 12), v0 = 12;
  const events = run(lean, ground, 4, {}, false);
  const end = ended(events);
  assert.ok(end && end.reason === 'slip' && end.time > 0.4 && end.time < 3.5, `${JSON.stringify(end)}`);
  assert.ok(end.bal > 0.99 && lean.x > 0.3, `leaning right (${end.bal.toFixed(2)}), so off to the right: x ${lean.x.toFixed(2)}`);
  assert.ok(!events.some(e => e.type === 'bail'), 'a slip is a stumble, not a crash');
  assert.ok(speedOf(lean) < v0 * 0.95 && speedOf(lean) > 4, `speed ${speedOf(lean).toFixed(1)}`);
  assert.ok(!events.filter(e => e.type === 'grind' && e.phase === 'start').slice(1).length, 'and it does not catch you straight back');
  const left = flyer(-0.3, 1.2, -4, 12);
  const leftEnd = ended(run(left, ground, 4, {}, false));
  assert.ok(leftEnd.bal < -0.99 && left.x < -0.3, 'the other side the other way');
  // landing off to one side leans you that way
  const a = flyer(0.4, 1.0, -4, 12), b = flyer(-0.4, 1.0, -4, 12);
  run(a, ground, 0.25); run(b, ground, 0.25);
  assert.ok(a.grind.bal > 0.1 && b.grind.bal < -0.1, `${a.grind.bal.toFixed(2)} ${b.grind.bal.toFixed(2)}`);
  // pushing the stick right rolls the board right, left rolls it left
  const p = flyer(0, 1.0, -4, 12), q = flyer(0, 1.0, -4, 12), c = flyer(0, 1.0, -4, 12);
  for (const st of [p, q, c]) run(st, ground, 0.25);
  run(p, ground, 0.3, { steer: 1 }, false); run(q, ground, 0.3, { steer: -1 }, false); run(c, ground, 0.3, {}, false);
  assert.ok(p.grind.bal > c.grind.bal + 0.12, `pushed right: ${p.grind.bal.toFixed(2)} against ${c.grind.bal.toFixed(2)} untouched`);
  assert.ok(q.grind.bal < c.grind.bal - 0.12, `pushed left: ${q.grind.bal.toFixed(2)} against ${c.grind.bal.toFixed(2)} untouched`);
  // and a rider who reads the roll and pushes against it holds the bar to the end
  const good = flyer(0.4, 1.2, -4, 12);
  const goodEvents = run(good, ground, 14);
  assert.ok(ended(goodEvents)?.reason === 'end', 'a steady hand rides it out');
});

test('rails: slipping works at any angle, and a bar that is too flat for your speed lets you slide off it', () => {
  const rail = bar({ length: 80, y: d => 0.7 + d * 0.09 }), ground = flatGround([rail], 0); // climbing: it stops you
  const st = flyer(0, 1.2, -4, 5);
  const end = ended(run(st, ground, 8));
  assert.ok(end && end.reason === 'slip', JSON.stringify(end));
  const across = flyer(0.2, 1.2, -4, 12, { yaw: -Math.PI / 2 }), flat = flatGround([bar({ length: 100, y: d => 0.7 - d * 0.04 })]);
  flat.rails[0] = bar({ length: 100, y: d => 0.7 - d * 0.04 });
  const e2 = ended(run(across, flat, 5, {}, false));
  assert.ok(e2 && e2.reason === 'slip' && e2.name === 'Boardslide', JSON.stringify(e2));
});

test('rails: ride straight up the ramp at the start without a jump, and ride off the end without one too', () => {
  // The bar rises out of the sand over 5 m, stands 0.7 up, and sinks back over the last 5 m (what buildRail makes).
  const pts = []; for (let d = 0; d <= 60; d += 1) pts.push([0, 0.7 * smoothstep(0, 5, d) * smoothstep(0, 5, 60 - d), -d]);
  const rail = railFromPoints(pts, { entry: 5, exit: 5 }), ground = flatGround([rail]);
  const st = createBoardState({ x: 0, y: 0, z: 20, yaw: 0, speed: 10 });
  const events = run(st, ground, 12);
  const start = started(events), end = ended(events);
  assert.ok(start && end && end.reason === 'end', 'caught at the start and let go at the end');
  assert.ok(end.distance > 45, `ground ${end.distance.toFixed(1)} m`);
  assert.ok(!events.some(e => e.type === 'launch'), 'no jump');
  assert.ok(st.grounded && !st.grind, 'back on the sand');
  assert.ok(Math.abs(st.yaw) < 0.01, 'and still pointing straight on');
  // anywhere on the ramp's stripes catches you; a board passing a metre and a half to the side is not caught
  const edge = createBoardState({ x: 0.7, y: 0, z: 20, yaw: 0, speed: 10 });
  assert.ok(started(run(edge, ground, 12)), 'on the edge of the stripes');
  const wide = createBoardState({ x: 1.5, y: 0, z: 20, yaw: 0, speed: 10 });
  assert.ok(!run(wide, ground, 12).some(e => e.type === 'grind'));
});

test('rails: the ramp only catches you at the start of the bar, not as you pass alongside it', () => {
  const pts = []; for (let d = 0; d <= 60; d += 1) pts.push([0, 0.7 * smoothstep(0, 5, d) * smoothstep(0, 5, 60 - d), -d]);
  const rail = railFromPoints(pts, { entry: 5, exit: 5 }), ground = flatGround([rail]);
  const st = createBoardState({ x: 0.3, y: 0, z: -30, yaw: 0, speed: 10 }); // on the sand, level with the middle of the bar, a little under it
  st.grounded = true;
  assert.ok(!run(st, ground, 1).some(e => e.type === 'grind'));
});

test('rails: a course builds its rails over the ground, with the bar clear of the sand', () => {
  const rail = buildRail({ from: 400, to: 520, offset: 12 }, { centreAt: s => course.pointAt(s), heightAt: course.heightAt });
  assert.ok(rail.length > 110 && rail.length < 135, `${rail.length}`);
  for (let i = 0; i < rail.n; i += 1) {
    const clear = rail.y[i] - rail.ground[i];
    assert.ok(clear > -1e-6, `under the sand at ${i}`);
    if (rail.dist[i] > 6 && rail.length - rail.dist[i] > 6) assert.ok(clear > 0.25 && clear < 1.8, `${clear.toFixed(2)} m clear at ${i}`);
  }
  assert.ok(rail.y[0] - rail.ground[0] < 0.01 && rail.y[rail.n - 1] - rail.ground[rail.n - 1] < 0.01, 'both ends meet the sand');
});

function smoothstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
