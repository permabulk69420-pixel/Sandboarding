import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourse } from '../src/course.js';

const course = createCourse();

test('the run is a long descent from the summit to the finish', () => {
  assert.ok(course.length > 900, `length ${course.length}`);
  assert.ok(course.finishS > course.startS + 700);
  const top = course.pointAt(course.startS).y, bottom = course.pointAt(course.finishS).y;
  assert.ok(top - bottom > 140, `drop ${top - bottom}`);
});

test('the lane only steepens at the kickers', () => {
  for (let s = course.startS; s < course.finishS; s += 0.5) {
    const p = course.pointAt(s);
    const n = course.normalAt(p.x, p.z);
    const slope = Math.acos(n.y) * 180 / Math.PI;
    const nearKicker = course.kickers.some(k => s > k - 14 && s < k + 13); // ramp, lip and landing slope
    if (!nearKicker) assert.ok(slope < 30, `slope ${slope.toFixed(1)} at s=${s}`);
  }
});

test('the ground has no seams (no jumps between neighbouring points)', () => {
  let worst = 0;
  for (let z = 80; z > -1000; z -= 9) {
    for (let x = -300; x < 300; x += 0.5) {
      const g = Math.abs(course.heightAt(x + 0.5, z) - course.heightAt(x, z)) / 0.5;
      worst = Math.max(worst, g);
    }
  }
  assert.ok(worst < 6, `steepest step ${worst.toFixed(2)}`);
});

test('walls rise on both sides of the lane', () => {
  for (const s of [150, 400, 620, 800]) {
    const p = course.pointAt(s);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw); // forward; right is (-fz, fx)
    const w = course.halfWidth(s);
    for (const side of [-1, 1]) {
      const x = p.x + side * -fz * (w + 12), z = p.z + side * fx * (w + 12);
      assert.ok(course.heightAt(x, z) > p.y + 3, `wall at s=${s} side ${side}`);
    }
  }
});

test('locate finds the arc length of points on the centre line', () => {
  for (const s of [60, 333.3, 701]) {
    const p = course.pointAt(s);
    const loc = course.locate(p.x, p.z);
    assert.ok(Math.abs(loc.s - s) < 0.5 && loc.distance < 0.1, JSON.stringify(loc));
  }
});

test('baked terrain heights rebuild the same grids', async () => {
  const { buildTerrainGrids } = await import('../src/terrain-grid.js');
  const live = buildTerrainGrids(course);
  const all = new Float32Array(live.near.vertexCount + live.far.vertexCount);
  let k = 0; for (const g of [live.near, live.far]) for (let i = 0; i < g.vertexCount; i += 1) all[k++] = g.positions[i * 3 + 1];
  const again = buildTerrainGrids(course, all);
  assert.deepEqual(again.near.positions, live.near.positions);
  assert.deepEqual(again.far.indices, live.far.indices);
});
