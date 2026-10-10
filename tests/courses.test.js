// Checks every course in src/courses/index.js. A new course has to pass all of these.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourse } from '../src/course.js';
import { COURSES } from '../src/courses/index.js';
import { rideCourse } from '../src/ride-sim.js';
import { BOARD } from '../src/board.js';
import { railProblems } from '../src/rails.js';

for (const def of COURSES) {
  const course = createCourse(def);
  const name = `${def.id}:`;

  test(`${name} a real descent from the start gate to the finish`, () => {
    assert.ok(course.finishS > course.startS + 300, 'at least 300 m long');
    const top = course.pointAt(course.startS).y, bottom = course.pointAt(course.finishS).y;
    assert.ok(top - bottom > 40, `drop ${(top - bottom).toFixed(0)} m`);
  });

  test(`${name} the lane only steepens past 30 degrees at its features`, () => {
    for (let s = course.startS; s < course.finishS; s += 0.5) {
      const p = course.pointAt(s), n = course.normalAt(p.x, p.z);
      const slope = Math.acos(n.y) * 180 / Math.PI;
      const inFeature = course.features.some(f => s > f.from - 2 && s < f.to + 2);
      if (!inFeature) assert.ok(slope < 30, `slope ${slope.toFixed(1)} at s=${s}`);
    }
  });

  test(`${name} the ground has no seams anywhere near the run`, () => {
    // Rows 13 m apart across the run, each scanned every half metre, but only where the row passes within `reach` of the centre line: a long
    // diagonal run has a huge bounding box that is mostly empty dunes, and scanning all of it takes minutes. Per row, the stretches of x
    // within reach of the line are merged, and each height is computed once and reused for the next step.
    const reach = 200, rowStep = 13, colStep = 0.5;
    const zs = course.points.map(p => p[1]);
    let worst = 0, at = null;
    for (let z = Math.max(...zs) + reach; z > Math.min(...zs) - reach; z -= rowStep) {
      const spans = [];
      for (const [px, pz] of course.points) {
        const dz = Math.abs(pz - z);
        if (dz < reach) { const half = Math.sqrt(reach * reach - dz * dz); spans.push([px - half, px + half]); }
      }
      spans.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else merged.push([span[0], span[1]]);
      }
      for (const [x0, x1] of merged) {
        let before = course.heightAt(x0, z);
        for (let x = x0 + colStep; x <= x1; x += colStep) {
          const here = course.heightAt(x, z), g = Math.abs(here - before) / colStep;
          if (g > worst) { worst = g; at = [x - colStep, z]; }
          before = here;
        }
      }
    }
    assert.ok(worst < 6, `steepest step ${worst.toFixed(2)} at ${at}`);
  });

  test(`${name} walls rise on both sides of the lane`, () => {
    for (let s = course.startS + 100; s < course.finishS - 50; s += 150) {
      if (course.features.some(f => s > f.from - 10 && s < f.to + 10)) continue;
      const p = course.pointAt(s), fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), w = course.halfWidth(s);
      for (const side of [-1, 1]) {
        const x = p.x + side * -fz * (w + 12), z = p.z + side * fx * (w + 12);
        assert.ok(course.heightAt(x, z) > p.y + 2, `no wall at s=${s} side ${side}`);
      }
    }
  });

  test(`${name} locate finds points on the centre line`, () => {
    for (const s of [course.startS + 10, (course.startS + course.finishS) / 2, course.finishS - 10]) {
      const p = course.pointAt(s), loc = course.locate(p.x, p.z);
      assert.ok(Math.abs(loc.s - s) < 0.6 && loc.distance < 0.1, JSON.stringify(loc));
    }
  });

  test(`${name} a simulated rider finishes standing and tucked: no bails, no stalls, air off every kicker`, () => {
    const stand = rideCourse(course), tuck = rideCourse(course, { tuck: 1 });
    for (const [label, r] of [['standing', stand], ['tucked', tuck]]) {
      assert.ok(!r.nonFinite, `${label}: physics blew up`);
      assert.ok(r.finished, `${label}: never finished (stalls at ${r.stalls.map(x => x.s.toFixed(0))})`);
      assert.equal(r.bails.length, 0, `${label}: bailed at ${r.bails.map(b => b.s.toFixed(0))}`);
      assert.equal(r.stalls.length, 0, `${label}: stalled at ${r.stalls.map(x => x.s.toFixed(0))}`);
      assert.equal(r.grinds.length, 0, `${label}: a rail caught the rider at ${r.grinds.map(g => g.s.toFixed(0))}`); // rails are off the racing line
      assert.ok(r.maxOff < 6, `${label}: strayed ${r.maxOff.toFixed(1)} m off the line`); // the simple autopilot drifts a little at speed; lanes are 9 m+ either side
      assert.ok(r.maxSpeed <= BOARD.maxSpeed + 1e-6);
      assert.ok(r.time < 480, `${label}: took ${r.time.toFixed(0)} s`);
    }
    course.kickers.forEach((k, i) => assert.ok(stand.airs.some(a => a.s > k && a.s < k + course.kickerReach[i]), `no air off the kicker at ${k.toFixed(0)}`));
    assert.ok(tuck.time < stand.time, 'tucking is faster');
  });

  test(`${name} every rail keeps the rules: off the racing line, inside the lane, clear of the features, over ground the bar can follow`, () => {
    for (const [i, rail] of course.rails.entries()) assert.deepEqual(railProblems(rail, course), [], `rail ${i} (${rail.from.toFixed(0)}-${rail.to.toFixed(0)} m)`);
  });

  test(`${name} a rider lined up on each rail is caught at its start and grinds it to the end`, () => {
    for (const [i, rail] of course.rails.entries()) {
      const label = `rail ${i} (${rail.from.toFixed(0)}-${rail.to.toFixed(0)} m)`;
      const r = rideCourse(course, { from: rail.from - 45, until: rail.to + 30, speed: 12, offset: s => rail.offsetAt(s) });
      assert.ok(!r.nonFinite, `${label}: physics blew up`);
      const mine = r.grinds.filter(g => g.rail === i), starts = mine.filter(g => g.phase === 'start'), ends = mine.filter(g => g.phase === 'end');
      assert.equal(starts.length, 1, `${label}: caught ${starts.length} times`);
      assert.ok(starts[0].s < rail.from + 12, `${label}: caught only at ${starts[0].s.toFixed(0)} m`);
      assert.equal(ends.length, 1, `${label}: let go ${ends.length} times`);
      assert.equal(ends[0].reason, 'end', `${label}: left the rail by ${ends[0].reason}`);
      assert.ok(ends[0].distance > rail.length - 12, `${label}: ground ${ends[0].distance.toFixed(0)} of ${rail.length.toFixed(0)} m`);
      assert.equal(r.bails.length, 0, `${label}: bailed`);
    }
  });
}
