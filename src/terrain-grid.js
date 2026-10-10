// The ground as plain arrays (no three.js), so building it can be timed and tested in node.
//
// Two grids from the same height field, side by side and never overlapping: a fine one (2.5 m squares, split to 1.25 m over the lane) over
// the run and everything near it, and a coarse one (40 m squares) for the mountains and the dune sea out to the horizon. Where they meet
// the fine grid's edge is fitted onto the coarse one's, so the ground is closed. The fine grid is cut into square tiles so the headset can
// skip the ones behind you or out of view; normals are worked out on the whole grid first, so tile edges light the same. Working the
// heights out takes a while, so tools/bake-terrain.js does it at build time and the game reads them from public/terrain/<course id>.bin.

export const GRID = Object.freeze({
  nearStep: 2.5,
  laneSplit: 2, // over the lane and the foot of its walls each near square is split this many ways each way (1.25 m), so kickers, lips
  laneBeyond: 7, // and side hits are smooth: within this many metres past the lane's edge,
  crestBend: 0.3, // and anywhere the ground bends sharply (a crest, a rim, a lip): metres a square's corner stands off the line of its neighbours
  tile: 64, // quads per side of a fine tile (160 m)
  farStep: 40,
  farMargin: 3400, // metres beyond the run's bounding box the coarse grid reaches: far enough to see the dune sea from the summit (the haze has swallowed it before the edge: LOOK.fogEnd)
  farHoleBeyond: 22, // a coarse square any part of which comes this close past the lane's edge is left to the fine grid (with a ring round it)
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
      // Split each quad along the diagonal whose ends are closest in height, so a crest or a gully running across the grid stays a
      // clean line instead of a row of saw teeth (the canyon walls are steep enough for it to show against the sky).
      const b = a + 1, d = a + cols, e = d + 1;
      if (Math.abs(y[a] - y[e]) < Math.abs(y[b] - y[d])) idx.push(vert(a), vert(d), vert(e), vert(a), vert(e), vert(b));
      else idx.push(vert(a), vert(d), vert(b), vert(b), vert(d), vert(e));
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
  // The whole lattice too, for anything that wants the ground's height on the GPU (the blowing sand): `used` marks the points that have one.
  const lattice = { x0, z0, cols, rows, step, heights: y, used };
  return { tiles, order: Float32Array.from(order), vertexCount, triangleCount, lattice };
}

// The near grid: 2.5 m squares, split into 1.25 m ones over the lane and the foot of its walls. Where a big square meets split ones its
// edge has an extra vertex in the middle, so it is drawn as a fan from its centre to keep the surface closed (no cracks). Built on a
// 1.25 m lattice; only the points some triangle uses get a height. Same outputs as buildGrid.
function buildNearGrid(course, { x0, z0, bcols, brows, keepBlock, fineBlock, beyondAt, adjust, heights, tile }) {
  const S = GRID.laneSplit, step = GRID.nearStep / S;
  const cols = bcols * S + 1, rows = brows * S + 1, n = cols * rows;
  const keep = new Uint8Array(bcols * brows), fine = new Uint8Array(bcols * brows);
  for (let bj = 0; bj < brows; bj += 1) for (let bi = 0; bi < bcols; bi += 1) keep[bj * bcols + bi] = keepBlock(bi, bj) ? 1 : 0;
  const L = (i, j) => j * cols + i; // lattice index
  const tris = [], triBlock = [];
  const used = new Uint8Array(n);
  const y = new Float32Array(n);
  const blocks = [];
  for (let bj = 0; bj < brows; bj += 1) for (let bi = 0; bi < bcols; bi += 1) if (keep[bj * bcols + bi]) blocks.push([bi, bj]);
  const corners = (bi, bj) => { const i = bi * S, j = bj * S; return [L(i, j), L(i + S, j), L(i, j + S), L(i + S, j + S)]; };
  // Heights where used, in lattice order (or read in that order from the bake). Recorded raw for the bake; adjusted for drawing later.
  const order = [];
  let k = 0;
  const readNew = () => {
    for (let i = 0; i < n; i += 1) {
      if (used[i] !== 1) continue;
      y[i] = heights ? heights[heights.offset + k++] : course.heightAt(x0 + (i % cols) * step, z0 + Math.floor(i / cols) * step);
      order.push(y[i]);
      used[i] = 2; // read
    }
  };
  // First the squares' corners, so the ground's own shape can decide where it needs the finer squares.
  for (const [bi, bj] of blocks) for (const v of corners(bi, bj)) if (!used[v]) used[v] = 1;
  readNew();
  const bend = c => { // how far a corner stands off the straight line of its neighbours, either way (metres)
    const i = c % cols, j = Math.floor(c / cols);
    let most = 0;
    if (i >= S && i + S < cols && used[c - S] && used[c + S]) most = Math.max(most, Math.abs(y[c] - (y[c - S] + y[c + S]) / 2));
    if (j >= S && j + S < rows && used[c - S * cols] && used[c + S * cols]) most = Math.max(most, Math.abs(y[c] - (y[c - S * cols] + y[c + S * cols]) / 2));
    return most;
  };
  for (const [bi, bj] of blocks) {
    const b = bj * bcols + bi;
    fine[b] = fineBlock(bi, bj) || corners(bi, bj).some(c => bend(c) > GRID.crestBend) ? 1 : 0;
  }
  const isFine = (bi, bj) => bi >= 0 && bj >= 0 && bi < bcols && bj < brows && fine[bj * bcols + bi] === 1;
  for (const [bi, bj] of blocks) {
    if (fine[bj * bcols + bi]) { for (let j = 0; j <= S; j += 1) for (let i = 0; i <= S; i += 1) { const q = L(bi * S + i, bj * S + j); if (!used[q]) used[q] = 1; } }
    else if (isFine(bi - 1, bj) || isFine(bi + 1, bj) || isFine(bi, bj - 1) || isFine(bi, bj + 1)) {
      const mark = q => { if (!used[q]) used[q] = 1; };
      mark(L(bi * S + S / 2, bj * S + S / 2)); // the fan's centre
      if (isFine(bi - 1, bj)) mark(L(bi * S, bj * S + S / 2));
      if (isFine(bi + 1, bj)) mark(L(bi * S + S, bj * S + S / 2));
      if (isFine(bi, bj - 1)) mark(L(bi * S + S / 2, bj * S));
      if (isFine(bi, bj + 1)) mark(L(bi * S + S / 2, bj * S + S));
    }
  }
  readNew();
  if (heights) heights.offset += k;
  if (adjust) for (let i = 0; i < n; i += 1) if (used[i]) y[i] = adjust(x0 + (i % cols) * step, z0 + Math.floor(i / cols) * step, y[i]);
  const quad = (a, b, d, e, block) => { // a b / d e, split along the diagonal whose ends are closest in height
    if (Math.abs(y[a] - y[e]) < Math.abs(y[b] - y[d])) tris.push(a, d, e, a, e, b); else tris.push(a, d, b, b, d, e);
    triBlock.push(block, block);
  };
  for (const [bi, bj] of blocks) {
    const block = bj * bcols + bi, i0 = bi * S, j0 = bj * S;
    if (fine[block]) {
      for (let j = 0; j < S; j += 1) for (let i = 0; i < S; i += 1) quad(L(i0 + i, j0 + j), L(i0 + i + 1, j0 + j), L(i0 + i, j0 + j + 1), L(i0 + i + 1, j0 + j + 1), block);
      continue;
    }
    const c = L(i0 + S / 2, j0 + S / 2);
    if (!used[c]) { quad(L(i0, j0), L(i0 + S, j0), L(i0, j0 + S), L(i0 + S, j0 + S), block); continue; }
    // Fan: walk the edge clockwise as seen from above (the same turning as the quads' triangles), taking midpoints where they exist.
    const ring = [L(i0, j0), L(i0 + S / 2, j0), L(i0 + S, j0), L(i0 + S, j0 + S / 2), L(i0 + S, j0 + S), L(i0 + S / 2, j0 + S), L(i0, j0 + S), L(i0, j0 + S / 2)]
      .filter(v => used[v]);
    for (let r = 0; r < ring.length; r += 1) { tris.push(c, ring[(r + 1) % ring.length], ring[r]); triBlock.push(block); }
  }
  // Normals from the nearest used neighbours each way (one or two lattice steps), so the split and unsplit parts light the same.
  const nrm = new Float32Array(n * 3);
  const side = (i, di, limit) => { for (let d = 1; d <= S; d += 1) { const q = i + di * d; if (d <= limit(d) && used[q]) return [q, d]; } return [i, 0]; };
  for (let i = 0; i < n; i += 1) {
    if (!used[i]) continue;
    const c = i % cols, r = Math.floor(i / cols);
    const [xa, da] = side(i, -1, d => c - d >= 0 ? d : -1), [xb, db] = side(i, 1, d => c + d < cols ? d : -1);
    const [za, ea] = side(i, -cols, d => r - d >= 0 ? d : -1), [zb, eb] = side(i, cols, d => r + d < rows ? d : -1);
    const nx = -(y[xb] - y[xa]) / (((da + db) || 1) * step), nz = -(y[zb] - y[za]) / (((ea + eb) || 1) * step), l = Math.hypot(nx, 1, nz);
    nrm[i * 3] = nx / l; nrm[i * 3 + 1] = 1 / l; nrm[i * 3 + 2] = nz / l;
  }
  // Shape, for the sand's look: how far past the lane's edge (metres, negative inside it), and how much the point stands above or sits
  // below its neighbours 2.5 m away (positive on a crest or a lip, negative in a hollow).
  const shape = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    if (!used[i]) continue;
    const c = i % cols, r = Math.floor(i / cols);
    let sum = 0, cnt = 0;
    for (const q of [c >= S ? i - S : -1, c + S < cols ? i + S : -1, r >= S ? i - S * cols : -1, r + S < rows ? i + S * cols : -1]) if (q >= 0 && used[q]) { sum += y[q]; cnt += 1; }
    shape[i * 2] = beyondAt ? beyondAt(c / S, r / S) : 0;
    shape[i * 2 + 1] = cnt ? y[i] - sum / cnt : 0;
  }
  // Tiles by block, each with its own compact vertex list.
  const groups = new Map();
  for (let t = 0; t < triBlock.length; t += 1) {
    const b = triBlock[t], key = Math.floor((b % bcols) / tile) + Math.floor(Math.floor(b / bcols) / tile) * 1e6;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const tiles = [];
  let vertexCount = 0, triangleCount = 0;
  for (const list of groups.values()) {
    const remap = new Map();
    const vert = i => { let v = remap.get(i); if (v === undefined) { v = remap.size; remap.set(i, v); } return v; };
    const idx = [];
    for (const t of list) idx.push(vert(tris[t * 3]), vert(tris[t * 3 + 1]), vert(tris[t * 3 + 2]));
    const m = remap.size;
    const positions = new Float32Array(m * 3), normals = new Float32Array(m * 3), shapes = new Float32Array(m * 2);
    for (const [i, v] of remap) {
      positions[v * 3] = x0 + (i % cols) * step; positions[v * 3 + 1] = y[i]; positions[v * 3 + 2] = z0 + Math.floor(i / cols) * step;
      normals.set(nrm.subarray(i * 3, i * 3 + 3), v * 3);
      shapes[v * 2] = shape[i * 2]; shapes[v * 2 + 1] = shape[i * 2 + 1];
    }
    tiles.push({ positions, normals, shapes, indices: m > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), vertexCount: m });
    vertexCount += m; triangleCount += idx.length / 3;
  }
  // For the blowing sand: every lattice point inside a kept block, with heights filled in across the unsplit squares.
  const filled = new Float32Array(n), known = new Uint8Array(n);
  for (const [bi, bj] of blocks) {
    const [a, b, d, e] = corners(bi, bj);
    for (let j = 0; j <= S; j += 1) for (let i = 0; i <= S; i += 1) {
      const q = L(bi * S + i, bj * S + j), u = i / S, v = j / S;
      filled[q] = used[q] && fine[bj * bcols + bi] ? y[q] : (y[a] * (1 - u) + y[b] * u) * (1 - v) + (y[d] * (1 - u) + y[e] * u) * v;
      known[q] = 1;
    }
  }
  const lattice = { x0, z0, cols, rows, step, heights: filled, used: known };
  return { tiles, order: Float32Array.from(order), vertexCount, triangleCount, lattice };
}

// `baked`: optional Float32Array of every used vertex height, coarse grid first then fine (from tools/bake-terrain.js).
//
// The two grids never overlap. The coarse one (40 m squares) only keeps squares that come nowhere near the run; every other square, and a
// ring of squares round them, is covered by the fine one instead. Where they meet, the fine grid's edge is bent onto the coarse grid's edge
// (blending over FIT metres), so the seam is closed: no gaps, nothing sunk out of sight, nothing poking through.
export function buildTerrainGrids(course, baked = null) {
  const heights = baked ? Object.assign(baked, { offset: 0 }) : null;
  const pts = course.points;
  const runMinX = Math.min(...pts.map(p => p[0])), runMaxX = Math.max(...pts.map(p => p[0]));
  const runMinZ = Math.min(...pts.map(p => p[1])), runMaxZ = Math.max(...pts.map(p => p[1]));

  // The coarse grid, and which of its squares the fine grid takes over.
  const fs = GRID.farStep, fm = GRID.farMargin;
  const fx0 = Math.floor((runMinX - fm) / fs) * fs, fz0 = Math.floor((runMinZ - fm) / fs) * fs;
  const fcols = Math.ceil((runMaxX + fm - fx0) / fs) + 1, frows = Math.ceil((runMaxZ + fm - fz0) / fs) + 1;
  const qcols = fcols - 1, qrows = frows - 1;
  // Distance past the lane's edge at half the coarse spacing: a square is near the run if any of its corners, edge middles or centre is.
  const hcols = fcols * 2 - 1, hbeyond = beyondField(course, fs / 2, fx0, fz0, hcols, frows * 2 - 1);
  const nearRun = new Uint8Array(qcols * qrows);
  for (let qj = 0; qj < qrows; qj += 1) for (let qi = 0; qi < qcols; qi += 1) {
    let near = false;
    for (let j = 0; j <= 2 && !near; j += 1) for (let i = 0; i <= 2; i += 1) if (hbeyond[(qj * 2 + j) * hcols + qi * 2 + i] <= GRID.farHoleBeyond) { near = true; break; }
    nearRun[qj * qcols + qi] = near ? 1 : 0;
  }
  const fineQuad = new Uint8Array(qcols * qrows); // near the run, or next to a square that is
  let fq0 = Infinity, fq1 = -Infinity, fr0 = Infinity, fr1 = -Infinity;
  for (let qj = 0; qj < qrows; qj += 1) for (let qi = 0; qi < qcols; qi += 1) {
    let any = false;
    for (let dj = -1; dj <= 1 && !any; dj += 1) for (let di = -1; di <= 1; di += 1) {
      const i = qi + di, j = qj + dj;
      if (i >= 0 && j >= 0 && i < qcols && j < qrows && nearRun[j * qcols + i]) { any = true; break; }
    }
    if (any) { fineQuad[qj * qcols + qi] = 1; fq0 = Math.min(fq0, qi); fq1 = Math.max(fq1, qi); fr0 = Math.min(fr0, qj); fr1 = Math.max(fr1, qj); }
  }
  const far = buildGrid(course, {
    step: fs, x0: fx0, z0: fz0, cols: fcols, rows: frows, heights,
    keepQuad: a => !fineQuad[Math.floor(a / fcols) * qcols + (a % fcols)] && (a % fcols) < qcols,
  });
  const farY = far.lattice.heights;
  const coarse = (i, j) => farY[j * fcols + i];
  const isCoarse = (qi, qj) => qi >= 0 && qj >= 0 && qi < qcols && qj < qrows && !fineQuad[qj * qcols + qi];

  // The fine grid over every square the coarse one gave up, lined up with it (16 fine squares to a coarse one).
  const ns = GRID.nearStep;
  const nx0 = fx0 + fq0 * fs, nz0 = fz0 + fr0 * fs;
  const ncols = (fq1 - fq0 + 1) * (fs / ns) + 1, nrows = (fr1 - fr0 + 1) * (fs / ns) + 1;
  const ms = ns * 4, mcols = Math.ceil(ncols / 4) + 2, mrows = Math.ceil(nrows / 4) + 2;
  const mask = beyondField(course, ms, nx0, nz0, mcols, mrows);
  const maskAt = (c, r) => {
    const u = Math.min(mcols - 1.001, c / 4), v = Math.min(mrows - 1.001, r / 4), i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const m = (a, b) => mask[b * mcols + a];
    return (m(i, j) * (1 - fu) + m(i + 1, j) * fu) * (1 - fv) + (m(i, j + 1) * (1 - fu) + m(i + 1, j + 1) * fu) * fv;
  };
  const per = fs / ns;
  // Bend the fine grid onto the coarse one near where they meet: the height the coarse surface has at the nearest point of the nearest
  // coarse square's edge, blended in over FIT metres.
  const FIT = 20;
  const adjust = (x, z, h) => {
    const qi = Math.floor((x - fx0) / fs), qj = Math.floor((z - fz0) / fs);
    let best = Infinity, target = h;
    for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
      const i = qi + di, j = qj + dj;
      if (!isCoarse(i, j)) continue;
      const ax = fx0 + i * fs, az = fz0 + j * fs; // the coarse square [ax, ax+fs] x [az, az+fs]
      const px = Math.min(Math.max(x, ax), ax + fs), pz = Math.min(Math.max(z, az), az + fs);
      const d = Math.hypot(x - px, z - pz);
      if (d >= best) continue;
      best = d;
      // on its edge, the coarse surface is a straight line between the edge's two corners (whichever way its square is split)
      const u = (px - ax) / fs, v = (pz - az) / fs;
      if (v <= 1e-9 || v >= 1 - 1e-9) { const jj = v < 0.5 ? j : j + 1; target = coarse(i, jj) * (1 - u) + coarse(i + 1, jj) * u; }
      else { const ii = u < 0.5 ? i : i + 1; target = coarse(ii, j) * (1 - v) + coarse(ii, j + 1) * v; }
    }
    if (best >= FIT) return h;
    const w = best / FIT, t = w * w * (3 - 2 * w);
    return target + (h - target) * t;
  };
  const near = buildNearGrid(course, {
    x0: nx0, z0: nz0, bcols: ncols - 1, brows: nrows - 1, heights, tile: GRID.tile,
    keepBlock: (bi, bj) => fineQuad[(fr0 + Math.floor(bj / per)) * qcols + fq0 + Math.floor(bi / per)] === 1,
    fineBlock: (bi, bj) => Math.min(maskAt(bi, bj), maskAt(bi + 1, bj), maskAt(bi, bj + 1), maskAt(bi + 1, bj + 1)) < GRID.laneBeyond,
    beyondAt: maskAt,
    adjust,
  });
  if (heights && heights.offset !== heights.length) throw new Error(`Baked terrain has ${heights.length} heights, the grids need ${heights.offset}. Run npm run bake.`);
  return { near, far };
}
