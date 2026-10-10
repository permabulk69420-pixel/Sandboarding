// Run 1: Ridgeline. A 2.9 km run down a dune mountain from a 460 m summit.
//
// A course is plain data; src/course.js turns it into ground. To add a run: copy this file, change the numbers, add it to
// src/courses/index.js, then check it with `npm run ride-check <id>` and `npm test`. Distances along the run ("s") are metres along the
// centre line from its first point; heights are metres. All the keyed lists are [s, value] pairs, interpolated between.

// Hand-placed centre line, metres. The run heads roughly north (-z) from the summit.
const CONTROL = [
  [0, 40], [0, 0], [0, -50], [12, -120], [42, -190], [46, -260], [18, -320], [-28, -380], [-46, -450],
  [-24, -515], [18, -570], [44, -640], [36, -710], [8, -770],
  [-30, -850], [-75, -930], [-95, -1030], [-70, -1130], [-15, -1210], [45, -1290], [85, -1380], [95, -1480],
  [80, -1580], [35, -1670], [-25, -1750], [-65, -1840], [-60, -1930], [-20, -2010], [25, -2090], [45, -2190],
  [35, -2290], [10, -2390], [0, -2480], [0, -2560], [0, -2640], [0, -2700],
];

// Everything below is laid out in metres along the centre line as it measures now (2948 m). If the line is reshaped, it all stretches to fit.
const DESIGN_LENGTH = 2948;

// Elevation along the centre line (arc length s -> height). Interpolated with a monotone cubic so slopes never overshoot.
// The summit, the original Ridgeline run (cruisy pitch, steep pitch, rollers, kicker, gully, kicker), then the open bowl, a steep chute into
// the first big jump, S-bends, the canyon, the gap jump, and a long wide fast finish with a runout that climbs to stop you.
const PROFILE = [
  [0, 460], [53, 459], [77, 456], [165, 438], [264, 412], [352, 384], [396, 378], [484, 366], [551, 352], [639, 338], [727, 322], [815, 309],
  [874, 300], [1000, 286], [1120, 272], [1250, 256], [1330, 240], [1420, 214], [1452, 207], [1475, 201], [1525, 172], [1560, 165], [1640, 156],
  [1760, 140], [1850, 124], [1960, 108], [2050, 94], [2105, 88], [2178, 68], [2214, 64], [2222, 60.5], [2264, 39.5], [2274, 36.5], [2300, 33], [2400, 26], [2560, 15], [2700, 4.5],
  [2780, 1], [2830, 0], [2890, 2], [2948, 7],
];



// How far the ridges stand above the lane: low round the summit and the open bowl, tall along the gully and the canyon.
const RIDGE = [[0, 2.5], [66, 5], [143, 9], [595, 10], [617, 17], [683, 17], [705, 10], [860, 9], [920, 5], [1240, 5], [1290, 10],
  [1860, 12], [1880, 22], [2040, 22], [2080, 11], [2400, 7], [2948, 9]];

// The lane's half width: the gully at ~630 m, the open bowl (100 m across), the canyon, room round the gap jump, a wide finish.
const WIDTH = [[0, 26], [44, 22], [77, 15], [572, 15], [600, 9], [661, 9], [688, 15], [800, 15], [860, 16], [920, 50], [1240, 50],
  [1290, 17], [1400, 14], [1470, 16], [1560, 20], [1840, 18], [1870, 10], [2040, 10], [2080, 16], [2140, 24], [2300, 24], [2420, 34],
  [2790, 34], [2850, 40], [2948, 40]];
const ROLLERS = [
  { from: 352, to: 476, wavelength: 28, height: 1.3 }, { from: 744, to: 815, wavelength: 22, height: 0.9 },
  { from: 1130, to: 1240, wavelength: 30, height: 1.8 }, // hummocks in the bowl
  { from: 2420, to: 2560, wavelength: 26, height: 1.2 },
];
// A kicker's ramp curves up (shape exponent) so its lip points skyward; beyond the lip a landing slope eases back down to the run.
// `lane` is the half width of the kicker; the lane goes on past either side of it if you'd rather not jump.
const KICKERS = [
  // The jump line on the steep pitch: three built kickers a hundred metres apart, each a steep-faced ramp with a crisp lip and a long
  // landing, narrow enough to ride round.
  { at: 517, length: 13, height: 3.1, drop: 16, lane: 5, curve: 2.6 },
  { at: 616, length: 13, height: 3.1, drop: 16, lane: 5, curve: 2.6 },
  { at: 716, length: 15, height: 3.5, drop: 18, lane: 5.5, curve: 2.6 },
  { at: 1452, length: 24, height: 4.6, drop: 75, lane: 9, curve: 2.3 }, // big jump one: a long landing as steep as you fall, enough air to flip
  { at: 2182, length: 20, height: 3.4, drop: 6, lane: 10, curve: 2.6 }, // the gap jump's takeoff: over a gap in nearly level ground onto a long 27 degree landing
];
// A trench across the middle of the lane: the gap you jump. Steep on the near side, a long gentle ramp out on the far side (the run keeps
// falling away under it), so coming up short costs you speed but never traps you.
const GAPS = [{ from: 2186, to: 2216, depth: 4.5, bottom: 0.3, lane: 10 }];
// Side hits: small kickers off to one side of the lane (offset in metres, + right of travel), something to pop off on the long stretches.
const SIDE_HIT = { length: 10, height: 1.9, drop: 8, lane: 3.2, curve: 2.4 };
const SIDE_HITS = [
  [205, 8], [285, -8], // the cruisy first pitch
  [960, 22], [1030, -18], [1095, 15], [1185, -25], // the bowl
  [1600, 9], [1685, -9], [1765, 9], // the S-bends
  [2300, -12], [2365, 14], [2450, -16], [2525, 16], [2600, -14], [2665, 12], // the long finish
].map(([at, offset]) => ({ ...SIDE_HIT, at, offset }));


// Rails (src/rails.js): bars beside the lane to jump onto, or ride up the ramp at the start of, and grind. from/to: metres along the run;
// offset: metres right of the centre line (negative = left). They stand clear of the kickers and side hits, and well off the racing line.
const RAILS = [
  { from: 100, to: 200, offset: -9 }, // on the first pitch, to learn on
  { from: 880, to: 1110, offset: -9 }, // along the bowl: a long one, easy to hit and a long way to go
  { from: 1900, to: 2030, offset: -7 }, // through the canyon
];

// Landmarks: sandstone buttes and mesas that give each section its own skyline (src/landmarks.js). s along the run, side -1 left / 1 right,
// out = metres from the centre line (far past the walls, where nobody rides), height above the lane there and radius in metres.
const LANDMARKS = [
  { type: 'butte', s: 120, side: 1, out: 260, height: 30, radius: 45 }, // seen from the summit, either side of the first pitch
  { type: 'butte', s: 260, side: -1, out: 320, height: 22, radius: 70 },
  { type: 'butte', s: 640, side: -1, out: 230, height: 40, radius: 30 }, // a tall narrow one over the jump line
  { type: 'butte', s: 700, side: 1, out: 300, height: 18, radius: 85 },
  { type: 'butte', s: 1080, side: 1, out: 300, height: 45, radius: 40 }, // over the bowl's rim
  { type: 'butte', s: 1150, side: -1, out: 330, height: 26, radius: 60 },
  { type: 'butte', s: 1480, side: -1, out: 240, height: 52, radius: 32 }, // beside big jump one: the tallest, a landmark to aim at
  { type: 'butte', s: 1760, side: 1, out: 260, height: 30, radius: 55 }, // the S-bends
  { type: 'butte', s: 1960, side: -1, out: 210, height: 20, radius: 40 }, // rising beyond the canyon's rim
  { type: 'butte', s: 2250, side: 1, out: 260, height: 34, radius: 50 }, // the gap jump
  { type: 'butte', s: 2620, side: -1, out: 240, height: 28, radius: 65 }, // the finish
  { type: 'butte', s: 2900, side: 1, out: 200, height: 45, radius: 60 },
  { type: 'butte', s: 200, side: -1, out: 800, height: 80, radius: 140 }, // far out on the dune sea
  { type: 'butte', s: 800, side: 1, out: 700, height: 70, radius: 120 },
  { type: 'butte', s: 1500, side: -1, out: 900, height: 90, radius: 150 },
  { type: 'butte', s: 2300, side: -1, out: 620, height: 60, radius: 100 },
];

export default {
  id: 'ridgeline',
  name: 'Ridgeline',
  blurb: 'The original: a 2.7 km desert ridge of dunes, rollers and friendly kickers.',
  control: CONTROL, // the centre line: hand-placed [x, z] points (metres), smoothed into a curve; the run heads roughly -z
  designLength: DESIGN_LENGTH, // the centre line's length when the s values below were laid out; they stretch if the line changes
  profile: PROFILE, // [s, height] of the lane's centre
  width: WIDTH, // [s, half width of the lane]
  ridge: RIDGE, // [s, how far the ridges stand above the lane]
  rollers: ROLLERS,
  kickers: KICKERS,
  gaps: GAPS,
  sideHits: SIDE_HITS,
  rails: RAILS,
  landmarks: LANDMARKS,
  startS: 50, // the start gate
  pad: { s: 12, across: 20, ahead: 6, behind: 32 }, // the lodge's level pad on the summit (its door 12 m down the line, facing downhill)
  finishS: 2720, // the finish gate (the slope after it is too gentle to keep you moving: the runout)
  plain: -16, // the desert floor round the mountain
};
