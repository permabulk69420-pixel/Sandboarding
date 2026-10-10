import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { getHeldGripPose } from './grip-poses.js';
import { createAdaptiveGrip } from './adaptive-grip.js';
import { pulseHaptics } from './haptics.js';

// VR hands, trimmed from Oasis (src/hands.js there): the same rigs, poses and adaptive grip, without Oasis's tools, sticks, stones
// and fruit. The rigs are the pinned dumbgame hands, stored locally so they load with the game.
const HAND_ASSETS = Object.freeze({
  left: `${import.meta.env?.BASE_URL ?? '/'}models/hands/LeftHand.glb`,
  right: `${import.meta.env?.BASE_URL ?? '/'}models/hands/RightHand.glb`
});

// The meshes are authored with fingers along -Z and palms along -Y. These are
// the same mirrored grip-space offsets used in dumbgame.
const HAND_GRIP_OFFSETS = Object.freeze({
  left: Object.freeze({ position: Object.freeze([0, 0, 0]), rotation: Object.freeze([0, 0, Math.PI / 2]) }),
  right: Object.freeze({ position: Object.freeze([0, 0, 0]), rotation: Object.freeze([0, 0, -Math.PI / 2]) })
});

const PRIMARY_FACE_BUTTON = 4; // Quest X on left; right A is reserved for jump.
const PICKUP_HAPTIC_STRENGTH = 0.18;
const PICKUP_HAPTIC_MS = 28;
const loader = new GLTFLoader();
const gripMatrix = new THREE.Matrix4();

function prepareModel(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
  });
  return root;
}

function createActions(root, clips) {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    action.weight = 0;
    actions.set(clip.name, action);
  }
  return { mixer, actions, current: null };
}

function setPose(state, name, amount) {
  const action = state.actions.get(name);
  if (!action) return;
  if (state.current && state.current !== action) state.current.weight = 0;
  state.current = action;
  action.weight = 1;
  action.time = THREE.MathUtils.clamp(amount, 0, 1);
}

export function createVRHands({ renderer, scene, parent = null, gripDebug = false, onError = console.warn }) {
  // Oasis moves/turns a camera rig through the world. Match dumbgame by putting
  // WebXR controller and grip nodes under that rig rather than directly in scene space.
  const controllerParent = parent
    || scene?.children?.find((child) => child.isGroup && child.children.some((item) => item.isCamera))
    || scene;
  if (!controllerParent) throw new Error('VR hands require an XR player rig or scene parent.');

  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
  for (let i = 0; i < controllers.length; i += 1) {
    controllerParent.add(controllers[i]);
    controllerParent.add(grips[i]);
  }

  const models = { left: null, right: null };
  let visible = true;

  const states = controllers.map((controller, index) => {
    const objectGrip = new THREE.Group();
    objectGrip.name = `controller-${index}-held-object-anchor`;
    grips[index].add(objectGrip);
    return {
      controller,
      grip: grips[index],
      objectGrip,
      inputSource: null,
      handedness: '',
      pointing: false,
      primaryDown: false,
      heldGripProfile: null,
      handAnchor: null,
      handRoot: null,
      gripSocket: null,
      indexTip: null,
      mixerState: null,
      adaptiveGrip: null
    };
  });

  function resetObjectGrip(state) {
    state.grip.add(state.objectGrip);
    state.objectGrip.position.set(0, 0, 0);
    state.objectGrip.quaternion.identity();
    state.objectGrip.scale.set(1, 1, 1);
  }

  function syncObjectGrip(state) {
    if (!state.gripSocket) return;
    if (state.objectGrip.parent !== state.grip) state.grip.add(state.objectGrip);
    state.grip.updateWorldMatrix(true, false);
    state.gripSocket.updateWorldMatrix(true, false);
    gripMatrix
      .copy(state.grip.matrixWorld)
      .invert()
      .multiply(state.gripSocket.matrixWorld)
      .decompose(state.objectGrip.position, state.objectGrip.quaternion, state.objectGrip.scale);
    state.objectGrip.updateMatrixWorld(true);
  }

  function detach(state) {
    state.adaptiveGrip?.dispose();
    state.adaptiveGrip = null;
    resetObjectGrip(state);
    state.heldGripProfile = null;
    if (state.handAnchor) state.grip.remove(state.handAnchor);
    state.handAnchor = null;
    state.handRoot = null;
    state.gripSocket = null;
    state.indexTip = null;
    state.mixerState = null;
  }

  function attach(state) {
    const handedness = state.handedness;
    const gltf = models[handedness];
    if (!gltf || (handedness !== 'left' && handedness !== 'right')) return;

    detach(state);
    const root = prepareModel(clone(gltf.scene));
    root.name = `${handedness}-vr-hand`;

    const offset = HAND_GRIP_OFFSETS[handedness];
    const anchor = new THREE.Group();
    anchor.name = `${handedness}-hand-grip-offset`;
    anchor.position.fromArray(offset.position);
    anchor.rotation.set(...offset.rotation);
    anchor.visible = visible;
    anchor.add(root);
    state.grip.add(anchor);

    const side = handedness === 'left' ? 'l' : 'r';
    const socketName = `b_${side}_grip`;
    const indexTipName = `b_${side}_index_ignore`;
    const gripSocket = root.getObjectByName(socketName);
    const indexTip = root.getObjectByName(indexTipName);
    if (!gripSocket) onError(`Missing ${socketName}; held objects will use the controller wrist origin.`);
    if (!indexTip) onError(`Missing ${indexTipName}; fingertip interactions are unavailable.`);

    state.handAnchor = anchor;
    state.handRoot = root;
    state.gripSocket = gripSocket || null;
    state.indexTip = indexTip || null;
    state.mixerState = createActions(root, gltf.animations);
    state.adaptiveGrip = createAdaptiveGrip({ root, clips: gltf.animations, objectGrip: state.objectGrip, handedness, debug: gripDebug });
    setPose(state.mixerState, 'Open', 0);
    syncObjectGrip(state);
  }

  for (const state of states) {
    state.controller.addEventListener('connected', (event) => {
      state.inputSource = event.data;
      state.handedness = event.data.handedness || '';
      state.objectGrip.name = `${state.handedness || 'unknown'}-held-object-anchor`;
      state.pointing = false;
      state.primaryDown = false;
      state.heldGripProfile = null;
      attach(state);
    });

    state.controller.addEventListener('disconnected', () => {
      state.inputSource = null;
      state.handedness = '';
      state.pointing = false;
      state.primaryDown = false;
      state.heldGripProfile = null;
      detach(state);
    });
  }

  Promise.allSettled([
    loader.loadAsync(HAND_ASSETS.left),
    loader.loadAsync(HAND_ASSETS.right)
  ]).then(([left, right]) => {
    if (left.status === 'fulfilled') models.left = left.value;
    else onError(`Left VR hand failed to load: ${left.reason?.message || left.reason}`);
    if (right.status === 'fulfilled') models.right = right.value;
    else onError(`Right VR hand failed to load: ${right.reason?.message || right.reason}`);
    for (const state of states) attach(state);
  });

  function updateHandPose(state, dt) {
    if (!state.mixerState) return;
    const buttons = state.inputSource?.gamepad?.buttons || [];
    const trigger = buttons[0]?.value ?? 0;
    const squeeze = buttons[1]?.value ?? 0;
    const heldGripPose = getHeldGripPose(state);

    // Keep authored poses for free hands and unsupported future items. Supported
    // held objects receive their cached, per-joint contact pose after pickup/drop.
    if (heldGripPose && squeeze > 0.08) {
      setPose(state.mixerState, heldGripPose.animation, heldGripPose.amount);
    } else if (squeeze > 0.08 && trigger > 0.08) {
      setPose(state.mixerState, 'Fist', Math.max(trigger, squeeze));
    } else if (squeeze > 0.08) {
      setPose(state.mixerState, 'Grip', squeeze);
    } else if (state.pointing && trigger <= 0.08) {
      setPose(state.mixerState, 'Point', 1);
    } else if (trigger > 0.08) {
      setPose(state.mixerState, 'Pinch', trigger);
    } else {
      setPose(state.mixerState, 'Open', 0);
    }

    state.mixerState.mixer.update(dt);
    state.adaptiveGrip?.update(state.objectGrip.children[0] || null, dt);
  }

  function update(dt) {
    for (const state of states) {
      const buttons = state.inputSource?.gamepad?.buttons || [];
      const primary = Boolean(buttons[PRIMARY_FACE_BUTTON]?.pressed);
      // Keep the old point toggle on left X only. Right A is gameplay jump now.
      if (state.handedness === 'left' && primary && !state.primaryDown) state.pointing = !state.pointing;
      state.primaryDown = primary;
      syncObjectGrip(state);
    }

    for (const state of states) {
      const before = state.objectGrip.children.length;
      updateHandPose(state, dt);
      if (before === 0 && state.objectGrip.children.length > 0) pulseHaptics(state, PICKUP_HAPTIC_STRENGTH, PICKUP_HAPTIC_MS);
    }
  }

  function setVisible(value) {
    visible = Boolean(value);
    for (const state of states) {
      if (state.handAnchor) state.handAnchor.visible = visible;
    }
    return visible;
  }

  function getIndexTipWorldPosition(handedness, target) {
    const state = states.find((item) => item.handedness === handedness);
    if (!state?.indexTip || !target?.isVector3) return false;
    state.indexTip.updateWorldMatrix(true, false);
    state.indexTip.getWorldPosition(target);
    return true;
  }

  return {
    update,
    states,
    controllers,
    grips,
    objectGrips: states.map((state) => state.objectGrip),
    setVisible,
    isVisible: () => visible,
    getIndexTipWorldPosition
  };
}
