import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// A quick look at a lodge model in VR (?lodge): the cabin sits on the summit pad just above the start, its deck facing down the run, and
// you start inside it. Walls aren't solid yet; the floor and deck are walkable. Placement uses the model's own markers (SPAWN etc.).

export async function placeLodge({ scene, course, url }) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const markers = {};
  model.traverse(o => {
    if (o.name.startsWith('COL_')) o.visible = false;
    else if (!o.isMesh && o !== model) markers[o.name] = o;
  });
  // Where it goes: on the run's centre line 12 m below the top, facing downhill (the model's front faces -z).
  const p = course.pointAt(course.pad?.s ?? 12);
  const yaw = p.yaw;
  const box = new THREE.Box3().setFromObject(model); // model space (nothing moved yet)
  // Sit the floor just above the highest sand under the footprint, so the sand never pokes through it.
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const toWorld = (lx, lz) => ({ x: p.x + lx * cos + lz * sin, z: p.z - lx * sin + lz * cos });
  let top = -Infinity;
  for (let lx = box.min.x; lx <= box.max.x; lx += 1) for (let lz = box.min.z; lz <= box.max.z; lz += 1) {
    const w = toWorld(lx, lz); top = Math.max(top, course.heightAt(w.x, w.z));
  }
  const floorY = course.pad ? course.pad.height + 0.02 : top + 0.03; // on the course's level pad, if it has one
  model.position.set(p.x, floorY, p.z);
  model.rotation.y = yaw;
  scene.add(model);
  model.updateMatrixWorld(true);

  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert(), v = new THREE.Vector3();
  const spawnMarker = markers.SPAWN, spawnPos = new THREE.Vector3(), spawnQ = new THREE.Quaternion();
  if (spawnMarker) { spawnMarker.getWorldPosition(spawnPos); spawnMarker.getWorldQuaternion(spawnQ); } else spawnPos.set(p.x, floorY, p.z);
  const spawnYaw = new THREE.Euler().setFromQuaternion(spawnQ, 'YXZ').y;
  return {
    model, markers,
    spawn: { x: spawnPos.x, z: spawnPos.z, yaw: spawnYaw },
    // The floor height under (x, z) if that's on the cabin's floor or deck, else null.
    floorAt(x, z) {
      v.set(x, floorY, z).applyMatrix4(inv);
      return v.x > box.min.x && v.x < box.max.x && v.z > box.min.z && v.z < box.max.z ? floorY : null;
    },
  };
}
