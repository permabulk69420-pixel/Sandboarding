// Works out every terrain vertex height once, at build time, so the headset doesn't spend seconds on it at load.
// Runs automatically before `npm run dev` and `npm run build`. Output: public/terrain/<course id>.bin (Float32, fine grid then coarse),
// one per course in src/courses/index.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCourse } from '../src/course.js';
import { COURSES } from '../src/courses/index.js';
import { buildTerrainGrids } from '../src/terrain-grid.js';

mkdirSync(new URL('../public/terrain/', import.meta.url), { recursive: true });
for (const def of COURSES) {
  const t0 = performance.now();
  const course = createCourse(def);
  const { near, far } = buildTerrainGrids(course);
  const out = new Float32Array(near.order.length + far.order.length);
  out.set(near.order, 0); out.set(far.order, near.order.length);
  writeFileSync(new URL(`../public/terrain/${def.id}.bin`, import.meta.url), Buffer.from(out.buffer));
  console.log(`terrain baked: ${def.id}, ${near.triangleCount + far.triangleCount} triangles (${near.tiles.length} fine tiles), ${(out.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
