import * as THREE from 'three';
import { mergeByMaterial, place, Ring, roundedBox, sweep } from './GeometryUtil';
import { material, MaterialId } from './MaterialLibrary';

/**
 * VEH_* background traffic. These are seen from a distance and in motion, so
 * they are built for silhouette and light rather than panel detail — but they
 * are still modelled bodies with glazing, wheels and lamps, never boxes.
 */

export type VehicleId =
  | 'VEH_Car' | 'VEH_Hatchback' | 'VEH_Bus' | 'VEH_Motorcycle'
  | 'VEH_AutoRickshaw' | 'VEH_Van' | 'VEH_Truck' | 'VEH_ServiceTruck';

export const VEHICLE_IDS: VehicleId[] = [
  'VEH_Car', 'VEH_Hatchback', 'VEH_Bus', 'VEH_Motorcycle',
  'VEH_AutoRickshaw', 'VEH_Van', 'VEH_Truck', 'VEH_ServiceTruck',
];

const PAINT: MaterialId[] = [
  'MAT_PaintedMetal', 'MAT_TrainBodyB', 'MAT_TrainBodyC', 'MAT_SafetyYellow',
  'MAT_SafetyOrange', 'MAT_BrushedAlu', 'MAT_PaintedMetalDark',
];

function wheels(positions: Array<[number, number, number]>, radius: number, width: number): THREE.Object3D {
  const g = new THREE.Group();
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 12);
  const rim = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.05, 10);
  for (const [x, y, z] of positions) {
    const t = new THREE.Mesh(tyre, material('MAT_Rubber'));
    t.rotation.z = Math.PI / 2;
    t.position.set(x, y, z);
    g.add(t);
    const r = new THREE.Mesh(rim, material('MAT_BrushedAlu'));
    r.rotation.z = Math.PI / 2;
    r.position.set(x, y, z);
    g.add(r);
  }
  return g;
}

/** Car body built as a swept profile so it has a real shoulder line. */
function carBody(length: number, width: number, roofHeight: number, cabinStart: number, cabinEnd: number): THREE.BufferGeometry {
  const profile = (a: number) => {
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    return Math.pow(Math.pow(c, 3.2) + Math.pow(s, 3.2), -1 / 3.2);
  };
  const half = length / 2;
  const stations = [
    { z: -half, w: 0.72, h: 0.42, y: 0.62 },
    { z: -half * 0.82, w: 0.94, h: 0.52, y: 0.66 },
    { z: cabinStart, w: 1.0, h: 0.6, y: 0.7 },
    { z: (cabinStart + cabinEnd) / 2, w: 1.0, h: roofHeight, y: 0.78 },
    { z: cabinEnd, w: 1.0, h: 0.62, y: 0.7 },
    { z: half * 0.82, w: 0.95, h: 0.54, y: 0.66 },
    { z: half, w: 0.76, h: 0.44, y: 0.62 },
  ];
  const rings: Ring[] = stations.map((s) => ({
    c: new THREE.Vector3(0, s.y, s.z),
    u: new THREE.Vector3((width / 2) * s.w, 0, 0),
    v: new THREE.Vector3(0, s.h, 0),
    shape: profile,
  }));
  return sweep(rings, { radialSegments: 14, capStart: true, capEnd: true });
}

export function buildVehicle(id: VehicleId, seed = 1): THREE.Group {
  const g = new THREE.Group();
  g.name = id;
  const paint = material(PAINT[Math.abs(Math.floor(seed)) % PAINT.length]);

  switch (id) {
    case 'VEH_Car':
    case 'VEH_Hatchback': {
      const length = id === 'VEH_Car' ? 4.4 : 3.8;
      const body = new THREE.Mesh(carBody(length, 1.82, id === 'VEH_Car' ? 0.72 : 0.8, -0.3, 1.2), paint);
      body.castShadow = true;
      g.add(body);
      const glass = new THREE.Mesh(
        place(roundedBox(1.7, 0.55, id === 'VEH_Car' ? 1.5 : 1.3, 0.12, 2), [0, 1.32, 0.45]),
        material('MAT_GlassTinted'),
      );
      g.add(glass);
      g.add(wheels([
        [-0.82, 0.33, -length * 0.31], [0.82, 0.33, -length * 0.31],
        [-0.82, 0.33, length * 0.31], [0.82, 0.33, length * 0.31],
      ], 0.33, 0.22));
      for (const side of [-1, 1]) {
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), material('MAT_Headlight'));
        head.position.set(side * 0.6, 0.72, -length / 2 + 0.06);
        head.scale.set(1.5, 0.7, 0.5);
        g.add(head);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.06), material('MAT_TailLight'));
        tail.position.set(side * 0.62, 0.78, length / 2 - 0.03);
        g.add(tail);
      }
      break;
    }
    case 'VEH_Bus': {
      const body = new THREE.Mesh(roundedBox(2.55, 2.9, 11, 0.35, 3), paint);
      body.position.y = 1.85;
      body.castShadow = true;
      g.add(body);
      // Window band down both sides plus a windscreen.
      for (const side of [-1, 1]) {
        const band = new THREE.Mesh(
          place(new THREE.BoxGeometry(0.06, 1.0, 9.4), [side * 1.28, 2.35, 0.2]),
          material('MAT_GlassTinted'),
        );
        g.add(band);
      }
      const screen = new THREE.Mesh(place(new THREE.BoxGeometry(2.2, 1.2, 0.08), [0, 2.4, -5.48]), material('MAT_GlassTinted'));
      g.add(screen);
      const destination = new THREE.Mesh(place(new THREE.PlaneGeometry(1.9, 0.3), [0, 3.1, -5.52]), material('MAT_LedPanel'));
      g.add(destination);
      g.add(wheels([
        [-1.1, 0.5, -3.6], [1.1, 0.5, -3.6],
        [-1.1, 0.5, 3.2], [1.1, 0.5, 3.2],
      ], 0.5, 0.3));
      break;
    }
    case 'VEH_Motorcycle': {
      const tank = new THREE.Mesh(roundedBox(0.42, 0.4, 1.0, 0.14, 2), paint);
      tank.position.set(0, 0.82, -0.1);
      g.add(tank);
      const seat = new THREE.Mesh(roundedBox(0.34, 0.16, 0.8, 0.07, 2), material('MAT_PlasticDark'));
      seat.position.set(0, 0.86, 0.6);
      g.add(seat);
      const forks = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 6), material('MAT_Chrome'));
      forks.position.set(0, 0.7, -0.72);
      forks.rotation.x = 0.35;
      g.add(forks);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), material('MAT_Chrome'));
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 1.05, -0.85);
      g.add(bar);
      g.add(wheels([[0, 0.33, -0.95], [0, 0.33, 0.85]], 0.33, 0.12));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), material('MAT_Headlight'));
      head.position.set(0, 0.94, -1.02);
      g.add(head);
      break;
    }
    case 'VEH_AutoRickshaw': {
      const cabin = new THREE.Mesh(roundedBox(1.35, 1.5, 2.4, 0.3, 3), material('MAT_SafetyYellow'));
      cabin.position.y = 1.0;
      g.add(cabin);
      const canopy = new THREE.Mesh(roundedBox(1.4, 0.16, 2.0, 0.08, 2), material('MAT_PaintedMetalDark'));
      canopy.position.y = 1.78;
      g.add(canopy);
      const screen = new THREE.Mesh(place(new THREE.BoxGeometry(1.0, 0.7, 0.06), [0, 1.25, -1.2]), material('MAT_Glass'));
      g.add(screen);
      g.add(wheels([[0, 0.3, -1.0], [-0.62, 0.3, 0.85], [0.62, 0.3, 0.85]], 0.3, 0.16));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), material('MAT_Headlight'));
      head.position.set(0, 0.9, -1.24);
      g.add(head);
      break;
    }
    case 'VEH_Van': {
      const body = new THREE.Mesh(roundedBox(2.05, 2.2, 5.4, 0.3, 3), paint);
      body.position.y = 1.35;
      body.castShadow = true;
      g.add(body);
      const screen = new THREE.Mesh(place(new THREE.BoxGeometry(1.7, 0.85, 0.08), [0, 1.85, -2.66]), material('MAT_GlassTinted'));
      g.add(screen);
      g.add(wheels([
        [-0.9, 0.38, -1.7], [0.9, 0.38, -1.7],
        [-0.9, 0.38, 1.8], [0.9, 0.38, 1.8],
      ], 0.38, 0.24));
      break;
    }
    case 'VEH_Truck':
    case 'VEH_ServiceTruck': {
      const cab = new THREE.Mesh(roundedBox(2.4, 2.4, 2.4, 0.24, 3), paint);
      cab.position.set(0, 1.7, -2.8);
      cab.castShadow = true;
      g.add(cab);
      const screen = new THREE.Mesh(place(new THREE.BoxGeometry(2.0, 0.9, 0.08), [0, 2.2, -3.98]), material('MAT_GlassTinted'));
      g.add(screen);
      const bed = new THREE.Mesh(
        roundedBox(2.5, id === 'VEH_Truck' ? 2.6 : 1.2, 6.0, 0.12, 2),
        material(id === 'VEH_Truck' ? 'MAT_Corrugated' : 'MAT_SafetyOrange'),
      );
      bed.position.set(0, id === 'VEH_Truck' ? 2.0 : 1.3, 1.4);
      bed.castShadow = true;
      g.add(bed);
      if (id === 'VEH_ServiceTruck') {
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 10), material('MAT_NeonAmber'));
        beacon.position.set(0, 3.0, -2.8);
        g.add(beacon);
      }
      g.add(wheels([
        [-1.05, 0.52, -2.6], [1.05, 0.52, -2.6],
        [-1.05, 0.52, 1.4], [1.05, 0.52, 1.4],
        [-1.05, 0.52, 2.7], [1.05, 0.52, 2.7],
      ], 0.52, 0.3));
      break;
    }
  }

  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.receiveShadow = true;
  });
  return mergeByMaterial(g) as THREE.Group;
}
