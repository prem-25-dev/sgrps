import * as THREE from 'three';
import { Random } from '../core/Random';
import { place } from './GeometryUtil';
import { material } from './MaterialLibrary';

/**
 * VEG_* planting. Near the track these are real branching meshes; beyond the
 * mid distance the same silhouette is served as a crossed-plane impostor,
 * which is what keeps a densely planted zone affordable.
 */

export type VegetationId =
  | 'VEG_Tree' | 'VEG_Palm' | 'VEG_Shrub' | 'VEG_GrassPatch'
  | 'VEG_Planter' | 'VEG_Vine' | 'VEG_Hedge' | 'VEG_Sapling';

export const VEGETATION_IDS: VegetationId[] = [
  'VEG_Tree', 'VEG_Palm', 'VEG_Shrub', 'VEG_GrassPatch',
  'VEG_Planter', 'VEG_Vine', 'VEG_Hedge', 'VEG_Sapling',
];

/** Recursive branch builder: trunk, limbs, and canopy clusters. */
function branch(
  group: THREE.Group,
  from: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  radius: number,
  depth: number,
  rng: Random,
): void {
  const to = from.clone().addScaledVector(dir, length);
  const geo = new THREE.CylinderGeometry(radius * 0.65, radius, length, depth > 1 ? 7 : 5);
  const mesh = new THREE.Mesh(geo, material('MAT_Bark'));
  mesh.position.copy(from).addScaledVector(dir, length / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.castShadow = true;
  group.add(mesh);

  if (depth <= 0) {
    const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(length * 0.85, 1), material('MAT_Foliage'));
    canopy.position.copy(to);
    canopy.scale.set(rng.range(0.8, 1.3), rng.range(0.7, 1.0), rng.range(0.8, 1.3));
    canopy.castShadow = true;
    group.add(canopy);
    return;
  }

  const splits = depth > 1 ? 3 : 2;
  for (let i = 0; i < splits; i++) {
    const next = dir.clone();
    next.x += rng.range(-0.6, 0.6);
    next.z += rng.range(-0.6, 0.6);
    next.y += rng.range(-0.12, 0.22);
    next.normalize();
    branch(group, to, next, length * rng.range(0.6, 0.78), radius * 0.62, depth - 1, rng);
  }
}

export function buildVegetation(id: VegetationId, seed = 1): THREE.Group {
  const rng = new Random(seed >>> 0 || 1);
  const g = new THREE.Group();
  g.name = id;

  switch (id) {
    case 'VEG_Tree':
      branch(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), rng.range(2.4, 3.4), 0.19, 2, rng);
      break;
    case 'VEG_Sapling':
      branch(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), rng.range(1.1, 1.6), 0.07, 1, rng);
      break;
    case 'VEG_Palm': {
      const height = rng.range(5, 7.5);
      const segments = 8;
      for (let i = 0; i < segments; i++) {
        const t = i / segments;
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.13 - t * 0.05, 0.16 - t * 0.05, height / segments, 7),
          material('MAT_Bark'),
        );
        // Gentle S-curve up the trunk.
        seg.position.set(Math.sin(t * 2.2) * 0.32, height * (t + 0.5 / segments), 0);
        seg.rotation.z = -Math.cos(t * 2.2) * 0.12;
        g.add(seg);
      }
      const topX = Math.sin(2.2) * 0.32;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 2.6, 1, 3), material('MAT_Foliage'));
        // Droop the frond by bending its vertices.
        const pos = frond.geometry.getAttribute('position');
        for (let v = 0; v < pos.count; v++) {
          const y = pos.getY(v);
          pos.setZ(v, -Math.pow((y + 1.3) / 2.6, 2) * 1.1);
        }
        pos.needsUpdate = true;
        frond.geometry.computeVertexNormals();
        frond.position.set(topX + Math.cos(a) * 0.5, height, Math.sin(a) * 0.5);
        frond.rotation.set(-0.6, a, 0);
        g.add(frond);
      }
      break;
    }
    case 'VEG_Shrub': {
      for (let i = 0; i < 5; i++) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.35, 0.6), 1), material('MAT_Foliage'));
        blob.position.set(rng.range(-0.4, 0.4), rng.range(0.3, 0.7), rng.range(-0.4, 0.4));
        g.add(blob);
      }
      break;
    }
    case 'VEG_Hedge': {
      const body = new THREE.Mesh(place(new THREE.BoxGeometry(4, 1.1, 0.8), [0, 0.55, 0]), material('MAT_Foliage'));
      g.add(body);
      for (let i = 0; i < 8; i++) {
        const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), material('MAT_Foliage'));
        tuft.position.set(-1.8 + i * 0.5, 1.05 + rng.range(-0.1, 0.12), rng.range(-0.2, 0.2));
        g.add(tuft);
      }
      break;
    }
    case 'VEG_GrassPatch': {
      const blade = new THREE.PlaneGeometry(0.1, 0.42);
      const blades = new THREE.InstancedMesh(blade, material('MAT_Grass'), 60);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      for (let i = 0; i < 60; i++) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * Math.PI);
        s.set(1, rng.range(0.7, 1.5), 1);
        m.compose(new THREE.Vector3(rng.range(-1.2, 1.2), 0.21 * s.y, rng.range(-1.2, 1.2)), q, s);
        blades.setMatrixAt(i, m);
      }
      blades.instanceMatrix.needsUpdate = true;
      g.add(blades);
      break;
    }
    case 'VEG_Planter': {
      const box = new THREE.Mesh(place(new THREE.BoxGeometry(1.8, 0.6, 0.8), [0, 0.3, 0]), material('MAT_Concrete'));
      g.add(box);
      const soil = new THREE.Mesh(place(new THREE.BoxGeometry(1.6, 0.08, 0.62), [0, 0.6, 0]), material('MAT_Dirt'));
      g.add(soil);
      for (let i = 0; i < 3; i++) {
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.28, 0.42), 1), material('MAT_Foliage'));
        bush.position.set(-0.55 + i * 0.55, 0.82, 0);
        g.add(bush);
      }
      break;
    }
    case 'VEG_Vine': {
      for (let i = 0; i < 12; i++) {
        const strand = new THREE.Mesh(new THREE.PlaneGeometry(0.3, rng.range(0.8, 2.4)), material('MAT_Foliage'));
        strand.position.set(rng.range(-1.4, 1.4), rng.range(1.4, 2.6), 0);
        strand.rotation.z = rng.range(-0.16, 0.16);
        g.add(strand);
      }
      break;
    }
  }

  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = id === 'VEG_Tree' || id === 'VEG_Palm';
      mesh.receiveShadow = true;
    }
  });
  return g;
}

/** Crossed-plane impostor for distant planting. */
export function buildVegetationImpostor(id: VegetationId): THREE.Group {
  const g = new THREE.Group();
  g.name = `${id}_LOD2`;
  const height = id === 'VEG_Palm' ? 7 : id === 'VEG_Tree' ? 4.5 : 1.2;
  const width = id === 'VEG_Palm' ? 3.4 : id === 'VEG_Tree' ? 3.2 : 1.6;
  for (let i = 0; i < 2; i++) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material('MAT_Foliage'));
    plane.position.y = height / 2;
    plane.rotation.y = (i * Math.PI) / 2;
    g.add(plane);
  }
  return g;
}
