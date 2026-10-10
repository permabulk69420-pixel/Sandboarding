// Rails: bars to jump onto and grind along, standing a little above the ground beside the lane. No three.js, so it is tested in node.
//
// A rail is a polyline along its top (the line the board rides): points about a metre apart, each with the unit direction of travel (the way
// the points run, downhill) and the distance along the rail from its first point. The course builds them from short descriptions
// (buildRail); the board asks where it is on one (nearestOnRail, railAt) and slides along it; the renderer draws the bar and its posts from
// the same points. The first few metres rise out of the ground and the last few sink back into it, so you can ride on and off without a jump.

import { clamp, mix, smooth } from './math.js';

export const RAIL = Object.freeze({
  spacing: 1, // metres between points
  height: 0.7, // how far the top of the bar stands above the ground
  entry: 5, // metres over which the bar rises out of the sand at its start...
  exit: 5, // ...and sinks back into it at its end
  minClear: 0.3, // the bar is never closer to the ground than this, away from its two ramps
  smoothing: 4, // points either side that are averaged, twice, to smooth the bar over the ground's small bumps
});

// A rail from points [x, y, z] along its top. `info` is carried on it (from, to, offset, entry, exit, height...).
export function railFromPoints(points, info = {}) {
  const n = points.length;
  if (n < 2) throw new Error('A rail needs at least two points.');
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const tx = new Float64Array(n), ty = new Float64Array(n), tz = new Float64Array(n), dist = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 1) {
    [x[i], y[i], z[i]] = points[i];
    minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]);
    minZ = Math.min(minZ, z[i]); maxZ = Math.max(maxZ, z[i]);
    if (i > 0) dist[i] = dist[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1], z[i] - z[i - 1]);
  }
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a], l = Math.hypot(dx, dy, dz) || 1;
    tx[i] = dx / l; ty[i] = dy / l; tz[i] = dz / l;
  }
  return { entry: RAIL.entry, exit: RAIL.exit, ...info, n, x, y, z, tx, ty, tz, dist, length: dist[n - 1], minX, maxX, minY, maxY, minZ, maxZ };
}

// The rail's place and unit direction at distance u along it (clamped to its ends): { x, y, z, tx, ty, tz }.
export function railAt(rail, u, out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1 }) {
  const { dist } = rail;
  u = clamp(u, 0, rail.length);
  let lo = 0, hi = rail.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (dist[mid] <= u) lo = mid; else hi = mid; }
  const t = (u - dist[lo]) / ((dist[hi] - dist[lo]) || 1);
  out.x = mix(rail.x[lo], rail.x[hi], t); out.y = mix(rail.y[lo], rail.y[hi], t); out.z = mix(rail.z[lo], rail.z[hi], t);
  const dx = mix(rail.tx[lo], rail.tx[hi], t), dy = mix(rail.ty[lo], rail.ty[hi], t), dz = mix(rail.tz[lo], rail.tz[hi], t), l = Math.hypot(dx, dy, dz) || 1;
  out.tx = dx / l; out.ty = dy / l; out.tz = dz / l;
  return out;
}

// The point on the rail nearest (x, z) seen from above: how far along it (`u`) and how far off to the side (`d`, metres, in plan).
export function nearestOnRail(rail, x, z, out = { u: 0, d: 0 }) {
  const { n, dist } = rail, rx = rail.x, rz = rail.z;
  let best = Infinity, bu = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const ax = rx[i], az = rz[i], ex = rx[i + 1] - ax, ez = rz[i + 1] - az, l2 = ex * ex + ez * ez;
    const t = l2 > 1e-12 ? clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1) : 0;
    const dx = x - ax - ex * t, dz = z - az - ez * t, d2 = dx * dx + dz * dz;
    if (d2 < best) { best = d2; bu = dist[i] + t * (dist[i + 1] - dist[i]); }
  }
  out.u = bu; out.d = Math.sqrt(best);
  return out;
}

// The direction the board's nose points when it rides the rail forwards (three.js yaw: 0 faces -z, positive turns left).
export const railYaw = (tx, tz) => Math.atan2(-tx, -tz);

// Averages each value with its neighbours `radius` points either side (fewer at the ends).
function blur(values, radius) {
  return values.map((_, i) => {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j += 1) { sum += values[j]; c += 1; }
    return sum / c;
  });
}

function keyed(keys) {
  return s => {
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i += 1) if (s <= keys[i][0]) {
      const [a, va] = keys[i - 1], [b, vb] = keys[i]; return mix(va, vb, smooth(0, 1, (s - a) / (b - a)));
    }
    return keys[keys.length - 1][1];
  };
}

// A rail from its description in a course: { from, to, offset, height?, entry?, exit? }.
//  from, to   metres along the run (design metres, stretched by `k` like everything else in a course)
//  offset     metres right of the centre line (negative = left), or keys [[s, offset], ...] to drift across the lane
//  height     how far the top of the bar stands above the ground
//  entry/exit metres over which the bar rises out of the sand and sinks back into it
// `centreAt(s)` gives { x, z, yaw } on the centre line and `heightAt(x, z)` the ground.
export function buildRail(spec, { centreAt, heightAt }, k = 1) {
  const from = spec.from * k, to = spec.to * k;
  const height = spec.height ?? RAIL.height, entry = spec.entry ?? RAIL.entry, exit = spec.exit ?? RAIL.exit;
  const offsetAt = Array.isArray(spec.offset) ? keyed(spec.offset.map(([s, v]) => [s * k, v])) : () => spec.offset ?? 0;
  const count = Math.max(2, Math.round((to - from) / RAIL.spacing) + 1);
  const xs = [], zs = [], ground = [], arc = [0];
  for (let i = 0; i < count; i += 1) {
    const s = mix(from, to, i / (count - 1)), c = centreAt(s), o = offsetAt(s);
    const x = c.x + Math.cos(c.yaw) * o, z = c.z - Math.sin(c.yaw) * o; // right of travel is (cos yaw, -sin yaw)
    xs.push(x); zs.push(z); ground.push(heightAt(x, z));
    if (i > 0) arc.push(arc[i - 1] + Math.hypot(x - xs[i - 1], z - zs[i - 1]));
  }
  const total = arc[count - 1];
  // The bar follows the ground at a steady height, smoothed so it does not copy every bump; it rises out of the sand at the start and sinks
  // back at the end, and is never closer to the ground than minClear in between.
  let y = blur(blur(ground.map(g => g + height), RAIL.smoothing), RAIL.smoothing);
  const weight = i => smooth(0, entry, arc[i]) * smooth(0, exit, total - arc[i]);
  y = y.map((v, i) => mix(ground[i], v, weight(i)));
  y = y.map((v, i) => Math.max(v, ground[i] + RAIL.minClear * weight(i)));
  const points = y.map((v, i) => [xs[i], v, zs[i]]);
  return railFromPoints(points, { from, to, offset: spec.offset ?? 0, offsetAt, height, entry, exit, ground: Float64Array.from(ground) });
}

// What is wrong with a rail on a course, if anything (a list of plain-English problems, empty when it is fine). The rules every rail has to
// keep: well away from the racing line (so a rider following the lane never meets one by accident), inside the lane, clear of everything
// that shapes the lane's ground (kickers, gaps, rollers, side hits), clear of the gates, over ground the bar can follow, and long enough to
// be worth riding. `course` is a built course (src/course.js).
export function railProblems(rail, course, { minLength = 30, minOffset = 6.5, lanePad = 3, obstaclePad = 6 } = {}) {
  const out = [];
  if (rail.from < course.startS + 30) out.push(`starts at ${rail.from.toFixed(0)} m, too near the start gate`);
  if (rail.to > course.finishS - 30) out.push(`ends at ${rail.to.toFixed(0)} m, too near the finish gate`);
  if (rail.length < minLength) out.push(`only ${rail.length.toFixed(0)} m long`);
  const offsetAt = rail.offsetAt || (() => rail.offset ?? 0);
  for (let s = rail.from; s <= rail.to + 1e-6; s += 5) {
    const o = offsetAt(s), w = course.halfWidth(s);
    if (Math.abs(o) < minOffset) { out.push(`${o.toFixed(1)} m from the centre line at ${s.toFixed(0)} m: too near the racing line`); break; }
    if (Math.abs(o) > w - lanePad) { out.push(`${o.toFixed(1)} m out at ${s.toFixed(0)} m, but the lane is only ${w.toFixed(1)} m either side there`); break; }
  }
  for (const ob of course.obstacles || []) {
    if (ob.to < rail.from - obstaclePad || ob.from > rail.to + obstaclePad) continue;
    for (let s = Math.max(rail.from, ob.from - obstaclePad); s <= Math.min(rail.to, ob.to + obstaclePad) + 1e-6; s += 2) {
      const o = offsetAt(s);
      if (o > ob.lo - 2 && o < ob.hi + 2) { out.push(`crosses the ${ob.type} at ${ob.from.toFixed(0)}-${ob.to.toFixed(0)} m`); break; }
    }
  }
  for (let i = 0; i < rail.n; i += 1) {
    if (rail.dist[i] < 7 || rail.length - rail.dist[i] < 7) continue; // the ramps meet the sand on purpose
    const clear = rail.y[i] - rail.ground[i];
    if (clear < 0.25 || clear > 1.8) { out.push(`${clear.toFixed(2)} m above the sand at ${(rail.from + rail.dist[i]).toFixed(0)} m`); break; }
  }
  for (let i = 0; i < rail.n; i += 1) {
    if (rail.dist[i] < 7 || rail.length - rail.dist[i] < 7) continue;
    const slope = Math.asin(-rail.ty[i]) * 180 / Math.PI;
    if (slope > 40 || slope < -2) { out.push(`${slope.toFixed(0)} degrees at ${(rail.from + rail.dist[i]).toFixed(0)} m`); break; }
  }
  return out;
}
