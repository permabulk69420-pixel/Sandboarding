import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourse } from '../src/course.js';

const course = createCourse();

// Per-course checks live in courses.test.js. This one checks the terrain grid code itself, on the first course.
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
