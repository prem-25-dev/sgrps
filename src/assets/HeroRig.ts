import * as THREE from 'three';

/**
 * Humanoid rig definition and the automatic skinning solver.
 *
 * The rest pose is a relaxed stand (arms hanging, legs straight), which is the
 * most forgiving pose to weight from and the closest to a run cycle's mid
 * point. Every bone below maps onto a real anatomical joint so animation data
 * authored for any humanoid retargets cleanly.
 */

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Rest position in character space, metres, for a 1.78 m reference height. */
  rest: [number, number, number];
  /** Bone this one points at when computing skinning distance. */
  tip?: string;
  /** Multiplier on this bone's pull during auto-skinning. */
  influence?: number;
}

/**
 * Where the arm and leg chains hang, out from the centre line.
 *
 * Shared with `HeroFactory`, which sweeps the limb meshes and the clothing
 * over them at the same offsets. They were separate literals in both files:
 * move the mesh outboard for a better silhouette and the bones stay put, so
 * the skinning segments no longer run down the middle of the limb they drive
 * and the arm deforms around a line beside it.
 */
export const ARM_X = 0.193;
export const LEG_X = 0.106;

export const BONES: BoneDef[] = [
  { name: 'root', parent: null, rest: [0, 0, 0], influence: 0 },
  { name: 'hips', parent: 'root', rest: [0, 0.94, 0], tip: 'spine' },
  { name: 'spine', parent: 'hips', rest: [0, 1.06, 0], tip: 'chest' },
  { name: 'chest', parent: 'spine', rest: [0, 1.24, 0], tip: 'neck' },
  { name: 'neck', parent: 'chest', rest: [0, 1.5, 0], tip: 'head' },
  { name: 'head', parent: 'neck', rest: [0, 1.575, 0], tip: 'headTip' },
  { name: 'headTip', parent: 'head', rest: [0, 1.79, 0], influence: 0 },

  { name: 'shoulder_L', parent: 'chest', rest: [0.045, 1.46, 0], tip: 'upperArm_L' },
  { name: 'upperArm_L', parent: 'shoulder_L', rest: [ARM_X, 1.44, 0], tip: 'forearm_L' },
  { name: 'forearm_L', parent: 'upperArm_L', rest: [ARM_X, 1.165, 0], tip: 'hand_L' },
  { name: 'hand_L', parent: 'forearm_L', rest: [ARM_X, 0.92, 0], tip: 'fingers_L' },
  { name: 'fingers_L', parent: 'hand_L', rest: [ARM_X, 0.845, 0] },

  { name: 'shoulder_R', parent: 'chest', rest: [-0.045, 1.46, 0], tip: 'upperArm_R' },
  { name: 'upperArm_R', parent: 'shoulder_R', rest: [-ARM_X, 1.44, 0], tip: 'forearm_R' },
  { name: 'forearm_R', parent: 'upperArm_R', rest: [-ARM_X, 1.165, 0], tip: 'hand_R' },
  { name: 'hand_R', parent: 'forearm_R', rest: [-ARM_X, 0.92, 0], tip: 'fingers_R' },
  { name: 'fingers_R', parent: 'hand_R', rest: [-ARM_X, 0.845, 0] },

  { name: 'thigh_L', parent: 'hips', rest: [LEG_X, 0.92, 0], tip: 'calf_L' },
  { name: 'calf_L', parent: 'thigh_L', rest: [LEG_X, 0.505, 0], tip: 'foot_L' },
  { name: 'foot_L', parent: 'calf_L', rest: [LEG_X, 0.085, 0], tip: 'toe_L' },
  { name: 'toe_L', parent: 'foot_L', rest: [LEG_X, 0.03, -0.15] },

  { name: 'thigh_R', parent: 'hips', rest: [-LEG_X, 0.92, 0], tip: 'calf_R' },
  { name: 'calf_R', parent: 'thigh_R', rest: [-LEG_X, 0.505, 0], tip: 'foot_R' },
  { name: 'foot_R', parent: 'calf_R', rest: [-LEG_X, 0.085, 0], tip: 'toe_R' },
  { name: 'toe_R', parent: 'foot_R', rest: [-LEG_X, 0.03, -0.15] },
];

export const REFERENCE_HEIGHT = 1.78;

export interface Rig {
  skeleton: THREE.Skeleton;
  bones: THREE.Bone[];
  byName: Map<string, THREE.Bone>;
  root: THREE.Bone;
  /** Rest-pose world positions, scaled to the identity height. */
  restWorld: Map<string, THREE.Vector3>;
  /** Skinning segments: [start, end] per bone index, in character space. */
  segments: Array<{ index: number; a: THREE.Vector3; b: THREE.Vector3; influence: number; side: number }>;
}

/** Builds the bone hierarchy scaled to a hero height. */
export function buildRig(height: number): Rig {
  const scale = height / REFERENCE_HEIGHT;
  const byName = new Map<string, THREE.Bone>();
  const restWorld = new Map<string, THREE.Vector3>();
  const bones: THREE.Bone[] = [];

  for (const def of BONES) {
    const bone = new THREE.Bone();
    bone.name = def.name;
    byName.set(def.name, bone);
    restWorld.set(def.name, new THREE.Vector3(def.rest[0], def.rest[1], def.rest[2]).multiplyScalar(scale));
    bones.push(bone);
  }

  for (const def of BONES) {
    const bone = byName.get(def.name)!;
    const world = restWorld.get(def.name)!;
    if (def.parent) {
      const parent = byName.get(def.parent)!;
      const parentWorld = restWorld.get(def.parent)!;
      bone.position.copy(world).sub(parentWorld);
      parent.add(bone);
    } else {
      bone.position.copy(world);
    }
  }

  const root = byName.get('root')!;
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  const segments: Rig['segments'] = [];
  BONES.forEach((def, index) => {
    const influence = def.influence ?? 1;
    if (influence <= 0) return;
    const a = restWorld.get(def.name)!.clone();
    const b = def.tip ? restWorld.get(def.tip)!.clone() : a.clone().add(new THREE.Vector3(0, -0.03 * scale, 0));
    const side = def.name.endsWith('_L') ? 1 : def.name.endsWith('_R') ? -1 : 0;
    segments.push({ index, a, b, influence, side });
  });

  return { skeleton, bones, byName, root, restWorld, segments };
}

const _ap = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _closest = new THREE.Vector3();

function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const lenSq = _ab.lengthSq();
  const t = lenSq > 1e-8 ? Math.min(1, Math.max(0, _ap.dot(_ab) / lenSq)) : 0;
  _closest.copy(a).addScaledVector(_ab, t);
  return p.distanceTo(_closest);
}

const MAX_INFLUENCES = 4;

/**
 * Automatic skin weighting by inverse distance to bone segments.
 *
 * Two corrections stop the classic failure cases: a side penalty prevents the
 * left thigh from grabbing right-leg vertices across the crotch, and a
 * relative cutoff keeps distant bones from smearing weight across a joint.
 */
export function skinGeometry(
  geo: THREE.BufferGeometry,
  rig: Rig,
  opts: { falloff?: number; sideStrictness?: number; only?: string[] } = {},
): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const count = pos.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const falloff = opts.falloff ?? 3.2;
  const sideStrictness = opts.sideStrictness ?? 3.0;
  const allowed = opts.only ? new Set(opts.only) : null;
  const segments = allowed
    ? rig.segments.filter((s) => allowed.has(BONES[s.index].name))
    : rig.segments;

  const p = new THREE.Vector3();
  const scored: Array<{ index: number; d: number }> = [];

  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(pos, i);
    scored.length = 0;
    for (const seg of segments) {
      let d = distanceToSegment(p, seg.a, seg.b) / seg.influence;
      // Vertices clearly on one side of the body should not be claimed by the
      // mirrored limb, which is what produces melted crotches and armpits.
      if (seg.side !== 0 && Math.sign(p.x) !== 0 && Math.sign(p.x) !== seg.side) {
        d *= sideStrictness;
      }
      scored.push({ index: seg.index, d });
    }
    scored.sort((a, b) => a.d - b.d);

    const nearest = Math.max(scored[0].d, 1e-4);
    let total = 0;
    const picked: Array<{ index: number; w: number }> = [];
    for (let k = 0; k < Math.min(MAX_INFLUENCES, scored.length); k++) {
      const entry = scored[k];
      if (entry.d > nearest * 2.6) break;
      const w = Math.pow(1 / (entry.d + 0.012), falloff);
      picked.push({ index: entry.index, w });
      total += w;
    }
    if (picked.length === 0) {
      picked.push({ index: scored[0].index, w: 1 });
      total = 1;
    }
    for (let k = 0; k < picked.length; k++) {
      skinIndex[i * 4 + k] = picked[k].index;
      skinWeight[i * 4 + k] = picked[k].w / total;
    }
  }

  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  return geo;
}
