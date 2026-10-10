// The ground as plain arrays (no three.js), so building it can be timed and tested in node.
//
// Two grids from the same height field: a fine one (2 m) only where it matters, along the run and up its walls, and a coarse one
// (30 m) for the mountains out to the horizon with the run's corridor cut out of it. The coarse one is drawn pushed back slightly
// (polygon offset in the material) so in the band where both exist, the fine one always wins. Working the heights out takes a few
// seconds, so tools/bake-terrain.js does it at build time and the game reads them from public/terrain/heights.bin.

export const GRID = Object.freeze({
  nearStep: 2,
  nearReach: 100, // metres from the centre line the fine grid reaches (past the ridges, partway down the mountain's sides)
  farStep: 30,
  farMargin: 1900, // metres beyond the run's bounding box the coarse grid reaches (the haze has swallowed it well before the edge)
  farHole: 82, // coarse quads entirely closer than this to the centre line are left out
});

function distanceField(course, step, x0, z0, cols, rows) {
  // Distance from each grid point to the nearest centre line point (coarse but plenty for masking).
  const out = new Float32Array(cols * rows).fill(Infinity);
  const pts = course.points;
  for (let r = 0; r < rows; r += 1) {
    const z = z0 + r * step;
    for (let c = 0; c < cols; c += 1) {
      const x = x0 + c * step;
      let best = Infinity;
      for (let i = 0; i < pts.length; i += 4) { const dx = x - pts[i][0], dz = z - pts[i][1]; const d = dx * dx + dz * dz; if (d < best) best = d; }
      out[r * cols + c] = Math.sqrt(best);
    }
  }
  return out;
}

function buildGrid(course, { step, x0, z0, cols, rows, keepQuad, heights }) {
  const n = cols * rows;
  const positions = new Float32Array(n * 3);
  const used = new Uint8Array(n);
  const indices = [];
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      if (!keepQuad(a, b, d, e)) continue;
      indices.push(a, d, b, b, d, e);
      used[a] = used[b] = used[d] = used[e] = 1;
    }
  }
  // Heights only where a quad needs them (the expensive part), or read in order from a baked list.
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    const x = x0 + (i % cols) * step, z = z0 + Math.floor(i / cols) * step;
    positions[i * 3] = x; positions[i * 3 + 2] = z;
    positions[i * 3 + 1] = used[i] ? (heights ? heights[heights.offset + k++] : course.heightAt(x, z)) : 0;
  }
  if (heights) heights.offset += k;
  // Compact to the used vertices.
  const remap = new Int32Array(n).fill(-1);
  let m = 0; for (let i = 0; i < n; i += 1) if (used[i]) remap[i] = m++;
  const pos = new Float32Array(m * 3);
  for (let i = 0; i < n; i += 1) if (used[i]) pos.set(positions.subarray(i * 3, i * 3 + 3), remap[i] * 3);
  const idx = m > 65535 ? new Uint32Array(indices.length) : new Uint16Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) idx[i] = remap[indices[i]];
  return { positions: pos, indices: idx, vertexCount: m, triangleCount: indices.length / 3 };
}

// `baked`: optional Float32Array of every used vertex height, near grid first then far (from tools/bake-terrain.js).
export function buildTerrainGrids(course, baked = null) {
  const heights = baked ? Object.assign(baked, { offset: 0 }) : null;
  const runMinX = Math.min(...course.points.map(p => p[0])), runMaxX = Math.max(...course.points.map(p => p[0]));
  const runMinZ = Math.min(...course.points.map(p => p[1])), runMaxZ = Math.max(...course.points.map(p => p[1]));

  // Fine grid around the run.
  const ns = GRID.nearStep, reach = GRID.nearReach;
  const nx0 = Math.floor((runMinX - reach) / ns) * ns, nz0 = Math.floor((runMinZ - reach) / ns) * ns;
  const ncols = Math.ceil((runMaxX + reach - nx0) / ns) + 1, nrows = Math.ceil((runMaxZ + reach - nz0) / ns) + 1;
  // The distance mask on a 4x coarser lattice, looked up per vertex.
  const ms = ns * 4, mcols = Math.ceil(ncols / 4) + 2, mrows = Math.ceil(nrows / 4) + 2;
  const mask = distanceField(course, ms, nx0, nz0, mcols, mrows);
  const nearDist = i => {
    const c = i % ncols, r = Math.floor(i / ncols);
    return mask[Math.min(mrows - 1, Math.round(r / 4)) * mcols + Math.min(mcols - 1, Math.round(c / 4))];
  };
  const near = buildGrid(course, {
    step: ns, x0: nx0, z0: nz0, cols: ncols, rows: nrows,
    keepQuad: (a, bb, d, e) => Math.min(nearDist(a), nearDist(bb), nearDist(d), nearDist(e)) < reach, heights,
  });

  // Coarse grid out to the horizon, with the corridor cut out.
  const fs = GRID.farStep, fm = GRID.farMargin;
  const fx0 = Math.floor((runMinX - fm) / fs) * fs, fz0 = Math.floor((runMinZ - fm) / fs) * fs;
  const fcols = Math.ceil((runMaxX + fm - fx0) / fs) + 1, frows = Math.ceil((runMaxZ + fm - fz0) / fs) + 1;
  const fdist = distanceField(course, fs, fx0, fz0, fcols, frows);
  const far = buildGrid(course, {
    step: fs, x0: fx0, z0: fz0, cols: fcols, rows: frows,
    keepQuad: (a, bb, d, e) => Math.max(fdist[a], fdist[bb], fdist[d], fdist[e]) > GRID.farHole, heights,
  });
  if (heights && heights.offset !== heights.length) throw new Error(`Baked terrain has ${heights.length} heights, the grids need ${heights.offset}. Run npm run bake.`);
  return { near, far };
}
