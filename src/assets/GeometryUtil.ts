import * as THREE from 'three';

/**
 * Geometry construction helpers used by every asset factory. These build real
 * modelled surfaces (swept profiles, bevelled shells, lathed forms) rather
 * than leaning on primitive boxes.
 */

/** One cross-section of a swept surface, oriented by its own basis vectors. */
export interface Ring {
  /** Ring centre in local space. */
  c: THREE.Vector3;
  /** Half-extent along the ring's local X. */
  u: THREE.Vector3;
  /** Half-extent along the ring's local Y. */
  v: THREE.Vector3;
  /** Optional per-angle radius modulation, 1 = unchanged. */
  shape?: (angle: number) => number;
}

/** Build a ring in the XZ plane at height y with elliptical radii. */
export function ringXZ(y: number, rx: number, rz: number, xOff = 0, zOff = 0, shape?: (a: number) => number): Ring {
  return {
    c: new THREE.Vector3(xOff, y, zOff),
    u: new THREE.Vector3(rx, 0, 0),
    v: new THREE.Vector3(0, 0, rz),
    ...(shape ? { shape } : {}),
  };
}

export interface SweepOptions {
  radialSegments: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** V coordinate runs 0..1 along the sweep by default. */
  uvScale?: number;
}

/**
 * Sweeps a tube through the supplied rings. Produces smooth shared normals,
 * seamless UVs and optional end caps.
 */
export function sweep(rings: Ring[], opts: SweepOptions): THREE.BufferGeometry {
  const seg = Math.max(3, opts.radialSegments);
  const rows = rings.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Arc length parameterisation gives even texture stretch along the sweep.
  const lengths: number[] = [0];
  for (let i = 1; i < rows; i++) lengths.push(lengths[i - 1] + rings[i].c.distanceTo(rings[i - 1].c));
  const total = lengths[rows - 1] || 1;

  for (let r = 0; r < rows; r++) {
    const ring = rings[r];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const k = ring.shape ? ring.shape(a) : 1;
      const cos = Math.cos(a) * k;
      const sin = Math.sin(a) * k;
      positions.push(
        ring.c.x + ring.u.x * cos + ring.v.x * sin,
        ring.c.y + ring.u.y * cos + ring.v.y * sin,
        ring.c.z + ring.u.z * cos + ring.v.z * sin,
      );
      uvs.push(s / seg, (lengths[r] / total) * (opts.uvScale ?? 1));
    }
  }

  // Winding depends on which way the profile travels. A ring's own normal is
  // u x v; if that points along the sweep direction the faces come out
  // inside-out, so the triangle order is reversed. Without this, anything
  // swept downwards (legs, arms, trousers) renders back-to-front and its
  // computed normals are inverted.
  const axis = _sweepAxis.subVectors(rings[rows - 1].c, rings[0].c);
  const ringNormal = _ringNormal.crossVectors(rings[0].u, rings[0].v);
  const reverse = ringNormal.dot(axis) > 0;

  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s;
      const b = a + seg + 1;
      if (reverse) indices.push(a, a + 1, b, b, a + 1, b + 1);
      else indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  if (opts.capStart) capRing(rings[0], seg, positions, uvs, indices, !reverse);
  if (opts.capEnd) capRing(rings[rows - 1], seg, positions, uvs, indices, reverse);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function capRing(
  ring: Ring,
  seg: number,
  positions: number[],
  uvs: number[],
  indices: number[],
  flip: boolean,
): void {
  const centre = positions.length / 3;
  positions.push(ring.c.x, ring.c.y, ring.c.z);
  uvs.push(0.5, 0.5);
  const start = positions.length / 3;
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const k = ring.shape ? ring.shape(a) : 1;
    const cos = Math.cos(a) * k;
    const sin = Math.sin(a) * k;
    positions.push(
      ring.c.x + ring.u.x * cos + ring.v.x * sin,
      ring.c.y + ring.u.y * cos + ring.v.y * sin,
      ring.c.z + ring.u.z * cos + ring.v.z * sin,
    );
    uvs.push(cos * 0.5 + 0.5, sin * 0.5 + 0.5);
  }
  for (let s = 0; s < seg; s++) {
    if (flip) indices.push(centre, start + s + 1, start + s);
    else indices.push(centre, start + s, start + s + 1);
  }
}

/** Attributes this project merges. Everything else is dropped deliberately. */
const MERGE_ATTRS = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color'] as const;

/**
 * Merges indexed geometries into one buffer. Self-contained so the build has
 * no dependency on the three examples bundle.
 */
export function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const present = MERGE_ATTRS.filter((name) => geometries.every((g) => g.getAttribute(name)));
  const out = new THREE.BufferGeometry();
  const indices: number[] = [];
  let vertexOffset = 0;

  const buffers: Record<string, number[]> = {};
  for (const name of present) buffers[name] = [];

  for (const geo of geometries) {
    const pos = geo.getAttribute('position');
    for (const name of present) {
      const attr = geo.getAttribute(name);
      const arr = attr.array as ArrayLike<number>;
      for (let i = 0; i < arr.length; i++) buffers[name].push(arr[i]);
    }
    const idx = geo.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vertexOffset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + vertexOffset);
    }
    vertexOffset += pos.count;
  }

  for (const name of present) {
    const size = geometries[0].getAttribute(name).itemSize;
    if (name === 'skinIndex') {
      out.setAttribute(name, new THREE.Uint16BufferAttribute(buffers[name], size));
    } else {
      out.setAttribute(name, new THREE.Float32BufferAttribute(buffers[name], size));
    }
  }
  out.setIndex(indices);
  if (!present.includes('normal')) out.computeVertexNormals();
  return out;
}

/** Applies a matrix to a geometry, returning it for chaining. */
export function transform(geo: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  geo.applyMatrix4(m);
  return geo;
}

const _sweepAxis = new THREE.Vector3();
const _ringNormal = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

/** Convenience translate/rotate/scale on a geometry in one call. */
export function place(
  geo: THREE.BufferGeometry,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] | number = 1,
): THREE.BufferGeometry {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
  _m.compose(_v.set(pos[0], pos[1], pos[2]), _q, new THREE.Vector3(s[0], s[1], s[2]));
  geo.applyMatrix4(_m);
  return geo;
}

/** Rounded box built from a bevelled sweep. Used for crates, signs, bodies. */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  steps = 3,
): THREE.BufferGeometry {
  const r = Math.min(radius, width / 2.05, height / 2.05, depth / 2.05);
  const rings: Ring[] = [];
  // Superellipse profile: bevel 0 => sharp rectangle, 1 => ellipse.
  const bevel = Math.min(1, (r * 2) / Math.min(width, depth));
  const exponent = 2 + (1 - bevel) * 10;
  const squircle = (a: number) => {
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    return Math.pow(Math.pow(c, exponent) + Math.pow(s, exponent), -1 / exponent);
  };
  const push = (y: number, inset: number) => {
    rings.push(ringXZ(y, width / 2 - inset, depth / 2 - inset, 0, 0, squircle));
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -height / 2 + r * (1 - Math.cos((t * Math.PI) / 2));
    push(y, r * (1 - Math.sin((t * Math.PI) / 2)));
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const y = height / 2 - r * (1 - Math.cos((t * Math.PI) / 2));
    push(y, r * (1 - Math.sin((t * Math.PI) / 2)));
  }
  return sweep(rings, { radialSegments: 16, capStart: true, capEnd: true });
}

/** Counts triangles across a whole object tree; used by the asset budget report. */
export function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const index = geo.getIndex();
    const count = index ? index.count : geo.getAttribute('position')?.count ?? 0;
    const instances = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as unknown as THREE.InstancedMesh).count
      : 1;
    total += (count / 3) * instances;
  });
  return Math.round(total);
}

/** Deterministic jitter helper for scattering props without an RNG instance. */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Merges every plain mesh in a group that shares a material into one mesh,
 * baking each mesh's local transform into its vertices.
 *
 * A modelled prop is authored as ten or twenty small meshes because that is
 * how it is easiest to build; the renderer would rather have two. Instanced
 * meshes and anything flagged `userData.noMerge` are left alone.
 */
export function mergeByMaterial(group: THREE.Object3D): THREE.Object3D {
  const buckets = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; castShadow: boolean; receiveShadow: boolean }>();
  const keep: THREE.Object3D[] = [];

  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();

  const visit = (node: THREE.Object3D) => {
    for (const child of [...node.children]) visit(child);
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      // Anything that is not a mesh used to be dropped here without a word.
      // A light, a sprite or a line added to a merged factory group simply
      // ceased to exist, with no error and nothing in the scene graph to show
      // for it -- which is how a deliberately sabotaged street lamp passed a
      // test written to catch exactly that light.
      //
      // Leaf non-meshes are carried across instead. Containers are not: their
      // mesh children have just been merged and their geometry disposed, so
      // re-parenting the container would draw from freed buffers.
      const leaf = node.children.length === 0;
      const container = (node as THREE.Group).isGroup || node.type === 'Object3D';
      if (leaf && !container) keep.push(node);
      return;
    }
    const instanced = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh;
    const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh;
    if (instanced || skinned || mesh.userData.noMerge || Array.isArray(mesh.material)) {
      keep.push(mesh);
      return;
    }
    const material = mesh.material as THREE.Material;
    const clone = mesh.geometry.clone();
    // Bring the geometry into the group's local space.
    clone.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    // A merge needs matching attribute sets; drop anything exotic.
    for (const name of Object.keys(clone.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) clone.deleteAttribute(name);
    }
    if (!clone.getAttribute('normal')) clone.computeVertexNormals();
    if (!clone.getAttribute('uv')) {
      const count = clone.getAttribute('position').count;
      clone.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    let bucket = buckets.get(material);
    if (!bucket) {
      bucket = { geometries: [], castShadow: false, receiveShadow: false };
      buckets.set(material, bucket);
    }
    bucket.geometries.push(clone);
    bucket.castShadow ||= mesh.castShadow;
    bucket.receiveShadow ||= mesh.receiveShadow;
    mesh.geometry.dispose();
  };

  for (const child of [...group.children]) visit(child);

  const out = new THREE.Group();
  out.name = group.name;
  out.userData = group.userData;
  for (const [material, bucket] of buckets) {
    const merged = new THREE.Mesh(mergeGeometries(bucket.geometries), material);
    merged.castShadow = bucket.castShadow;
    merged.receiveShadow = bucket.receiveShadow;
    for (const geo of bucket.geometries) geo.dispose();
    out.add(merged);
  }
  for (const node of keep) {
    // Bake the world transform the node had inside the original group, since
    // it is about to lose the parents that carried it.
    node.updateMatrixWorld(true);
    node.matrix.copy(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    out.add(node);
  }
  return out;
}
