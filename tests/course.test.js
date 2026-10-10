import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourse } from '../src/course.js';

const course = createCourse();

test('the run is a long descent from the summit to the finish', () => {
  assert.ok(course.length > 2500, `length ${course.length}`);
  assert.ok(course.finishS > course.startS + 2400);
  const top = course.pointAt(course.startS).y, bottom = course.pointAt(course.finishS).y;
  assert.ok(top - bottom > 140, `drop ${top - bottom}`);
});

test('the lane only steepens at the kickers and the gap', () => {
  for (let s = course.startS; s < course.finishS; s += 0.5) {
    const p = course.pointAt(s);
    const n = course.normalAt(p.x, p.z);
    const slope = Math.acos(n.y) * 180 / Math.PI;
    const inFeature = course.features.some(f => s > f.from - 2 && s < f.to + 2); // kicker ramps, lips and landings; the gap
    if (!inFeature) assert.ok(slope < 30, `slope ${slope.toFixed(1)} at s=${s}`);
  }
});

test('the ground has no seams (no jumps between neighbouring points)', () => {
  let worst = 0;
  for (let z = 80; z > -2750; z -= 13) {
    for (let x = -260; x < 260; x += 0.5) {
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
  const all = new Float32Array(live.near.order.length + live.far.order.length);
  all.set(live.near.order, 0); all.set(live.far.order, live.near.order.length);
  const again = buildTerrainGrids(course, all);
  assert.equal(again.near.tiles.length, live.near.tiles.length);
  for (let t = 0; t < live.near.tiles.length; t += 1) assert.deepEqual(again.near.tiles[t].positions, live.near.tiles[t].positions);
  assert.deepEqual(again.far.tiles[0].indices, live.far.tiles[0].indices);
});
