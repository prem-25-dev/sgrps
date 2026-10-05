import * as THREE from 'three';
import { createSurface } from './TextureFactory';

/**
 * The pool of light a lamp throws on the ground beneath it.
 *
 * The world is full of things named for lighting that emit none: the tunnel's
 * service lamps, the train's headlights, `PROP_StreetLight`, `PROP_TrackLamp`.
 * Emissive materials glow, they do not illuminate, so every one of them was a
 * fitting hanging in the dark.
 *
 * The obvious fix -- a light per lamp -- is the one thing that cannot be done
 * here. Lamps are streamed decor: they come and go constantly, and three.js
 * recompiles every shader in the scene when the light count changes, so a
 * travelling light would hitch continuously. The scene keeps a fixed set of
 * lights and lamps cast an additive puddle instead. It costs one transparent
 * quad, reads correctly from the gameplay camera, and never touches the light
 * count.
 */

let material: THREE.MeshBasicMaterial | null = null;
let falloff: THREE.Texture | null | undefined;

/**
 * A round white-to-black gradient, so a pool has no visible edge. Built
 * through `createSurface`, which returns null under the headless harness where
 * there is no canvas -- lamps then simply have no pool, rather than throwing
 * on `document` in a test run.
 */
function radialFalloff(): THREE.Texture | null {
  if (falloff === undefined) {
    const size = 64;
    const surface = createSurface(size);
    if (!surface) {
      falloff = null;
    } else {
      const c = surface.ctx;
      const grad = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.45, '#8a8a8a');
      grad.addColorStop(1, '#000000');
      c.fillStyle = grad;
      c.fillRect(0, 0, size, size);
      falloff = new THREE.CanvasTexture(surface.canvas as HTMLCanvasElement);
      falloff.colorSpace = THREE.SRGBColorSpace;
      falloff.needsUpdate = true;
    }
  }
  return falloff;
}

/** One shared material, so every pool in the world batches together. */
export function lightPoolMaterial(): THREE.MeshBasicMaterial {
  if (!material) {
    const map = radialFalloff();
    material = new THREE.MeshBasicMaterial({
      color: 0xffc27a,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    // Assigned rather than passed: three.js warns when a material parameter is
    // present with an undefined value, and the headless harness has no canvas.
    if (map) material.map = map;
  }
  return material;
}

/**
 * A horizontal pool of the given size, centred on the origin and lying just
 * above the ground so it does not z-fight with whatever it falls on.
 */
export function lightPool(width: number, depth: number, y = 0.06): THREE.Mesh {
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), lightPoolMaterial());
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = y;
  pool.name = 'FX_LightPool';
  // Nothing casts or receives shadow from a puddle of light.
  pool.castShadow = false;
  pool.receiveShadow = false;
  return pool;
}
