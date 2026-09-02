import * as THREE from 'three';
import { ringXZ, sweep, Ring } from '../src/assets/GeometryUtil';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
