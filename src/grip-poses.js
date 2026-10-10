// Conventional authored VR grip profiles. Objects choose the closest handle size;
// the hand then holds a fixed pose instead of closing blindly through the mesh.
export const GRIP_PROFILE = Object.freeze({
  THIN: 'thin',
  MEDIUM: 'medium',
  LARGE: 'large',
  PINCH: 'pinch',
});

const GRIP_POSES = Object.freeze({
  thin: Object.freeze({ animation: 'Grip', amount: 0.86 }),
  medium: Object.freeze({ animation: 'Grip', amount: 0.72 }),
  large: Object.freeze({ animation: 'Grip', amount: 0.58 }),
  pinch: Object.freeze({ animation: 'Pinch', amount: 1 }),
});

export function setHeldGripProfile(state, profile = GRIP_PROFILE.MEDIUM) {
  if (!state) return;
  state.heldGripProfile = GRIP_POSES[profile] ? profile : GRIP_PROFILE.MEDIUM;
}

export function clearHeldGripProfile(state) {
  if (state) state.heldGripProfile = null;
}

export function getHeldGripPose(state) {
  if (!state) return null;

  // Explicit per-item profile wins when a future asset needs one.
  if (state.heldGripProfile && GRIP_POSES[state.heldGripProfile]) {
    return GRIP_POSES[state.heldGripProfile];
  }

  // Generic game-style fallback: anything actually attached to the hand receives a
  // sensible authored pose automatically. Thin loose sticks use the slimmer pose;
  // ordinary tools such as the axe and torch use the medium handle pose by default.
  const heldObject = state.objectGrip?.children?.[0] || null;
  if (!heldObject) return null;
  const profile = heldObject.userData?.gripProfile
    || GRIP_PROFILE.MEDIUM;
  return GRIP_POSES[profile] || GRIP_POSES[GRIP_PROFILE.MEDIUM];
}
