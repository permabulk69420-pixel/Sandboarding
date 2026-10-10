# Sandboarding

Sandboarding down desert mountains in VR (WebXR, three.js, Vite). Every run is plain data in `src/courses/`; the start screen lists them and
`?run=<id>` picks one. Each run brings its own ground, jumps and look (sky, sun, sand, haze).

## Runs

| id | run | what it is |
| --- | --- | --- |
| `ridgeline` | Ridgeline | The original: a 2.7 km desert ridge of dunes, rollers and friendly kickers. |
| `vertigo` | Vertigo | A 4 km plunge off a red spire: an 8 second cliff launch, a knife-edge crest, three stepping-stone jumps, a gap you can't see the bottom of, a canyon of rollers and a last leap. |

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
   so pick them by looking at them.

Things learned the hard way: a kicker taller than the `ridge` beside it is shaved off, so keep `ridge` at least 6 m above the tallest kicker;
a sharp bend in the profile carves into the lane unless the ridge is tall enough to carry it; a huge jump needs `reach` (how far past the lip
the tests look for the landing) and a tall one needs `edge` (how many metres its sides take to fall away); and leave a rider 60 m or more of
ground between big jumps to settle.
