import * as THREE from 'three';
import { mergeGeometries, place, Ring, ringXZ, sweep } from './GeometryUtil';
import { HeroIdentity } from './HeroIdentity';
import { buildRig, Rig, skinGeometry, REFERENCE_HEIGHT } from './HeroRig';
import { noiseTexture } from './TextureFactory';

/**
 * CHR_Hero: a modelled, rigged, skinned human.
 *
 * The body, clothing and shoes are skinned to the humanoid rig. Face detail
 * and hair are parented to the head bone, which keeps small features crisp
 * without paying for them in the skinning solve.
 */

export type HeroLod = 0 | 1 | 2;

interface Quality {
  torsoSegments: number;
  limbSegments: number;
  headSegments: number;
  fingers: boolean;
  faceDetail: 'full' | 'reduced' | 'minimal';
  hairStrands: number;
  /** >1 subdivides the authored sections for a smoother silhouette,
   *  <1 drops them for the cheaper LODs. */
  ringDensity: number;
}

const QUALITY: Record<HeroLod, Quality> = {
  0: { torsoSegments: 26, limbSegments: 18, headSegments: 34, fingers: true, faceDetail: 'full', hairStrands: 14, ringDensity: 3 },
  1: { torsoSegments: 18, limbSegments: 12, headSegments: 22, fingers: false, faceDetail: 'reduced', hairStrands: 8, ringDensity: 1.6 },
  2: { torsoSegments: 10, limbSegments: 8, headSegments: 14, fingers: false, faceDetail: 'minimal', hairStrands: 0, ringDensity: 0.7 },
};

/** Slightly boxy human cross-section: a superellipse rather than a circle. */
function bodyProfile(power: number) {
  return (a: number) => {
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    return Math.pow(Math.pow(c, power) + Math.pow(s, power), -1 / power);
  };
}

const TORSO_PROFILE = bodyProfile(2.12);
const LIMB_PROFILE = bodyProfile(2.15);

interface Section {
  y: number;
  rx: number;
  rz: number;
  z?: number;
}

/** Torso silhouette from hips to the base of the neck. */
function torsoSections(id: HeroIdentity): Section[] {
  const b = id.build;
  const shoulder = (id.shoulderRatio * REFERENCE_HEIGHT) / 2;
  const hip = (id.hipRatio * REFERENCE_HEIGHT) / 2;
  const g = 0.9 + b * 0.28; // girth scalar
  return [
    { y: 0.845, rx: hip * 0.9 * g, rz: 0.104 * g, z: 0.008 },
    { y: 0.905, rx: hip * g, rz: 0.112 * g, z: 0.012 },
    { y: 0.965, rx: hip * 0.95 * g, rz: 0.106 * g, z: 0.006 },
    { y: 1.03, rx: hip * 0.81 * g, rz: 0.094 * g, z: 0 },
    { y: 1.075, rx: hip * 0.79 * g, rz: 0.092 * g, z: -0.002 },
    { y: 1.14, rx: hip * 0.92 * g, rz: 0.104 * g, z: -0.006 },
    { y: 1.21, rx: shoulder * 0.79 * g, rz: 0.118 * g, z: -0.01 },
    { y: 1.28, rx: shoulder * 0.87 * g, rz: 0.12 * g, z: -0.011 },
    { y: 1.35, rx: shoulder * 0.93 * g, rz: 0.116 * g, z: -0.008 },
    { y: 1.42, rx: shoulder * 1.02 * g, rz: 0.107 * g, z: -0.004 },
    { y: 1.462, rx: shoulder * 0.94 * g, rz: 0.096 * g, z: 0 },
    { y: 1.492, rx: shoulder * 0.60 * g, rz: 0.083 * g, z: 0.002 },
    { y: 1.515, rx: 0.062, rz: 0.058, z: 0.004 },
  ];
}

function neckSections(): Section[] {
  return [
    { y: 1.478, rx: 0.072, rz: 0.068, z: 0.005 },
    { y: 1.51, rx: 0.056, rz: 0.054, z: 0.003 },
    { y: 1.548, rx: 0.05, rz: 0.049, z: 0.001 },
    { y: 1.588, rx: 0.049, rz: 0.049, z: 0 },
  ];
}

function armSections(id: HeroIdentity, side: number): Section[] {
  const g = 0.92 + id.build * 0.22;
  const x = 0.185 * side;
  return [
    // Domed top: the sweep closes over the shoulder and tucks under the
    // trapezius rather than ending in a flat disc.
    { y: 1.496, rx: 0.014 * g, rz: 0.014 * g, z: 0 },
    { y: 1.482, rx: 0.030 * g, rz: 0.030 * g, z: 0 },
    { y: 1.466, rx: 0.043 * g, rz: 0.043 * g, z: 0 },
    { y: 1.44, rx: 0.056 * g, rz: 0.056 * g, z: 0 },
    { y: 1.41, rx: 0.06 * g, rz: 0.06 * g, z: 0 },
    { y: 1.32, rx: 0.053 * g, rz: 0.053 * g, z: 0 },
    { y: 1.23, rx: 0.046 * g, rz: 0.047 * g, z: 0 },
    { y: 1.165, rx: 0.043 * g, rz: 0.044 * g, z: 0 },
    { y: 1.09, rx: 0.043 * g, rz: 0.044 * g, z: 0 },
    { y: 1.0, rx: 0.037 * g, rz: 0.038 * g, z: 0 },
    { y: 0.945, rx: 0.031 * g, rz: 0.033 * g, z: 0 },
    { y: 0.922, rx: 0.03 * g, rz: 0.032 * g, z: 0 },
  ].map((s) => ({ ...s, rx: s.rx, rz: s.rz, z: s.z, y: s.y, x } as Section & { x: number }));
}

function legSections(id: HeroIdentity): Section[] {
  const g = 0.94 + id.build * 0.2;
  return [
    { y: 0.955, rx: 0.09 * g, rz: 0.1 * g, z: 0.004 },
    { y: 0.88, rx: 0.085 * g, rz: 0.095 * g, z: 0.004 },
    { y: 0.77, rx: 0.077 * g, rz: 0.087 * g, z: 0.002 },
    { y: 0.65, rx: 0.068 * g, rz: 0.076 * g, z: 0 },
    { y: 0.555, rx: 0.06 * g, rz: 0.066 * g, z: 0 },
    { y: 0.505, rx: 0.057 * g, rz: 0.062 * g, z: 0.002 },
    { y: 0.45, rx: 0.061 * g, rz: 0.07 * g, z: 0.008 },
    { y: 0.37, rx: 0.058 * g, rz: 0.068 * g, z: 0.008 },
    { y: 0.27, rx: 0.046 * g, rz: 0.053 * g, z: 0.004 },
    { y: 0.17, rx: 0.036 * g, rz: 0.042 * g, z: 0 },
    { y: 0.11, rx: 0.034 * g, rz: 0.041 * g, z: -0.002 },
  ];
}

/** Catmull-Rom through the authored control sections. */
function sampleSections(sections: Section[], t: number): Section {
  const n = sections.length - 1;
  const f = Math.min(n - 1e-6, Math.max(0, t * n));
  const i = Math.floor(f);
  const u = f - i;
  const at = (k: number) => sections[Math.min(n, Math.max(0, k))];
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  const spline = (a: number, b: number, c: number, d: number) => {
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  };
  return {
    y: spline(p0.y, p1.y, p2.y, p3.y),
    rx: Math.max(1e-4, spline(p0.rx, p1.rx, p2.rx, p3.rx)),
    rz: Math.max(1e-4, spline(p0.rz, p1.rz, p2.rz, p3.rz)),
    z: spline(p0.z ?? 0, p1.z ?? 0, p2.z ?? 0, p3.z ?? 0),
  };
}

/**
 * Clothing must be built from the *same* resampled curve as the body beneath
 * it. Sampling the body with a spline and the trousers with straight lines
 * lets the spline's overshoot poke through the cloth, so both go through here.
 * `offset` may be a constant or a function of the normalised position.
 */
function sectionsToRings(
  sections: Section[],
  x: number,
  profile: (a: number) => number,
  scale: number,
  offset: number | ((t: number) => number) = 0,
  density = 1,
): Ring[] {
  const offsetAt = typeof offset === 'function' ? offset : () => offset;
  if (density < 1) {
    const step = Math.max(1, Math.round(1 / density));
    const picked = sections.filter((_, i) => i % step === 0 || i === sections.length - 1);
    return picked.map((s, i) => {
      const o = offsetAt(i / Math.max(1, picked.length - 1));
      return ringXZ(s.y * scale, (s.rx + o) * scale, (s.rz + o) * scale, x * scale, (s.z ?? 0) * scale, profile);
    });
  }
  const rows = Math.max(sections.length, Math.round((sections.length - 1) * density) + 1);
  const rings: Ring[] = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const s = sampleSections(sections, t);
    const o = offsetAt(t);
    rings.push(ringXZ(s.y * scale, (s.rx + o) * scale, (s.rz + o) * scale, x * scale, (s.z ?? 0) * scale, profile));
  }
  return rings;
}

/**
 * Clips an already-resampled ring set by height.
 *
 * Clothing has to be built from the identical spline as the body it covers.
 * Filtering the *control sections* first changes the curve (a Catmull-Rom
 * through nine points is not the same as through eleven), and the body then
 * bulges through the cloth. So we always resample the full section list and
 * clip the resulting rings instead.
 */
function clipRings(rings: Ring[], minY: number, maxY = Infinity): Ring[] {
  return rings.filter((r) => r.c.y >= minY - 1e-6 && r.c.y <= maxY + 1e-6);
}

/** Foot shape, swept along Z rather than Y. */
function footRings(side: number, scale: number, offset = 0, lift = 0, density = 1): Ring[] {
  const defs = [
    { z: 0.055, y: 0.055, rx: 0.03, ry: 0.05 },
    { z: 0.02, y: 0.05, rx: 0.037, ry: 0.052 },
    { z: -0.04, y: 0.045, rx: 0.042, ry: 0.046 },
    { z: -0.1, y: 0.038, rx: 0.042, ry: 0.038 },
    { z: -0.15, y: 0.03, rx: 0.038, ry: 0.03 },
    { z: -0.185, y: 0.024, rx: 0.028, ry: 0.022 },
  ];
  const sections: Section[] = defs.map((d) => ({ y: d.z, rx: d.rx, rz: d.ry, z: d.y }));
  const rows = density > 1 ? Math.round((defs.length - 1) * density) + 1 : defs.length;
  const rings: Ring[] = [];
  for (let i = 0; i < rows; i++) {
    const s = rows === defs.length ? sections[i] : sampleSections(sections, i / (rows - 1));
    rings.push({
      c: new THREE.Vector3(0.095 * side * scale, ((s.z ?? 0) + lift) * scale, s.y * scale),
      u: new THREE.Vector3((s.rx + offset) * scale, 0, 0),
      v: new THREE.Vector3(0, (s.rz + offset) * scale, 0),
      shape: LIMB_PROFILE,
    });
  }
  return rings;
}

/** Head silhouette as a displaced sphere: skull, brow, cheekbones, jaw, chin. */
function headSurface(id: HeroIdentity, theta: number, phi: number, scale: number, swell = 0): THREE.Vector3 {
  const f = id.face;
  const half = (f.length / 2) * scale;
  const rx = half * f.widthRatio;
  const rz = half * f.depthRatio;

  // phi: 0 at crown, PI at chin. theta: 0 faces forward (-Z).
  const sy = Math.cos(phi);
  const ring = Math.sin(phi);
  const front = Math.cos(theta); // 1 = face, -1 = back of head
  const sideAbs = Math.abs(Math.sin(theta));

  let x = ring * Math.sin(theta) * rx;
  let y = sy * half;
  let z = -ring * front * rz;

  const t = (y / half + 1) / 2; // 0 chin .. 1 crown

  // Jaw taper narrows the lower third and pulls the chin forward.
  if (t < 0.42) {
    const k = (0.42 - t) / 0.42;
    const taper = 1 - k * k * (0.2 + f.jawTaper * 0.42);
    x *= taper;
    z *= taper * (front > 0 ? 1 - k * 0.06 : 1);
    if (front > 0.55) z -= k * k * half * (0.1 + f.jawTaper * 0.06);
  }
  // Cranium is deeper than the face and slightly flattened at the back.
  if (front < 0) z *= 1.04 + 0.05 * (1 - t);
  // Brow ridge.
  const browBand = Math.exp(-Math.pow((t - 0.6) / 0.075, 2));
  if (front > 0.35) z -= browBand * front * half * 0.055 * (0.5 + f.brow);
  // Cheekbones.
  const cheekBand = Math.exp(-Math.pow((t - 0.47) / 0.1, 2));
  x += Math.sign(x) * cheekBand * sideAbs * rx * 0.075 * (0.4 + f.cheekbone);
  // Temples pull in slightly above the cheekbones.
  const templeBand = Math.exp(-Math.pow((t - 0.68) / 0.08, 2));
  x -= Math.sign(x) * templeBand * sideAbs * rx * 0.05;
  // Flatten the very front of the face so it reads as a face, not a ball.
  if (front > 0.72 && t > 0.3 && t < 0.72) z *= 0.965;
  // Crown rounds off.
  if (t > 0.9) {
    const k = (t - 0.9) / 0.1;
    x *= 1 - k * 0.06;
    z *= 1 - k * 0.06;
  }

  if (swell !== 0) {
    const len = Math.hypot(x, y, z) || 1;
    x += (x / len) * swell;
    y += (y / len) * swell;
    z += (z / len) * swell;
  }
  return new THREE.Vector3(x, y, z);
}

/** Grid patch on the head surface, used for the skull, hair cap and stubble. */
function headPatch(
  id: HeroIdentity,
  scale: number,
  uSteps: number,
  vSteps: number,
  phiMin: (theta: number) => number,
  phiMax: (theta: number) => number,
  swell: (theta: number, v: number) => number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let iv = 0; iv <= vSteps; iv++) {
    const v = iv / vSteps;
    for (let iu = 0; iu <= uSteps; iu++) {
      const theta = (iu / uSteps) * Math.PI * 2;
      const phi = phiMin(theta) + (phiMax(theta) - phiMin(theta)) * v;
      const p = headSurface(id, theta, phi, scale, swell(theta, v));
      positions.push(p.x, p.y, p.z);
      uvs.push(iu / uSteps, v);
    }
  }
  for (let iv = 0; iv < vSteps; iv++) {
    for (let iu = 0; iu < uSteps; iu++) {
      const a = iv * (uSteps + 1) + iu;
      const b = a + uSteps + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Full head shell. */
function buildHead(id: HeroIdentity, scale: number, segments: number): THREE.BufferGeometry {
  return headPatch(
    id,
    scale,
    segments,
    Math.max(6, Math.round(segments * 0.75)),
    () => 0.001,
    () => Math.PI - 0.001,
    () => 0,
  );
}

export interface HeroMaterials {
  skin: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  brow: THREE.MeshStandardMaterial;
  eyeWhite: THREE.MeshStandardMaterial;
  iris: THREE.MeshStandardMaterial;
  mouth: THREE.MeshStandardMaterial;
  teeth: THREE.MeshStandardMaterial;
  shirt: THREE.MeshStandardMaterial;
  shirtAccent: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
  shoeBody: THREE.MeshStandardMaterial;
  shoeSole: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
}

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function shade(color: number, amount: number): string {
  const c = new THREE.Color(color);
  c.multiplyScalar(amount);
  return `#${c.getHexString()}`;
}

/** Identity colours drive real generated maps rather than a flat tint. */
export function buildHeroMaterials(id: HeroIdentity): HeroMaterials {
  const key = id.name.replace(/\s+/g, '_');
  const skin = new THREE.MeshStandardMaterial({
    map: noiseTexture(`hero:${key}:skin`, {
      colorA: shade(id.colors.skinShadow, 1.0),
      colorB: hex(id.colors.skin),
      period: 6,
      contrast: 0.5,
      size: 256,
      seed: 3,
    }),
    roughness: 0.66,
    metalness: 0.0,
  });
  const hair = new THREE.MeshStandardMaterial({
    map: noiseTexture(`hero:${key}:hair`, {
      colorA: shade(id.colors.hair, 0.7),
      colorB: shade(id.colors.hair, 2.4),
      period: 40,
      contrast: 1.6,
      size: 256,
      seed: 9,
    }),
    // Hair is matte: a low roughness here is what made it read as a helmet.
    roughness: 0.68,
    metalness: 0.0,
  });
  const shirt = new THREE.MeshStandardMaterial({
    map: noiseTexture(`hero:${key}:shirt`, {
      colorA: shade(id.colors.shirt, 0.78),
      colorB: shade(id.colors.shirt, 1.18),
      period: 30,
      contrast: 0.8,
      size: 256,
      seed: 19,
    }),
    roughness: 0.82,
    metalness: 0.0,
  });
  const pants = new THREE.MeshStandardMaterial({
    map: noiseTexture(`hero:${key}:pants`, {
      colorA: shade(id.colors.pants, 0.75),
      colorB: shade(id.colors.pants, 1.2),
      period: 36,
      contrast: 0.9,
      size: 256,
      seed: 27,
    }),
    roughness: 0.88,
    metalness: 0.0,
  });
  return {
    skin,
    hair,
    brow: new THREE.MeshStandardMaterial({ color: id.colors.brow, roughness: 0.55 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.18 }),
    iris: new THREE.MeshStandardMaterial({ color: id.colors.iris, roughness: 0.14, metalness: 0.05 }),
    mouth: new THREE.MeshStandardMaterial({ color: id.colors.lips, roughness: 0.48 }),
    teeth: new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.28 }),
    shirt,
    shirtAccent: new THREE.MeshStandardMaterial({
      color: id.colors.shirtAccent,
      roughness: 0.5,
      emissive: new THREE.Color(id.colors.shirtAccent).multiplyScalar(0.35),
      emissiveIntensity: 0.6,
    }),
    pants,
    shoeBody: new THREE.MeshStandardMaterial({ color: id.colors.shoeBody, roughness: 0.68 }),
    shoeSole: new THREE.MeshStandardMaterial({ color: id.colors.shoeSole, roughness: 0.82 }),
    accent: new THREE.MeshStandardMaterial({
      color: id.colors.accent,
      roughness: 0.42,
      emissive: new THREE.Color(id.colors.accent).multiplyScalar(0.4),
      emissiveIntensity: 0.8,
    }),
  };
}

export interface Hero {
  /** Root object placed in the scene. */
  object: THREE.Group;
  rig: Rig;
  materials: HeroMaterials;
  /** One child group per LOD; only one is visible at a time. */
  lods: THREE.Group[];
  identity: HeroIdentity;
  setLod(level: HeroLod): void;
  currentLod: HeroLod;
  dispose(): void;
}

/** Builds one LOD's worth of skinned meshes onto the shared rig. */
function buildLodMeshes(
  id: HeroIdentity,
  rig: Rig,
  mats: HeroMaterials,
  lod: HeroLod,
): { group: THREE.Group; skinned: THREE.SkinnedMesh[] } {
  const q = QUALITY[lod];
  const scale = id.height / REFERENCE_HEIGHT;
  const group = new THREE.Group();
  group.name = `CHR_Hero_LOD${lod}`;
  const skinned: THREE.SkinnedMesh[] = [];

  const addSkinned = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    name: string,
    only?: string[],
  ) => {
    skinGeometry(geo, rig, only ? { only } : {});
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = lod === 0;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.bind(rig.skeleton);
    group.add(mesh);
    skinned.push(mesh);
    return mesh;
  };

  // ---- Body ------------------------------------------------------------
  const bodyParts: THREE.BufferGeometry[] = [];
  bodyParts.push(
    sweep(sectionsToRings(torsoSections(id), 0, TORSO_PROFILE, scale, 0, q.ringDensity), {
      radialSegments: q.torsoSegments,
      capStart: true,
    }),
  );
  bodyParts.push(
    sweep(sectionsToRings(neckSections(), 0, LIMB_PROFILE, scale, 0, q.ringDensity), {
      radialSegments: Math.max(6, q.limbSegments),
    }),
  );
  for (const side of [1, -1]) {
    bodyParts.push(
      sweep(sectionsToRings(armSections(id, side), 0.185 * side, LIMB_PROFILE, scale, 0, q.ringDensity), {
        radialSegments: q.limbSegments,
        capStart: true,
        capEnd: !q.fingers,
      }),
    );
    bodyParts.push(
      sweep(sectionsToRings(legSections(id), 0.095 * side, LIMB_PROFILE, scale, 0, q.ringDensity), {
        radialSegments: q.limbSegments,
        capStart: true,
      }),
    );
    bodyParts.push(sweep(footRings(side, scale, 0, 0, q.ringDensity), { radialSegments: q.limbSegments, capStart: true, capEnd: true }));
    if (q.fingers) bodyParts.push(...buildHand(side, scale));
  }
  addSkinned(mergeGeometries(bodyParts), mats.skin, `CHR_Hero_Body_LOD${lod}`);

  // ---- Clothing --------------------------------------------------------
  const shirtParts: THREE.BufferGeometry[] = [];
  // Run the shirt all the way up to the neck ring so it closes into a crew
  // neck; stopping at the shoulder left an open hole that read as strapless.
  shirtParts.push(
    sweep(
      clipRings(sectionsToRings(torsoSections(id), 0, TORSO_PROFILE, scale, 0.017, q.ringDensity), 0.86 * scale),
      { radialSegments: q.torsoSegments, capStart: true },
    ),
  );
  // Collar band around the neck opening.
  const collar: Section[] = [
    { y: 1.5, rx: 0.072, rz: 0.068, z: 0.004 },
    { y: 1.528, rx: 0.066, rz: 0.063, z: 0.003 },
  ];
  shirtParts.push(
    sweep(sectionsToRings(collar, 0, LIMB_PROFILE, scale, 0, 1), {
      radialSegments: Math.max(8, q.limbSegments),
    }),
  );
  const sleeveEnd = id.outfit.top === 'tee' ? 1.23 : 0.96;
  for (const side of [1, -1]) {
    // Cap the sleeve just below the shoulder dome so it reads as a seam
    // rather than a plate hanging off the joint.
    const sleeve = clipRings(
      sectionsToRings(armSections(id, side), 0.185 * side, LIMB_PROFILE, scale, 0.016, q.ringDensity),
      sleeveEnd * scale,
      1.472 * scale,
    );
    if (sleeve.length >= 2) {
      shirtParts.push(sweep(sleeve, { radialSegments: q.limbSegments, capStart: true, capEnd: true }));
    }
  }
  addSkinned(mergeGeometries(shirtParts), mats.shirt, `CHR_Hero_Shirt_LOD${lod}`);

  // A single accent band across the chest reads as branding at any distance.
  if (lod < 2) {
    const band = torsoSections(id).filter((s) => s.y >= 1.2 && s.y <= 1.29);
    if (band.length >= 2) {
      addSkinned(
        sweep(sectionsToRings(band, 0, TORSO_PROFILE, scale, 0.021, 1), { radialSegments: q.torsoSegments }),
        mats.shirtAccent,
        `CHR_Hero_ShirtBand_LOD${lod}`,
      );
    }
  }

  const pantsParts: THREE.BufferGeometry[] = [];
  pantsParts.push(
    sweep(
      clipRings(
        sectionsToRings(torsoSections(id), 0, TORSO_PROFILE, scale, 0.019, q.ringDensity),
        0.84 * scale,
        1.06 * scale,
      ),
      { radialSegments: q.torsoSegments, capStart: true, capEnd: true },
    ),
  );
  const ankle = id.outfit.bottom === 'joggers' ? 0.155 : 0.115;
  const joggers = id.outfit.bottom === 'joggers';
  for (const side of [1, -1]) {
    // Joggers cinch over the last fifth of the leg; jeans keep an even drape.
    const drape = (t: number) => (joggers && t > 0.86 ? 0.019 - (t - 0.86) * 0.09 : 0.019);
    const leg = clipRings(
      sectionsToRings(legSections(id), 0.095 * side, LIMB_PROFILE, scale, drape, q.ringDensity),
      ankle * scale,
    );
    pantsParts.push(sweep(leg, { radialSegments: q.limbSegments, capEnd: true }));
  }
  addSkinned(mergeGeometries(pantsParts), mats.pants, `CHR_Hero_Pants_LOD${lod}`);

  // ---- Shoes -----------------------------------------------------------
  for (const side of [1, -1]) {
    const upper = sweep(footRings(side, scale, 0.014, 0.004, q.ringDensity), {
      radialSegments: q.limbSegments,
      capStart: true,
      capEnd: true,
    });
    addSkinned(upper, mats.shoeBody, `CHR_Hero_Shoe_${side > 0 ? 'L' : 'R'}_LOD${lod}`, [
      `foot_${side > 0 ? 'L' : 'R'}`,
      `toe_${side > 0 ? 'L' : 'R'}`,
      `calf_${side > 0 ? 'L' : 'R'}`,
    ]);
    const sole = sweep(soleRings(side, scale, q.ringDensity), { radialSegments: q.limbSegments, capStart: true, capEnd: true });
    addSkinned(sole, mats.shoeSole, `CHR_Hero_Sole_${side > 0 ? 'L' : 'R'}_LOD${lod}`, [
      `foot_${side > 0 ? 'L' : 'R'}`,
      `toe_${side > 0 ? 'L' : 'R'}`,
    ]);
  }

  // ---- Head, face and hair (parented to the head bone) -----------------
  const headBone = rig.byName.get('head')!;
  const headGroup = new THREE.Group();
  headGroup.name = `CHR_Hero_Head_LOD${lod}`;
  // Head bone sits at 1.575; the skull centre is a little above it.
  headGroup.position.set(0, (1.663 - 1.575) * scale, 0);
  headBone.add(headGroup);

  const headMesh = new THREE.Mesh(buildHead(id, scale, q.headSegments), mats.skin);
  headMesh.castShadow = lod === 0;
  headGroup.add(headMesh);
  buildFace(id, scale, q, mats, headGroup);
  if (q.hairStrands > 0 || lod === 2) buildHair(id, scale, q, mats, headGroup);

  group.userData.headGroup = headGroup;
  return { group, skinned };
}

function soleRings(side: number, scale: number, density = 1): Ring[] {
  const defs = [
    { z: 0.062, y: 0.014, rx: 0.032, ry: 0.016 },
    { z: 0.02, y: 0.013, rx: 0.042, ry: 0.016 },
    { z: -0.05, y: 0.013, rx: 0.048, ry: 0.016 },
    { z: -0.12, y: 0.013, rx: 0.046, ry: 0.015 },
    { z: -0.175, y: 0.015, rx: 0.036, ry: 0.014 },
    { z: -0.2, y: 0.018, rx: 0.022, ry: 0.011 },
  ];
  const sections: Section[] = defs.map((d) => ({ y: d.z, rx: d.rx, rz: d.ry, z: d.y }));
  const rows = density > 1 ? Math.round((defs.length - 1) * density) + 1 : defs.length;
  const profile = bodyProfile(3.2);
  const rings: Ring[] = [];
  for (let i = 0; i < rows; i++) {
    const s = rows === defs.length ? sections[i] : sampleSections(sections, i / (rows - 1));
    rings.push({
      c: new THREE.Vector3(0.095 * side * scale, (s.z ?? 0) * scale, s.y * scale),
      u: new THREE.Vector3(s.rx * scale, 0, 0),
      v: new THREE.Vector3(0, s.rz * scale, 0),
      shape: profile,
    });
  }
  return rings;
}

/** Palm plus four fingers and a thumb. */
function buildHand(side: number, scale: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const x = 0.185 * side;
  const palm = [
    { y: 0.925, rx: 0.031, rz: 0.033 },
    { y: 0.9, rx: 0.036, rz: 0.024 },
    { y: 0.87, rx: 0.038, rz: 0.022 },
    { y: 0.845, rx: 0.036, rz: 0.021 },
  ];
  out.push(
    sweep(
      palm.map((p) => ringXZ(p.y * scale, p.rx * scale, p.rz * scale, x * scale, 0, LIMB_PROFILE)),
      { radialSegments: 10, capStart: true, capEnd: true },
    ),
  );
  const fingerZ = [-0.022, -0.0075, 0.0075, 0.022];
  const fingerLen = [0.072, 0.082, 0.078, 0.062];
  for (let i = 0; i < 4; i++) {
    const top = 0.848;
    const bottom = top - fingerLen[i];
    const rings = [0, 0.35, 0.7, 1].map((t) => {
      const y = top + (bottom - top) * t;
      const r = 0.0092 * (1 - t * 0.32);
      return ringXZ(y * scale, r * scale, r * scale, x * scale, fingerZ[i] * scale);
    });
    out.push(sweep(rings, { radialSegments: 6, capStart: true, capEnd: true }));
  }
  // Thumb angles away from the palm.
  const thumb = [0, 0.5, 1].map((t) => {
    const y = (0.905 - t * 0.055) * scale;
    const tx = (x + side * t * 0.026) * scale;
    const tz = (-0.012 - t * 0.018) * scale;
    const r = 0.0105 * (1 - t * 0.3) * scale;
    return ringXZ(0, r, r, 0, 0).c ? { c: new THREE.Vector3(tx, y, tz), u: new THREE.Vector3(r, 0, 0), v: new THREE.Vector3(0, 0, r) } : ringXZ(0, r, r);
  });
  out.push(sweep(thumb as Ring[], { radialSegments: 6, capStart: true, capEnd: true }));
  return out;
}

/** Eyes, lids, brows, nose, lips, teeth, tongue and ears. */
function buildFace(
  id: HeroIdentity,
  scale: number,
  q: Quality,
  mats: HeroMaterials,
  parent: THREE.Group,
): void {
  const f = id.face;
  const half = (f.length / 2) * scale;
  const rx = half * f.widthRatio;
  const rz = half * f.depthRatio;
  const seg = q.faceDetail === 'full' ? 14 : 8;

  const eyeX = rx * f.eyeSpacing;
  const eyeY = half * 0.09;
  const eyeR = half * 0.086 * (0.78 + f.eyeSize * 0.42);
  const eyeZ = -rz * 0.79;

  for (const side of [1, -1]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(eyeR, seg, seg), mats.eyeWhite);
    ball.position.set(eyeX * side, eyeY, eyeZ + eyeR * 0.86);
    parent.add(ball);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.52, seg, Math.max(6, seg - 4)), mats.iris);
    iris.position.set(eyeX * side, eyeY, eyeZ + eyeR * 0.86 - eyeR * 0.74);
    iris.scale.set(1, 1, 0.55);
    parent.add(iris);

    if (q.faceDetail !== 'minimal') {
      // Upper and lower lids as thin shells clipping the eyeball.
      const lid = new THREE.Mesh(
        new THREE.SphereGeometry(eyeR * 1.1, seg, seg, 0, Math.PI * 2, 0, Math.PI * 0.42),
        mats.skin,
      );
      lid.position.copy(ball.position);
      lid.rotation.x = -0.35;
      parent.add(lid);

      const lowerLid = new THREE.Mesh(
        new THREE.SphereGeometry(eyeR * 1.08, seg, seg, 0, Math.PI * 2, Math.PI * 0.66, Math.PI * 0.34),
        mats.skin,
      );
      lowerLid.position.copy(ball.position);
      lowerLid.rotation.x = 0.28;
      parent.add(lowerLid);

      // Brow: a shallow curved bar sitting on the ridge.
      const brow = new THREE.Mesh(
        new THREE.TorusGeometry(eyeR * 1.18, eyeR * 0.17, 5, 10, Math.PI * 0.72),
        mats.brow,
      );
      brow.position.set(eyeX * side, eyeY + eyeR * 1.5, eyeZ + eyeR * 0.2);
      brow.rotation.set(0.22, 0, side > 0 ? 0.16 : -0.16);
      brow.scale.set(1, 0.7, 0.7);
      parent.add(brow);
    }

    // Ears.
    const ear = new THREE.Mesh(new THREE.SphereGeometry(half * 0.16 * (0.7 + f.ear * 0.6), seg, seg), mats.skin);
    ear.position.set(rx * 0.95 * side, -half * 0.02, rz * 0.36);
    ear.scale.set(0.28, 0.85, 0.5);
    parent.add(ear);
  }

  // Nose: a tapered wedge from the bridge to the tip, plus nostrils.
  const noseTipY = -half * (0.06 + f.noseLength * 0.1);
  const noseRings: Ring[] = [
    { y: half * 0.16, w: 0.16, d: 0.06, z: -rz * 0.82 },
    { y: half * 0.05, w: 0.19, d: 0.1, z: -rz * 0.9 },
    { y: -half * 0.03, w: 0.24, d: 0.14, z: -rz * 0.98 },
    { y: noseTipY, w: 0.26, d: 0.13, z: -rz * 0.99 },
    { y: noseTipY - half * 0.05, w: 0.30, d: 0.08, z: -rz * 0.88 },
  ].map((n) => ({
    c: new THREE.Vector3(0, n.y, n.z - rz * f.noseBridge * 0.04),
    u: new THREE.Vector3(rx * n.w * (0.75 + f.noseWidth * 0.5), 0, 0),
    v: new THREE.Vector3(0, 0, rz * n.d),
    shape: bodyProfile(2.6),
  }));
  const nose = new THREE.Mesh(sweep(noseRings, { radialSegments: seg, capStart: true, capEnd: true }), mats.skin);
  parent.add(nose);

  // Lips.
  const lipY = -half * 0.42;
  const lipZ = -rz * 0.78;
  const lipScale = 0.75 + f.lips * 0.5;
  const upper = new THREE.Mesh(new THREE.SphereGeometry(half * 0.105 * lipScale, seg, Math.max(5, seg - 6)), mats.mouth);
  upper.position.set(0, lipY + half * 0.028, lipZ + half * 0.03);
  upper.scale.set(2.1, 0.34, 0.42);
  parent.add(upper);
  const lower = new THREE.Mesh(new THREE.SphereGeometry(half * 0.105 * lipScale, seg, Math.max(5, seg - 6)), mats.mouth);
  lower.position.set(0, lipY - half * 0.038, lipZ + half * 0.035);
  lower.scale.set(1.85, 0.4, 0.46);
  parent.add(lower);

  if (q.faceDetail === 'full') {
    // Teeth and tongue sit inside the mouth line and read on close-ups.
    const teeth = new THREE.Mesh(new THREE.TorusGeometry(half * 0.115, half * 0.02, 5, 12, Math.PI), mats.teeth);
    teeth.position.set(0, lipY - half * 0.005, lipZ + half * 0.2);
    teeth.rotation.set(Math.PI / 2, 0, Math.PI);
    teeth.scale.set(1, 1, 0.7);
    parent.add(teeth);

    const tongue = new THREE.Mesh(new THREE.SphereGeometry(half * 0.06, 8, 6), mats.mouth);
    tongue.position.set(0, lipY - half * 0.04, lipZ + half * 0.26);
    tongue.scale.set(1.2, 0.5, 1.3);
    parent.add(tongue);

    if (id.hair.stubble > 0.05) {
      const stubble = headPatch(
        id,
        scale,
        18,
        6,
        () => Math.PI * 0.62,
        (theta) => Math.PI * (0.62 + 0.3 * Math.max(0, Math.cos(theta))),
        () => half * 0.006,
      );
      const mat = mats.hair.clone();
      mat.transparent = true;
      mat.opacity = 0.32 + id.hair.stubble * 0.42;
      mat.roughness = 0.85;
      const mesh = new THREE.Mesh(stubble, mat);
      parent.add(mesh);
    }
  }
}

/** Hair cap with an authored hairline, plus strand clusters on top. */
function buildHair(
  id: HeroIdentity,
  scale: number,
  q: Quality,
  mats: HeroMaterials,
  parent: THREE.Group,
): void {
  const h = id.hair;
  const half = (id.face.length / 2) * scale;
  const volume = h.volume * scale;

  // theta 0 faces forward: the hairline stops high at the front and runs
  // down to the nape at the back.
  const hairline = (theta: number) => {
    const front = Math.cos(theta);
    // Higher at the brow, lower at the nape. The front term has to be strong
    // or the cap sits over the eyes like a bowl.
    const base = 1.26 - 0.42 * front - (h.fringe - 0.5) * 0.14 * Math.max(0, front);
    const sides = Math.abs(Math.sin(theta));
    return base + sides * h.sideburn * 0.26;
  };

  const cap = headPatch(
    id,
    scale,
    q.faceDetail === 'minimal' ? 12 : 24,
    q.faceDetail === 'minimal' ? 5 : 10,
    () => 0.001,
    hairline,
    (theta, v) => {
      const taper = Math.min(1, (1 - v) * 3.2);
      const curl = h.style === 'curly' ? Math.sin(theta * 9) * Math.sin(v * 11) * 0.35 : 0;
      return volume * (0.35 + taper * 0.85 + curl);
    },
  );
  const capMesh = new THREE.Mesh(cap, mats.hair);
  capMesh.material.side = THREE.DoubleSide;
  parent.add(capMesh);

  // A short inward rim closes the shell so it never reads as paper thin.
  const rim = headPatch(
    id,
    scale,
    q.faceDetail === 'minimal' ? 12 : 24,
    2,
    hairline,
    (theta) => hairline(theta) + 0.1,
    (_theta, v) => volume * (1 - v) * 0.6,
  );
  parent.add(new THREE.Mesh(rim, mats.hair));

  // Strand clusters give the silhouette some direction on the top.
  for (let i = 0; i < q.hairStrands; i++) {
    const theta = (i / Math.max(1, q.hairStrands)) * Math.PI * 2;
    const phi = 0.35 + (i % 3) * 0.22;
    const base = headSurface(id, theta, phi, scale, volume * 0.7);
    const tipPhi = phi + (h.style === 'curly' ? 0.14 : 0.34);
    const tip = headSurface(id, theta + 0.1, tipPhi, scale, volume * (h.style === 'short' ? 0.9 : 1.25));
    const dir = tip.clone().sub(base);
    const rings: Ring[] = [0, 0.5, 1].map((t) => {
      const c = base.clone().addScaledVector(dir, t);
      const r = half * 0.042 * (1 - t * 0.8);
      return { c, u: new THREE.Vector3(r, 0, 0), v: new THREE.Vector3(0, 0, r) };
    });
    parent.add(new THREE.Mesh(sweep(rings, { radialSegments: 5, capStart: true, capEnd: true }), mats.hair));
  }
}

/** Optional signature accessories driven by the identity outfit block. */
function buildAccessories(id: HeroIdentity, rig: Rig, mats: HeroMaterials, scale: number): void {
  if (id.outfit.watch) {
    const strap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032 * scale, 0.032 * scale, 0.022 * scale, 12),
      mats.pants,
    );
    strap.rotation.z = Math.PI / 2;
    strap.position.set(0, -0.03 * scale, 0);
    rig.byName.get('hand_L')!.add(strap);
    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017 * scale, 0.017 * scale, 0.008 * scale, 12),
      mats.accent,
    );
    face.rotation.z = Math.PI / 2;
    face.position.set(0.03 * scale, -0.03 * scale, 0);
    rig.byName.get('hand_L')!.add(face);
  }
  if (id.outfit.band) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.033 * scale, 0.007 * scale, 5, 12),
      mats.shirtAccent,
    );
    band.rotation.y = Math.PI / 2;
    band.position.set(0, -0.02 * scale, 0);
    rig.byName.get('hand_R')!.add(band);
  }
  if (id.outfit.backpack) {
    const body = place(
      new THREE.BoxGeometry(0.26 * scale, 0.34 * scale, 0.14 * scale),
      [0, 0.06 * scale, 0.15 * scale],
    );
    const pack = new THREE.Mesh(body, mats.pants);
    rig.byName.get('chest')!.add(pack);
  }
}

/**
 * Builds the complete hero: one skeleton, three LODs of geometry, materials
 * derived from the identity, and accessories.
 */
export function createHero(identity: HeroIdentity): Hero {
  const rig = buildRig(identity.height);
  const materials = buildHeroMaterials(identity);
  const object = new THREE.Group();
  object.name = `CHR_Hero_${identity.name}`;
  object.add(rig.root);

  const scale = identity.height / REFERENCE_HEIGHT;
  const lods: THREE.Group[] = [];
  for (const level of [0, 1, 2] as HeroLod[]) {
    const { group } = buildLodMeshes(identity, rig, materials, level);
    group.visible = level === 0;
    object.add(group);
    lods.push(group);
  }
  buildAccessories(identity, rig, materials, scale);

  let currentLod: HeroLod = 0;
  const hero: Hero = {
    object,
    rig,
    materials,
    lods,
    identity,
    currentLod,
    setLod(level: HeroLod) {
      if (level === currentLod) return;
      // Head detail is parented to the bone, so swap visibility per LOD group
      // and keep only the active head group shown.
      lods.forEach((group, i) => {
        const active = i === level;
        group.visible = active;
        const head = group.userData.headGroup as THREE.Group | undefined;
        if (head) head.visible = active;
      });
      currentLod = level;
      hero.currentLod = level;
    },
    dispose() {
      object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      for (const mat of Object.values(materials)) mat.dispose();
    },
  };
  // Head groups for inactive LODs start hidden.
  lods.forEach((group, i) => {
    const head = group.userData.headGroup as THREE.Group | undefined;
    if (head) head.visible = i === 0;
  });
  return hero;
}
