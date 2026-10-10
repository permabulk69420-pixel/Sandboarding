import * as THREE from 'three';

// Dev only (?grabtest&s=<metres>): holds the board in the air and fakes the two controllers, so grabs can be looked at on a desktop.
//   rh=x,y,z,pitch,yaw,roll / lh=...  where each hand is, in the player rig's space (metres) and how it's turned (degrees)
//   cam=x,y,z,yaw,pitch               moves the eye (rig space, radians) to look from outside
//   squeeze=right|left|both           which hands squeeze (after half a second, so the grab starts on the press)
export function grabTest({ params, hands, rig, camera, grab, boardMesh, board, freeze }) {
  const st = board();
  st.grounded = false; st.y += 1.6; st.vx = st.vy = st.vz = 0; st.upx = st.nx; st.upy = st.ny; st.upz = st.nz;
  st.pitch = Number(params.get('flip') || 0);
  freeze();
  const squeeze = params.get('squeeze') || 'both';
  const pose = side => {
    const v = (params.get(side === 'right' ? 'rh' : 'lh') || (side === 'right' ? '0.28,0.75,-0.1,-40,0,0' : '-0.28,0.75,-0.1,-40,0,0')).split(',').map(Number);
    return { p: new THREE.Vector3(v[0], v[1], v[2]), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(...v.slice(3, 6).map(d => (d || 0) * Math.PI / 180), 'YXZ')) };
  };
  const pads = {};
  hands.states.forEach((state, i) => {
    const side = i === 0 ? 'left' : 'right';
    pads[side] = { buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false })), axes: [0, 0, 0, 0] };
    state.controller.dispatchEvent({ type: 'connected', data: { handedness: side, gamepad: pads[side] } });
    const { p, q } = pose(side);
    state.grip.visible = true; state.grip.matrixAutoUpdate = true;
    state.grip.position.copy(p); state.grip.quaternion.copy(q);
  });
  setTimeout(() => {
    for (const side of ['left', 'right']) if (squeeze === 'both' || squeeze === side) { pads[side].buttons[1].value = 1; pads[side].buttons[1].pressed = true; }
  }, 500);
  if (params.has('cam')) {
    const [x, y, z, yaw, pitch] = params.get('cam').split(',').map(Number);
    camera.position.set(x, y, z); camera.rotation.set(pitch || 0, yaw || 0, 0, 'YXZ');
  }
  window.__grabtest = { hands, rig, grab, boardMesh, camera, THREE };
}
