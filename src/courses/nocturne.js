// Run 3: Nocturne. A moonlit run down a mountain: a serpent of banked S-bends, a rhythm line of kickers, a tight gate in a tall-walled
// canyon, long sweepers across the open dunes, and a leap toward the moon at the bottom. It is the flowing one: nothing here is steep,
// and almost everything is a turn.
//
// Written with the helpers in route.js. Distances along the run ("s") are metres along the centre line from its first point.

import { route, descent } from './route.js';

const CONTROL = route({ x: 0, z: 40 }, [
  [260, 0], // the summit and the first pitch
  [96, 55], [192, -110], [192, 110], [192, -110], [192, 110], [96, -55], // the serpent: S-bends, 100 m radius, 260-1220
  [100, 0],
  [340, 0], // the rhythm line, 1320-1660
  [100, -70], [200, 140], [100, -70], // the moon gate: a tight chicane in a canyon, 1660-2060
  [120, 0],
  [300, 50], [300, -100], [300, 50], // the long sweepers, 2180-3080
  [260, 0], // the leap
  [200, 0], // the runout
]);
const DESIGN_LENGTH = 3554;

const PROFILE = descent(675, [
  [40, 1], [90, 4, 9], [130, 9],
  [960, 11],
  [100, 8],
  [340, 8],
  [400, 11],
  [120, 9],
  [900, 12],
  [80, 12, 17], [230, 19], // the leap straight steepens, to arrive at the lip with speed and to land on a slope as steep as the fall
  [60, 10], [100, 4], [100, 1], [100, 0],
]);

const WIDTH = [[0, 26], [44, 22], [77, 15], [1230, 14], [1330, 11], [1650, 11], [1670, 9], [2060, 9], [2100, 22], [3080, 22], [3120, 20], [3340, 20], [3460, 30], [3540, 30]];
const RIDGE = [[0, 3], [66, 6], [143, 12], [1230, 12], [1330, 12], [1650, 12], [1690, 18], [2050, 18], [2100, 9], [3150, 9], [3200, 17], [3330, 17], [3380, 9], [3440, 6], [3554, 0.4]]; // the walls ease away over the runout, so the lane opens onto the plain instead of ending in a cliff

// Whoops: low rollers on the breather after the gate. (None on the leap straight: every landing costs speed, and the leap wants it all.)
const ROLLERS = [
  { from: 2070, to: 2180, wavelength: 24, height: 0.9 },
];
const KICKERS = [
  { at: 1400, length: 9, height: 1.8, drop: 18, lane: 6, curve: 2.4 },
  { at: 1444, length: 9, height: 2.2, drop: 20, lane: 6, curve: 2.4 },
  { at: 1492, length: 10, height: 2.6, drop: 22, lane: 6, curve: 2.4 },
  { at: 1544, length: 10, height: 3.0, drop: 24, lane: 6, curve: 2.4 },
  { at: 1600, length: 11, height: 3.4, drop: 26, lane: 6, curve: 2.4 },
  { at: 3260, length: 30, height: 10, drop: 150, lane: 14, edge: 3.2, curve: 2.4, reach: 200 }, // the leap, toward the moon
];
const GAPS = [];
// Optional hits off to the side of the serpent's bends (+ is right of travel), and on the long sweepers: pop off them or ride round.
const SIDE_HIT = { length: 10, height: 1.9, drop: 8, lane: 3.2, curve: 2.4 };
const SIDE_HITS = [
  [430, -8], [620, 8], [810, -8], [1000, 8], [1190, -8], // the serpent
  [2230, 14], [2330, -14], [2430, 14], [2560, -14], [2690, 14], [2820, -14], [2950, 14], [3040, -14], // the sweepers
].map(([at, offset]) => ({ ...SIDE_HIT, at, offset }));

// Rails (src/rails.js): bars beside the lane to jump onto, or ride up the ramp at the start of, and grind. from/to: metres along the run;
// offset: metres right of the centre line (negative = left). A rail carries you through a bend at full speed, with no carving to scrub it.
const RAILS = [
  { from: 100, to: 250, offset: 9 }, // on the way down to the serpent
  { from: 380, to: 520, offset: 9 }, // the inside of the first S-bend...
  { from: 560, to: 700, offset: -9 }, // ...and of the next, on the other side
  { from: 2470, to: 2650, offset: 12 }, // round the inside of the long right sweeper
];

// Silhouettes against the stars (src/landmarks.js): hoodoos and fins near the run, big buttes far out on the dune sea.
const LANDMARKS = [
  { type: 'hoodoo', s: 140, side: -1, out: 230, height: 70, radius: 16 }, // seen from the summit
  { type: 'fin', s: 420, side: 1, out: 280, height: 60, radius: 40 },
  { type: 'hoodoo', s: 700, side: -1, out: 260, height: 90, radius: 20 },
  { type: 'butte', s: 980, side: 1, out: 320, height: 55, radius: 60 },
  { type: 'hoodoo', s: 1300, side: 1, out: 240, height: 80, radius: 18 },
  { type: 'fin', s: 1540, side: -1, out: 260, height: 70, radius: 45 }, // over the rhythm line
  { type: 'hoodoo', s: 1800, side: 1, out: 200, height: 60, radius: 14 }, // above the gate canyon
  { type: 'butte', s: 2250, side: -1, out: 300, height: 70, radius: 70 },
  { type: 'hoodoo', s: 2600, side: 1, out: 350, height: 110, radius: 24 },
  { type: 'fin', s: 2850, side: -1, out: 330, height: 80, radius: 55 },
  { type: 'hoodoo', s: 3150, side: 1, out: 220, height: 80, radius: 18 }, // by the leap
  { type: 'butte', s: 3300, side: -1, out: 260, height: 60, radius: 60 },
  { type: 'butte', s: 300, side: -1, out: 800, height: 160, radius: 150 }, // far out on the dune sea
  { type: 'butte', s: 1200, side: 1, out: 900, height: 200, radius: 180 },
  { type: 'butte', s: 2000, side: -1, out: 1000, height: 180, radius: 170 },
  { type: 'butte', s: 2900, side: 1, out: 900, height: 170, radius: 160 },
];

// Moonlit night: a big pale moon ahead and to the left, a ringed planet ahead and to the right, a deep navy sky with stars right down to the
// horizon, and silvery dunes. Colours are linear [r, g, b] triples (see world.js), not hex: it is much easier to keep a dark look dark.
const LOOK = {
  sun: [-0.45, 0.42, -0.78], sunColor: [0.26, 0.33, 0.55], sunStrength: 1, sunSize: 2.2,
  zenith: [0.001, 0.002, 0.012], mid: [0.006, 0.018, 0.07], horizon: [0.045, 0.085, 0.19], sunGlow: [0.22, 0.30, 0.6], sunBand: [0.12, 0.18, 0.38],
  sand: [0.5, 0.42, 0.38], sandShadow: [0.08, 0.09, 0.2], rock: [0.18, 0.18, 0.24], bounce: [0.05, 0.065, 0.14], sandstone: [0.26, 0.24, 0.3],
  exposure: 1.2,
  stars: 3.5, starCut: 0.982, starFrom: [0.03, 0.35],
  clouds: { amount: 0.45, cool: [0.2, 0.3, 0.55], warm: [0.5, 0.65, 1.0] },
  dust: [0.65, 0.8, 1.1], dustLight: 0.9,
  planet: { dir: [0.55, 0.42, -0.72], radius: 0.13, tilt: 66, roll: -20 },
};

export default {
  id: 'nocturne',
  name: 'Nocturne',
  blurb: 'A moonlit run: banked S-bends, a rhythm line, a tight canyon gate, a leap.',
  control: CONTROL,
  designLength: DESIGN_LENGTH,
  profile: PROFILE,
  width: WIDTH,
  ridge: RIDGE,
  rollers: ROLLERS,
  kickers: KICKERS,
  gaps: GAPS,
  sideHits: SIDE_HITS,
  rails: RAILS,
  landmarks: LANDMARKS,
  startS: 50,
  pad: { s: 12, across: 20, ahead: 6, behind: 32 },
  finishS: 3400,
  plain: -16,
  look: LOOK,
};
