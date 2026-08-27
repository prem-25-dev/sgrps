import * as THREE from 'three';
import { archetypeForZone, buildBuilding, buildingSeed } from '../assets/CityFactory';
import { buildProp, PROP_IDS, PROP_TAGS, PropId } from '../assets/PropFactory';
import { buildVegetation, VegetationId } from '../assets/VegetationFactory';
import { buildVehicle, VEHICLE_IDS, VehicleId } from '../assets/VehicleFactory';
import { TRACK_HALF_WIDTH } from '../assets/TrackFactory';
import { CFG } from '../core/Config';
import { KeyedPool } from '../core/ObjectPool';
import { Random } from '../core/Random';
import { ZoneDef } from '../core/Types';

/**
 * Scatters the world either side of the track.
 *
 * Everything here is cosmetic and lives outside the play space, so it can be
 * culled and swapped aggressively. Content is chosen by zone and placed with
 * a per-slot seed, which means the same stretch of track always looks the
 * same on a replay of the same seed.
 */

interface Placed {
  object: THREE.Object3D;
  key: string;
  kind: 'building' | 'prop' | 'vegetation' | 'vehicle';
  /** Absolute track Z. */
  z: number;
  /** Vehicles roll along the service road. */
  speed: number;
}

/** Distinct building looks per archetype. Bounds the building pool. */
const BUILDING_SEEDS = [10453, 28871, 51219, 77431];
/** Massing bands, so a zone's continuous scale does not create a new key. */
const SCALE_BANDS = [0.6, 0.9, 1.3];
/** Day and night lighting, likewise. */
const NIGHT_BANDS = [0.1, 0.8];
/** Distinct looks per planting and vehicle type. */
const VARIANTS_PER_PROP = 4;
const VARIANT_SEEDS = [733, 2141, 5387, 9091];

/** Nearest band index for a continuous value. */
function band(value: number, bands: number[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < bands.length; i++) {
    const d = Math.abs(bands[i] - value);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const PROPS_BY_TAG: Record<string, PropId[]> = {};
for (const id of PROP_IDS) {
  for (const tag of PROP_TAGS[id]) {
    (PROPS_BY_TAG[tag] ??= []).push(id);
  }
}

const ZONE_PROP_TAGS: Record<string, string[]> = {
  ZONE_CityEdge: ['street', 'rail'],
  ZONE_Metro: ['rail', 'street'],
  ZONE_Downtown: ['street', 'street', 'rail'],
  ZONE_Industrial: ['industrial', 'rail'],
  ZONE_Elevated: ['rail', 'street'],
  ZONE_Construction: ['construction', 'construction', 'rail'],
  ZONE_Neon: ['street', 'street', 'rail'],
};

const ZONE_VEGETATION: Record<string, VegetationId[]> = {
  ZONE_CityEdge: ['VEG_Tree', 'VEG_Shrub', 'VEG_GrassPatch', 'VEG_Hedge', 'VEG_Sapling'],
  ZONE_Metro: ['VEG_Planter', 'VEG_Shrub', 'VEG_Sapling'],
  ZONE_Downtown: ['VEG_Planter', 'VEG_Palm'],
  ZONE_Industrial: ['VEG_Shrub', 'VEG_GrassPatch'],
  ZONE_Elevated: ['VEG_Palm', 'VEG_Tree'],
  ZONE_Construction: ['VEG_GrassPatch'],
  ZONE_Neon: ['VEG_Planter', 'VEG_Palm', 'VEG_Vine'],
};

export class DecorScatter {
  readonly root = new THREE.Group();
  private placed: Placed[] = [];

  /**
   * Pool keys must come from a small fixed set.
   *
   * These keys originally embedded a per-instance seed, so every building was
   * its own key: nothing was ever reused and the pool grew without bound —
   * measured at 1,236 retained building meshes after 17 km. Scale and night
   * are now quantised into bands and the seed into a handful of variants, so
   * the whole decor layer converges on a fixed working set.
   */
  private buildings = new KeyedPool<THREE.Object3D>(
    (key) => {
      const [archetype, variant, scaleBand, nightBand] = key.split('|');
      return buildBuilding({
        archetype: archetype as never,
        seed: BUILDING_SEEDS[Number(variant)],
        scale: SCALE_BANDS[Number(scaleBand)],
        night: NIGHT_BANDS[Number(nightBand)],
      });
    },
    (o) => { o.visible = true; },
    (o) => { o.visible = false; o.parent?.remove(o); },
  );

  private props = new KeyedPool<THREE.Object3D>(
    (key) => buildProp(key as PropId),
    (o) => { o.visible = true; },
    (o) => { o.visible = false; o.parent?.remove(o); },
  );

  private vegetation = new KeyedPool<THREE.Object3D>(
    (key) => {
      const [id, variant] = key.split('|');
      return buildVegetation(id as VegetationId, VARIANT_SEEDS[Number(variant)]);
    },
    (o) => { o.visible = true; },
    (o) => { o.visible = false; o.parent?.remove(o); },
  );

  private vehicles = new KeyedPool<THREE.Object3D>(
    (key) => {
      const [id, variant] = key.split('|');
      return buildVehicle(id as VehicleId, VARIANT_SEEDS[Number(variant)]);
    },
    (o) => { o.visible = true; },
    (o) => { o.visible = false; o.parent?.remove(o); },
  );

  constructor() {
    this.root.name = 'ENV_Decor';
  }

  /**
   * Populates one segment's worth of scenery. `density` scales everything so
   * the quality setting can thin the world out without changing gameplay.
   */
  populate(startZ: number, length: number, zone: ZoneDef, zoneIndex: number, slot: number, density: number): void {
    const rng = new Random((Math.floor(startZ) * 2654435761) >>> 0 || 1);
    const night = zone.neon;

    for (const side of [-1, 1]) {
      // --- Buildings: one plot per segment per side, set back from the track.
      if (rng.bool(0.85 * density)) {
        const archetype = archetypeForZone(zone.id, rng);
        const variant = Math.abs(buildingSeed(zoneIndex, slot, side)) % BUILDING_SEEDS.length;
        const key = `${archetype}|${variant}|${band(zone.buildingScale, SCALE_BANDS)}|${band(night, NIGHT_BANDS)}`;
        const object = this.buildings.acquire(key);
        const footprint = (object.userData.footprint as { width: number; depth: number } | undefined) ?? { width: 14, depth: 14 };
        const z = startZ + rng.range(2, length - 2);
        object.position.set(
          side * (TRACK_HALF_WIDTH + 10 + footprint.width / 2 + rng.range(0, 8)),
          0,
          z - startZ,
        );
        object.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.root.add(object);
        this.placed.push({ object, key, kind: 'building', z, speed: 0 });
      }

      // --- Lineside props.
      const tags = ZONE_PROP_TAGS[zone.id] ?? ['street'];
      const propCount = Math.round(rng.range(1, 3) * zone.propDensity * density);
      for (let i = 0; i < propCount; i++) {
        const tag = rng.pick(tags);
        const pool = PROPS_BY_TAG[tag] ?? PROP_IDS;
        const id = rng.pick(pool);
        const object = this.props.acquire(id);
        const z = startZ + rng.range(0, length);
        const railSide = tag === 'rail';
        object.position.set(
          side * (railSide ? TRACK_HALF_WIDTH + rng.range(1.2, 3.2) : TRACK_HALF_WIDTH + rng.range(5, 14)),
          0,
          z - startZ,
        );
        object.rotation.y = side > 0 ? Math.PI * 0.5 + rng.range(-0.2, 0.2) : -Math.PI * 0.5 + rng.range(-0.2, 0.2);
        const s = rng.range(0.92, 1.1);
        object.scale.setScalar(s);
        this.root.add(object);
        this.placed.push({ object, key: id, kind: 'prop', z, speed: 0 });
      }

      // --- Planting.
      const vegCount = Math.round(rng.range(0, 3) * zone.vegetationDensity * density);
      const vegPool = ZONE_VEGETATION[zone.id] ?? ['VEG_Shrub'];
      for (let i = 0; i < vegCount; i++) {
        const id = rng.pick(vegPool);
        const key = `${id}|${rng.int(0, VARIANTS_PER_PROP)}`;
        const object = this.vegetation.acquire(key);
        const z = startZ + rng.range(0, length);
        object.position.set(side * (TRACK_HALF_WIDTH + rng.range(4, 16)), 0, z - startZ);
        object.rotation.y = rng.range(0, Math.PI * 2);
        object.scale.setScalar(rng.range(0.85, 1.25));
        this.root.add(object);
        this.placed.push({ object, key, kind: 'vegetation', z, speed: 0 });
      }

      // --- Background traffic on the service road.
      if (rng.bool(0.32 * density * (zone.id === 'ZONE_Industrial' || zone.id === 'ZONE_Construction' ? 1.4 : 1))) {
        const id = rng.pick(VEHICLE_IDS);
        const key = `${id}|${rng.int(0, VARIANTS_PER_PROP)}`;
        const object = this.vehicles.acquire(key);
        const z = startZ + rng.range(0, length);
        object.position.set(side * (TRACK_HALF_WIDTH + rng.range(6.5, 9)), 0, z - startZ);
        // Traffic runs parallel to the track, in either direction.
        const towards = rng.bool();
        object.rotation.y = towards ? Math.PI : 0;
        this.root.add(object);
        this.placed.push({ object, key, kind: 'vehicle', z, speed: towards ? rng.range(-9, -4) : rng.range(4, 11) });
      }
    }
  }

  /** Repositions everything relative to the player and recycles what is past. */
  update(dt: number, distance: number): void {
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i];
      if (p.speed !== 0) p.z += p.speed * dt;
      const relZ = p.z - distance;
      if (relZ < -CFG.recycleDistance - 40 || relZ > CFG.viewDistance + 120) {
        this.recycle(i);
        continue;
      }
      p.object.position.z = relZ;
      p.object.visible = relZ < CFG.viewDistance + 60;
    }
  }

  private recycle(index: number): void {
    const p = this.placed[index];
    switch (p.kind) {
      case 'building': this.buildings.release(p.key, p.object); break;
      case 'prop': this.props.release(p.key, p.object); break;
      case 'vegetation': this.vegetation.release(p.key, p.object); break;
      case 'vehicle': this.vehicles.release(p.key, p.object); break;
    }
    this.placed.splice(index, 1);
  }

  clear(): void {
    for (let i = this.placed.length - 1; i >= 0; i--) this.recycle(i);
  }

  get stats(): { placed: number; buildings: number; props: number } {
    return {
      placed: this.placed.length,
      buildings: this.buildings.totals.live,
      props: this.props.totals.live,
    };
  }
}
