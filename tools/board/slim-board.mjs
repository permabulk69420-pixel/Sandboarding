// Makes the game version of the Sirocco board (public/models/board) from the untouched master in art/board.
// From tools/board: python3 resize-textures.py ../../art/board/Sirocco_Dune156.glb, then
// npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/functions@4.1.1 @gltf-transform/extensions@4.1.1 meshoptimizer@0.22.0
// node slim-board.mjs ../../art/board/Sirocco_Dune156.glb ../../public/models/board/sirocco_dune156.glb 0.0005
// Game version of the Sirocco board: simplified within a tight error, stitches untouched, big textures halved each way.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';

const [src, out, err = '0.0005'] = process.argv.slice(2);
await MeshoptSimplifier.ready;

// Smooth normals from the simplified shape: each vertex averages the faces that use it. Hard edges stay hard because the export already
// split those vertices (different normals), and weld keeps them apart.
function recomputeNormals(prim) {
  const pos = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray(), nrm = prim.getAttribute('NORMAL');
  const out = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { out[v] += nx; out[v + 1] += ny; out[v + 2] += nz; }
  }
  const old = nrm.getArray();
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v], out[v + 1], out[v + 2]);
    if (l > 1e-12) { out[v] /= l; out[v + 1] /= l; out[v + 2] /= l; } else { out[v] = old[v]; out[v + 1] = old[v + 1]; out[v + 2] = old[v + 2]; }
  }
  nrm.setArray(out);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const count = () => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).reduce((n, p) => n + p.getIndices().getCount() / 3, 0);
console.log('before', count());
await doc.transform(weld());
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial()?.getName() || '';
    const before = prim.getIndices().getCount() / 3;
    if (/stitch/i.test(mat)) { console.log('  keep', mesh.getName().slice(0, 14), mat, before); continue; }
    // The deck's laminate shells are left exactly as modelled. They are layered a millimetre or so apart (top sheet over sidewall over core),
    // and simplifying each one on its own moved them through each other: patches of one showed through another, flickering as you moved.
    // The whole deck is 172k triangles, which the headset handles fine. Only the bindings are simplified.
    if (mesh.getName().startsWith('Deck')) { console.log('  keep', mesh.getName().slice(0, 14), mat, before); continue; }
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error: Number(err), lockBorder: true });
    console.log('  ', mesh.getName().slice(0, 14), mat.padEnd(38), before, '->', prim.getIndices().getCount() / 3);
  }
}
// Swap in the resized textures prepared alongside.
for (const tex of doc.getRoot().listTextures()) {
  const name = tex.getName() || tex.getURI();
  const file = { Deck_2Kx8K: 'deck_1k4k.jpg', Base_2Kx8K: 'base_1k4k.png' }[tex.getName()];
  if (file) { tex.setImage(new Uint8Array(fs.readFileSync(file))).setMimeType(file.endsWith('jpg') ? 'image/jpeg' : 'image/png').setName(tex.getName().replace('2Kx8K', '1Kx4K')); }
}
await doc.transform(dedup(), prune());
console.log('after', count());
await io.write(out, doc);
