import * as THREE from 'three';

// Placeholder props until Kane's models arrive: start and finish gates, flags along the lane edges, and the board.
// Everything here is simple geometry and one or two materials, instanced where there are many.

function bannerTexture(text, { bg = '#e8642c', fg = '#fff4e2' } = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg; g.font = 'bold 132px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 6);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// A gate across the middle of the lane at arc length s: two posts and a banner between them, 11 m wide.
export function createGate(course, s, text, colours) {
  const p = course.pointAt(s), w = 5.5;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = -fz, rz = fx; // forward and right
  const group = new THREE.Group(); group.name = `Gate ${text}`;
  const postMat = new THREE.MeshStandardMaterial({ color: '#2d2a2a', roughness: 0.6, metalness: 0.3 });
  const height = 4.4;
  const ends = [-1, 1].map(side => [p.x + rx * w * side, p.z + rz * w * side]);
  for (const [x, z] of ends) {
    const y = course.heightAt(x, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, height, 10), postMat);
    post.position.set(x, y + height / 2, z); group.add(post);
  }
  const top = Math.max(...ends.map(([x, z]) => course.heightAt(x, z))) + height - 0.9;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, w * 2 * 0.1875),
    new THREE.MeshBasicMaterial({ map: bannerTexture(text, colours), side: THREE.DoubleSide, toneMapped: false }));
  banner.position.set(p.x, top, p.z);
  banner.rotation.y = p.yaw;
  group.add(banner);
  return group;
}

// Little flags on poles down both edges of the lane, blue on the left and orange on the right, so the line reads from far away and
// speed reads up close. Two instanced meshes.
export function createLaneFlags(course, { every = 24 } = {}) {
  const spots = [];
  for (let s = course.startS + 20; s < course.finishS - 10; s += every) {
    const p = course.pointAt(s), w = course.halfWidth(s) + 0.8;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = -fz, rz = fx;
    for (const side of [-1, 1]) {
      const x = p.x + rx * w * side, z = p.z + rz * w * side;
      spots.push({ x, z, y: course.heightAt(x, z), yaw: p.yaw, side });
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.025, 0.03, 1.8, 6); poleGeo.translate(0, 0.9, 0);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.8, 0, 0, 1.38, 0, 0, 1.59, 0.42], 3));
  flagGeo.computeVertexNormals();
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: '#e9e2d6', roughness: 0.7 }), spots.length);
  const flags = new THREE.InstancedMesh(flagGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  const blue = new THREE.Color('#2f7fd8'), orange = new THREE.Color('#f07a2a');
  spots.forEach((sp, i) => {
    q.setFromEuler(e.set(0, sp.yaw, 0)); m.compose(pos.set(sp.x, sp.y - 0.05, sp.z), q, one);
    poles.setMatrixAt(i, m); flags.setMatrixAt(i, m); flags.setColorAt(i, sp.side < 0 ? blue : orange);
  });
  const group = new THREE.Group(); group.name = 'Lane flags'; group.add(poles, flags);
  return group;
}

// The placeholder board: a rounded deck about 1.35 m long with two straps. Its length runs along -z (the way it points).
export function createBoardMesh() {
  const L = 1.35, W = 0.3, r = 0.15;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, -L / 2 + r);
  shape.lineTo(-W / 2, L / 2 - r); shape.quadraticCurveTo(-W / 2, L / 2, 0, L / 2); shape.quadraticCurveTo(W / 2, L / 2, W / 2, L / 2 - r);
  shape.lineTo(W / 2, -L / 2 + r); shape.quadraticCurveTo(W / 2, -L / 2, 0, -L / 2); shape.quadraticCurveTo(-W / 2, -L / 2, -W / 2, -L / 2 + r);
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 });
  deckGeo.rotateX(-Math.PI / 2); // lie flat, shape's +y becomes -z (the nose)
  deckGeo.translate(0, 0.012, 0);
  // Tip the nose and tail up a little.
  const p = deckGeo.attributes.position;
  for (let i = 0; i < p.count; i += 1) { const z = p.getZ(i); const t = Math.max(0, Math.abs(z) - 0.48) / 0.2; p.setY(i, p.getY(i) + t * t * 0.07); }
  deckGeo.computeVertexNormals();

  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256); grad.addColorStop(0, '#f2e6cf'); grad.addColorStop(1, '#e4d2b0');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#e8642c'; g.fillRect(0, 108, 64, 16); g.fillStyle = '#2f7fd8'; g.fillRect(0, 128, 64, 8);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  // Planar UVs from the deck's footprint so the stripe runs across the middle.
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 1) { uv[i * 2] = p.getX(i) / W + 0.5; uv[i * 2 + 1] = p.getZ(i) / L + 0.5; }
  deckGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  const board = new THREE.Group(); board.name = 'Board';
  board.add(new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })));
  const strapMat = new THREE.MeshStandardMaterial({ color: '#232326', roughness: 0.8 });
  for (const z of [-0.24, 0.24]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.035, 0.07), strapMat);
    strap.position.set(0, 0.045, z); board.add(strap);
  }
  return board;
}
