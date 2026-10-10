import * as THREE from 'three';

// Text on canvases: a small panel on the left wrist (time, speed, prompts) and a big sign in the world (results at the finish, the
// prompt at the start gate). Redrawn only when the text changes.

export const formatTime = t => {
  if (!Number.isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

function createPanel({ width, height, pxPerMetre = 2400, background = 'rgba(18, 22, 28, 0.78)' }) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * pxPerMetre); canvas.height = Math.round(height * pxPerMetre);
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false }));
  mesh.renderOrder = 20;
  let last = '';
  function draw(lines) {
    const key = JSON.stringify(lines);
    if (key === last) return; last = key;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = background;
    const r = canvas.height * 0.12;
    g.beginPath(); g.roundRect(0, 0, canvas.width, canvas.height, r); g.fill();
    let y = canvas.height * 0.08;
    for (const line of lines) {
      const size = line.size * canvas.height;
      g.font = `${line.bold ? '700' : '500'} ${size}px system-ui, sans-serif`;
      g.fillStyle = line.colour || '#fff4e2'; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(line.text, canvas.width / 2, y);
      y += size * 1.18;
    }
    texture.needsUpdate = true;
  }
  return { mesh, draw };
}

export function createWristPanel() {
  const panel = createPanel({ width: 0.13, height: 0.075 });
  // Sits on the back of the left wrist, facing you when you look at your watch.
  panel.mesh.position.set(0.0, 0.035, 0.07);
  panel.mesh.rotation.set(-Math.PI / 2 + 0.35, 0, Math.PI / 2);
  return panel;
}

export function createSign({ width = 3.2, height = 1.2 } = {}) {
  return createPanel({ width, height, pxPerMetre: 320 });
}
