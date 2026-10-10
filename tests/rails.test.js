import test from 'node:test';
import assert from 'node:assert/strict';
import { railFromPoints, railAt, nearestOnRail, buildRail, railYaw } from '../src/rails.js';
import { createSparkSim, SPARKS } from '../src/sparks.js';

const line = (n = 11, y = d => 1 - d * 0.1) => { const pts = []; for (let d = 0; d < n; d += 1) pts.push([2, y(d), -d]); return railFromPoints(pts); };

test('a rail knows its length, its direction and where it is at any distance along it', () => {
  const r = line();
  assert.ok(Math.abs(r.length - 10 * Math.hypot(1, 0.1)) < 1e-9);
  const at = railAt(r, 5);
  assert.ok(Math.abs(at.x - 2) < 1e-9 && Math.abs(at.z + 5 / Math.hypot(1, 0.1) * 1) < 0.2, JSON.stringify(at));
  assert.ok(Math.abs(Math.hypot(at.tx, at.ty, at.tz) - 1) < 1e-9, 'a unit direction');
  assert.ok(at.tz < -0.99 && at.ty < 0 && at.ty > -0.11, 'heading toward -z and downhill');
  assert.deepEqual([railAt(r, -5).z, railAt(r, 999).z].map(z => Math.round(z) + 0), [0, -10], 'clamped to its ends');
  assert.ok(Math.abs(railYaw(0, -1)) < 1e-12 && Math.abs(railYaw(-1, 0) - Math.PI / 2) < 1e-12, 'yaw 0 faces -z and turns left');
});

test('nearestOnRail finds how far along and how far to the side a point is, seen from above', () => {
  const r = line();
  const near = nearestOnRail(r, 3.5, -4.0);
  assert.ok(Math.abs(near.d - 1.5) < 1e-9, `${near.d}`);
  assert.ok(Math.abs(near.u - railAt(r, near.u).z * 0 - near.u) < 1e-9 && Math.abs(railAt(r, near.u).z + 4) < 0.05, `u ${near.u}`);
  assert.ok(nearestOnRail(r, 2, 6).d > 5.9, 'before the start: distance to the start point');
});

test('a built rail follows the ground at a steady height, rises out of the sand at one end and sinks back into it at the other', () => {
  const ground = (x, z) => -0.2 * z + 0.4 * Math.sin(x * 0.7 + z * 0.3); // a slope with ripples
  const rail = buildRail({ from: 0, to: 80, offset: 3 }, { centreAt: s => ({ x: 0, z: -s, yaw: 0 }), heightAt: ground });
  assert.equal(rail.offsetAt(10), 3);
  assert.ok(Math.abs(rail.x[10] - 3) < 1e-9, 'three metres to the right of a line heading -z (the right of yaw 0 is +x)');
  for (let i = 0; i < rail.n; i += 1) assert.ok(rail.y[i] >= rail.ground[i] - 1e-9, `under the sand at ${i}`);
  assert.ok(Math.abs(rail.y[0] - rail.ground[0]) < 1e-9 && Math.abs(rail.y[rail.n - 1] - rail.ground[rail.n - 1]) < 1e-9, 'meets the sand at both ends');
  const mid = Math.floor(rail.n / 2);
  assert.ok(rail.y[mid] - rail.ground[mid] > 0.3 && rail.y[mid] - rail.ground[mid] < 1.2, `${rail.y[mid] - rail.ground[mid]}`);
  // smooth: the bar's direction never kinks by more than a few degrees from one point to the next
  for (let i = 8; i < rail.n - 8; i += 1) assert.ok(Math.abs(rail.ty[i] - rail.ty[i - 1]) < 0.05, `kink at ${i}`);
  // a rail can drift across the lane
  const drift = buildRail({ from: 0, to: 80, offset: [[0, 8], [80, -8]] }, { centreAt: s => ({ x: 0, z: -s, yaw: 0 }), heightAt: () => 0 });
  assert.ok(drift.x[0] > 7.9 && drift.x[drift.n - 1] < -7.9);
});

test('sparks: thrown out, pulled down and gone within a second, and the pool never overflows', () => {
  const sim = createSparkSim({ capacity: 32, random: (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })() });
  const place = new Float32Array(32 * 4), look = new Float32Array(32 * 4);
  sim.emit(0, 5, 0, 0, 0, 0, { count: 20, spread: 0, up: 0 });
  assert.equal(sim.live, 20);
  const y0 = 5;
  let drawn = sim.update(0.1, place, look);
  assert.equal(drawn, 20);
  for (let i = 0; i < 20; i += 1) assert.ok(place[i * 4 + 1] < y0 + 0.5 && place[i * 4 + 3] > 0, 'alive, and falling');
  sim.emit(0, 5, 0, 0, 0, 0, { count: 100 }); // more than the pool holds: the oldest are reused
  assert.ok(sim.live <= 32);
  for (let t = 0; t < 1; t += 0.05) drawn = sim.update(0.05, place, look);
  assert.equal(sim.live, 0);
  assert.equal(drawn, 0);
  assert.ok(SPARKS.life[1] < 1);
});

test('the rails and sparks build into scenery without a browser', async () => {
  const THREE = await import('three');
  const { createCourse } = await import('../src/course.js');
  const { COURSES } = await import('../src/courses/index.js');
  const { createRails } = await import('../src/rails-view.js');
  const { createSparks } = await import('../src/sparks.js');
  for (const def of COURSES) {
    const course = createCourse(def);
    const group = createRails(course);
    const names = group.children.map(c => c.name);
    assert.equal(names.filter(n => n === 'Rail bar').length, course.rails.length, `${def.id}: one bar per rail`);
    assert.equal(names.filter(n => n === 'Rail ramp').length, course.rails.length * 2, `${def.id}: a ramp at each end`);
    assert.ok(names.includes('Rail posts'), `${def.id}: posts`);
    const bars = group.children.filter(c => c.name === 'Rail bar');
    bars.forEach((bar, i) => {
      const rail = course.rails[i], box = new THREE.Box3().setFromObject(bar);
      assert.ok(box.min.x < rail.minX && box.max.x > rail.maxX - 1e-6 && box.min.z < rail.minZ && box.max.z > rail.maxZ - 1e-6, `${def.id} rail ${i}: the bar covers the rail`);
      assert.ok(box.max.y > rail.maxY - 0.2 && box.max.y < rail.maxY + 0.05, `${def.id} rail ${i}: the bar rides just under the board's line`);
    });
  }
  const sparks = createSparks({});
  sparks.emit(0, 0, 0, 1, 1, 1, { count: 5 });
  sparks.update(0.016);
  assert.equal(sparks.mesh.geometry.instanceCount, 5);
  sparks.dispose();
});
