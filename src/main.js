import * as THREE from 'three';
import './style.css';
import { createCourse } from './course.js';
import { COURSES, courseById } from './courses/index.js';
import { createBoardState, stepBoard, speedOf, leanSteer, boardAttitude, BOARD, useFeel } from './board.js';
import { clamp, angleDelta } from './math.js';
import { createSky, createTerrain, LOOK, worldTime } from './world.js';
import { createWindSand, WIND_SAND } from './wind-sand.js';
import { createGate, createLaneFlags, createBoardMesh, loadBoardModel } from './props.js';
import { createSign, formatTime } from './hud.js';
import { createRideAudio } from './audio.js';
import { createInput } from './input.js';
import { createVRHands } from './hands.js';
import { createSandPuffs } from './sand-puffs.js';
import { pulseHaptics } from './haptics.js';
import { createBoardGrab } from './board-grab.js';

// Sandboarding, first run. You stand on the summit, walk to the start gate, press A to drop in, and ride the course to the finish
// against the clock. Thumbstick to carve, trigger to drag the tail and slow down, crouch for speed, A to hop, B back to the last
// checkpoint, Y back to the summit. On a desktop: WASD/arrows, Space, R and T, mouse to look.

const params = new URLSearchParams(location.search);
useFeel(params.get('feel')); // ?feel=classic: the original direct steering, for comparing
const BASE = import.meta.env?.BASE_URL ?? './';
const RUN = Object.freeze({ chargeTime: 0.6, crouchDrop: 0.45, chargeDip: 0.12, checkpointEvery: 120, countdown: 3, walkSpeed: 3.2, turnSpeed: 2.2, eye: 1.65 });

// ---------------------------------------------------------------- renderer, scene, player rig
const canvas = document.getElementById('world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const scene = new THREE.Scene();
// Near and far planes as tight as the world allows: the depth buffer's precision depends mostly on the near plane, and with it at 5 cm
// distant slopes and the sunk coarse terrain flickered through each other. Past LOOK.fogEnd everything is haze anyway (the sky below
// the horizon is the same colour), so nothing visible is lost beyond 3.6 km. WebXR uses these planes too.
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 3600);
const rig = new THREE.Group(); rig.name = 'Player rig';
rig.add(camera); scene.add(rig);
camera.position.set(0, RUN.eye, 0);

scene.add(createSky());
// Reflections for the shiny things (the board's clearcoat and titanium, the gates): the sky, captured once into an environment map.
{
  const envScene = new THREE.Scene(); envScene.add(createSky());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  pmrem.dispose();
}
scene.add(new THREE.HemisphereLight(new THREE.Color().copy(LOOK.mid).lerp(LOOK.zenith, 0.3), LOOK.bounce, 1.1));
const sunLight = new THREE.DirectionalLight(new THREE.Color(LOOK.sunColor).multiplyScalar(0.45), 2.2);
sunLight.position.copy(LOOK.sun).multiplyScalar(100); scene.add(sunLight);

// Which run: ?run=<id> (the lodge's map table will choose later). Defaults to the first.
const courseDef = courseById(params.get('run'));
const runNumber = COURSES.indexOf(courseDef) + 1;
const course = createCourse(courseDef);
const status = document.getElementById('status');
const sunUniform = { value: LOOK.sun };
let windSand = null; // blowing sand, once the ground has loaded
createTerrain(course, { url: `${BASE}terrain/${course.id}.bin`, sandUrl: `${BASE}textures/sand-detail.jpg`, onStatus: t => { status.textContent = t; } }).then(terrain => {
  scene.add(terrain); status.textContent = ''; enterVR.disabled = !xrSupported; playButton.disabled = false;
  if (terrain.userData.ground && !params.has('nowind')) windSand = createWindSand({ scene, lattice: terrain.userData.ground, sun: sunUniform });
  enterVR.textContent = xrSupported ? 'Enter VR' : 'VR not available';
});
scene.add(createGate(course, course.startS, 'START', { bg: '#2f7fd8' }));
scene.add(createGate(course, course.finishS, 'FINISH', { bg: '#e8642c' }));
scene.add(createLaneFlags(course));

const boardMesh = createBoardMesh(); scene.add(boardMesh);
loadBoardModel(boardMesh, `${BASE}models/board/sirocco_dune156.glb`);
// The cabin (a test for now) sits on the summit pad and you start inside it. ?nolodge leaves it out.
let lodge = null;
if (!params.has('nolodge')) {
  import('./lodge-test.js').then(m => m.placeLodge({ scene, course, url: `${BASE}models/lodge/cabin-v3.glb` }))
    .then(l => { lodge = l; if (mode === 'summit') placeOnSummit(); }).catch(error => console.warn('lodge', error));
}
const puffs = createSandPuffs({ scene, sun: sunUniform, heightAt: course.heightAt });
const audio = createRideAudio();
const input = createInput();
const hands = createVRHands({ renderer, scene, parent: rig });
const grab = createBoardGrab({ hands, boardMesh });
let frozen = false; // dev only (?grabtest): the board hangs where it is

// Signs in the world: one beside the start gate, one past the finish.
const startSign = createSign();
{ const p = course.pointAt(course.startS - 6); startSign.mesh.position.set(p.x, p.y + 1.9, p.z); startSign.mesh.rotation.y = p.yaw; }
const finishSign = createSign({ width: 4.2, height: 1.8 });
{ const p = course.pointAt(course.finishS + 30); finishSign.mesh.position.set(p.x, p.y + 3.2, p.z); finishSign.mesh.rotation.y = p.yaw; }
scene.add(startSign.mesh, finishSign.mesh);
finishSign.mesh.visible = false;

// A black shell round the eyes for quick fades when you're moved (respawns, back to the summit).
const fader = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 8), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }));
fader.renderOrder = 100; fader.visible = false; camera.add(fader);

// ---------------------------------------------------------------- game state
const store = {
  get best() { try { return Number(localStorage.getItem(`sandboarding.best.${course.id}`)) || Infinity; } catch { return Infinity; } },
  set best(v) { try { localStorage.setItem(`sandboarding.best.${course.id}`, String(v)); } catch { /* private window */ } },
};
let mode = 'summit'; // summit | countdown | ride | finished (and fly, a dev camera)
let board = createBoardState();
let runTime = 0, countdown = 0, finishedFor = 0, lastCheckpoint = course.startS, result = null;
let rigYaw = 0, headOffset = new THREE.Vector2(), standHeight = RUN.eye, rumbleClock = 0, sprayClock = 0, lostFor = 0;
let charge = 0, chargeClock = 0, crouched = false, crouchAmount = 0; // the jump's wind-up (0..1) and the right-stick crouch
let dip = 0; // the little duck while winding up a jump, eased
let fading = null; // { t, half, action }
const autopilot = params.has('auto');

const groundAt = (x, z) => lodge?.floorAt(x, z) ?? course.heightAt(x, z); // on foot: the cabin's floor where there is one

function placeOnSummit() {
  const p = course.pointAt(Math.max(0, course.startS - 26));
  if (lodge) { p.x = lodge.spawn.x; p.z = lodge.spawn.z; p.yaw = lodge.spawn.yaw; }
  rig.position.set(p.x, groundAt(p.x, p.z), p.z);
  rigYaw = p.yaw; rig.rotation.set(0, rigYaw, 0);
  boardMesh.visible = true;
  const g = course.pointAt(course.startS - 2.5); // the board waits by the gate
  boardMesh.position.set(g.x + 1.6, course.heightAt(g.x + 1.6, g.z) + 0.01, g.z);
  boardMesh.quaternion.setFromEuler(new THREE.Euler(0, g.yaw + 0.5, 0));
  mode = 'summit'; finishSign.mesh.visible = false; startSign.mesh.visible = true;
  audio.silence();
}

function boardAt(s, speed) {
  const p = course.pointAt(s);
  board = createBoardState({ x: p.x, y: course.heightAt(p.x, p.z), z: p.z, yaw: p.yaw, speed });
  rigYaw = p.yaw;
}

function dropIn() {
  boardAt(course.startS, 0);
  // Keep your real feet over the board: remember where your head is in the play space now.
  headOffset.set(renderer.xr.isPresenting ? camera.position.x : 0, renderer.xr.isPresenting ? camera.position.z : 0);
  standHeight = renderer.xr.isPresenting ? Math.max(1.2, camera.position.y) : RUN.eye;
  charge = 0; crouched = false; crouchAmount = 0;
  mode = 'countdown'; countdown = RUN.countdown; runTime = 0; lastCheckpoint = course.startS; result = null; lostFor = 0;
  startSign.mesh.visible = false; finishSign.mesh.visible = false;
  audio.chime(false);
}

function respawn() {
  boardAt(lastCheckpoint, 6); lostFor = 0;
}

function fadeThen(action) { if (!fading) { fading = { t: 0, half: 0.18, action, done: false }; fader.visible = true; } }

// ---------------------------------------------------------------- welcome screen, VR session
const enterVR = document.getElementById('enter-vr');
document.querySelector('#welcome .tag').textContent = `Run ${runNumber} · ${course.name}`;
// Lean to steer: off unless you tick it on the start screen; remembered on this headset.
const leanOption = document.getElementById('lean-steer');
try { leanOption.checked = localStorage.getItem('sandboarding.lean') === '1'; } catch { /* private window */ }
leanOption.addEventListener('change', () => { try { localStorage.setItem('sandboarding.lean', leanOption.checked ? '1' : '0'); } catch { /* ignore */ } });
const playButton = document.getElementById('play');
const welcome = document.getElementById('welcome');
const hudText = document.getElementById('hud');
let xrSupported = false, playing = false;
navigator.xr?.isSessionSupported?.('immersive-vr').then(ok => { xrSupported = ok; }).catch(() => {});

enterVR.addEventListener('click', async () => {
  audio.start();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'] });
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(0.65);
    if (session.supportedFrameRates && session.updateTargetFrameRate) {
      const rates = Array.from(session.supportedFrameRates);
      const want = rates.includes(72) ? 72 : rates.find(r => r >= 72);
      if (want) await session.updateTargetFrameRate(want).catch(() => {});
    }
  } catch (error) {
    status.textContent = error.name === 'NotAllowedError' ? 'VR access was declined.' : 'Could not enter VR. Open this page in the Meta Quest Browser.';
  }
});
renderer.xr.addEventListener('sessionstart', () => { camera.position.set(0, 0, 0); playing = true; welcome.hidden = true; placeOnSummit(); });
renderer.xr.addEventListener('sessionend', () => { camera.position.set(0, RUN.eye, 0); camera.rotation.set(0, 0, 0); playing = false; welcome.hidden = false; placeOnSummit(); });
playButton.addEventListener('click', () => { audio.start(); playing = true; welcome.hidden = true; hudText.hidden = false; canvas.requestPointerLock?.(); });
canvas.addEventListener('click', () => { if (playing && !renderer.xr.isPresenting) canvas.requestPointerLock?.(); });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  rigYaw -= e.movementX * 0.0025;
  camera.rotation.x = clamp(camera.rotation.x - e.movementY * 0.0025, -1.3, 1.3);
});
addEventListener('resize', () => { if (renderer.xr.isPresenting) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------------------------------------------------------------- per frame
const tmpN = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3(), basis = new THREE.Matrix4();
const yawQ = new THREE.Quaternion(), flipQ = new THREE.Quaternion(), X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0), feet = new THREE.Vector3(), lift = new THREE.Vector3();
const HIPS = 0.9; // metres above the board: flips turn you around here, like a rider's body
const smoothUp = new THREE.Vector3(0, 1, 0);
const headWorld = new THREE.Vector3();
let lastTime = 0;

function handsPulse(strength, ms) { for (const s of hands.states) pulseHaptics(s, strength, ms); }

function statusLines() {
  const best = store.best;
  if (mode === 'summit') {
    const g = course.pointAt(course.startS);
    camera.getWorldPosition(headWorld);
    const near = Math.hypot(headWorld.x - g.x, headWorld.z - g.z) < 7;
    return [
      { text: `Run ${runNumber} · ${course.name}`, size: 0.2, bold: true },
      { text: `Best ${formatTime(best)}`, size: 0.17, colour: '#ffd7a8' },
      { text: near ? 'Press A to drop in' : 'Walk to the start gate', size: 0.17, colour: near ? '#9fe0ff' : '#d8d0c4' },
    ];
  }
  if (mode === 'countdown') return [{ text: String(Math.ceil(countdown)), size: 0.6, bold: true }];
  const kmh = Math.round(speedOf(board) * 3.6);
  if (mode === 'finished') return [
    { text: result.newBest ? 'New best!' : 'Finish', size: 0.2, bold: true, colour: result.newBest ? '#ffd27a' : '#fff4e2' },
    { text: formatTime(result.time), size: 0.3, bold: true },
    { text: 'A again · Y summit', size: 0.15, colour: '#d8d0c4' },
  ];
  return [
    { text: formatTime(runTime), size: 0.3, bold: true },
    { text: `${kmh} km/h`, size: 0.2, colour: '#ffd7a8' },
    { text: lostFor > 1.5 ? 'B back to the run' : 'B checkpoint · Y summit', size: 0.15, colour: lostFor > 1.5 ? '#9fe0ff' : '#d8d0c4' },
  ];
}

function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  const session = renderer.xr.isPresenting ? renderer.xr.getSession() : null;
  const read = input.read(session); // always read, so button edges stay in step
  const inp = playing && !fading ? read : { moveX: 0, moveZ: 0, turn: 0, steer: 0, brake: 0, tuckKey: 0, a: false, b: false, y: false, aHeld: false, aReleased: false, crouchToggle: false };

  // Fades: out, act, back in.
  if (fading) {
    fading.t += dt;
    if (!fading.done && fading.t >= fading.half) { fading.action(); fading.done = true; }
    fader.material.opacity = fading.t < fading.half ? fading.t / fading.half : Math.max(0, 1 - (fading.t - fading.half) / fading.half);
    if (fading.t >= fading.half * 2) { fading = null; fader.visible = false; }
  }

  if (mode === 'summit') {
    // Walk: left stick (or WASD) relative to where you look; the right stick turns smoothly.
    camera.getWorldDirection(tmpF); tmpF.y = 0; tmpF.normalize();
    tmpR.set(-tmpF.z, 0, tmpF.x);
    const mx = inp.moveX, mz = inp.moveZ;
    rig.position.addScaledVector(tmpF, -mz * RUN.walkSpeed * dt).addScaledVector(tmpR, mx * RUN.walkSpeed * dt);
    rig.position.y = groundAt(rig.position.x, rig.position.z);
    rigYaw -= inp.turn * RUN.turnSpeed * dt; // smooth turning
    rig.rotation.set(0, rigYaw, 0); // level (clears any flip left over from a run)
    const g = course.pointAt(course.startS);
    camera.getWorldPosition(headWorld);
    const near = Math.hypot(headWorld.x - g.x, headWorld.z - g.z) < 7;
    startSign.draw([{ text: `Run ${runNumber} · ${course.name}`, size: 0.3, bold: true }, { text: near ? 'Press A to drop in' : 'Walk up to the gate', size: 0.24, colour: '#9fe0ff' }, { text: `Best ${formatTime(store.best)}`, size: 0.2, colour: '#ffd7a8' }]);
    if (near && inp.a) fadeThen(dropIn);
  } else if (mode !== 'fly') {
    if (mode === 'countdown') {
      const before = Math.ceil(countdown);
      countdown -= dt;
      if (Math.ceil(countdown) !== before && countdown > 0) audio.chime(false);
      if (countdown <= 0) { mode = 'ride'; audio.chime(true); const p = course.pointAt(course.startS); board.vx = -Math.sin(p.yaw) * 3; board.vz = -Math.cos(p.yaw) * 3; }
    }
    if (mode === 'ride' || mode === 'finished') {
      // Intent: steer, brake, tuck (crouch for real in VR), hop.
      const loc = course.locate(board.x, board.z);
      // Steer with the stick, plus leaning your head left or right over the board if that option is on.
      const lean = session && leanOption.checked ? leanSteer(camera.position.x - headOffset.x) : 0;
      let steer = clamp(inp.steer + lean, -1, 1), brake = inp.brake;
      if (autopilot) {
        const aim = course.pointAt(Math.min(course.length, loc.s + 14));
        steer = clamp(-angleDelta(board.yaw, Math.atan2(-(aim.x - board.x), -(aim.z - board.z))) * 2.5, -1, 1);
      }
      // Crouch: squat for real, or click the right stick to toggle it. Either way you tuck for speed.
      if (inp.crouchToggle) crouched = !crouched;
      crouchAmount += ((crouched ? 1 : 0) - crouchAmount) * Math.min(1, dt * 8);
      const squat = session ? clamp((standHeight - camera.position.y - 0.08) / 0.3, 0, 1) : 0;
      const tuck = Math.max(squat, crouchAmount, inp.tuckKey);
      if (mode === 'finished') brake = Math.max(brake, 0.7);
      // Jump: hold A to wind it up (the right controller rumbles harder as it builds), let go to pop. A tap is a small hop.
      let ollie = false;
      if (mode === 'ride' && board.grounded && inp.aHeld) {
        charge = Math.min(1, charge + dt / RUN.chargeTime);
        chargeClock += dt;
        if (chargeClock > 0.07) { chargeClock = 0; const right = hands.states.find(h => h.handedness === 'right'); pulseHaptics(right, 0.06 + 0.35 * charge, 50); }
      }
      if (inp.aReleased && charge > 0) { if (board.grounded && mode === 'ride') ollie = charge; charge = 0; }
      if (!board.grounded) charge = 0;
      if (!frozen) stepBoard(board, { steer, brake, tuck, ollie, pitch: inp.pitch }, course, dt);
      const speed = speedOf(board);

      for (const e of board.events) {
        if (e.type === 'launch') grab.clearLog();
        if (e.type === 'land' && grab.holding()) {
          // Still holding the board when it hits the sand: it's torn out of your hand, and that costs a little speed.
          grab.releaseAll(); board.vx *= 0.92; board.vy *= 0.92; board.vz *= 0.92; e.impact += 1.5;
        }
        if (e.type === 'land') {
          const hit = Math.min(1, e.impact / 8 + (e.heavy ? 0.35 : 0)); // a heavy (badly angled) landing hits harder
          audio.thump(hit); if (e.impact > 2 || e.heavy) puffs.impact(board.x, board.z, { size: 0.7, strength: hit }); handsPulse(Math.min(1, 0.25 + hit * 0.7), e.heavy ? 110 : 60);
        }
        if (e.type === 'bail') {
          grab.releaseAll();
          // A crash: thump, sand everywhere, then a quick fade and you're back on your feet on the run, a little slower.
          audio.thump(1); puffs.impact(board.x, board.z, { size: 1.2, strength: 1 }); handsPulse(1, 200);
          if (mode === 'ride') fadeThen(() => {
            let at = course.locate(board.x, board.z).s;
            const gap = course.features.find(f => f.type === 'gap' && at > f.from - 4 && at < f.to);
            if (gap) at = gap.to + 6; // never back on your feet in the hole: just past it
            boardAt(at, 5); lostFor = 0;
          });
        }
      }
      board.events.length = 0;

      // Sand spray off the tail, more when carving hard.
      const carve = Math.abs(board.steer) * clamp(speed / 12, 0, 1);
      sprayClock += dt;
      if (board.grounded && speed > 5 && sprayClock > 0.07) {
        sprayClock = 0;
        const fx = -Math.sin(board.yaw), fz = -Math.cos(board.yaw);
        puffs.kick(board.x - fx * 0.8, board.z - fz * 0.8, fx, fz, { size: 0.35 + carve * 0.35, count: 1 + Math.round(carve * 3 + speed / 14) });
      }
      // A soft rumble through both hands while the board is on the sand.
      rumbleClock += dt;
      if (board.grounded && speed > 3 && rumbleClock > 0.09) { rumbleClock = 0; handsPulse(0.04 + speed * 0.004 + carve * 0.08, 40); }
      audio.update(speed, board.grounded, carve);

      if (mode === 'ride') {
        runTime += dt;
        if (board.grounded && loc.distance < loc.halfWidth + 2) {
          const cp = course.startS + Math.floor((loc.s - course.startS) / RUN.checkpointEvery) * RUN.checkpointEvery;
          if (cp > lastCheckpoint) lastCheckpoint = cp;
        }
        lostFor = (loc.distance > loc.halfWidth + 25 || (speed < 0.8 && board.grounded && runTime > 5)) ? lostFor + dt : 0;
        if (loc.s >= course.finishS) {
          const best = store.best, newBest = runTime < best;
          if (newBest) store.best = runTime;
          result = { time: runTime, newBest, best: Math.min(best, runTime) };
          mode = 'finished'; finishedFor = 0; audio.chime(true); handsPulse(0.6, 120);
          finishSign.mesh.visible = true;
          finishSign.draw([{ text: result.newBest ? 'New best!' : 'Finish', size: 0.24, bold: true, colour: result.newBest ? '#ffd27a' : '#fff4e2' },
            { text: formatTime(result.time), size: 0.36, bold: true }, { text: `Best ${formatTime(result.best)}`, size: 0.18, colour: '#ffd7a8' },
            { text: 'A ride again  ·  Y back to the summit', size: 0.15, colour: '#d8d0c4' }]);
        }
        if (inp.b) fadeThen(respawn);
      } else {
        finishedFor += dt;
        if (inp.a && finishedFor > 0.8) fadeThen(dropIn);
      }
      if (inp.y) fadeThen(placeOnSummit);
    }

    // Board and rider follow the physics. The board tilts with the ground; your view only turns, never rolls or pitches.
    // On the sand the board follows the ground (smoothed); in the air it shows your flip.
    if (board.grounded) {
      tmpN.set(board.nx, board.ny, board.nz);
      smoothUp.lerp(tmpN, Math.min(1, dt * 14)).normalize();
      tmpF.set(-Math.sin(board.yaw), 0, -Math.cos(board.yaw)); tmpF.addScaledVector(smoothUp, -tmpF.dot(smoothUp)).normalize();
    } else {
      const a = boardAttitude(board);
      smoothUp.set(a.u.x, a.u.y, a.u.z); tmpF.set(a.f.x, a.f.y, a.f.z);
    }
    tmpR.crossVectors(tmpF, smoothUp).normalize();
    basis.makeBasis(tmpR, smoothUp, tmpF.clone().negate());
    boardMesh.quaternion.setFromRotationMatrix(basis);

    // Your view turns with the board (yaw always; in the air the flip too: the Full Send camera), pivoting at your hips so the board stays
    // under your feet. On the sand the view stays level: it never tilts with the slope.
    rigYaw += angleDelta(rigYaw, board.yaw) * Math.min(1, dt * 10);
    yawQ.setFromAxisAngle(Y_AXIS, rigYaw);
    flipQ.setFromAxisAngle(X_AXIS, board.grounded ? 0 : board.pitch);
    rig.quaternion.copy(yawQ).multiply(flipQ);
    // Feet: the hips (above the board) minus your body, turned with you. Your real head's spot in the play space stays over the board.
    lift.set(headOffset.x, HIPS, headOffset.y).applyQuaternion(rig.quaternion);
    rig.position.set(board.x, board.y + HIPS + 0.04, board.z).sub(lift);
    // A little duck while you wind up a jump: drops the moment you press A, springs back up the moment you pop.
    dip += ((charge > 0 ? RUN.chargeDip : 0) - dip) * Math.min(1, dt * 35);
    rig.position.y -= RUN.crouchDrop * crouchAmount + dip;
    feet.set(0, HIPS, 0).applyQuaternion(rig.quaternion);
    boardMesh.position.set(board.x, board.y + HIPS + 0.005, board.z).sub(feet);
  }

  if (!session && playing) hudText.textContent = statusLines().map(l => l.text).join('   ·   ');

  // Grabs: the board comes up to a squeezing hand in the air (after the physics has placed it), then the hands are fitted onto it.
  const riding = mode === 'ride' || mode === 'finished';
  if (riding) grab.update(dt, mode === 'ride' && !board.grounded); else if (grab.holding()) grab.releaseAll();
  hands.update(dt);
  grab.place();
  puffs.update(dt);
  worldTime.value = (time / 1000) % 3600;
  if (windSand) { camera.getWorldPosition(headWorld); windSand.update(time / 1000, headWorld, session ? WIND_SAND.vrViewHeight : renderer.domElement.height); }
  renderer.render(scene, camera);
}

placeOnSummit();
// Dev views for screenshots and quick testing: ?s=<metres down the run> starts you riding there, ?auto drives for you,
// ?play skips the welcome screen, ?pitch=<radians> tilts the desktop camera.
if (params.has('s')) { mode = 'ride'; boardAt(Number(params.get('s')) || course.startS, 12); startSign.mesh.visible = false; }
if (params.has('pitch')) camera.rotation.x = Number(params.get('pitch'));
if (params.has('play')) { playing = true; welcome.hidden = true; hudText.hidden = false; }
if (params.has('fly')) { // ?fly=x,y,z,yaw,pitch: a free camera for looking at the course from anywhere
  const [x, y, z, yaw, pitch] = params.get('fly').split(',').map(Number);
  mode = 'fly'; rig.position.set(x, y, z); rigYaw = yaw || 0; rig.rotation.y = rigYaw; camera.rotation.x = pitch || 0;
}
renderer.setAnimationLoop(frame);
if (params.has('grabtest')) import('./dev-grab-test.js').then(m => m.grabTest({ params, hands, rig, camera, grab, boardMesh, board: () => board, freeze: () => { frozen = true; } }));
window.__sand = { course, get board() { return board; }, get mode() { return mode; }, camera, rig, BOARD };
