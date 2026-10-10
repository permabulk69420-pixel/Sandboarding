import * as THREE from 'three';

// Puffs of sand and dust: the soft clouds that jump up when something heavy lands on the dunes (a stinger's sting, a body falling over) and
// drift off. One instanced mesh of camera-facing quads, so every puff in the world is a single draw call, and nothing is allocated while
// it runs. The pool is simulated on the CPU (a few dozen puffs at most): each puff is thrown out with a velocity, loses speed to the air,
// lifts a little (warm dusty air), swells as it spreads and fades. They are lit the way the wind-blown sand is (src/wind-sand.js): sand
// coloured, glowing a little when the sun is behind them, a faint moonlit smudge at night.

export const PUFFS = Object.freeze({
  capacity: 192,
  drag: 2.3, // per second: how quickly a puff's speed dies away
  rise: 0.45, // metres per second squared of lift
  grow: 2.1, // how many times wider a puff is at the end of its life than at the start
  fadeIn: 0.1, // share of its life it takes to come up to full strength
  floor: 0.42, // a puff's centre stays this many of its own radii above the ground, so its soft edge meets the sand and does not slice it
  nearFade: Object.freeze([0.7, 2.8]), // metres from the eye over which a puff fades out, so one never fills the view
});

// The simulation, with no three.js in it, so it can be tested. Arrays are written in place by `update`.
export function createPuffSim({ capacity = PUFFS.capacity, heightAt = () => 0, random = Math.random, config = PUFFS } = {}) {
  const position = new Float32Array(capacity * 3);
  const velocity = new Float32Array(capacity * 3);
  const radius0 = new Float32Array(capacity); // metres, at birth
  const alpha0 = new Float32Array(capacity);
  const life = new Float32Array(capacity); // seconds in all; 0 means the slot is free
  const age = new Float32Array(capacity);
  const turn = new Float32Array(capacity);
  const spin = new Float32Array(capacity);
  const seed = new Float32Array(capacity);
  let next = 0;
  let live = 0;
  let highest = -1;

  // Puff out `count` clouds around (x, y, z). Options (all optional):
  //   radius    the puffs start scattered over a disc this wide (metres)
  //   outward   speed away from the middle, across the ground (m/s)
  //   push      [dx, dz, speed]: an extra shove along a direction (the lunge kicks sand backwards)
  //   up        upward speed (m/s)
  //   jitter    random extra speed in every direction (m/s)
  //   size      [min, max] radius at birth (metres)
  //   life      [min, max] seconds
  //   alpha     strength at the peak, 0 to 1
  function emit(x, y, z, count, {
    radius = 0.5, outward = 2, push = null, up = 0.8, jitter = 0.5, size = [0.35, 0.6], life: lifeRange = [1.2, 2], alpha = 0.4,
  } = {}) {
    for (let n = 0; n < count; n++) {
      const i = next;
      next = (next + 1) % capacity;
      const p = i * 3;
      const angle = random() * Math.PI * 2;
      const away = Math.sqrt(random()) * radius;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      position[p] = x + ca * away;
      position[p + 1] = y;
      position[p + 2] = z + sa * away;
      const spread = outward * (0.55 + 0.9 * random());
      velocity[p] = ca * spread + (random() - 0.5) * jitter;
      velocity[p + 1] = up * (0.6 + 0.8 * random()) + (random() - 0.5) * jitter * 0.4;
      velocity[p + 2] = sa * spread + (random() - 0.5) * jitter;
      if (push) {
        velocity[p] += push[0] * push[2] * (0.6 + 0.8 * random());
        velocity[p + 2] += push[1] * push[2] * (0.6 + 0.8 * random());
      }
      radius0[i] = size[0] + (size[1] - size[0]) * random();
      alpha0[i] = alpha * (0.7 + 0.3 * random());
      life[i] = lifeRange[0] + (lifeRange[1] - lifeRange[0]) * random();
      age[i] = 0;
      turn[i] = random() * Math.PI * 2;
      spin[i] = (random() - 0.5) * 0.9;
      seed[i] = random();
    }
  }

  // Moves everything on by `dt` seconds and writes each puff's place and look into the two arrays the renderer reads:
  // `place` (x, y, z and the height of the ground under it, per puff) and `look` (radius, alpha, seed, turn per puff). Returns how many slots to draw.
  function update(dt, place, look) {
    if (!(dt > 0)) return highest + 1;
    const drag = Math.exp(-config.drag * dt);
    live = 0;
    let top = -1;
    for (let i = 0; i < capacity; i++) {
      if (life[i] <= 0) continue;
      age[i] += dt;
      if (age[i] >= life[i]) {
        life[i] = 0;
        look[i * 4 + 1] = 0;
        continue;
      }
      const p = i * 3;
      velocity[p] *= drag;
      velocity[p + 2] *= drag;
      velocity[p + 1] = velocity[p + 1] * drag + config.rise * dt;
      position[p] += velocity[p] * dt;
      position[p + 1] += velocity[p + 1] * dt;
      position[p + 2] += velocity[p + 2] * dt;
      const t = age[i] / life[i];
      const swell = 1 + (config.grow - 1) * (1 - (1 - t) * (1 - t)); // spreads fast, then slows
      const radius = radius0[i] * swell;
      const ground = heightAt(position[p], position[p + 2]);
      const floor = ground + radius * config.floor;
      if (position[p + 1] < floor) { position[p + 1] = floor; if (velocity[p + 1] < 0) velocity[p + 1] = 0; }
      const rise = Math.min(1, t / config.fadeIn);
      const fade = (1 - t) ** 1.4;
      const k = i * 4;
      place[k] = position[p];
      place[k + 1] = position[p + 1];
      place[k + 2] = position[p + 2];
      place[k + 3] = ground;
      look[k] = radius;
      look[k + 1] = alpha0[i] * rise * fade;
      look[k + 2] = seed[i];
      look[k + 3] = turn[i] + spin[i] * age[i];
      live += 1;
      top = i;
    }
    highest = top;
    return top + 1;
  }

  return { emit, update, get live() { return live; }, capacity };
}

const VERTEX = /* glsl */`
  attribute vec4 aPlace; // x, y, z: where; w: the height of the ground under it
  attribute vec4 aLook; // x: radius, y: alpha, z: seed, w: turn
  uniform vec2 uNear;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  varying vec3 vWorld;
  varying float vAbove; // how far this corner of the quad is above the ground, in radii
  void main() {
    float c = cos(aLook.w);
    float s = sin(aLook.w);
    vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aLook.x;
    // the camera's right and up in the world: the quad always faces the eye
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 corner = aPlace.xyz + right * q.x + up * q.y;
    vec4 mv = viewMatrix * vec4(corner, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;
    vAlpha = aLook.y * smoothstep(uNear.x, uNear.y, max(-mv.z, 0.0));
    vSeed = aLook.z;
    vWorld = aPlace.xyz;
    vAbove = (corner.y - aPlace.w) / max(aLook.x, 0.01);
  }
`;

const FRAGMENT = /* glsl */`
  uniform vec3 uSun;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  varying vec3 vWorld;
  varying float vAbove;

  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float r = length(vUv);
    float shape = smoothstep(1.0, 0.05, r);
    // a ragged, billowing edge: a puff is a lump of dust and not a clean disc
    float n = 0.6 * valueNoise(vUv * 2.2 + vSeed * 37.0) + 0.4 * valueNoise(vUv * 5.0 + vSeed * 11.0);
    // fade out toward the ground, so where the quad meets the dune there is no hard cut
    float lift = smoothstep(0.0, 0.6, vAbove);
    float a = pow(shape, 1.25) * mix(0.45, 1.0, n) * vAlpha * lift;
    if (a < 0.004) discard;

    float day = smoothstep(-0.07, 0.16, uSun.y);
    vec3 ray = normalize(vWorld - cameraPosition);
    float backlit = pow(max(dot(ray, uSun), 0.0), 4.0);
    vec3 sand = mix(vec3(0.90, 0.72, 0.50), vec3(0.97, 0.86, 0.68), 0.5 + 0.5 * n); // paler than the ground, so it shows against it
    vec3 ambient = mix(vec3(0.006, 0.009, 0.015), vec3(0.28, 0.34, 0.42), day);
    vec3 sun = vec3(1.23, 1.09, 0.86) * (0.55 + 0.9 * backlit) * day;
    gl_FragColor = vec4(sand * (ambient + sun) * 1.05, min(1.0, a));
    #include <tonemapping_fragment>
    gl_FragColor.rgb += sand * vec3(0.0060, 0.0090, 0.0165) * (1.0 - day);
    #include <colorspace_fragment>
  }
`;

// `sun`: the shared uSun uniform (a { value: Vector3 } of the direction to the sun, as the sand material's), `heightAt(x, z)`: the ground.
export function createSandPuffs({ scene = null, sun, heightAt = () => 0, capacity = PUFFS.capacity } = {}) {
  if (!sun) throw new Error('Sand puffs need the sun uniform.');
  const sim = createPuffSim({ capacity, heightAt });
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const place = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const look = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  place.setUsage(THREE.DynamicDrawUsage);
  look.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPlace', place);
  geometry.setAttribute('aLook', look);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { uSun: sun, uNear: { value: new THREE.Vector2(...PUFFS.nearFade) } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Sand puffs';
  mesh.frustumCulled = false; // positions are set in the vertex shader
  mesh.renderOrder = 6;
  mesh.visible = false;
  scene?.add(mesh);

  const ground = (x, z) => heightAt(x, z);

  // The ready-made puffs. Heights are read from the ground here, so callers pass only the spot on the sand.
  const fx = {
    mesh,
    sim,
    emit: sim.emit,
    // a ring of dust thrown out along the ground from a point where something heavy landed, and a plume straight up
    impact(x, z, { size = 1, strength = 1 } = {}) {
      const y = ground(x, z);
      sim.emit(x, y + 0.1 * size, z, Math.round(14 * strength), { radius: 0.3 * size, outward: 6 * size, up: 1.4, jitter: 0.9, size: [0.6 * size, 1.0 * size], life: [1.2, 2.1], alpha: 0.8 });
      sim.emit(x, y + 0.2 * size, z, Math.round(6 * strength), { radius: 0.25 * size, outward: 0.9, up: 3 * size, jitter: 0.6, size: [0.5 * size, 0.85 * size], life: [1.1, 1.8], alpha: 0.65 });
    },
    // sand kicked up behind something that rushes forward: (dx, dz) is the way it is going
    kick(x, z, dx, dz, { size = 1, count = 7 } = {}) {
      const y = ground(x, z);
      sim.emit(x, y + 0.1, z, count, { radius: 0.9 * size, outward: 0.8, push: [-dx, -dz, 5 * size], up: 1.0, jitter: 0.8, size: [0.5 * size, 0.85 * size], life: [1.0, 1.7], alpha: 0.6 });
    },
    // a big slow cloud rolling out of the sand round something heavy that has just dropped
    collapse(x, z, { size = 1 } = {}) {
      const y = ground(x, z);
      sim.emit(x, y + 0.15, z, 16, { radius: 2 * size, outward: 3.2 * size, up: 1.1, jitter: 0.7, size: [0.9 * size, 1.5 * size], life: [2.0, 3.4], alpha: 0.62 });
    },
    // a colossal foot coming down: a wide ring of heavy dust pushed out along the ground and a slow plume. `size` is roughly the radius of the foot in metres
    // (the stinger's presets are for a creature a few metres long; this one is eight metres across), so the puffs are big, last for seconds and billow up slowly.
    stomp(x, z, { size = 8, strength = 1 } = {}) {
      const y = ground(x, z);
      sim.emit(x, y + 0.2 * size, z, Math.round(14 * strength) + 4, { radius: 0.8 * size, outward: 1.9 * size, up: 0.3 * size, jitter: 0.35 * size, size: [0.45 * size, 0.75 * size], life: [2.6, 4.4], alpha: 0.5 });
      sim.emit(x, y + 0.3 * size, z, Math.round(5 * strength), { radius: 0.5 * size, outward: 0.2 * size, up: 0.55 * size, jitter: 0.25 * size, size: [0.5 * size, 0.85 * size], life: [3.2, 5.2], alpha: 0.4 });
    },
    // a few grains shaken loose and drifting off a point
    trickle(x, z, { size = 1, count = 2, radius = 1.2 } = {}) {
      const y = ground(x, z);
      sim.emit(x, y + 0.1, z, count, { radius: radius * size, outward: 0.6, up: 0.6, jitter: 0.5, size: [0.4 * size, 0.7 * size], life: [1.3, 2.4], alpha: 0.4 });
    },
    update(dt) {
      if (!(dt > 0)) return;
      const draw = sim.update(dt, place.array, look.array);
      geometry.instanceCount = draw;
      mesh.visible = draw > 0;
      if (draw > 0) { place.needsUpdate = true; look.needsUpdate = true; }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
  return fx;
}
