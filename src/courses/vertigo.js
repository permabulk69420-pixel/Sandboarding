// Run 2: Vertigo. A 4 km run down a spire of red rock from a summit well over a kilometre up. It is steep from the first turn and it never
// lets go: a cliff to jump off, a knife-edge crest with nothing either side of it, three step-down jumps, a gap you cannot see the bottom of,
// a canyon of rollers, and a last leap that takes you over five seconds to come down from.
//
// Written with the helpers in route.js: `route` lays the centre line out as legs (length, turn) and `descent` the height as pieces (length,
// slope). Distances along the run ("s") are metres along the centre line from its first point; heights are metres.

import { route, descent } from './route.js';

// 560 straight (summit, chute, the cliff), the crest's long S-bends, the stepping stones, a bend, the gap, the canyon, the last leap. The
// stepping stones' straight is long: a fast rider flies 180 m off each stone, and needs 60 m on the ground between them to settle (a landing
// that is still correcting drifts wide on the next flight), and the last one must land before the bend.
const CONTROL = route({ x: 0, z: 40 }, [
  [560, 0],
  [170, -34], [260, 60], [260, -60], [260, 60], [170, -26],
  [700, 0],
  [170, 36], [170, -36],
  [360, 0],
  [110, 0], [200, 34], [200, -34],
  [620, 0],
]);
const DESIGN_LENGTH = 4212;

// The height of the centre line, as pieces of [length, slope in degrees]. Steeper than 30 only inside a jump's own span.
const PROFILE = descent(1750, [
  [40, 1], [110, 8, 22], [242, 24], // the summit, then a long chute to build speed
  [120, 52], [60, 52, 27], // off the cliff: the lip is at 380 and the face falls away at 52 degrees
  [1108, 26], // the crest
  [660, 25], // the stepping stones
  [340, 21], // the bend
  [110, 23], [290, 27], // the approach to the gap, then the steep landing and the run on
  [130, 15], [380, 22], // the canyon: easy over its rollers (a roller adds 17 degrees to the slope on its face), then it picks up again
  [110, 23], [200, 34], [90, 34, 12], [60, 12, 0], [60, 0, -3], [160, -3], // the last leap, its landing and the runout
]);

const WIDTH = [[0, 26], [44, 22], [77, 15], [330, 14], [380, 12], [580, 12], [640, 7.5], [1680, 7.5], [1740, 12], [2340, 12], [2400, 14],
  [2740, 14], [2800, 17], [3100, 17], [3140, 8], [3600, 8], [3660, 15], [3800, 15], [4000, 30], [4210, 34]];
// How far the ridges stand above the lane. Low on the crest (so there is nothing either side of you), and tall wherever a big jump stands: the
// mountain's shape caps the ground at the ridge's height, so a ramp taller than the ridge beside it is shaved off, and a sharp bend in the
// profile (the cliff's edge) cuts into the lane unless the ridge is tall enough to carry it.
const RIDGE = [[0, 4], [40, 7], [90, 10], [143, 11], [260, 12], [330, 30], [490, 30], [580, 9], [640, 7], [1680, 7], [1700, 16], [2400, 16], [2660, 12], [2720, 28],
  [2880, 28], [2960, 12], [3080, 9], [3140, 30], [3600, 30], [3620, 34], [3900, 34], [4000, 14], [4210, 9]];

// Crimson dusk: a huge low sun off to the left, a violet sky going to peach at the horizon, rose sand and rust-red rock, and a ringed planet
// filling a quarter of the sky. (The hex colours look pale because the look system squares them on the way to the shader: see world.js.)
const LOOK = {
  sun: [-0.75, 0.13, -0.65], sunColor: '#ffe5d1', sunStrength: 2.0,
  zenith: '#6d598e', mid: '#a079ac', horizon: '#fac0ac', sunGlow: '#ffd5b5',
  sand: '#dfc6bd', sandShadow: '#c3acc0', rock: '#c9a6a0', bounce: '#ceb5bd', sandstone: '#d5b3a9',
  exposure: 0.9,
  fogDensity: 0.0011, fogHeight: 420,
  stars: 1.2, starCut: 0.994,
  clouds: { amount: 1.3, cool: [0.55, 0.2, 0.45], warm: [1.4, 0.55, 0.35] },
  dust: [0.9, 0.62, 0.55],
  planet: { dir: [0.62, 0.3, -0.72], radius: 0.15, tilt: 62, roll: -18 },
};

const ROLLERS = [
  { from: 3110, to: 3200, wavelength: 40, height: 1.9 }, // the canyon's mouth
];
const KICKERS = [
  { at: 380, length: 26, height: 11, drop: 260, lane: 12, edge: 3.2, curve: 2.4, reach: 260 }, // the cliff: a 370 m fall
  { at: 1740, length: 26, height: 9, drop: 120, lane: 12, edge: 2.6, curve: 2.4, reach: 200 }, // stepping stones
  { at: 1980, length: 26, height: 9, drop: 120, lane: 12, edge: 2.6, curve: 2.4, reach: 200 },
  { at: 2220, length: 26, height: 9, drop: 120, lane: 12, edge: 2.6, curve: 2.4, reach: 200 },
  { at: 2790, length: 30, height: 14, drop: 150, lane: 17, edge: 4, curve: 2.4, reach: 190 }, // the gap's takeoff
  { at: 3700, length: 34, height: 20, drop: 300, lane: 14, edge: 6, curve: 2.4, reach: 200 }, // the last leap
];
// Spires, fins and buttes of the same red rock, far taller than anything on the other runs (src/landmarks.js).
const LANDMARKS = [
  { type: 'hoodoo', s: 300, side: 1, out: 250, height: 240, radius: 34 }, // the notch before the cliff
  { type: 'hoodoo', s: 440, side: -1, out: 300, height: 330, radius: 42 },
  { type: 'fin', s: 820, side: -1, out: 360, height: 260, radius: 60 }, // along the crest
  { type: 'hoodoo', s: 1000, side: 1, out: 330, height: 360, radius: 38 },
  { type: 'fin', s: 1350, side: 1, out: 420, height: 300, radius: 70 },
  { type: 'hoodoo', s: 1560, side: -1, out: 300, height: 300, radius: 36 },
  { type: 'butte', s: 1900, side: -1, out: 520, height: 420, radius: 150 }, // over the stepping stones
  { type: 'hoodoo', s: 2050, side: 1, out: 280, height: 280, radius: 40 },
  { type: 'butte', s: 2600, side: 1, out: 600, height: 380, radius: 170 },
  { type: 'hoodoo', s: 2750, side: -1, out: 260, height: 300, radius: 44 }, // beside the gap
  { type: 'hoodoo', s: 2920, side: 1, out: 260, height: 330, radius: 40 },
  { type: 'fin', s: 3350, side: -1, out: 300, height: 240, radius: 60 }, // over the canyon
  { type: 'butte', s: 3700, side: 1, out: 700, height: 360, radius: 190 },
  { type: 'hoodoo', s: 3800, side: -1, out: 340, height: 320, radius: 46 }, // the last leap
  { type: 'butte', s: 4050, side: 1, out: 380, height: 200, radius: 120 },
  { type: 'butte', s: 800, side: 1, out: 1100, height: 520, radius: 260 }, // far out on the plain
  { type: 'butte', s: 2400, side: -1, out: 1200, height: 600, radius: 300 },
  { type: 'butte', s: 3400, side: 1, out: 1000, height: 480, radius: 240 },
];
const GAPS = [{ from: 2796, to: 2866, depth: 45, bottom: 0.45, lane: 17, edge: 14 }]; // edge: the trench's side walls fall away over 14 m (near vertical, but not a knife-cut)

export default {
  id: 'vertigo',
  name: 'Vertigo',
  control: CONTROL,
  designLength: DESIGN_LENGTH,
  profile: PROFILE,
  width: WIDTH,
  ridge: RIDGE,
  rollers: ROLLERS,
  kickers: KICKERS,
  gaps: GAPS,
  sideHits: [],
  landmarks: LANDMARKS,
  startS: 50,
  pad: { s: 12, across: 20, ahead: 6, behind: 32 },
  finishS: 4000,
  plain: -16,
  blurb: 'A 4 km plunge off a red spire: a cliff, a knife-edge crest, a gap, a leap.',
  look: LOOK,
};
