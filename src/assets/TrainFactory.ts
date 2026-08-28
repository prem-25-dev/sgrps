import * as THREE from 'three';
import { CFG } from '../core/Config';
import { mergeGeometries, place, Ring, roundedBox, sweep } from './GeometryUtil';
import { material, MaterialId } from './MaterialLibrary';

/**
 * TRN_* metro rolling stock.
 *
 * Each unit is a modelled carriage: a swept body shell with a real cross
 * section, glazed windows with an interior behind them, plug doors that
 * animate, bogies with wheels, lights and a destination display. Trains are
 * the largest objects the player runs past, so they carry the most detail.
 */

export type TrainVariant =
  | 'TRN_Metro_A'
  | 'TRN_Metro_B'
  | 'TRN_Metro_C'
  | 'TRN_Freight_A'
  | 'TRN_Service_A'
  | 'TRN_Express_A';

export const TRAIN_VARIANTS: TrainVariant[] = [
  'TRN_Metro_A', 'TRN_Metro_B', 'TRN_Metro_C', 'TRN_Freight_A', 'TRN_Service_A', 'TRN_Express_A',
];

export interface TrainSpec {
  body: MaterialId;
  skirt: MaterialId;
  roof: MaterialId;
  accent: MaterialId;
  /** Overall carriage length in metres. */
  length: number;
  width: number;
  /** Height of the roof above the rail head. */
  height: number;
  /** Rounded corner radius of the body section. */
  corner: number;
  windows: boolean;
  doors: number;
  interior: boolean;
  cab: boolean;
  /** Roof clutter: air conditioning, pantograph, vents. */
  roofKit: 'ac' | 'pantograph' | 'vents' | 'none';
  label: string;
}

const SPECS: Record<TrainVariant, TrainSpec> = {
  TRN_Metro_A: {
    body: 'MAT_TrainBodyA', skirt: 'MAT_TrainSkirt', roof: 'MAT_TrainRoof', accent: 'MAT_NeonCyan',
    length: 21, width: 2.85, height: 3.15, corner: 0.42, windows: true, doors: 3,
    interior: true, cab: true, roofKit: 'ac', label: 'LINE 7  ·  CENTRAL',
  },
  TRN_Metro_B: {
    body: 'MAT_TrainBodyB', skirt: 'MAT_TrainSkirt', roof: 'MAT_TrainRoof', accent: 'MAT_NeonAmber',
    length: 19.5, width: 2.8, height: 3.1, corner: 0.36, windows: true, doors: 3,
    interior: true, cab: false, roofKit: 'ac', label: 'LINE 3  ·  RIVERSIDE',
  },
  TRN_Metro_C: {
    body: 'MAT_TrainBodyC', skirt: 'MAT_TrainSkirt', roof: 'MAT_TrainRoof', accent: 'MAT_NeonMagenta',
    length: 20, width: 2.82, height: 3.12, corner: 0.5, windows: true, doors: 2,
    interior: true, cab: true, roofKit: 'pantograph', label: 'LINE 9  ·  NORTH GATE',
  },
  TRN_Freight_A: {
    body: 'MAT_Corrugated', skirt: 'MAT_RustedMetal', roof: 'MAT_RustedMetal', accent: 'MAT_SafetyOrange',
    length: 17, width: 2.9, height: 3.05, corner: 0.12, windows: false, doors: 1,
    interior: false, cab: false, roofKit: 'none', label: 'FREIGHT',
  },
  TRN_Service_A: {
    body: 'MAT_SafetyYellow', skirt: 'MAT_PaintedMetalDark', roof: 'MAT_PaintedMetal', accent: 'MAT_HazardStripe',
    length: 14, width: 2.75, height: 2.95, corner: 0.3, windows: true, doors: 1,
    interior: false, cab: true, roofKit: 'vents', label: 'ENGINEERING',
  },
  TRN_Express_A: {
    body: 'MAT_BrushedAlu', skirt: 'MAT_TrainSkirt', roof: 'MAT_TrainRoof', accent: 'MAT_Neon',
    length: 23, width: 2.86, height: 3.18, corner: 0.6, windows: true, doors: 2,
    interior: true, cab: true, roofKit: 'pantograph', label: 'EXPRESS  ·  AIRPORT',
  },
};

export function trainSpec(variant: TrainVariant): TrainSpec {
  return SPECS[variant];
}

/** Body cross-section: tumblehome sides and a domed roof, swept along Z. */
function bodyShell(spec: TrainSpec, taperFront: boolean, taperRear: boolean): THREE.BufferGeometry {
  const halfW = spec.width / 2;
  const halfL = spec.length / 2;
  const floor = 0.85;
  const roof = spec.height;
  const midY = (floor + roof) / 2;
  const halfH = (roof - floor) / 2;

  // Superellipse gives the rounded-corner metro profile in one function.
  const n = 2 + (1 - Math.min(1, spec.corner / (halfW * 0.9))) * 8;
  const profile = (a: number) => {
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
  };

  const stations = [
    { z: -halfL, k: taperFront ? 0.62 : 0.985 },
    { z: -halfL + 0.5, k: taperFront ? 0.82 : 1 },
    { z: -halfL + 1.5, k: taperFront ? 0.96 : 1 },
    { z: -halfL + 3, k: 1 },
    { z: 0, k: 1 },
    { z: halfL - 3, k: 1 },
    { z: halfL - 1.5, k: taperRear ? 0.96 : 1 },
    { z: halfL - 0.5, k: taperRear ? 0.82 : 1 },
    { z: halfL, k: taperRear ? 0.62 : 0.985 },
  ];

  const rings: Ring[] = stations.map((s) => ({
    c: new THREE.Vector3(0, midY, s.z),
    u: new THREE.Vector3(halfW * s.k, 0, 0),
    v: new THREE.Vector3(0, halfH * (0.9 + 0.1 * s.k), 0),
    shape: profile,
  }));

  return sweep(rings, { radialSegments: 22, capStart: true, capEnd: true });
}

/** Underframe skirt and solebar. */
function underframe(spec: TrainSpec): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(place(roundedBox(spec.width - 0.12, 0.5, spec.length - 0.9, 0.08, 2), [0, 0.62, 0]));
  parts.push(place(new THREE.BoxGeometry(spec.width + 0.06, 0.12, spec.length - 1.4), [0, 0.9, 0]));
  return mergeGeometries(parts);
}

function bogie(): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(roundedBox(2.1, 0.34, 2.6, 0.06, 2), material('MAT_PaintedMetalDark'));
  frame.position.y = 0.55;
  g.add(frame);

  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.14, 14);
  const flangeGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.04, 14);
  for (const z of [-0.9, 0.9]) {
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.62, 8), material('MAT_StainlessSteel'));
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.42, z);
    g.add(axle);
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, material('MAT_RailSteel'));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.75, 0.42, z);
      g.add(wheel);
      const flange = new THREE.Mesh(flangeGeo, material('MAT_RailSteel'));
      flange.rotation.z = Math.PI / 2;
      flange.position.set(side * 0.83, 0.42, z);
      g.add(flange);
    }
  }
  // Suspension.
  for (const side of [-1, 1]) {
    for (const z of [-0.9, 0.9]) {
      const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.26, 8), material('MAT_PaintedMetal'));
      spring.position.set(side * 0.72, 0.78, z);
      g.add(spring);
    }
  }
  return g;
}

/** Window band with an interior visible behind the glass. */
function addWindows(group: THREE.Group, spec: TrainSpec): void {
  const halfL = spec.length / 2;
  const y = 2.05;
  const count = Math.max(4, Math.floor(spec.length / 2.6));
  const glass = material('MAT_GlassTinted');
  const frameMat = material('MAT_BrushedAlu');

  for (let i = 0; i < count; i++) {
    const z = -halfL + 1.6 + (i + 0.5) * ((spec.length - 3.2) / count);
    for (const side of [-1, 1]) {
      const frame = new THREE.Mesh(
        roundedBox(0.09, 0.96, 1.72, 0.05, 2),
        frameMat,
      );
      frame.position.set(side * (spec.width / 2 - 0.02), y, z);
      group.add(frame);

      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.82), glass);
      pane.position.set(side * (spec.width / 2 + 0.005), y, z);
      pane.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(pane);
    }
  }

  // Front and rear windscreens on cab units.
  if (spec.cab) {
    for (const end of [-1, 1]) {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), glass);
      screen.position.set(0, 2.25, end * (halfL - 0.16));
      screen.rotation.x = end > 0 ? 0.12 : -0.12;
      screen.rotation.y = end > 0 ? Math.PI : 0;
      group.add(screen);
    }
  }
}

/** Seats, grab poles and ceiling lighting, seen through the glazing. */
function addInterior(group: THREE.Group, spec: TrainSpec): void {
  const halfL = spec.length / 2;
  const floorY = 1.02;

  const floor = new THREE.Mesh(
    place(new THREE.BoxGeometry(spec.width - 0.3, 0.06, spec.length - 1.2), [0, floorY, 0]),
    material('MAT_Rubber'),
  );
  group.add(floor);

  const seatGeo = roundedBox(0.5, 0.44, 1.9, 0.07, 2);
  const seatMat = material('MAT_PlasticDark');
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, 12);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const side of [-1, 1]) {
    for (let n = 0; n < 6; n++) {
      const z = -halfL + 2.2 + n * ((spec.length - 4.4) / 5);
      m.makeTranslation(side * (spec.width / 2 - 0.5), floorY + 0.32, z);
      if (i < seats.count) seats.setMatrixAt(i++, m);
    }
  }
  seats.count = i;
  seats.instanceMatrix.needsUpdate = true;
  group.add(seats);

  // Grab poles.
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.35, 6);
  const poles = new THREE.InstancedMesh(poleGeo, material('MAT_StainlessSteel'), 8);
  i = 0;
  for (const side of [-1, 1]) {
    for (let n = 0; n < 4; n++) {
      const z = -halfL + 3 + n * ((spec.length - 6) / 3);
      m.makeTranslation(side * 0.75, floorY + 0.7, z);
      if (i < poles.count) poles.setMatrixAt(i++, m);
    }
  }
  poles.count = i;
  poles.instanceMatrix.needsUpdate = true;
  group.add(poles);

  // Ceiling strip lighting reads clearly through the windows at night.
  const strip = new THREE.Mesh(
    place(new THREE.BoxGeometry(0.9, 0.05, spec.length - 2.4), [0, spec.height - 0.28, 0]),
    material('MAT_NeonAmber'),
  );
  group.add(strip);
}

export interface TrainDoors {
  /** 0 = closed, 1 = fully open. */
  set(open: number): void;
}

/** Plug doors that slide into the body side. */
function addDoors(group: THREE.Group, spec: TrainSpec, skip = false): TrainDoors {
  const halfL = spec.length / 2;
  const leaves: Array<{ mesh: THREE.Mesh; closed: number; dir: number }> = [];
  const doorMat = material('MAT_PaintedMetalDark');

  // Scenery stock keeps the door openings painted on by the livery rather than
  // modelled: at the distance these are seen, four leaves a door is geometry
  // nobody can resolve.
  if (skip) return { set: () => {} };

  for (let d = 0; d < spec.doors; d++) {
    const z = -halfL + ((d + 1) * spec.length) / (spec.doors + 1);
    for (const side of [-1, 1]) {
      for (const leaf of [-1, 1]) {
        const mesh = new THREE.Mesh(roundedBox(0.1, 1.95, 0.72, 0.04, 2), doorMat);
        const closedZ = z + leaf * 0.37;
        mesh.position.set(side * (spec.width / 2 - 0.01), 1.98, closedZ);
        group.add(mesh);
        leaves.push({ mesh, closed: closedZ, dir: leaf });

        // Door glass.
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.0), material('MAT_GlassTinted'));
        pane.position.set(side * (spec.width / 2 + 0.01), 2.25, closedZ);
        pane.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        mesh.userData.pane = pane;
        group.add(pane);
      }
    }
  }

  return {
    set(open: number) {
      const travel = 0.66 * Math.min(1, Math.max(0, open));
      for (const leaf of leaves) {
        leaf.mesh.position.z = leaf.closed + leaf.dir * travel;
        const pane = leaf.mesh.userData.pane as THREE.Mesh | undefined;
        if (pane) pane.position.z = leaf.mesh.position.z;
      }
    },
  };
}

function addRoofKit(group: THREE.Group, spec: TrainSpec): void {
  const halfL = spec.length / 2;
  if (spec.roofKit === 'ac' || spec.roofKit === 'vents') {
    const unitGeo = roundedBox(1.5, 0.32, 2.2, 0.06, 2);
    const units = new THREE.InstancedMesh(unitGeo, material('MAT_PaintedMetal'), 3);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) {
      m.makeTranslation(0, spec.height + 0.14, -halfL + 3.5 + i * ((spec.length - 7) / 2));
      units.setMatrixAt(i, m);
    }
    units.instanceMatrix.needsUpdate = true;
    group.add(units);
  }
  if (spec.roofKit === 'pantograph') {
    const base = new THREE.Mesh(roundedBox(1.7, 0.16, 1.2, 0.04, 2), material('MAT_PaintedMetalDark'));
    base.position.set(0, spec.height + 0.08, 0);
    group.add(base);
    const armGeo = new THREE.BoxGeometry(0.07, 1.15, 0.07);
    for (const dir of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, material('MAT_StainlessSteel'));
      arm.position.set(0, spec.height + 0.68, dir * 0.32);
      arm.rotation.x = dir * 0.42;
      group.add(arm);
    }
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.16), material('MAT_Copper'));
    shoe.position.set(0, spec.height + 1.22, 0);
    group.add(shoe);
  }
  // Roof walkway strip, always present: this is the surface players run on.
  const walkway = new THREE.Mesh(
    place(new THREE.BoxGeometry(spec.width - 0.5, 0.04, spec.length - 1), [0, spec.height + 0.02, 0]),
    material('MAT_TrainRoof'),
  );
  group.add(walkway);
}

function addLightsAndLivery(group: THREE.Group, spec: TrainSpec): void {
  const halfL = spec.length / 2;
  const accent = material(spec.accent);

  // Livery stripe along the waist.
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(
      place(new THREE.BoxGeometry(0.03, 0.16, spec.length - 1.1), [side * (spec.width / 2 + 0.005), 1.42, 0]),
      accent,
    );
    group.add(stripe);
  }

  if (spec.cab) {
    for (const side of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), material('MAT_Headlight'));
      head.position.set(side * 0.92, 1.3, -halfL + 0.06);
      head.scale.z = 0.5;
      group.add(head);

      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), material('MAT_TailLight'));
      tail.position.set(side * 0.92, 1.3, halfL - 0.06);
      tail.scale.z = 0.5;
      group.add(tail);
    }
    // Destination display above the windscreen.
    const display = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.34), material('MAT_LedPanel'));
    display.position.set(0, 2.86, -halfL + 0.03);
    group.add(display);
  }

  // Couplers.
  for (const end of [-1, 1]) {
    const coupler = new THREE.Mesh(roundedBox(0.5, 0.34, 0.5, 0.06, 2), material('MAT_PaintedMetalDark'));
    coupler.position.set(0, 0.72, end * (halfL + 0.12));
    group.add(coupler);
  }
}

export interface Train {
  object: THREE.Group;
  spec: TrainSpec;
  doors: TrainDoors;
  /** Roof height in world units; the collider uses this as a standable top. */
  roofHeight: number;
  update(dt: number, time: number): void;
}

/**
 * Builds a full carriage. `role` shapes the ends: a lead unit gets a tapered
 * nose, a middle unit is flat both ends so consists join cleanly.
 */
export function buildTrain(
  variant: TrainVariant,
  role: 'lead' | 'middle' | 'tail' = 'lead',
  /**
   * `scenery` drops everything that cannot be read from the neighbouring line:
   * the interior, the working doors, the roof kit. What is left is the
   * silhouette, the windows and the livery — which is all a passing train is.
   */
  detail: 'full' | 'scenery' = 'full',
): Train {
  const spec = SPECS[variant];
  const group = new THREE.Group();
  group.name = `${variant}_${role}`;

  const taperFront = role === 'lead' && spec.cab;
  const taperRear = role === 'tail' && spec.cab;

  const shell = new THREE.Mesh(bodyShell(spec, taperFront, taperRear), material(spec.body));
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const frame = new THREE.Mesh(underframe(spec), material(spec.skirt));
  frame.castShadow = true;
  group.add(frame);

  for (const z of [-spec.length / 2 + 3.2, spec.length / 2 - 3.2]) {
    const b = bogie();
    b.position.z = z;
    group.add(b);
  }

  const scenery = detail === 'scenery';
  if (spec.interior && !scenery) addInterior(group, spec);
  if (spec.windows) addWindows(group, spec);
  const doors = addDoors(group, spec, scenery);
  if (!scenery) addRoofKit(group, spec);
  addLightsAndLivery(group, spec);

  let doorPhase = 0;
  let doorTarget = 0;

  return {
    object: group,
    spec,
    doors,
    roofHeight: spec.height + 0.04,
    update(dt: number, time: number) {
      // Stationary trains cycle their doors so stations feel alive.
      const cycle = (time * 0.14) % 1;
      doorTarget = cycle > 0.55 && cycle < 0.85 ? 1 : 0;
      doorPhase += (doorTarget - doorPhase) * Math.min(1, dt * 3.2);
      doors.set(doorPhase);
    },
  };
}

/** Standable roof height used by the collision system for rooftop routes. */
export const TRAIN_ROOF_HEIGHT = CFG.world.trainRoofHeight;
