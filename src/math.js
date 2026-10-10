// Small shared maths. No three.js here so the course and the board can be tested in node.
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;

function hash(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 1337;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

// Smooth value noise in 0..1.
export function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy);
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), fx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
}

export function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * noise(x * f + i * 17.3, y * f - i * 9.1); norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

// Thumbstick axis with a deadzone, rescaled so the live range still reaches 1 (as in Oasis).
export function stickAxis(v, deadzone = 0.15) {
  return Math.abs(v) < deadzone ? 0 : Math.sign(v) * (Math.abs(v) - deadzone) / (1 - deadzone);
}

// Shortest signed angle from a to b.
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Axis snapping for a stick: pushed within `degrees` of straight left/right it's purely left/right, within `degrees` of straight up/down
// it's purely up/down; only real diagonals give both. Stops a sideways push from leaking a little of the other axis (a spin from picking
// up a bit of flip). Returns [x, y].
export function axisSnap(x, y, degrees = 20) {
  if (x === 0 || y === 0) return [x, y];
  const angle = Math.atan2(Math.abs(y), Math.abs(x)) * 180 / Math.PI; // 0 = straight sideways, 90 = straight up/down
  if (angle < degrees) return [x, 0];
  if (angle > 90 - degrees) return [0, y];
  return [x, y];
}
