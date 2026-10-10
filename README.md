# Sandboarding

Sandboarding down desert mountains in VR (WebXR, three.js, Vite). Every run is plain data in `src/courses/`; the start screen lists them and
`?run=<id>` picks one. Each run brings its own ground, jumps and look (sky, sun, sand, haze).

## Runs

| id | run | what it is |
| --- | --- | --- |
| `ridgeline` | Ridgeline | The original: a 2.7 km desert ridge of dunes, rollers and friendly kickers. |
| `vertigo` | Vertigo | A 4 km plunge off a red spire: an 8 second cliff launch, a knife-edge crest, three stepping-stone jumps, a gap you can't see the bottom of, a canyon of rollers and a last leap. |
| `nocturne` | Nocturne | A 3.5 km moonlit run, the flowing one: a serpent of banked S-bends, a rhythm line of five kickers, a tight canyon gate, long sweepers and a leap toward the moon. |
| `mirage` | Mirage | A 4.5 km run over white gypsum dunes at noon, the fast and open one: wide sweepers, a field of long swells, three step-up jumps of growing size, a dry wash to clear and a steep sprint into a long leap. Far pools of mirage shimmer on the dune sea. |

## Rails

Every run has a few steel rails beside the lane. Ride up the striped ramp at the start of one, or jump and land the board on it, and you grind
(sparks, a rasp of steel, a buzz in both controllers). Nothing lines you up: the board stays at whatever angle you land it, so along the bar
is a 50-50 and across it is a boardslide (turn in the air with the stick to choose). A rail catches you only if the bar passes under the board
as it lies (a sideways board reaches further than a lengthways one), you are coming down onto it, travelling roughly along it (within 60
degrees) and faster than a walk.

On the bar you have to keep your balance. The board is always trying to roll off the bar and the bar knocks it about, and the stick rolls it
back (push right and it rolls right, so push against the way it is tipping); landing off to one side starts you off balance that way. You can
see the board tip and your body sway off the bar, the hand on the side you are falling toward buzzes harder as you near the edge, and the
scrape gets higher and rougher. Lose it and you slip off the side, losing some speed (not a crash). Long grinds get harder. Hop off with A (hold
it to charge a bigger pop; the board eases round to point the way you are going so a boardslide can pop out and land) or ride off the end,
where the bar sinks back into the sand. Gravity and the bar's slick friction decide your speed. The finish sign adds up how far you ground.
Stand-alone physics: `src/rails.js` (the bars) and `src/board.js` (the grind and the balance, all in `BOARD`); the tests ride a perfect balancer
(`perfectBalance`) and check that one with no stick falls off.

## Landing

Nothing levels the board in the air: it keeps the angle it left the ground at, and you pitch it with the stick (a small push is gentle, a full
push a fast flip) to meet the ground you are about to land on. Within about 24 degrees of the slope is a clean landing, up to about 47 degrees is
a heavy one that costs speed, and past that is a bail. Most big jumps need the nose brought down to meet the landing. `perfectLanding` in
`src/board.js` is the stick a perfect rider uses; the tests and `npm run ride-check` use it (and report what a rider with hands off does).

## Working on it

```
npm install
npm run dev                 # bakes the terrain, then serves on :4173
npm test                    # every run must pass the same checks (see tests/courses.test.js)
npm run ride-check [id]     # a simulated rider rides the run standing and tucked and reports what it hit
npm run bake [id...]        # re-bake the terrain for some or all runs (public/terrain, not committed)
npm run build
```

Dev-only URL params: `?run=<id>`, `?play` (skip the start screen), `?fly=x,y,z,yaw,pitch` (put the camera anywhere), `?s=<metres>` (start
partway down the run), `?time=<seconds>` (freeze the sky's clock, for repeatable screenshots), `?nowind`, `?nolodge`, `?nolandmarks`, `?auto`.

## Adding a run

1. Write `src/courses/<id>.js` (copy `vertigo.js`). `route()` and `descent()` in `src/courses/route.js` lay the centre line out as legs
   (length, turn) and the height as slopes. Kickers, gaps, rollers and `ridge` are described in `src/course.js`.
2. Add it to `COURSES` in `src/courses/index.js`.
3. `npm run ride-check <id>` until it reports no problems, then `npm test`.
4. Give it a `look` (only the parts that differ from the base look in `src/world.js`). Hex colours there are squared on the way to the shader,
   so pick them by looking at them; or write a colour as a linear `[r, g, b]` triple, which is used exactly as written (the way to go for a
   very dark look like Nocturne's or a very bright one like Mirage's). Besides colours, a look can set `sunBand` (the pale band over the sun),
   `sunSize`, `starFrom` (how far up the sky the stars start), `fogDensity`/`fogHeight`, `exposure`, and `mirage` (0 to 1: far level ground
   turns to wobbling pools that mirror the sky).
5. Rails go in `rails`: `{ from, to, offset }` in metres along the run and metres right of the centre line (negative is left), optionally
   `height` (the top of the bar above the sand, 0.7), `entry` and `exit` (the lengths of the ramps, 5). Keep them off the racing line (6.5 m
   or more), inside the lane, and clear of kickers, gaps, rollers and side hits; `railProblems` in `src/rails.js` checks all of that, the tests
   run it on every rail, and they ride a simulated rider onto each rail to make sure it can be reached and ridden to the end. A rail is built
   over the ground as it is and follows it, so it is best where the lane is smooth: banked bends and steep walls make for a hard approach.
6. Scenery goes in `landmarks` (see `src/landmarks.js`): hoodoos, fins and buttes placed by `s`, `side` and `out` from the run, standing
   `height` above the lane there, or, for far mountains on a run that drops a long way, by absolute `at: [x, z]` and `top`.
   Nothing beside the lane is visible below the lane's own height, so near formations have to be tall.

Things learned the hard way: a kicker taller than the `ridge` beside it is shaved off, so keep `ridge` at least 6 m above the tallest kicker;
a sharp bend in the profile carves into the lane unless the ridge is tall enough to carry it; a huge jump needs `reach` (how far past the lip
the tests look for the landing) and a tall one needs `edge` (how many metres its sides take to fall away); and leave a rider 60 m or more of
ground between big jumps to settle.

Terrain limits worth knowing before laying out a run: the ground is the lowest of every stretch's own surface, and the walls climb at 0.55 m
per metre, so no two parts of the run may differ in height by more than about 0.55 times the distance between them. That rules out hairpins
and folded routes (the lower strand's wall cuts the higher lane): keep the route heading away from the summit and at least 200 m from itself.
The whole summit-to-plain mountain is as high as the run is, so a 1,000 m drop makes a mountain nearly 2 km across.

`npm run bake` has to be re-run after any change to a run's shape (the dev server and the build do it for you).
