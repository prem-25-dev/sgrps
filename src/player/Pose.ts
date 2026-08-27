import * as THREE from 'three';
import { BONES } from '../assets/HeroRig';

/**
 * A pose is a flat quaternion buffer, one entry per rig bone, plus a root
 * translation. Flat buffers keep blending allocation free at 60 Hz.
 */

export const BONE_INDEX: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  BONES.forEach((b, i) => (map[b.name] = i));
  return map;
})();

export const BONE_COUNT = BONES.length;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class Pose {
  readonly q = new Float32Array(BONE_COUNT * 4);
  /** Offset applied to the hips bone, in metres. */
  readonly offset = new THREE.Vector3();

  constructor() {
    this.identity();
  }

  identity(): this {
    for (let i = 0; i < BONE_COUNT; i++) {
      this.q[i * 4] = 0;
      this.q[i * 4 + 1] = 0;
      this.q[i * 4 + 2] = 0;
      this.q[i * 4 + 3] = 1;
    }
    this.offset.set(0, 0, 0);
    return this;
  }

  /** Sets a bone's local rotation from XYZ Euler angles in radians. */
  set(bone: string, x: number, y = 0, z = 0): this {
    const i = BONE_INDEX[bone];
    if (i === undefined) return this;
    _q.setFromEuler(_e.set(x, y, z, 'XYZ'));
    this.q[i * 4] = _q.x;
    this.q[i * 4 + 1] = _q.y;
    this.q[i * 4 + 2] = _q.z;
    this.q[i * 4 + 3] = _q.w;
    return this;
  }

  /** Multiplies an extra rotation onto a bone, for additive layers. */
  add(bone: string, x: number, y = 0, z = 0, weight = 1): this {
    const i = BONE_INDEX[bone];
    if (i === undefined || weight === 0) return this;
    _q.setFromEuler(_e.set(x * weight, y * weight, z * weight, 'XYZ'));
    const bx = this.q[i * 4];
    const by = this.q[i * 4 + 1];
    const bz = this.q[i * 4 + 2];
    const bw = this.q[i * 4 + 3];
    // base * extra
    this.q[i * 4] = bw * _q.x + bx * _q.w + by * _q.z - bz * _q.y;
    this.q[i * 4 + 1] = bw * _q.y - bx * _q.z + by * _q.w + bz * _q.x;
    this.q[i * 4 + 2] = bw * _q.z + bx * _q.y - by * _q.x + bz * _q.w;
    this.q[i * 4 + 3] = bw * _q.w - bx * _q.x - by * _q.y - bz * _q.z;
    return this;
  }

  /** Mirrors a left-side value onto both sides in one call. */
  setPair(bone: string, x: number, y = 0, z = 0, mirrorYZ = true): this {
    this.set(`${bone}_L`, x, y, z);
    this.set(`${bone}_R`, x, mirrorYZ ? -y : y, mirrorYZ ? -z : z);
    return this;
  }

  copy(other: Pose): this {
    this.q.set(other.q);
    this.offset.copy(other.offset);
    return this;
  }

  /** Normalised lerp from a to b. Shortest path per bone. */
  static blend(a: Pose, b: Pose, t: number, out: Pose): Pose {
    if (t <= 0) return out.copy(a);
    if (t >= 1) return out.copy(b);
    for (let i = 0; i < BONE_COUNT; i++) {
      const o = i * 4;
      let bx = b.q[o];
      let by = b.q[o + 1];
      let bz = b.q[o + 2];
      let bw = b.q[o + 3];
      const ax = a.q[o];
      const ay = a.q[o + 1];
      const az = a.q[o + 2];
      const aw = a.q[o + 3];
      if (ax * bx + ay * by + az * bz + aw * bw < 0) {
        bx = -bx; by = -by; bz = -bz; bw = -bw;
      }
      let x = ax + (bx - ax) * t;
      let y = ay + (by - ay) * t;
      let z = az + (bz - az) * t;
      let w = aw + (bw - aw) * t;
      const len = Math.hypot(x, y, z, w) || 1;
      out.q[o] = x / len;
      out.q[o + 1] = y / len;
      out.q[o + 2] = z / len;
      out.q[o + 3] = w / len;
    }
    out.offset.lerpVectors(a.offset, b.offset, t);
    return out;
  }

  /** Writes this pose onto a live skeleton. */
  apply(bones: THREE.Bone[], restLocal: THREE.Vector3[]): void {
    for (let i = 0; i < bones.length && i < BONE_COUNT; i++) {
      const o = i * 4;
      bones[i].quaternion.set(this.q[o], this.q[o + 1], this.q[o + 2], this.q[o + 3]);
    }
    const hips = BONE_INDEX['hips'];
    if (hips !== undefined && bones[hips]) {
      bones[hips].position.copy(restLocal[hips]).add(this.offset);
    }
  }
}

/** Periodic raised-cosine bump, 1 at `centre`, 0 outside `width`. */
export function bump(p: number, centre: number, width: number): number {
  let d = p - centre;
  d -= Math.round(d); // wrap to [-0.5, 0.5]
  const k = Math.abs(d) / width;
  if (k >= 1) return 0;
  return 0.5 + 0.5 * Math.cos(k * Math.PI);
}

/** Smoothstep in 0..1. */
export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Ease-out cubic, used for snappy one-shot transitions. */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export const TAU = Math.PI * 2;
