# Sandboarding

A VR sandboarding game for Meta Quest, in the browser (three.js + WebXR). Same desert family as Oasis.

**Play:** https://permabulk69420-pixel.github.io/Sandboarding/ (open it in the Meta Quest Browser and press Enter VR).

## What's here (first prototype)

- **Run 1, Ridgeline:** a 1 km run down a giant dune mountain, about 160 m of drop. A cruisy first pitch, a steep pitch, rollers, two kickers with landing slopes, a narrow gully with tall walls, banked turns that build themselves from the line's curves, then a long fast finish and a runout that brings you to a stop. Blue flags mark the left edge of the lane, orange the right.
- **The summit:** you start on top. Walk to the START arch and press A to drop in (3, 2, 1, go).
- **Riding:** the thumbstick carves, the trigger drags the tail to slow down, crouching for real tucks you for speed, A hops (an ollie). You can fly off the kickers and the crests of rollers. Land with the board crosswise and you bail.
- **Run timer** on your left wrist with speed, checkpoints every 120 m (B to go back to the last one), Y back to the summit, best time saved on the headset.
- **Feel:** wind roar that grows with speed, sand hiss while you carve, a thump and a puff of sand when you land, a rumble through the controllers while you ride, sand spray off the tail. All sound is generated, nothing to download.
- **Look:** a low twilight sun, a ringed planet, sand drawn with a custom shader (wind ripples, sparkles where the sun glints, rock on the steep faces, sky-coloured haze). No textures.
- **Hands:** the Oasis VR hands.

Placeholders, waiting on real models: the board, the gates and the flags. The board is built in `src/props.js` (`createBoardMesh`); swap it for a GLB when it's ready.

**Desktop:** press *Ride on desktop*. WASD to walk, Enter to drop in, A/D carve, S brake, W tuck, Space hop, R checkpoint, T summit, mouse to look.

## How it's built

| File | What |
| --- | --- |
| `src/course.js` | The run: centre line, height profile, lane width, ridges, rollers, kickers. The ground is the lower of a carved channel and a mountain that falls away to the plain, so it is seamless everywhere. Edit `CONTROL`, `PROFILE`, `WIDTH`, `RIDGE`, `ROLLERS`, `KICKERS` to reshape it. |
| `src/board.js` | Riding physics, all numbers in `BOARD`. |
| `src/world.js` | Sky, sand shader, terrain meshes, colours in `LOOK`. |
| `src/terrain-grid.js`, `tools/bake-terrain.js` | The terrain mesh. Heights are worked out at build time into `public/terrain/heights.bin` so the headset loads instantly (`npm run dev` and `npm run build` do it for you). |
| `src/main.js` | The game: summit, countdown, ride, finish, respawns, wrist panel, sound, haptics. |
| `src/hands.js`, `src/adaptive-grip.js`, `src/grip-*.js`, `src/haptics.js`, `src/sand-puffs.js` | Brought over from Oasis. |

Dev URL options: `?s=300` start riding 300 m down the run, `?auto` the board steers itself, `?play` skip the welcome screen, `?fly=x,y,z,yaw,pitch` a free camera.

```
npm install
npm run dev     # http://localhost:4173
npm test        # course and physics checks (a simulated ride must finish in about a minute with air off both kickers)
npm run build
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`). Pages must be set to deploy from **GitHub Actions** (Settings → Pages → Source).
