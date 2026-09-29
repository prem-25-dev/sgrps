import * as THREE from 'three';
import { archetypeForZone, buildBuilding, buildingSeed, residentialArchetypeForZone } from '../assets/CityFactory';
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

/**
 * Which side of the line the houses are on.
 *
 * `laneToX` maps an increasing lane index to a decreasing world X, because
 * the camera looks along +Z and screen-right is therefore world -X. So the
 * side the player sees on their **left** is world **+X**, and that is the
 * side the street of houses belongs on. Getting this backwards puts the
 * houses where nobody asked for them and is invisible in any test that only
 * counts objects, so it is written down here rather than inferred at the
 * call site.
 */
const RESIDENTIAL_SIDE = 1;

/**
 * The lateral bands the world is built in, measured from the centre line.
 *
 * Everything cosmetic has to dodge two things: the running corridor itself,
 * and the neighbouring running lines at ±(TRACK_HALF_WIDTH + 5.4) where the
 * ambient trains pass. That second one is the trap — the distance that looks
 * comfortable for an avenue is almost exactly where the live lines are, and
 * anything planted there gets driven through several times a minute. The
 * bands below are disjoint by construction, and every placement reads its
 * offsets from here rather than from a number typed at the call site.
 */
const BAND = {
  /** Cess: signals, relay boxes, lamps. */
  railProps: [1.2, 3.2] as const,
  /** Clear of the neighbouring running lines, which sit at +5.4 ± 1.7. */
  avenue: [7.4, 9.6] as const,
  /** Service road: traffic and street furniture. */
  road: [10.2, 13.6] as const,
  /** Gardens and background planting. */
  gardens: [12.8, 19.0] as const,
} as const;

/** Spacing of the roadside trees, in metres of track. */
const AVENUE_SPACING = 8.5;

const ZONE_VEGETATION: Record<string, VegetationId[]> = {
  ZONE_CityEdge: ['VEG_Tree', 'VEG_Shrub', 'VEG_GrassPatch', 'VEG_Hedge', 'VEG_Sapling'],
  ZONE_Metro: ['VEG_Planter', 'VEG_Shrub', 'VEG_Sapling'],
  ZONE_Downtown: ['VEG_Planter', 'VEG_Palm'],
  ZONE_Industrial: ['VEG_Shrub', 'VEG_GrassPatch'],
  ZONE_Elevated: ['VEG_Palm', 'VEG_Tree'],
  ZONE_Construction: ['VEG_GrassPatch'],
  ZONE_Neon: ['VEG_Planter', 'VEG_Palm', 'VEG_Vine'],
};

/**
 * The roadside avenue: what is planted along the line, and how completely.
 *
 * This is deliberately separate from the scatter above. Scattered planting is
 * a probability per segment, so a zone with low vegetation density shows the
 * player nothing at all for hundreds of metres — and a runner with nothing
 * passing close by has no sense of speed, which is the one thing the scenery
 * is there to give them. The avenue is a rhythm instead of a dice roll: a
 * tree every few metres, thinned by zone rather than switched off.
 */
const ZONE_AVENUE: Record<string, { species: VegetationId[]; fill: number }> = {
  ZONE_CityEdge: { species: ['VEG_Tree', 'VEG_Tree', 'VEG_Sapling'], fill: 0.95 },
  ZONE_Metro: { species: ['VEG_Tree', 'VEG_Sapling'], fill: 0.8 },
  ZONE_Downtown: { species: ['VEG_Palm', 'VEG_Tree'], fill: 0.7 },
  ZONE_Industrial: { species: ['VEG_Tree', 'VEG_Shrub'], fill: 0.45 },
  ZONE_Elevated: { species: ['VEG_Tree', 'VEG_Palm'], fill: 0.75 },
  ZONE_Construction: { species: ['VEG_Tree', 'VEG_Shrub'], fill: 0.4 },
  ZONE_Neon: { species: ['VEG_Palm', 'VEG_Palm', 'VEG_Tree'], fill: 0.8 },
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

    // --- The avenue: a rhythm of trees close enough to read as speed.
    this.plantAvenue(startZ, length, zone, density);

    for (const side of [-1, 1]) {
      const residential = side === RESIDENTIAL_SIDE;

      // --- Buildings: one plot per segment per side, set back from the track.
      //
      // The residential side gets houses, and gets them closer: a house is a
      // third the size of an office block, and at the setback the commercial
      // side needs it would be a smudge on the horizon rather than somewhere
      // a person lives. The setback is measured off the footprint's *depth*,
      // because the plot is rotated a quarter turn to face the line.
      if (rng.bool((residential ? 0.95 : 0.85) * density)) {
        const archetype = residential
          ? residentialArchetypeForZone(zone.id, rng)
          : archetypeForZone(zone.id, rng);
        const variant = Math.abs(buildingSeed(zoneIndex, slot, side)) % BUILDING_SEEDS.length;
        const key = `${archetype}|${variant}|${band(zone.buildingScale, SCALE_BANDS)}|${band(night, NIGHT_BANDS)}`;
        const object = this.buildings.acquire(key);
        const footprint = (object.userData.footprint as { width: number; depth: number } | undefined) ?? { width: 14, depth: 14 };
        const z = startZ + rng.range(2, length - 2);
        // Garden walls stand 2.6 m in front of a house, so the plot line has
        // to clear the gardens band by that much or the wall ends up in the
        // road.
        const setback = residential
          ? TRACK_HALF_WIDTH + BAND.gardens[0] + 2.6 + footprint.depth / 2 + rng.range(0, 2.4)
          : TRACK_HALF_WIDTH + BAND.gardens[0] + 3 + footprint.width / 2 + rng.range(0, 8);
        object.position.set(side * setback, 0, z - startZ);
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
        const spread = railSide ? BAND.railProps : BAND.road;
        object.position.set(
          side * (TRACK_HALF_WIDTH + rng.range(spread[0], spread[1])),
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
        object.position.set(side * (TRACK_HALF_WIDTH + rng.range(BAND.gardens[0], BAND.gardens[1])), 0, z - startZ);
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
        object.position.set(side * (TRACK_HALF_WIDTH + rng.range(BAND.road[0], BAND.road[0] + 1.8)), 0, z - startZ);
        // Traffic runs parallel to the track, in either direction.
        const towards = rng.bool();
        object.rotation.y = towards ? Math.PI : 0;
        this.root.add(object);
        this.placed.push({ object, key, kind: 'vehicle', z, speed: towards ? rng.range(-9, -4) : rng.range(4, 11) });
      }
    }
  }

  /**
   * Plants the roadside avenue for one segment.
   *
   * Trees are placed on a fixed grid of track Z rather than at random, so the
   * spacing is even and the line of them sweeps past at a steady beat — the
   * cue that tells a player how fast they are actually going. The grid is
   * absolute, not per segment, so the rhythm carries across segment joins
   * instead of restarting at every boundary. A gap is left here and there, and
   * the two sides are offset half a spacing apart, so it reads as planting
   * rather than as fence posts.
   */
  private plantAvenue(startZ: number, length: number, zone: ZoneDef, density: number): void {
    const avenue = ZONE_AVENUE[zone.id];
    if (!avenue) return;
    // Thinning the avenue is how the low quality profile pays for itself
    // here, but it never empties: a corridor with nothing passing close by
    // looks like a treadmill at any speed.
    const fill = Math.min(1, avenue.fill * (0.55 + 0.45 * density));

    for (const side of [-1, 1]) {
      const offset = side > 0 ? 0 : AVENUE_SPACING / 2;
      const first = Math.ceil((startZ - offset) / AVENUE_SPACING);
      const last = Math.floor((startZ + length - offset) / AVENUE_SPACING);
      for (let i = first; i <= last; i++) {
        const z = i * AVENUE_SPACING + offset;
        // Hash the slot so the same tree stands in the same place on a replay
        // of the same seed, independent of how the segment was cut.
        const slotRng = new Random(((i * 2246822519) ^ (side > 0 ? 0x9e3779b9 : 0x85ebca6b)) >>> 0 || 1);
        if (!slotRng.bool(fill)) continue;
        const id = slotRng.pick(avenue.species);
        const key = `${id}|${slotRng.int(0, VARIANTS_PER_PROP)}`;
        const object = this.vegetation.acquire(key);
        object.position.set(
          side * (TRACK_HALF_WIDTH + slotRng.range(BAND.avenue[0], BAND.avenue[1])),
          0,
          z - startZ,
        );
        object.rotation.y = slotRng.range(0, Math.PI * 2);
        object.scale.setScalar(slotRng.range(0.9, 1.45));
        this.root.add(object);
        this.placed.push({ object, key, kind: 'vegetation', z, speed: 0 });
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
