// Works out every terrain vertex height once, at build time, so the headset doesn't spend seconds on it at load.
// Runs automatically before `npm run dev` and `npm run build`. Output: public/terrain/heights.bin (Float32, near grid then far).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCourse } from '../src/course.js';
import { buildTerrainGrids } from '../src/terrain-grid.js';

const t0 = performance.now();
const course = createCourse();
const { near, far } = buildTerrainGrids(course);
const out = new Float32Array(near.vertexCount + far.vertexCount);
let k = 0;
for (const grid of [near, far]) for (let i = 0; i < grid.vertexCount; i += 1) out[k++] = grid.positions[i * 3 + 1];
mkdirSync(new URL('../public/terrain/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/terrain/heights.bin', import.meta.url), Buffer.from(out.buffer));
console.log(`terrain baked: ${near.triangleCount + far.triangleCount} triangles, ${(out.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
