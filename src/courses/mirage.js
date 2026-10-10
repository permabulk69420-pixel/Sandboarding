// Run 4: Mirage. A 4.5 km run across white gypsum dunes under a noon sun: wide sweepers you can carve at a hundred kilometres an hour,
// a field of long rolling swells, three step-up tabletops, a dry wash to jump, and a steep final sprint that ends in a long leap. It is
// the fast and open one: lanes are wide, the ridges beside them low, and there is room to choose your own line.
//
// Written with the helpers in route.js. Distances along the run ("s") are metres along the centre line from its first point.

import { route, descent } from './route.js';

const CONTROL = route({ x: 0, z: 40 }, [
  [260, 0], // the summit and the first pitch
  [330, 58], [330, -40], [330, 58], [330, -40], // the whitecaps: big sweepers, 330 m radius and more, 260-1580
  [700, 0], // the swells, 1580-2280
  [560, 0], // the tabletops, 2280-2840
  [300, -50], [240, 0], // the wash: a sweeper into the gap, 2840-3380
  [320, 0], [390, 0], // the sprint, 3380-4090
  [450, 0], // the leap, its landing and the runout
]);
const DESIGN_LENGTH = 4541;

const PROFILE = descent(1070, [
  [40, 1], [100, 5, 10], [120, 12],
  [1320, 13],
  [700, 9],
  [560, 14],
  [540, 15],
  [700, 17, 18], // the sprint
  [260, 19], // the leap and its landing: the ground has to keep falling away for as far as you fly
  [60, 10], [100, 4], [100, 1], [100, 0],
]);

const WIDTH = [[0, 26], [44, 22], [77, 20], [330, 36], [400, 38], [1560, 38], [1620, 30], [2260, 30], [2290, 16], [2830, 16], [2860, 28], [3340, 28], [3370, 26],
  [3470, 26], [3510, 30], [4100, 30], [4140, 24], [4450, 24], [4540, 40]];
const RIDGE = [[0, 3], [66, 6], [143, 8], [1560, 8], [1620, 9], [2260, 9], [2290, 17], [2830, 17], [2870, 9], [3340, 9], [3360, 22], [3460, 22], [3500, 9],
  [4100, 9], [4130, 20], [4450, 20], [4540, 9]];

// The swells: long low rollers you can skim at speed, a crest every 80 m.
const ROLLERS = [
  { from: 1620, to: 2240, wavelength: 80, height: 2.0 },
];
const KICKERS = [
  { at: 2400, length: 22, height: 4, drop: 90, lane: 12, edge: 2.4, curve: 2.4, reach: 130 }, // the tabletops, each bigger than the last
  { at: 2540, length: 22, height: 5, drop: 90, lane: 12, edge: 2.4, curve: 2.4, reach: 130 },
  { at: 2680, length: 22, height: 6.2, drop: 90, lane: 12, edge: 2.4, curve: 2.4, reach: 130 },
  { at: 3376, length: 28, height: 9, drop: 130, lane: 22, edge: 3, curve: 2.4, reach: 170 }, // the takeoff for the wash
  { at: 4090, length: 36, height: 12, drop: 220, lane: 18, edge: 4, curve: 2.4, reach: 280 }, // the leap
];
const GAPS = [{ from: 3382, to: 3440, depth: 12, bottom: 0.45, lane: 22, edge: 8 }]; // the wash: a dry riverbed across the lane
const SIDE_HIT = { length: 12, height: 2.4, drop: 10, lane: 4, curve: 2.4 };
const SIDE_HITS = [
  [400, 20], [540, -22], [700, 20], [860, -22], [1000, 20], [1150, -22], [1300, 20], [1450, -22], [1560, 20], // the whitecaps
  [3500, 14], [3580, -14], [3660, 14], [3740, -14], [3820, 14], [3900, -14], [3980, 14], // the sprint
].map(([at, offset]) => ({ ...SIDE_HIT, at, offset }));

const LANDMARKS = [];

// Noon on white gypsum: a high sun off to the left, a pale washed-out sky and the ghost of the ringed planet, dazzling sand with cool blue
// shadows, and far brown mountains in the haze. Colours are linear [r, g, b] triples (see world.js).
const LOOK = {
  sun: [-0.72, 0.64, -0.26], sunColor: [1.0, 0.95, 0.85], sunStrength: 1.6, sunSize: 1.3,
  zenith: [0.03, 0.10, 0.32], mid: [0.12, 0.26, 0.55], horizon: [0.62, 0.68, 0.76], sunGlow: [1.0, 0.9, 0.7], sunBand: [0.95, 0.9, 0.8],
  sand: [0.70, 0.66, 0.60], sandShadow: [0.35, 0.40, 0.55], rock: [0.30, 0.26, 0.24], bounce: [0.55, 0.55, 0.58], sandstone: [0.34, 0.28, 0.25],
  exposure: 0.85,
  stars: 0,
  clouds: { amount: 0.7, cool: [0.75, 0.8, 0.9], warm: [1.2, 1.15, 1.05] },
  dust: [1.25, 1.2, 1.1], dustLight: 1.1,
  planet: { dir: [0.45, 0.55, -0.7], radius: 0.07, tilt: 66, roll: -20 },
};

export default {
  id: 'mirage',
  name: 'Mirage',
  blurb: 'White noon dunes: wide sweepers, rolling swells, tabletops, a dry wash and a leap.',
  control: CONTROL,
  designLength: DESIGN_LENGTH,
  profile: PROFILE,
  width: WIDTH,
  ridge: RIDGE,
  rollers: ROLLERS,
  kickers: KICKERS,
  gaps: GAPS,
  sideHits: SIDE_HITS,
  landmarks: LANDMARKS,
  startS: 50,
  pad: { s: 12, across: 20, ahead: 6, behind: 32 },
  finishS: 4380,
  plain: -16,
  look: LOOK,
};
