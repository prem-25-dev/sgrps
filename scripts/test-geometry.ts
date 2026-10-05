import * as THREE from 'three';
import { ringXZ, sweep, Ring } from '../src/assets/GeometryUtil';
import { buildTrackModule, fixingGeometry, sleeperGeometry, TRACK_VARIANTS } from '../src/assets/TrackFactory';
import { createHero } from '../src/assets/HeroFactory';
import { DEFAULT_IDENTITY } from '../src/assets/HeroIdentity';

/**
 * Winding regression test: a swept tube must have outward-facing normals
 * whichever direction the profile travels.
 */
/**
 * Splits a swept tube's vertices into wall and cap sets and reports whether
 * each faces the right way: walls point radially outward, the start cap points
 * back along the sweep and the end cap points forward along it.
 */
function analyse(geo: THREE.BufferGeometry, axis: THREE.Vector3) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const dir = axis.clone().normalize();
  let wall = 0, wallOut = 0, capFwd = 0, capBack = 0;

  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const axial = n.dot(dir);
    if (Math.abs(axial) > 0.75) {
      // Cap vertex: which end is it on?
      if (axial > 0) capFwd++;
      else capBack++;
      continue;
    }
    radial.copy(p).addScaledVector(dir, -p.dot(dir));
    if (radial.lengthSq() < 1e-8) continue;
    radial.normalize();
    wall++;
    if (radial.dot(n) > 0) wallOut++;
  }
  return { wall, wallOutward: wallOut / Math.max(1, wall), capFwd, capBack };
}

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const up: Ring[] = [0, 1, 2, 3].map((i) => ringXZ(i * 0.3, 0.2 + i * 0.02, 0.2 + i * 0.02));
const down: Ring[] = [3, 2, 1, 0].map((i) => ringXZ(i * 0.3, 0.2 + i * 0.02, 0.2 + i * 0.02));

const upGeo = sweep(up, { radialSegments: 12, capStart: true, capEnd: true });
const downGeo = sweep(down, { radialSegments: 12, capStart: true, capEnd: true });

const upInfo = analyse(upGeo, new THREE.Vector3(0, 1, 0));
const downInfo = analyse(downGeo, new THREE.Vector3(0, -1, 0));
console.log(`  upward sweep:   walls ${(upInfo.wallOutward * 100).toFixed(1)}% outward, caps ${upInfo.capBack}/${upInfo.capFwd}`);
console.log(`  downward sweep: walls ${(downInfo.wallOutward * 100).toFixed(1)}% outward, caps ${downInfo.capBack}/${downInfo.capFwd}`);
check('upward sweep walls face outward', upInfo.wallOutward > 0.98, `${upInfo.wallOutward}`);
check('downward sweep walls face outward', downInfo.wallOutward > 0.98, `${downInfo.wallOutward}`);
check('upward sweep caps face both ways', upInfo.capBack > 0 && upInfo.capFwd > 0, 'a cap is inverted');
check('downward sweep caps face both ways', downInfo.capBack > 0 && downInfo.capFwd > 0, 'a cap is inverted');

// A sweep along Z (feet, pipes) must also come out right.
const alongZ: Ring[] = [0, 1, 2, 3].map((i) => ({
  c: new THREE.Vector3(0, 0, -i * 0.3),
  u: new THREE.Vector3(0.15, 0, 0),
  v: new THREE.Vector3(0, 0.15, 0),
}));
const zGeo = sweep(alongZ, { radialSegments: 12, capStart: true, capEnd: true });
const zInfo = analyse(zGeo, new THREE.Vector3(0, 0, -1));
console.log(`  -Z sweep:       walls ${(zInfo.wallOutward * 100).toFixed(1)}% outward, caps ${zInfo.capBack}/${zInfo.capFwd}`);
check('sweep along -Z walls face outward', zInfo.wallOutward > 0.98, `${zInfo.wallOutward}`);


// ---------------------------------------------------------------------------
// The head.
//
// `sweep` was the first thing in this project found to wind inside out, and
// the head is built by a different function — `headPatch` — which had the
// same fault and kept it far longer, because a convex shell viewed from
// inside still reads as a head from the front. Every screenshot taken to
// judge the face was taken from the front, so nothing caught it. From behind
// the mouth shows through the back of the skull, and behind is where the
// player is for the entire game.
console.log('\nThe head:');
{
  /** Share of triangles whose geometric normal points away from a centre. */
  const outwardShare = (geo: THREE.BufferGeometry, centre: THREE.Vector3) => {
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    const n = new THREE.Vector3(), mid = new THREE.Vector3();
    let out = 0, total = 0;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx.getX(i) : i;
      const ib = idx ? idx.getX(i + 1) : i + 1;
      const ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
      ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
      if (n.lengthSq() === 0) continue;
      mid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(centre);
      total++;
      if (n.dot(mid) > 0) out++;
    }
    return total === 0 ? 0 : out / total;
  };

  // Calibration first. This measure has a sign, and getting it backwards
  // would make every assertion below pass on an inside-out head, so it is
  // anchored to geometry three.js builds itself.
  const sphere = outwardShare(new THREE.SphereGeometry(1, 16, 12), new THREE.Vector3());
  const box = outwardShare(new THREE.BoxGeometry(1, 1, 1), new THREE.Vector3());
  check('the winding measure agrees with three.js\u2019s own primitives',
    sphere === 1 && box === 1, `sphere ${sphere}, box ${box}`);

  const hero = createHero(DEFAULT_IDENTITY);
  hero.setLod(0);
  hero.object.updateMatrixWorld(true);

  /**
   * The nearest hit the renderer would actually draw.
   *
   * `Raycaster` does not skip hidden objects, and the hero carries all three
   * LODs at once with two of them switched off, so an unfiltered cast reports
   * the low-detail head shells sitting in the same space as the real one.
   */
  const visibleHit = (from: THREE.Vector3, target: THREE.Object3D) => {
    const caster = new THREE.Raycaster();
    caster.set(from, new THREE.Vector3(0, 0, 1));
    for (const hit of caster.intersectObject(target, true)) {
      let node: THREE.Object3D | null = hit.object;
      let shown = true;
      while (node) { if (!node.visible) { shown = false; break; } node = node.parent; }
      if (shown) return hit;
    }
    return null;
  };
  let shell: THREE.Mesh | null = null;
  let biggest = 0;
  hero.rig.byName.get('head')!.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry.getIndex()) return;
    let node: THREE.Object3D | null = m;
    while (node) { if (!node.visible) return; node = node.parent; }
    const tris = m.geometry.getIndex()!.count / 3;
    // The shell is the one patch that wraps the whole head.
    m.geometry.computeBoundingBox();
    const size = m.geometry.boundingBox!.getSize(new THREE.Vector3());
    if (size.y > 0.2 && size.x > 0.15 && tris > biggest) { biggest = tris; shell = m; }
  });
  check('the head has a shell', shell !== null);

  if (shell) {
    const mesh = shell as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const centre = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
    const share = outwardShare(mesh.geometry, centre);
    check('the head shell faces outward', share > 0.99,
      `${(share * 100).toFixed(1)}% of ${biggest} triangles`);

    // And the face has to be on the outside of it. Ray casting from in front
    // of the head is the same question the camera asks, so it cannot be
    // satisfied by a feature that is merely near the surface but behind it.
    //
    // The rays are aimed from the shell's own centre, not from the head bone,
    // which sits at the base of the skull: measuring from the bone put every
    // ray through the jaw and below.
    const head = hero.rig.byName.get('head')!;
    const centreWorld = mesh.localToWorld(centre.clone());
    const identityScale = DEFAULT_IDENTITY.height / 1.78;
    const half = (DEFAULT_IDENTITY.face.length / 2) * identityScale;
    const eyeX = half * DEFAULT_IDENTITY.face.widthRatio * DEFAULT_IDENTITY.face.eyeSpacing;
    // Eyelids and the stubble layer are meant to lie over the eyeball and the
    // skin, so each feature names the parts that may legitimately be in front
    // of it. Anything else — above all the shell — means it is buried.
    const named: [string, string[], THREE.Vector3][] = [
      ['an eye', ['CHR_Hero_Eye_L', 'CHR_Hero_EyeLid_L'], new THREE.Vector3(eyeX, half * 0.09, 0)],
      ['the other eye', ['CHR_Hero_Eye_R', 'CHR_Hero_EyeLid_R'], new THREE.Vector3(-eyeX, half * 0.09, 0)],
      ['the lower lip', ['CHR_Hero_Lip_Lower'], new THREE.Vector3(0, -half * 0.46, 0)],
      ['the nose', ['CHR_Hero_Nose'], new THREE.Vector3(0, -half * 0.1, 0)],
    ];
    for (const [what, allowed, offset] of named) {
      const from = centreWorld.clone().add(offset).add(new THREE.Vector3(0, 0, -1.5));
      const first = visibleHit(from, head);
      check(`${what} is the first thing seen at its own place on the face`,
        !!first && allowed.includes(first.object.name),
        first ? `${first.object.name || 'an unnamed mesh'} is in front of it` : 'the ray missed the head entirely');
    }
  }
}

// ---------------------------------------------------------------------------
// The name on the shirt winds the way the print texture assumes.
console.log('\nThe shirt print:');
{
  // `MIRROR_PRINT` in HeroFactory rests on one geometric fact: which way a
  // sweep's u runs as seen by somebody looking at the runner. Pin it here, so
  // that changing `sweep` fails a test instead of silently printing the
  // runner's name backwards.
  const ring: Ring[] = [0, 1].map((i) => ({
    c: new THREE.Vector3(0, i * 0.2, 0),
    u: new THREE.Vector3(0.2, 0, 0),
    v: new THREE.Vector3(0, 0, 0.2),
  }));
  const geo = sweep(ring, { radialSegments: 60 });
  const pos = geo.getAttribute('position');
  // Walk the first ring and find the vertices nearest the back (+Z) and the
  // chest (-Z), then read which way x moves as u increases.
  const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  let backI = 0, chestI = 0;
  for (let i = 0; i < 61; i++) {
    if (at(i).z > at(backI).z) backI = i;
    if (at(i).z < at(chestI).z) chestI = i;
  }
  const dxBack = at(backI + 1).x - at(backI).x;
  const dxChest = at(chestI + 1).x - at(chestI).x;
  // A viewer behind the runner has +X on their right; a viewer in front has
  // -X on their right. Both see u increasing to their left, so both prints
  // mirror — one flag, not one per side.
  check('u runs to the left of a viewer behind the runner', dxBack < 0, `dx ${dxBack.toFixed(4)}`);
  check('and to the left of a viewer in front as well', dxChest > 0, `dx ${dxChest.toFixed(4)}`);
}

// ---------------------------------------------------------------------------
console.log('\nWhat the permanent way costs:');
{
  // The track is laid under every metre of every run, so whatever it costs is
  // paid continuously and on every device. It was the most expensive thing in
  // the game by a wide margin -- 66.5k triangles to the 24 m module, 598k of
  // the 884k in view at 600 m -- and almost all of it was bevel on parts too
  // small to show one: a 2 cm radius on a sleeper and a 1.5 cm radius on a
  // 16 cm rail chair, both swept sixteen ways round, 304 of them per module.
  //
  // This budget is deliberately not a tight fit. It is here to catch a part
  // of the track quietly going back to a high-segment sweep, which is a change
  // that looks free in a screenshot and is not.
  const cost = (root: THREE.Object3D) => {
    let tris = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry as THREE.BufferGeometry;
      const idx = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
      const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      tris += (idx / 3) * inst;
    });
    return tris;
  };
  let worst = 0;
  let worstName = '';
  for (const variant of TRACK_VARIANTS) {
    const tris = cost(buildTrackModule(variant, 7));
    if (tris > worst) { worst = tris; worstName = variant; }
  }
  check('every track module stays inside its triangle budget', worst < 60000,
    `${worstName} costs ${(worst / 1000).toFixed(1)}k triangles`);
  console.log(`  dearest module: ${worstName} at ${(worst / 1000).toFixed(1)}k triangles`);

  // And the sleeper and the chair specifically, since they are the two that
  // are instanced hundreds of times and so the two that matter.
  const count = (g: THREE.BufferGeometry) =>
    (g.index ? g.index.count : g.attributes.position.count) / 3;
  check('a sleeper is cheap enough to lay 114 of per module', count(sleeperGeometry()) <= 96,
    `${count(sleeperGeometry())} triangles`);
  check('a rail chair is cheap enough to lay 228 of per module', count(fixingGeometry()) <= 24,
    `${count(fixingGeometry())} triangles`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
