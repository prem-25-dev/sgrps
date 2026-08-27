import * as THREE from 'three';
import { createHero } from '../src/assets/HeroFactory';
import { DEFAULT_IDENTITY } from '../src/assets/HeroIdentity';
import { countTriangles } from '../src/assets/GeometryUtil';

const hero = createHero(DEFAULT_IDENTITY);
hero.object.updateMatrixWorld(true);

console.log('LOD triangle budgets:');
for (let lod = 0; lod < 3; lod++) {
  const g = hero.lods[lod];
  const head = g.userData.headGroup as THREE.Group | undefined;
  console.log(`  LOD${lod}: ${countTriangles(g) + (head ? countTriangles(head) : 0)} tris`);
}

console.log('\nLOD0 parts (bounds in metres, y = height above ground):');
const box = new THREE.Box3();
hero.lods[0].children.forEach((child) => {
  const mesh = child as THREE.Mesh;
  if (!mesh.isMesh) return;
  box.setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute);
  const tri = countTriangles(mesh);
  console.log(
    `  ${mesh.name.padEnd(28)} tris ${String(tri).padStart(5)}  ` +
    `x [${box.min.x.toFixed(3)}, ${box.max.x.toFixed(3)}]  ` +
    `y [${box.min.y.toFixed(3)}, ${box.max.y.toFixed(3)}]  ` +
    `z [${box.min.z.toFixed(3)}, ${box.max.z.toFixed(3)}]`,
  );
});

const head = hero.lods[0].userData.headGroup as THREE.Group;
console.log(`\nhead group children: ${head.children.length}, world y ${head.getWorldPosition(new THREE.Vector3()).y.toFixed(3)}`);

let bad = 0, checked = 0;
hero.lods[0].traverse((o) => {
  const m = o as THREE.SkinnedMesh;
  if (!m.isSkinnedMesh) return;
  const w = m.geometry.getAttribute('skinWeight');
  for (let i = 0; i < w.count; i++) {
    const sum = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
    checked++;
    if (Math.abs(sum - 1) > 1e-3) bad++;
  }
});
console.log(`skin weights: ${checked} vertices, ${bad} not normalised`);
