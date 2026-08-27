import * as THREE from 'three';
import { Random } from '../core/Random';
import { hash01, mergeByMaterial, place, roundedBox } from './GeometryUtil';
import { decal, material, MaterialId } from './MaterialLibrary';

/**
 * ENV_* city block generator.
 *
 * Buildings are assembled from massing rules rather than modelled one by one:
 * a footprint, a stack of setbacks, a facade treatment and a rooftop kit. Five
 * archetypes times seeded variation gives a skyline that never obviously
 * repeats, from a handful of shared materials.
 */

export type BuildingArchetype =
  | 'ENV_Apartment' | 'ENV_Office' | 'ENV_Shop' | 'ENV_Restaurant'
  | 'ENV_Warehouse' | 'ENV_Industrial' | 'ENV_Tower' | 'ENV_LowRise';

export const BUILDING_ARCHETYPES: BuildingArchetype[] = [
  'ENV_Apartment', 'ENV_Office', 'ENV_Shop', 'ENV_Restaurant',
  'ENV_Warehouse', 'ENV_Industrial', 'ENV_Tower', 'ENV_LowRise',
];

interface Massing {
  width: [number, number];
  depth: [number, number];
  floors: [number, number];
  floorHeight: number;
  setbacks: number;
  body: MaterialId[];
  facade: 'windowGrid' | 'curtainWall' | 'shopfront' | 'industrial';
  roof: 'plant' | 'tanks' | 'aerials' | 'flat' | 'saw';
  neonChance: number;
}

const MASSING: Record<BuildingArchetype, Massing> = {
  ENV_Apartment: {
    width: [10, 18], depth: [10, 16], floors: [5, 12], floorHeight: 3.0, setbacks: 1,
    body: ['MAT_Plaster', 'MAT_PaintedWall', 'MAT_Brick'], facade: 'windowGrid', roof: 'tanks', neonChance: 0.15,
  },
  ENV_Office: {
    width: [14, 24], depth: [12, 20], floors: [8, 18], floorHeight: 3.6, setbacks: 2,
    body: ['MAT_Concrete', 'MAT_PaintedWall'], facade: 'curtainWall', roof: 'plant', neonChance: 0.3,
  },
  ENV_Shop: {
    width: [8, 14], depth: [8, 12], floors: [2, 4], floorHeight: 3.2, setbacks: 0,
    body: ['MAT_PaintedWall', 'MAT_Brick', 'MAT_Plaster'], facade: 'shopfront', roof: 'aerials', neonChance: 0.75,
  },
  ENV_Restaurant: {
    width: [7, 12], depth: [8, 12], floors: [1, 3], floorHeight: 3.4, setbacks: 0,
    body: ['MAT_Brick', 'MAT_PaintedWall'], facade: 'shopfront', roof: 'aerials', neonChance: 0.9,
  },
  ENV_Warehouse: {
    width: [18, 30], depth: [16, 26], floors: [1, 2], floorHeight: 6.5, setbacks: 0,
    body: ['MAT_Corrugated', 'MAT_ConcreteDirty'], facade: 'industrial', roof: 'saw', neonChance: 0.05,
  },
  ENV_Industrial: {
    width: [14, 24], depth: [14, 22], floors: [2, 4], floorHeight: 4.8, setbacks: 0,
    body: ['MAT_ConcreteDirty', 'MAT_Corrugated', 'MAT_RustedMetal'], facade: 'industrial', roof: 'tanks', neonChance: 0.05,
  },
  ENV_Tower: {
    width: [12, 18], depth: [12, 18], floors: [20, 38], floorHeight: 3.5, setbacks: 3,
    body: ['MAT_Concrete', 'MAT_GlassTinted'], facade: 'curtainWall', roof: 'aerials', neonChance: 0.45,
  },
  ENV_LowRise: {
    width: [9, 15], depth: [9, 14], floors: [2, 5], floorHeight: 3.1, setbacks: 0,
    body: ['MAT_Brick', 'MAT_Plaster', 'MAT_PaintedWall'], facade: 'windowGrid', roof: 'flat', neonChance: 0.35,
  },
};

/** Adds a window grid as one instanced mesh per building. */
function addWindowGrid(
  g: THREE.Group,
  width: number,
  depth: number,
  baseY: number,
  height: number,
  floorHeight: number,
  rng: Random,
  litRatio: number,
): void {
  const cols = Math.max(2, Math.floor(width / 2.2));
  const rows = Math.max(1, Math.floor(height / floorHeight));
  const geo = new THREE.PlaneGeometry(1.2, 1.5);
  const total = cols * rows * 2 + Math.max(2, Math.floor(depth / 2.2)) * rows * 2;
  const lit = new THREE.InstancedMesh(geo, material('MAT_WindowLit'), total);
  const dark = new THREE.InstancedMesh(geo, material('MAT_GlassTinted'), total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  let litN = 0;
  let darkN = 0;

  const push = (x: number, y: number, z: number, yaw: number) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    p.set(x, y, z);
    m.compose(p, q, s);
    if (rng.bool(litRatio)) lit.setMatrixAt(litN++, m);
    else dark.setMatrixAt(darkN++, m);
  };

  for (let r = 0; r < rows; r++) {
    const y = baseY + floorHeight * (r + 0.55);
    for (let c = 0; c < cols; c++) {
      const x = -width / 2 + ((c + 0.5) * width) / cols;
      push(x, y, depth / 2 + 0.03, 0);
      push(x, y, -depth / 2 - 0.03, Math.PI);
    }
    const dCols = Math.max(2, Math.floor(depth / 2.2));
    for (let c = 0; c < dCols; c++) {
      const z = -depth / 2 + ((c + 0.5) * depth) / dCols;
      push(width / 2 + 0.03, y, z, Math.PI / 2);
      push(-width / 2 - 0.03, y, z, -Math.PI / 2);
    }
  }
  lit.count = litN;
  dark.count = darkN;
  lit.instanceMatrix.needsUpdate = true;
  dark.instanceMatrix.needsUpdate = true;
  if (litN > 0) g.add(lit);
  if (darkN > 0) g.add(dark);
}

/** Continuous glazing bands with mullions, for offices and towers. */
function addCurtainWall(
  g: THREE.Group,
  width: number,
  depth: number,
  baseY: number,
  height: number,
  floorHeight: number,
): void {
  const rows = Math.max(1, Math.floor(height / floorHeight));
  for (let r = 0; r < rows; r++) {
    const y = baseY + floorHeight * (r + 0.5);
    const band = new THREE.Mesh(
      place(new THREE.BoxGeometry(width + 0.06, floorHeight * 0.62, depth + 0.06), [0, y, 0]),
      material('MAT_WindowLit'),
    );
    g.add(band);
    const spandrel = new THREE.Mesh(
      place(new THREE.BoxGeometry(width + 0.1, floorHeight * 0.34, depth + 0.1), [0, y + floorHeight * 0.48, 0]),
      material('MAT_BrushedAlu'),
    );
    g.add(spandrel);
  }
  // Vertical mullions break up the glass.
  const cols = Math.max(3, Math.floor(width / 2.4));
  const mullion = new THREE.BoxGeometry(0.12, height, 0.12);
  const mullions = new THREE.InstancedMesh(mullion, material('MAT_BrushedAlu'), cols * 2);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let c = 0; c < cols; c++) {
    const x = -width / 2 + ((c + 0.5) * width) / cols;
    m.makeTranslation(x, baseY + height / 2, depth / 2 + 0.05);
    mullions.setMatrixAt(n++, m);
    m.makeTranslation(x, baseY + height / 2, -depth / 2 - 0.05);
    mullions.setMatrixAt(n++, m);
  }
  mullions.count = n;
  mullions.instanceMatrix.needsUpdate = true;
  g.add(mullions);
}

/** Ground-floor retail: glazing, signage and an awning. */
function addShopfront(g: THREE.Group, width: number, depth: number, rng: Random, neon: boolean): void {
  const glass = new THREE.Mesh(
    place(new THREE.BoxGeometry(width * 0.86, 2.6, 0.12), [0, 1.4, depth / 2 + 0.04]),
    material('MAT_Glass'),
  );
  g.add(glass);

  const fascia = new THREE.Mesh(
    place(new THREE.BoxGeometry(width * 0.94, 0.9, 0.22), [0, 3.35, depth / 2 + 0.06]),
    material(neon ? 'MAT_NeonMagenta' : 'MAT_PaintedMetalDark'),
  );
  g.add(fascia);

  const ad = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.5, 1.6), decal('DEC_Ad'));
  ad.position.set(-width * 0.2, 1.7, depth / 2 + 0.12);
  g.add(ad);

  if (rng.bool(0.6)) {
    const awning = new THREE.Mesh(
      place(roundedBox(width * 0.8, 0.1, 1.5, 0.05, 2), [0, 3.0, depth / 2 + 0.85]),
      material('MAT_SafetyOrange'),
    );
    awning.rotation.x = -0.16;
    g.add(awning);
  }

  if (neon) {
    // Vertical neon blade sign, the signature of the night district.
    const blade = new THREE.Mesh(
      place(roundedBox(0.5, 4.2, 0.16, 0.06, 2), [width * 0.42, 5.2, depth / 2 + 0.4]),
      material(rng.pick(['MAT_NeonCyan', 'MAT_NeonMagenta', 'MAT_NeonAmber'] as MaterialId[])),
    );
    g.add(blade);
  }
}

/** Industrial facade: roller shutters, vents and a loading dock. */
function addIndustrialFacade(g: THREE.Group, width: number, depth: number, height: number): void {
  const shutter = new THREE.Mesh(
    place(new THREE.BoxGeometry(width * 0.34, 4.2, 0.16), [0, 2.1, depth / 2 + 0.05]),
    material('MAT_Corrugated'),
  );
  g.add(shutter);
  const dock = new THREE.Mesh(
    place(new THREE.BoxGeometry(width * 0.4, 1.1, 1.6), [0, 0.55, depth / 2 + 0.9]),
    material('MAT_Concrete'),
  );
  g.add(dock);
  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(
      place(new THREE.BoxGeometry(1.4, 0.8, 0.14), [-width * 0.3 + i * width * 0.3, height * 0.72, depth / 2 + 0.04]),
      material('MAT_BrushedAlu'),
    );
    g.add(vent);
  }
  const rust = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.6, height * 0.5), decal('DEC_Rust'));
  rust.position.set(0, height * 0.4, depth / 2 + 0.14);
  g.add(rust);
}

function addRoofKit(
  g: THREE.Group,
  kind: Massing['roof'],
  width: number,
  depth: number,
  top: number,
  rng: Random,
): void {
  const parapet = new THREE.Mesh(
    place(new THREE.BoxGeometry(width + 0.3, 0.7, depth + 0.3), [0, top + 0.35, 0]),
    material('MAT_ConcreteDirty'),
  );
  g.add(parapet);
  const roofDeck = new THREE.Mesh(
    place(new THREE.BoxGeometry(width, 0.2, depth), [0, top + 0.1, 0]),
    material('MAT_ConcreteDirty'),
  );
  g.add(roofDeck);

  switch (kind) {
    case 'plant': {
      for (let i = 0; i < 3; i++) {
        const unit = new THREE.Mesh(
          roundedBox(rng.range(1.6, 3.2), rng.range(0.8, 1.6), rng.range(1.6, 2.8), 0.08, 2),
          material('MAT_BrushedAlu'),
        );
        unit.position.set(rng.range(-width * 0.3, width * 0.3), top + 0.9, rng.range(-depth * 0.3, depth * 0.3));
        g.add(unit);
      }
      const stair = new THREE.Mesh(roundedBox(2.2, 2.6, 2.2, 0.1, 2), material('MAT_ConcreteDirty'));
      stair.position.set(width * 0.26, top + 1.3, -depth * 0.26);
      g.add(stair);
      break;
    }
    case 'tanks': {
      for (let i = 0; i < 2; i++) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 12), material('MAT_StainlessSteel'));
        tank.position.set(rng.range(-width * 0.3, width * 0.3), top + 1.5, rng.range(-depth * 0.3, depth * 0.3));
        g.add(tank);
        const legs = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.6), material('MAT_RustedMetal'));
        legs.position.set(tank.position.x, top + 0.5, tank.position.z);
        g.add(legs);
      }
      break;
    }
    case 'aerials': {
      for (let i = 0; i < 4; i++) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, rng.range(2, 5.5), 6), material('MAT_StainlessSteel'));
        mast.position.set(rng.range(-width * 0.4, width * 0.4), top + mast.geometry.parameters.height / 2, rng.range(-depth * 0.4, depth * 0.4));
        g.add(mast);
      }
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), material('MAT_Plastic'));
      dish.position.set(width * 0.2, top + 1.0, depth * 0.2);
      dish.rotation.x = 0.7;
      g.add(dish);
      break;
    }
    case 'saw': {
      const bays = Math.max(2, Math.floor(depth / 5));
      for (let i = 0; i < bays; i++) {
        const z = -depth / 2 + ((i + 0.5) * depth) / bays;
        const slope = new THREE.Mesh(
          place(new THREE.BoxGeometry(width, 0.16, depth / bays * 0.95), [0, top + 1.1, z]),
          material('MAT_Corrugated'),
        );
        slope.rotation.x = 0.42;
        g.add(slope);
        const glazing = new THREE.Mesh(
          place(new THREE.BoxGeometry(width, 1.3, 0.14), [0, top + 0.9, z - depth / bays * 0.42]),
          material('MAT_GlassTinted'),
        );
        g.add(glazing);
      }
      break;
    }
    case 'flat':
      break;
  }

  // Water pipe and a rooftop hatch appear on everything.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.2, 8), material('MAT_RustedMetal'));
  pipe.position.set(-width * 0.36, top + 1.1, depth * 0.3);
  g.add(pipe);
}

export interface BuildingOptions {
  archetype: BuildingArchetype;
  seed: number;
  /** Multiplies the massing height, driven by the zone. */
  scale: number;
  /** 0..1: how many windows are lit and how much neon appears. */
  night: number;
}

/** Builds one building. Result is a self-contained group ready to pool. */
export function buildBuilding(opts: BuildingOptions): THREE.Group {
  const rng = new Random(opts.seed >>> 0 || 1);
  const spec = MASSING[opts.archetype];
  const g = new THREE.Group();
  g.name = opts.archetype;

  const width = rng.range(spec.width[0], spec.width[1]);
  const depth = rng.range(spec.depth[0], spec.depth[1]);
  const floors = Math.max(1, Math.round(rng.range(spec.floors[0], spec.floors[1]) * opts.scale));
  const bodyMat = material(rng.pick(spec.body));

  // Massing stack: each setback is a smaller box on top of the last.
  const tiers = spec.setbacks + 1;
  let y = 0;
  let w = width;
  let d = depth;
  const tops: Array<{ y: number; w: number; d: number }> = [];
  for (let t = 0; t < tiers; t++) {
    const tierFloors = Math.max(1, Math.round(floors / tiers));
    const h = tierFloors * spec.floorHeight;
    const box = new THREE.Mesh(place(new THREE.BoxGeometry(w, h, d), [0, y + h / 2, 0]), bodyMat);
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);

    if (spec.facade === 'windowGrid') {
      addWindowGrid(g, w, d, y, h, spec.floorHeight, rng, 0.15 + opts.night * 0.55);
    } else if (spec.facade === 'curtainWall') {
      addCurtainWall(g, w, d, y, h, spec.floorHeight);
    } else if (spec.facade === 'industrial' && t === 0) {
      addIndustrialFacade(g, w, d, h);
    }

    tops.push({ y: y + h, w, d });
    y += h;
    w *= rng.range(0.72, 0.86);
    d *= rng.range(0.72, 0.86);
  }

  if (spec.facade === 'shopfront') addShopfront(g, width, depth, rng, rng.bool(spec.neonChance * (0.4 + opts.night)));

  const last = tops[tops.length - 1];
  addRoofKit(g, spec.roof, last.w, last.d, last.y, rng);

  // Ground grime and a street-level ad on most buildings.
  if (rng.bool(0.6)) {
    const grime = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.7, 3), decal('DEC_Dirt'));
    grime.position.set(0, 1.5, depth / 2 + 0.08);
    g.add(grime);
  }

  g.userData.footprint = { width, depth, height: y };
  // Window grids stay instanced; the shell collapses to a few draws.
  return mergeByMaterial(g) as THREE.Group;
}

/** Picks an archetype appropriate to a zone. */
export function archetypeForZone(zone: string, rng: Random): BuildingArchetype {
  switch (zone) {
    case 'ZONE_CityEdge': return rng.pick(['ENV_LowRise', 'ENV_Apartment', 'ENV_Shop', 'ENV_LowRise']);
    case 'ZONE_Metro': return rng.pick(['ENV_Apartment', 'ENV_Office', 'ENV_Shop', 'ENV_LowRise']);
    case 'ZONE_Downtown': return rng.pick(['ENV_Tower', 'ENV_Office', 'ENV_Tower', 'ENV_Apartment']);
    case 'ZONE_Industrial': return rng.pick(['ENV_Warehouse', 'ENV_Industrial', 'ENV_Warehouse']);
    case 'ZONE_Elevated': return rng.pick(['ENV_Apartment', 'ENV_LowRise', 'ENV_Office']);
    case 'ZONE_Construction': return rng.pick(['ENV_Industrial', 'ENV_LowRise', 'ENV_Warehouse']);
    case 'ZONE_Neon': return rng.pick(['ENV_Shop', 'ENV_Restaurant', 'ENV_Tower', 'ENV_Shop']);
    default: return rng.pick(BUILDING_ARCHETYPES);
  }
}

/** Deterministic seed for a building at a given world slot. */
export function buildingSeed(zoneIndex: number, slot: number, side: number): number {
  return Math.floor(hash01(zoneIndex * 97 + slot * 13 + side * 7) * 0xffffff) + 1;
}
