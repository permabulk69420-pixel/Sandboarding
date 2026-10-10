// The ground as plain arrays (no three.js), so building it can be timed and tested in node.
//
// Two grids from the same height field: a fine one (2.5 m) only where it matters, over the lane and 40 m past its edges (wider in the bowl,
// narrower in the canyon), and a coarse one (32 m) for the mountains out to the horizon with the run's corridor cut out of it. The coarse
// one is drawn pushed back slightly (polygon offset in the material) so in the band where both exist, the fine one always wins.
// The fine grid is cut into square tiles so the headset can skip the ones behind you or out of view; normals are worked out on the whole
// grid first, so the tiles' edges light the same and no seams show. Working the heights out takes a few seconds, so tools/bake-terrain.js
// does it at build time and the game reads them from public/terrain/heights.bin.

export const GRID = Object.freeze({
  nearStep: 2.5,
  nearBeyond: 40, // metres past the lane's edge the fine grid reaches (over the walls and ridges, partway down the mountain's sides)
  tile: 64, // quads per side of a fine tile (160 m)
  farStep: 32,
  farMargin: 1900, // metres beyond the run's bounding box the coarse grid reaches (the haze has swallowed it well before the edge)
  farHoleBeyond: 22, // coarse quads entirely closer than this past the lane's edge are left out (the fine grid covers them)
  farSink: 10, // metres the coarse grid is lowered where it overlaps the fine one, easing back to true height one coarse step beyond it
});

// For each lattice point: how far it is past the edge of the lane, measured to the nearest centre-line point (coarse but plenty for masks).
function beyondField(course, step, x0, z0, cols, rows) {
  const out = new Float32Array(cols * rows);
  const pts = course.points;
  for (let r = 0; r < rows; r += 1) {
    const z = z0 + r * step;
    for (let c = 0; c < cols; c += 1) {
      const x = x0 + c * step;
      let best = Infinity, bi = 0;
      for (let i = 0; i < pts.length; i += 4) { const dx = x - pts[i][0], dz = z - pts[i][1]; const d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
      out[r * cols + c] = Math.sqrt(best) - course.halfWidth(bi);
    }
  }
  return out;
}

function buildGrid(course, { step, x0, z0, cols, rows, keepQuad, heights, tile = Infinity, sink = null }) {
  const n = cols * rows;
  const used = new Uint8Array(n);
  const quads = [];
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c;
      if (!keepQuad(a, a + 1, a + cols, a + cols + 1)) continue;
      quads.push(a);
      used[a] = used[a + 1] = used[a + cols] = used[a + cols + 1] = 1;
    }
  }
  // Heights only where a quad needs them (the expensive part), or read in order from a baked list.
  const y = new Float32Array(n);
  const order = []; // used heights in grid order: what the bake stores
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    if (!used[i]) continue;
    y[i] = heights ? heights[heights.offset + k++] : course.heightAt(x0 + (i % cols) * step, z0 + Math.floor(i / cols) * step);
    order.push(y[i]);
    if (sink) y[i] -= sink(i); // after recording: the bake keeps the true heights
  }
  if (heights) heights.offset += k;
  // Normals from the whole grid (central differences where both neighbours exist), so tile edges match.
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    if (!used[i]) continue;
    const c = i % cols, r = Math.floor(i / cols);
    const hx0 = c > 0 && used[i - 1] ? y[i - 1] : y[i], hx1 = c < cols - 1 && used[i + 1] ? y[i + 1] : y[i];
    const hz0 = r > 0 && used[i - cols] ? y[i - cols] : y[i], hz1 = r < rows - 1 && used[i + cols] ? y[i + cols] : y[i];
    const sx = (c > 0 && used[i - 1] ? 1 : 0) + (c < cols - 1 && used[i + 1] ? 1 : 0) || 1;
    const sz = (r > 0 && used[i - cols] ? 1 : 0) + (r < rows - 1 && used[i + cols] ? 1 : 0) || 1;
    const nx = -(hx1 - hx0) / (sx * step), nz = -(hz1 - hz0) / (sz * step), l = Math.hypot(nx, 1, nz);
    nrm[i * 3] = nx / l; nrm[i * 3 + 1] = 1 / l; nrm[i * 3 + 2] = nz / l;
  }
  // Group quads into tiles, then give each tile its own compact vertex list.
  const groups = new Map();
  for (const a of quads) {
    const key = Math.floor((a % cols) / tile) + Math.floor(Math.floor(a / cols) / tile) * 1e6;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const tiles = [];
  let vertexCount = 0, triangleCount = 0;
  for (const list of groups.values()) {
    const remap = new Map();
    const vert = i => { let v = remap.get(i); if (v === undefined) { v = remap.size; remap.set(i, v); } return v; };
    const idx = [];
    for (const a of list) {
      const b = a + 1, d = a + cols, e = d + 1;
      idx.push(vert(a), vert(d), vert(b), vert(b), vert(d), vert(e));
    }
    const m = remap.size;
    const positions = new Float32Array(m * 3), normals = new Float32Array(m * 3);
    for (const [i, v] of remap) {
      positions[v * 3] = x0 + (i % cols) * step; positions[v * 3 + 1] = y[i]; positions[v * 3 + 2] = z0 + Math.floor(i / cols) * step;
      normals.set(nrm.subarray(i * 3, i * 3 + 3), v * 3);
    }
    tiles.push({ positions, normals, indices: m > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), vertexCount: m });
    vertexCount += m; triangleCount += idx.length / 3;
  }
  return { tiles, order: Float32Array.from(order), vertexCount, triangleCount };
}

// `baked`: optional Float32Array of every used vertex height, fine grid first then coarse (from tools/bake-terrain.js).
export function buildTerrainGrids(course, baked = null) {
  const heights = baked ? Object.assign(baked, { offset: 0 }) : null;
  const pts = course.points;
  const runMinX = Math.min(...pts.map(p => p[0])), runMaxX = Math.max(...pts.map(p => p[0]));
  const runMinZ = Math.min(...pts.map(p => p[1])), runMaxZ = Math.max(...pts.map(p => p[1]));
  let widest = 0; for (let s = 0; s <= course.length; s += 10) widest = Math.max(widest, course.halfWidth(s));

  // Fine grid over the lane and its walls, in tiles.
  const ns = GRID.nearStep, reach = widest + GRID.nearBeyond;
  const nx0 = Math.floor((runMinX - reach) / ns) * ns, nz0 = Math.floor((runMinZ - reach) / ns) * ns;
  const ncols = Math.ceil((runMaxX + reach - nx0) / ns) + 1, nrows = Math.ceil((runMaxZ + reach - nz0) / ns) + 1;
  // The mask on a 4x coarser lattice, looked up per vertex.
  const ms = ns * 4, mcols = Math.ceil(ncols / 4) + 2, mrows = Math.ceil(nrows / 4) + 2;
  const mask = beyondField(course, ms, nx0, nz0, mcols, mrows);
  const nearBeyond = i => {
    const c = i % ncols, r = Math.floor(i / ncols);
    return mask[Math.min(mrows - 1, Math.round(r / 4)) * mcols + Math.min(mcols - 1, Math.round(c / 4))];
  };
  const near = buildGrid(course, {
    step: ns, x0: nx0, z0: nz0, cols: ncols, rows: nrows, heights, tile: GRID.tile,
    keepQuad: (a, b, d, e) => Math.min(nearBeyond(a), nearBeyond(b), nearBeyond(d), nearBeyond(e)) < GRID.nearBeyond,
  });

  // Coarse grid out to the horizon, with the corridor cut out (one piece: it's light, and mostly in view anyway).
  const fs = GRID.farStep, fm = GRID.farMargin;
  const fx0 = Math.floor((runMinX - fm) / fs) * fs, fz0 = Math.floor((runMinZ - fm) / fs) * fs;
  const fcols = Math.ceil((runMaxX + fm - fx0) / fs) + 1, frows = Math.ceil((runMaxZ + fm - fz0) / fs) + 1;
  const fbeyond = beyondField(course, fs, fx0, fz0, fcols, frows);
  // Where it overlaps the fine grid, the coarse grid is sunk out of sight: its big triangles cut across concave walls metres above the real
  // surface and would otherwise poke through.
  const far = buildGrid(course, {
    step: fs, x0: fx0, z0: fz0, cols: fcols, rows: frows, heights,
    keepQuad: (a, b, d, e) => Math.max(fbeyond[a], fbeyond[b], fbeyond[d], fbeyond[e]) > GRID.farHoleBeyond,
    sink: i => GRID.farSink * (1 - Math.min(1, Math.max(0, (fbeyond[i] - GRID.nearBeyond) / GRID.farStep))),
  });
  if (heights && heights.offset !== heights.length) throw new Error(`Baked terrain has ${heights.length} heights, the grids need ${heights.offset}. Run npm run bake.`);
  return { near, far };
}
