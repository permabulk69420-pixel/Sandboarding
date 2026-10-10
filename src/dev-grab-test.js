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
  // look=right|left&orbit=yawDeg,pitchDeg,dist: once the grab has settled, keep the camera aimed at that hand's grip from that angle (around
  // the board's own axes, so every grab is seen the same way).
  if (params.has('look')) {
    const side = params.get('look'), [oy, op, od] = (params.get('orbit') || '60,20,0.45').split(',').map(Number);
    const target = new THREE.Vector3(), eye = new THREE.Vector3(), q = new THREE.Quaternion();
    setInterval(() => {
      const state = hands.states.find(h => h.handedness === side);
      if (!state?.gripSocket) return;
      state.gripSocket.getWorldPosition(target);
      boardMesh.getWorldQuaternion(q);
      eye.set(0, 0, od).applyEuler(new THREE.Euler(-op * Math.PI / 180, oy * Math.PI / 180, 0, 'YXZ')).applyQuaternion(q).add(target);
      rig.worldToLocal(camera.position.copy(eye));
      camera.lookAt(target);
    }, 30);
  }
  // Which way each holding hand's palm faces against the way it should (degrees apart), for checking the fit numerically.
  window.__palmCheck = () => hands.states.filter(s => s.objectGrip.children.length).map(s => {
    const side = s.handedness === 'left' ? 'l' : 'r', w = n => s.handRoot.getObjectByName(`b_${side}_${n}`).getWorldPosition(new THREE.Vector3());
    const wr = w('hand'), a = w('index1').sub(wr), b = w('pinky1').sub(wr), tip = w('middle_ignore').sub(wr);
    const palm = new THREE.Vector3().crossVectors(a, b).normalize(); if (palm.dot(tip) < 0) palm.negate();
    const g = [...grab.debug().entries()].find(([st]) => st === s)?.[1];
    return { hand: s.handedness, grab: g?.name, palm: palm.toArray().map(x => +x.toFixed(2)), inward: g?.inwardWorld?.toArray().map(x => +x.toFixed(2)), apart: g?.inwardWorld ? +(palm.angleTo(g.inwardWorld) * 180 / Math.PI).toFixed(0) : null };
  });
  window.__grabtest = { hands, rig, grab, boardMesh, camera, THREE };
}
