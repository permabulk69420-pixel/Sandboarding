// Works out every terrain vertex height once, at build time, so the headset doesn't spend seconds on it at load.
// Runs automatically before `npm run dev` and `npm run build`. Output: public/terrain/<course id>.bin (Float32, coarse grid then fine),
// one per course in src/courses/index.js. `npm run bake <id>` bakes just that course.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCourse } from '../src/course.js';
import { COURSES } from '../src/courses/index.js';
import { buildTerrainGrids } from '../src/terrain-grid.js';

mkdirSync(new URL('../public/terrain/', import.meta.url), { recursive: true });
const ids = process.argv.slice(2);
for (const def of ids.length ? COURSES.filter(c => ids.includes(c.id)) : COURSES) {
  const t0 = performance.now();
  const course = createCourse(def);
  const { near, far } = buildTerrainGrids(course);
  const out = new Float32Array(far.order.length + near.order.length); // coarse first: the fine grid is fitted to it
  out.set(far.order, 0); out.set(near.order, far.order.length);
  writeFileSync(new URL(`../public/terrain/${def.id}.bin`, import.meta.url), Buffer.from(out.buffer));
  console.log(`terrain baked: ${def.id}, ${near.triangleCount + far.triangleCount} triangles (${near.tiles.length} fine tiles), ${(out.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
