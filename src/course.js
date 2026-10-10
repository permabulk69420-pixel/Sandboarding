// Turns a course definition (src/courses/) into ground: a height and slope anywhere, and where along the run a point is.
//
// A course is a centre line (a smooth curve through hand-placed points) with an elevation profile along it. The ground is the lower of
// two shapes, so it is continuous everywhere:
//  - the CHANNEL: the lowest of one shaped surface per stretch of centre line. Each stretch carves a dished lane and rises into walls on
//    both sides that keep climbing (so a stretch only matters near itself). Features along the lane (rollers, kickers, a narrow gully,
//    banked turns) are part of each stretch's shape.
//  - the MOUNTAIN: a smooth landform that follows the run's height plus a ridge, and falls away on every side to a dune plain.
// Near the run the channel is lower, so you ride in a lane between ridges; away from it the mountain is, so the summit is a real top
// with the desert spread out below. Pure maths, no three.js, so it is tested in node.

import { clamp, mix, smooth, fbm, noise } from './math.js';
import { COURSES } from './courses/index.js';
import { buildRail } from './rails.js';

// The shaping rules every course shares. Each course's own layout lives in src/courses/.
export const COURSE = Object.freeze({
  checkpointEvery: 120,
  wallSteep: 0.05, // how quickly the walls curve up beyond the lane
  flank: 0.55, // the channel's walls keep climbing at this slope (must stay above the run's own slope, so stretches stay local)
  fall: 0.62, // the mountain's sides fall away at this slope beyond the ridge
  // The dune sea on the plain below: rows of big dunes across the wind (which blows toward +x+z, as the sand ripples and the blowing sand),
  // each a long gentle climb and a steep slip face downwind. They grow in from `duneFrom` to `duneFull` metres past the lane's edge, so
  // they never touch the run.
  duneSpacing: 420, // metres from one crest to the next
  duneHeight: [12, 50], // lowest and tallest crests, metres
  duneFrom: 130,
  duneFull: 450,
});

// The dune sea's height at (x, z), before it is faded in. Rows across the wind, bent and broken up by slow noise.
const DUNE_WIND = [0.82, 0.57];
export function duneSea(x, z) {
  const u = x * DUNE_WIND[0] + z * DUNE_WIND[1], v = -x * DUNE_WIND[1] + z * DUNE_WIND[0];
  const phase = u / COURSE.duneSpacing + (fbm(v * 0.0016 + 11.3, u * 0.0006 - 4.1, 3) - 0.5) * 2.4 + (noise(v * 0.005, u * 0.003) - 0.5) * 0.35;
  const f = phase - Math.floor(phase); // 0 to 1 across one dune, upwind to downwind
  const shape = f < 0.72 ? smooth(0, 1, f / 0.72) : 1 - smooth(0, 1, (f - 0.72) / 0.28);
  const [lo, hi] = COURSE.duneHeight;
  return shape * mix(lo, hi, smooth(0.25, 0.75, fbm(x * 0.0011 + 3.1, z * 0.0011 - 7.7, 3)));
}

// ---------------------------------------------------------------- the centre line
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function sampleCentreLine(CONTROL, step = 1) {
  const dense = [];
  for (let i = 0; i < CONTROL.length - 1; i += 1) {
    const p0 = CONTROL[Math.max(0, i - 1)], p1 = CONTROL[i], p2 = CONTROL[i + 1], p3 = CONTROL[Math.min(CONTROL.length - 1, i + 2)];
    for (let k = 0; k < 40; k += 1) {
      const t = k / 40;
      dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  dense.push(CONTROL[CONTROL.length - 1].slice());
  // Resample at even arc length.
  const out = [dense[0]];
  let carry = 0;
  for (let i = 1; i < dense.length; i += 1) {
    const [ax, az] = dense[i - 1], [bx, bz] = dense[i];
    const len = Math.hypot(bx - ax, bz - az);
    let pos = step - carry;
    while (pos <= len) {
      const t = pos / len; out.push([mix(ax, bx, t), mix(az, bz, t)]); pos += step;
    }
    carry = len - (pos - step);
  }
  return out;
}

// Monotone cubic (Fritsch-Carlson) through [x, y] keys.
function monotone(keys) {
  const n = keys.length, xs = keys.map(k => k[0]), ys = keys.map(k => k[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 3 * (d[i - 1] + d[i]) / ((2 * d[i] + d[i - 1]) / d[i - 1] + (d[i] + 2 * d[i - 1]) / d[i]);
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

function linearKeys(keys) {
  return s => {
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i += 1) if (s <= keys[i][0]) {
      const [a, va] = keys[i - 1], [b, vb] = keys[i]; return mix(va, vb, smooth(0, 1, (s - a) / (b - a)));
    }
    return keys[keys.length - 1][1];
  };
}

// ---------------------------------------------------------------- build
export function createCourse(def = COURSES[0]) {
  const pts = sampleCentreLine(def.control, 1);
  const n = pts.length;
  const length = n - 1;
  const k = length / def.designLength;
  const elevation = monotone(def.profile.map(([s, y]) => [s * k, y]));
  const halfWidth = linearKeys(def.width.map(([s, w]) => [s * k, w]));
  const ridgeAt = linearKeys(def.ridge.map(([s, r]) => [s * k, r]));
  const rollers = (def.rollers || []).map(r => ({ ...r, from: r.from * k, to: r.to * k }));
  const kickers = (def.kickers || []).map(kk => ({ ...kk, at: kk.at * k }));
  const gaps = (def.gaps || []).map(gp => ({ ...gp, from: gp.from * k, to: gp.to * k }));
  const sideHits = (def.sideHits || []).map(sh => ({ ...sh, at: sh.at * k }));

  // Per-point tangent and smoothed signed curvature (positive = turning left).
  const tx = new Float64Array(n), tz = new Float64Array(n), rawK = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; tx[i] = (b[0] - a[0]) / l; tz[i] = (b[1] - a[1]) / l;
  }
  for (let i = 4; i < n - 4; i += 1) {
    let dh = Math.atan2(tx[i + 4], tz[i + 4]) - Math.atan2(tx[i - 4], tz[i - 4]);
    if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
    rawK[i] = dh / 8;
  }

  // Per-point values, interpolated along each stretch: elevation, lane half width, bank, and the features' height on the centre line.
  const E = new Float64Array(n), W = new Float64Array(n), B = new Float64Array(n), R = new Float64Array(n), K = new Float64Array(n), KL = new Float64Array(n), KE = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0, c = 0; // 41 m box smoothing so banks build and fade gently
    for (let j = i - 20; j <= i + 20; j += 1) if (j >= 0 && j < n) { sum += rawK[j]; c += 1; }
    B[i] = clamp((sum / c) * 34, -0.42, 0.42); // rise of the outside of a turn, per metre across the lane: berms you can lean into
    E[i] = elevation(i); W[i] = halfWidth(i); KL[i] = 6; KE[i] = 1.8;
    for (const r of rollers) if (i >= r.from && i <= r.to) {
      R[i] += r.height * Math.sin(((i - r.from) / r.wavelength) * Math.PI * 2) * smooth(r.from, r.from + 12, i) * (1 - smooth(r.to - 12, r.to, i));
    }
    for (const kk of kickers) {
      const start = kk.at - kk.length;
      if (i < start || i > kk.at + kk.drop) continue;
      K[i] += kk.height * (i <= kk.at ? ((i - start) / kk.length) ** kk.curve : 1 - smooth(0, 1, (i - kk.at) / kk.drop));
      KL[i] = kk.lane; KE[i] = Math.max(KE[i], kk.edge ?? 1.8); // the ramp's sides fall away over `edge` metres: a tall ramp needs more than a short one
    }
    for (const gp of gaps) if (i >= gp.from && i <= gp.to) {
      const u = (i - gp.from) / (gp.to - gp.from);
      K[i] -= gp.depth * (u < gp.bottom ? smooth(0, 1, u / gp.bottom) : 1 - smooth(0, 1, (u - gp.bottom) / (1 - gp.bottom)));
      KL[i] = Math.max(KL[i], gp.lane); KE[i] = Math.max(KE[i], gp.edge ?? 1.8); // a gap's walls fall away over `edge` metres: deep ones need room to be climbable-looking, not seams
    }
  }
  // The mountain: every 4th centre-line point carries the height of the ridge tops and the lane's half width there, blended smoothly
  // across the map with a Gaussian (so it has no seams where bends meet).
  const MS = [];
  for (let i = 0; i < n; i += 4) MS.push({ x: pts[i][0], z: pts[i][1], top: E[i] + ridgeAt(i), w: W[i] });
  const SIGMA = 55, INV = 1 / (2 * SIGMA * SIGMA), SKIP = 24 / INV; // weights are relative to the nearest sample, so none underflow
  function mountain(x, z, near) {
    let d2min = Infinity;
    for (let q = 0; q < MS.length; q += 1) { const dx = x - MS[q].x, dz = z - MS[q].z; const d2 = dx * dx + dz * dz; if (d2 < d2min) d2min = d2; }
    let wsum = 0, top = 0, w = 0;
    for (let q = 0; q < MS.length; q += 1) {
      const m = MS[q], dx = x - m.x, dz = z - m.z, rel = dx * dx + dz * dz - d2min;
      if (rel > SKIP) continue; // weight below e^-24: makes no difference
      const wt = Math.exp(-rel * INV); wsum += wt; top += wt * m.top; w += wt * m.w;
    }
    top /= wsum; w /= wsum;
    const flank = top - COURSE.fall * Math.max(0, near - w - 16);
    const out = near - w, plain = def.plain ?? -16;
    const floor = out > COURSE.duneFrom ? plain + duneSea(x, z) * smooth(COURSE.duneFrom, COURSE.duneFull, out) : plain;
    // a smooth maximum, so the dunes run up into the mountain's foot without a crease
    const k = 16, gap = Math.max(0, k - Math.abs(flank - floor)) / k;
    return Math.max(flank, floor) + gap * gap * k * 0.25;
  }

  // Kicker lips are sharper than the 1 m spacing: place the exact lip on the nearest point.
  for (const kk of kickers) { const i = Math.round(kk.at); K[i] = Math.max(K[i], kk.height); }

  const SEG_LEN = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) SEG_LEN[i] = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  // A stretch rises this steeply beyond its own ends, so each one only shapes the ground beside it. It has to be steep: anything along the
  // lane taller than this slope times the distance (a kicker's lip, a roller's crest) would otherwise be sliced off by its neighbours.
  const OVERSHOOT = 3.5;
  const KNEE = 14; // metres beyond the lane where the curved wall hands over to the flank's straight climb

  // The shaped surface of one stretch [i, i+1] at world (x, z), before the noise. Continuous in x and z.
  function stretchHeight(i, x, z) {
    const ax = pts[i][0], az = pts[i][1], len = SEG_LEN[i];
    const ex = (pts[i + 1][0] - ax) / len, ez = (pts[i + 1][1] - az) / len;
    const along = (x - ax) * ex + (z - az) * ez;
    const cross = ex * (z - az) - ez * (x - ax); // signed distance across: positive = right of travel
    const t = clamp(along / len, 0, 1);
    const over = along < 0 ? -along : along > len ? along - len : 0;
    const j = i + 1;
    const w = mix(W[i], W[j], t), ad = Math.abs(cross), inLane = Math.min(ad, w);
    // A shallow dish across the lane so you drift back to the middle (about 2 m deep at the edge of a normal lane, never more than 4.5 m
    // across the wide bowl), and banked turns (the bank stops growing 15 m out, so wide sections don't tip over).
    const dish = w <= 15 ? 0.010 : mix(2.25, 4.5, smooth(15, 50, w)) / (w * w);
    const bankReach = Math.min(w, 15);
    let h = mix(E[i], E[j], t) + dish * inLane * inLane + mix(B[i], B[j], t) * clamp(cross, -bankReach, bankReach);
    const roll = mix(R[i], R[j], t), kick = mix(K[i], K[j], t);
    if (roll !== 0) h += roll * (1 - smooth(w - 5, w, ad));
    if (kick !== 0) { const lane = Math.max(KL[i], KL[j]), edge = Math.max(KE[i], KE[j]); h += kick * (1 - smooth(lane, lane + edge, ad)); } // built sides: a short, sharp fall-off
    const s = i + t;
    for (let q = 0; q < sideHits.length; q += 1) {
      const sh = sideHits[q];
      if (s < sh.at - sh.length || s > sh.at + sh.drop) continue;
      const shape = s <= sh.at ? ((s - (sh.at - sh.length)) / sh.length) ** sh.curve : 1 - smooth(0, 1, (s - sh.at) / sh.drop);
      h += sh.height * shape * (1 - smooth(sh.lane, sh.lane + 2.5, Math.abs(cross - sh.offset)));
    }
    const out = Math.max(0, ad - w);
    const gully = 1 - smooth(9, 15, w); // 1 in the narrow gully: taller, steeper walls
    const steep = COURSE.wallSteep * (1 + 1.0 * gully); // tall canyon walls, but not so steep they turn to stair steps
    h += out < KNEE ? steep * out * out : steep * KNEE * KNEE + COURSE.flank * (out - KNEE);
    return h + over * OVERSHOOT;
  }

  // Spatial lists: for each 8 m cell, the stretches that can be the lowest there (within 45 m of the closest one).
  const CELL = 8, REACH = 30, BOUND = 900;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const gx0 = Math.floor((minX - BOUND) / CELL), gz0 = Math.floor((minZ - BOUND) / CELL);
  const gw = Math.ceil((maxX + BOUND) / CELL) - gx0, gh = Math.ceil((maxZ + BOUND) / CELL) - gz0;
  const lists = new Array(gw * gh);
  const coarse = []; for (let i = 0; i < n - 1; i += 3) coarse.push(i); if (coarse[coarse.length - 1] !== n - 2) coarse.push(n - 2);

  function segDist(i, x, z) {
    const ax = pts[i][0], az = pts[i][1], ex = pts[i + 1][0] - ax, ez = pts[i + 1][1] - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    return Math.hypot(x - ax - ex * t, z - az - ez * t);
  }
  // A stretch can only be the lowest in a cell if its lowest possible height there is below the best guaranteed height. Lower bound per
  // stretch: its lowest elevation, minus the most a bank or roller can take away, plus the wall at its nearest approach to the cell.
  const wallMin = out => (out < KNEE ? COURSE.wallSteep * out * out : COURSE.wallSteep * KNEE * KNEE + COURSE.flank * (out - KNEE));
  const ROLL_MAX = Math.max(0, ...rollers.map(r => r.height));
  const LOW = new Float64Array(n - 1), WMAX = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    WMAX[i] = Math.max(W[i], W[i + 1]);
    LOW[i] = Math.min(E[i], E[i + 1]) - Math.max(Math.abs(B[i]), Math.abs(B[i + 1])) * WMAX[i] - ROLL_MAX;
  }
  function cellList(cx, cz) {
    const key = cz * gw + cx;
    if (lists[key]) return lists[key];
    const x0 = (gx0 + cx) * CELL, z0 = (gz0 + cz) * CELL, half = CELL * Math.SQRT1_2;
    const mx = x0 + CELL / 2, mz = z0 + CELL / 2;
    const dist = new Float64Array(n - 1);
    let best = Infinity, bestI = 0;
    for (let i = 0; i < n - 1; i += 1) { dist[i] = segDist(i, mx, mz); if (dist[i] < best) { best = dist[i]; bestI = i; } }
    // Guaranteed ceiling: the nearest stretch's height at the cell's corners and centre, plus a margin for the curve between them.
    let ceiling = -Infinity;
    for (const [px, pz] of [[x0, z0], [x0 + CELL, z0], [x0, z0 + CELL], [x0 + CELL, z0 + CELL], [mx, mz]]) {
      let lo = Infinity;
      for (let i = Math.max(0, bestI - REACH); i < Math.min(n - 1, bestI + REACH); i += 1) lo = Math.min(lo, stretchHeight(i, px, pz));
      ceiling = Math.max(ceiling, lo);
    }
    ceiling += 3;
    const list = [];
    for (let i = 0; i < n - 1; i += 1) {
      if (dist[i] <= best + 2 * half || LOW[i] + wallMin(Math.max(0, dist[i] - half - WMAX[i])) <= ceiling) list.push(i);
    }
    lists[key] = Int32Array.from(list);
    return lists[key];
  }

  function rawHeightAt(x, z) {
    const cx = Math.floor(x / CELL) - gx0, cz = Math.floor(z / CELL) - gz0;
    const list = cx >= 0 && cz >= 0 && cx < gw && cz < gh ? cellList(cx, cz) : coarse;
    let h = Infinity, near = Infinity, nearI = 0;
    for (let q = 0; q < list.length; q += 1) {
      const i = list[q];
      const v = stretchHeight(i, x, z); if (v < h) h = v;
      const dd = segDist(i, x, z); if (dd < near) { near = dd; nearI = i; }
    }
    // The lower of the channel and the mountain, blended over a few metres so ridge crests are rounded, not knife edges.
    const m = mountain(x, z, near), blend = Math.max(0, 5 - Math.abs(h - m)) / 5;
    h = Math.min(h, m) - blend * blend * 1.25;
    // Lumpy dunes on the walls, the mountain and the plain; none in the lane.
    const out = Math.max(0, near - W[nearI]);
    if (out > 0) {
      const rough = smooth(0, 10, out);
      h += rough * ((fbm(x * 0.012, z * 0.012, 4) - 0.5) * 14 * smooth(0, 60, out) + (noise(x * 0.09, z * 0.09) - 0.5) * 1.4);
    }
    return h;
  }

  // A level pad for a building (the lodge): a rectangle set square to the run at `pad.s`, `across` either side of the centre line,
  // reaching `ahead` metres downhill and `behind` uphill, levelled to the ground's height on the centre line there, and blended back into
  // the slope over `blend` metres round it.
  const pad = def.pad ? (() => {
    const s0 = def.pad.s * k, i = Math.round(s0), [px, pz] = pts[i];
    return { ...def.pad, x: px, z: pz, tx: tx[i], tz: tz[i], height: rawHeightAt(px, pz), blend: def.pad.blend ?? 16 };
  })() : null;
  function heightAt(x, z) {
    const h = rawHeightAt(x, z);
    if (!pad) return h;
    const dx = x - pad.x, dz = z - pad.z;
    const a = dx * pad.tx + dz * pad.tz; // along the run (downhill +)
    const c = dx * -pad.tz + dz * pad.tx; // across
    const out = Math.hypot(Math.max(0, a - pad.ahead, -pad.behind - a), Math.max(0, Math.abs(c) - pad.across));
    if (out >= pad.blend) return h;
    return mix(pad.height, h, smooth(0, pad.blend, out));
  }

  const EPS = 0.35;
  function normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const hx = heightAt(x + EPS, z) - heightAt(x - EPS, z), hz = heightAt(x, z + EPS) - heightAt(x, z - EPS);
    const nx = -hx, ny = 2 * EPS, nz = -hz, l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  // Where along the run a point is: arc length, signed offset across the lane, distance from the centre line.
  function locate(x, z) {
    const cx = Math.floor(x / CELL) - gx0, cz = Math.floor(z / CELL) - gz0;
    const list = cx >= 0 && cz >= 0 && cx < gw && cz < gh ? cellList(cx, cz) : coarse;
    let best = Infinity, bi = 0;
    for (let k = 0; k < list.length; k += 1) { const dd = segDist(list[k], x, z); if (dd < best) { best = dd; bi = list[k]; } }
    const ax = pts[bi][0], az = pts[bi][1], ex = pts[bi + 1][0] - ax, ez = pts[bi + 1][1] - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    return { s: bi + t, distance: best, halfWidth: halfWidth(bi + t) };
  }

  // A point on the centre line and the downhill heading there (three.js yaw: 0 faces -z, positive turns left).
  function centreAt(s) {
    const i = clamp(Math.floor(s), 0, n - 2), t = clamp(s - i, 0, 1);
    return { x: mix(pts[i][0], pts[i + 1][0], t), z: mix(pts[i][1], pts[i + 1][1], t), yaw: Math.atan2(-tx[i], -tz[i]) };
  }
  function pointAt(s) {
    const c = centreAt(s);
    return { x: c.x, z: c.z, y: heightAt(c.x, c.z), yaw: c.yaw };
  }

  // Rails (src/rails.js): bars beside the lane to jump onto and grind. Built over the ground as it is, so they follow it.
  const rails = (def.rails || []).map(spec => buildRail(spec, { centreAt, heightAt }, k));
  // Everything that shapes the lane's ground, with the stretch of the run it covers (from, to) and the strip across the lane it reaches
  // (lo, hi: metres right of the centre line), so a rail can be checked for keeping clear of them.
  const obstacles = [
    ...kickers.map(kk => ({ type: 'kicker', from: kk.at - kk.length, to: kk.at + kk.drop, lo: -(kk.lane + (kk.edge ?? 1.8)), hi: kk.lane + (kk.edge ?? 1.8) })),
    ...gaps.map(gp => ({ type: 'gap', from: gp.from, to: gp.to, lo: -(gp.lane + (gp.edge ?? 1.8)), hi: gp.lane + (gp.edge ?? 1.8) })),
    ...rollers.map(r => { const w = Math.max(halfWidth(r.from), halfWidth((r.from + r.to) / 2), halfWidth(r.to)); return { type: 'roller', from: r.from, to: r.to, lo: -w, hi: w }; }),
    ...sideHits.map(sh => ({ type: 'side', from: sh.at - sh.length, to: sh.at + sh.drop, lo: sh.offset - sh.lane - 2.5, hi: sh.offset + sh.lane + 2.5 })),
  ];

  return {
    length, points: pts, heightAt, normalAt, locate, pointAt, elevation, halfWidth, rails, obstacles,
    id: def.id, name: def.name, startS: def.startS * k, finishS: def.finishS * k, plain: def.plain ?? -16,
    pad: pad && { x: pad.x, z: pad.z, height: pad.height, s: def.pad.s * k },
    landmarks: (def.landmarks || []).map(l => (l.s === undefined ? l : { ...l, s: l.s * k })), // placed by `at` rather than `s`: nothing to scale
    kickers: kickers.map(kk => kk.at),
    // How far past each lip (metres along the run) a standing rider may land. Normal kickers throw you about 80 m; a kicker built for a long
    // flight says so with `reach`, and the tests and ride-check look for the landing that far on.
    kickerReach: kickers.map(kk => kk.reach ?? 80),
    // Stretches where the lane is meant to be steep (kicker ramps and landings, the gap), for tests and anything that wants to know.
    features: [...kickers.map(kk => ({ type: 'kicker', from: kk.at - kk.length, to: kk.at + kk.drop })), ...gaps.map(gp => ({ type: 'gap', from: gp.from, to: gp.to })),
      ...sideHits.map(sh => ({ type: 'side', from: sh.at - sh.length, to: sh.at + sh.drop, offset: sh.offset })),
      ...(pad ? [{ type: 'pad', from: 0 , to: def.pad.s * k + pad.ahead + pad.blend }] : [])], bounds: { minX: minX - BOUND, maxX: maxX + BOUND, minZ: minZ - BOUND, maxZ: maxZ + BOUND },
  };
}
