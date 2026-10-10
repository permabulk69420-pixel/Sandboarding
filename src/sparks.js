import * as THREE from 'three';

// Sparks: the shower thrown off where the board grinds a rail. A pool of short streaks, each a thin quad stretched along its own direction of
// travel, drawn as one instanced mesh with additive light so a crowd of them glows. The simulation has no three.js in it so it can be
// tested; nothing is allocated while it runs.

export const SPARKS = Object.freeze({
  capacity: 192,
  gravity: 9.8,
  drag: 1.6, // per second: how quickly a spark's speed dies away
  life: Object.freeze([0.25, 0.6]), // seconds
  size: 0.011, // half width of a streak, metres
  streak: 0.022, // seconds of travel a streak is long
  nearFade: Object.freeze([0.25, 0.7]), // metres from the eye over which a spark fades out, so none ever fills the view
});

export function createSparkSim({ capacity = SPARKS.capacity, random = Math.random, config = SPARKS } = {}) {
  const position = new Float32Array(capacity * 3);
  const velocity = new Float32Array(capacity * 3);
  const life = new Float32Array(capacity); // seconds in all; 0 means the slot is free
  const age = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  let next = 0;

  // Throws `count` sparks from (x, y, z). `vx, vy, vz` is the direction and speed they leave along (a spark keeps part of the board's own
  // speed); `spread` scatters them sideways, `up` gives each a lift, `scale` sizes them.
  function emit(x, y, z, vx, vy, vz, { count = 1, spread = 2.2, up = 2.2, scale = 1 } = {}) {
    for (let n = 0; n < count; n += 1) {
      const i = next; next = (next + 1) % capacity;
      const p = i * 3, k = 0.45 + 0.7 * random();
      position[p] = x; position[p + 1] = y; position[p + 2] = z;
      velocity[p] = vx * k + (random() - 0.5) * 2 * spread;
      velocity[p + 1] = vy * k + up * (0.3 + random()) + (random() - 0.5) * spread * 0.5;
      velocity[p + 2] = vz * k + (random() - 0.5) * 2 * spread;
      life[i] = config.life[0] + (config.life[1] - config.life[0]) * random();
      age[i] = 0;
      size[i] = config.size * scale * (0.7 + 0.6 * random());
    }
  }

  // Moves everything on by `dt` seconds and writes each live spark's state into `place` (x, y, z, half width per spark) and `look` (the
  // velocity x, y, z and how far through its life it is, 0 to 1). Returns how many slots to draw.
  function update(dt, place, look) {
    const drag = Math.exp(-config.drag * dt);
    let top = -1;
    for (let i = 0; i < capacity; i += 1) {
      if (life[i] <= 0) continue;
      age[i] += dt;
      if (age[i] >= life[i]) { life[i] = 0; look[i * 4 + 3] = 1; place[i * 4 + 3] = 0; continue; }
      const p = i * 3;
      velocity[p] *= drag; velocity[p + 2] *= drag;
      velocity[p + 1] = velocity[p + 1] * drag - config.gravity * dt;
      position[p] += velocity[p] * dt; position[p + 1] += velocity[p + 1] * dt; position[p + 2] += velocity[p + 2] * dt;
      const k = i * 4;
      place[k] = position[p]; place[k + 1] = position[p + 1]; place[k + 2] = position[p + 2]; place[k + 3] = size[i];
      look[k] = velocity[p]; look[k + 1] = velocity[p + 1]; look[k + 2] = velocity[p + 2]; look[k + 3] = age[i] / life[i];
      top = i;
    }
    return top + 1;
  }

  return { emit, update, capacity, get live() { let c = 0; for (let i = 0; i < capacity; i += 1) if (life[i] > 0) c += 1; return c; } };
}

const VERTEX = /* glsl */`
  attribute vec4 aPlace; // x, y, z: where the head is; w: half width in metres (0 = not alive)
  attribute vec4 aLook; // x, y, z: velocity; w: how far through its life (0 to 1)
  uniform vec2 uNear;
  uniform float uStreak;
  varying float vLife;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vec3 head = aPlace.xyz;
    vec3 tail = head - aLook.xyz * uStreak;
    vec4 h = projectionMatrix * viewMatrix * vec4(head, 1.0);
    vec4 t = projectionMatrix * viewMatrix * vec4(tail, 1.0);
    // work in a space where a pixel is the same size across and up (x scaled by the aspect), then go back to clip space
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    vec2 hIso = vec2(h.x / h.w * aspect, h.y / h.w);
    vec2 tIso = vec2(t.x / max(t.w, 0.02) * aspect, t.y / max(t.w, 0.02));
    vec2 d = hIso - tIso;
    float len = length(d);
    vec2 along = len > 1e-5 ? d / len : vec2(0.0, 1.0);
    vec2 across = vec2(-along.y, along.x);
    float wide = max(aPlace.w * projectionMatrix[1][1] / max(h.w, 0.02), 0.0035); // half the streak's width on screen, never thinner than a pixel or two
    // x runs across the streak (-1 to 1), y from the head (0) back to the tail (1); the head sticks out a little so it is rounded, not cut
    vec2 iso = hIso - along * (position.y * max(len, wide * 1.5)) + along * ((1.0 - position.y) * wide * 0.8) + across * (position.x * wide);
    gl_Position = vec4(iso.x / aspect * h.w, iso.y * h.w, h.z, h.w);
    if (aPlace.w <= 0.0 || h.w < 0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // a dead slot, or behind the eye: clipped away
    vLife = aLook.w;
    vUv = position.xy;
    vFade = smoothstep(uNear.x, uNear.y, h.w);
  }
`;

const FRAGMENT = /* glsl */`
  varying float vLife;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float across = 1.0 - abs(vUv.x);
    float along = 1.0 - vUv.y * 0.85; // brightest at the head, thinning toward the tail
    float shape = smoothstep(0.0, 0.6, across) * along;
    float fade = pow(1.0 - vLife, 1.4) * vFade;
    // white hot at first, then yellow, then ember orange as it cools
    vec3 hot = mix(vec3(4.0, 3.4, 2.4), vec3(2.4, 0.9, 0.18), smoothstep(0.0, 0.8, vLife));
    float a = shape * fade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(hot * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// `scene`: where to add the sparks' mesh.
export function createSparks({ scene = null, capacity = SPARKS.capacity } = {}) {
  const sim = createSparkSim({ capacity });
  const geometry = new THREE.InstancedBufferGeometry();
  // a quad: x across (-1 to 1), y from the head (0) to the tail (1)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const place = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const look = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  place.setUsage(THREE.DynamicDrawUsage); look.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPlace', place); geometry.setAttribute('aLook', look);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { uNear: { value: new THREE.Vector2(...SPARKS.nearFade) }, uStreak: { value: SPARKS.streak } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Sparks'; mesh.frustumCulled = false; mesh.renderOrder = 7; mesh.visible = false;
  scene?.add(mesh);
  return {
    mesh, sim,
    emit: sim.emit,
    update(dt) {
      if (!(dt > 0)) return;
      const draw = sim.update(dt, place.array, look.array);
      geometry.instanceCount = draw;
      mesh.visible = draw > 0;
      if (draw > 0) { place.needsUpdate = true; look.needsUpdate = true; }
    },
    dispose() { geometry.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}
