import * as THREE from 'three';
import { POWERUP_BY_ID } from '../../data/powerups';
import { roundedBox } from '../assets/GeometryUtil';
import { material } from '../assets/MaterialLibrary';

/**
 * PWR_* pickup models. Each has a distinct silhouette so it is identifiable
 * at speed from the chase camera, and a shared orbiting halo that marks it as
 * a power-up rather than scenery.
 */
export function buildPowerUpMesh(id: string): THREE.Group {
  const def = POWERUP_BY_ID[id];
  if (!def) throw new Error(`Unknown power-up: ${id}`);
  const g = new THREE.Group();
  g.name = id;

  const core = new THREE.Group();
  core.name = 'core';
  g.add(core);

  switch (def.icon) {
    case 'magnet': {
      // Horseshoe magnet: an arc plus two poles.
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.11, 8, 16, Math.PI), material('MAT_Magnet'));
      arc.rotation.z = Math.PI;
      core.add(arc);
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 10), material('MAT_StainlessSteel'));
        pole.position.set(side * 0.32, 0.13, 0);
        core.add(pole);
      }
      break;
    }
    case 'shield': {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.42);
      shape.quadraticCurveTo(0.36, 0.3, 0.34, -0.06);
      shape.quadraticCurveTo(0.3, -0.36, 0, -0.46);
      shape.quadraticCurveTo(-0.3, -0.36, -0.34, -0.06);
      shape.quadraticCurveTo(-0.36, 0.3, 0, 0.42);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
      geo.center();
      const body = new THREE.Mesh(geo, material('MAT_StainlessSteel'));
      core.add(body);
      const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12), material('MAT_NeonCyan'));
      emblem.position.z = 0.09;
      core.add(emblem);
      break;
    }
    case 'multiplier': {
      const bar = roundedBox(0.5, 0.13, 0.13, 0.05, 2);
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const cross = new THREE.Mesh(bar, material('MAT_CoinCore'));
        cross.rotation.z = rot;
        core.add(cross);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.045, 6, 18), material('MAT_NeonAmber'));
      core.add(ring);
      break;
    }
    case 'boost': {
      // Chevron stack pointing down the track.
      for (let i = 0; i < 3; i++) {
        const chevron = new THREE.Mesh(roundedBox(0.44, 0.1, 0.1, 0.04, 2), material('MAT_Boost'));
        chevron.position.set(0, 0.2 - i * 0.2, 0);
        chevron.rotation.z = 0.5;
        core.add(chevron);
        const mirror = chevron.clone();
        mirror.rotation.z = -0.5;
        mirror.position.x = 0.32;
        core.add(mirror);
      }
      core.position.x = -0.16;
      break;
    }
    case 'coin': {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.09, 18), material('MAT_CoinGold'));
      disc.rotation.x = Math.PI / 2;
      core.add(disc);
      const x2 = new THREE.Mesh(roundedBox(0.36, 0.09, 0.09, 0.03, 2), material('MAT_CoinCore'));
      x2.position.z = 0.06;
      core.add(x2);
      break;
    }
  }

  // Shared halo: a slowly counter-rotating ring plus a soft shell.
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.02, 6, 24), material('MAT_Shield'));
  halo.name = 'halo';
  halo.rotation.x = Math.PI / 2;
  g.add(halo);

  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), material('MAT_Shield'));
  shell.name = 'shell';
  const shellMat = shell.material as THREE.MeshStandardMaterial;
  shellMat.opacity = 0.12;
  g.add(shell);

  const tint = new THREE.Color(def.color);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.name === 'halo') {
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.emissive = tint;
      mat.color = tint;
      mesh.material = mat;
    }
  });

  return g;
}

/** Per-frame idle motion shared by every pickup. */
export function animatePowerUp(group: THREE.Group, time: number): void {
  const core = group.getObjectByName('core');
  const halo = group.getObjectByName('halo');
  if (core) {
    core.rotation.y = time * 1.6;
    core.position.y = Math.sin(time * 2.4) * 0.09;
  }
  if (halo) {
    halo.rotation.z = -time * 1.1;
    halo.rotation.x = Math.PI / 2 + Math.sin(time * 0.8) * 0.28;
  }
}

/** Shield bubble that wraps the player while the shield is active. */
export function buildShieldBubble(): THREE.Mesh {
  const mat = material('MAT_Shield').clone();
  mat.opacity = 0.22;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), mat);
  mesh.name = 'VFX_ShieldBubble';
  mesh.visible = false;
  return mesh;
}
