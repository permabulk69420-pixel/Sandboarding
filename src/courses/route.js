// Helpers for laying out a run without hand-placing every number. A course is still plain data; these just build two of its lists.
//
//  route(start, legs)    the centre line: a start and then legs of [length, turn]. A leg with turn 0 is straight; otherwise it is an arc of
//                        constant radius (radius = length / turn in radians). Heading is in degrees: 0 heads toward -z, positive turns left.
//  descent(top, pieces)  the elevation profile: a top height and then pieces of [length, slope in degrees], blended smoothly where one piece
//                        meets the next. A slope of 0 is level, a positive slope runs downhill. A piece may also be [length, slope, slope] to
//                        ease from the first slope to the second.
//
// Both return the same shapes the hand-written courses use: route gives [x, z] control points, descent gives [s, height] keys.

const RAD = Math.PI / 180;

export function route({ x = 0, z = 0, heading = 0 }, legs, spacing = 60) {
  const points = [[x, z]];
  let h = heading * RAD, px = x, pz = z;
  for (const [length, turn = 0] of legs) {
    const n = Math.max(1, Math.round(length / spacing)), ds = length / n, dh = (turn * RAD) / n;
    for (let i = 0; i < n; i += 1) {
      const mid = h + dh / 2; // step along the arc using the heading half way through it
      px -= Math.sin(mid) * ds; pz -= Math.cos(mid) * ds; h += dh;
      points.push([Math.round(px * 10) / 10, Math.round(pz * 10) / 10]);
    }
  }
  return points;
}

export function descent(top, pieces, { blend = 36, every = 12 } = {}) {
  const edges = []; // where each piece starts, its start and end slope
  let at = 0;
  for (const [length, a, b = a] of pieces) { edges.push({ from: at, to: at + length, a, b }); at += length; }
  const total = at;
  const smooth = t => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
  const slopeIn = (p, s) => p.a + (p.b - p.a) * smooth((s - p.from) / (p.to - p.from));
  const slopeAt = s => {
    let i = edges.findIndex(p => s < p.to); if (i < 0) i = edges.length - 1;
    let v = slopeIn(edges[i], s);
    const prev = edges[i - 1], next = edges[i + 1];
    // Across a join, blend the two pieces' slopes over `blend` metres centred on it.
    if (prev && s < edges[i].from + blend / 2) v = slopeIn(prev, s) + (v - slopeIn(prev, s)) * smooth((s - (edges[i].from - blend / 2)) / blend);
    else if (next && s > edges[i].to - blend / 2) v += (slopeIn(next, s) - v) * smooth((s - (edges[i].to - blend / 2)) / blend);
    return v;
  };
  const keys = [[0, top]];
  let y = top, sNow = 0, nextKey = every;
  const dx = 0.5;
  while (sNow < total) {
    const s1 = Math.min(total, sNow + dx);
    y -= Math.tan(slopeAt((sNow + s1) / 2) * RAD) * (s1 - sNow);
    sNow = s1;
    if (sNow >= nextKey - 1e-9 || sNow >= total) { keys.push([Math.round(sNow * 10) / 10, Math.round(y * 10) / 10]); nextKey += every; }
  }
  return keys;
}
