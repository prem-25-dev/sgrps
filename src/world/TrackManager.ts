import * as THREE from 'three';
import { buildTrackModule, TrackVariant } from '../assets/TrackFactory';
import { buildStation } from '../assets/StationFactory';
import { CFG } from '../core/Config';
import { ActiveObstacle, CollisionSystem } from '../core/CollisionSystem';
import { KeyedPool } from '../core/ObjectPool';
import { Random } from '../core/Random';
import { ZoneDef } from '../core/Types';
import { zoneAt } from '../../data/difficulty/zones';
import { buildObstacleMesh, obstacleDef } from '../obstacles/ObstacleFactory';
import { Train } from '../assets/TrainFactory';
import { PlannedSegment, ProceduralGenerator } from '../procedural/ProceduralGenerator';
import { CollectibleManager } from '../collectibles/CollectibleManager';
import { PowerUpManager } from '../powerups/PowerUpManager';
import { DecorScatter } from './DecorScatter';

/**
 * Streams the world.
 *
 * The player never moves in Z; instead every resident object is positioned at
 * `absoluteZ - distance` each frame. That keeps floating point precision
 * identical at 10 m and at 100 km, and makes recycling a simple range test.
 */

interface ResidentModule {
  group: THREE.Group;
  variant: TrackVariant;
  startZ: number;
}

interface ResidentSegment {
  plan: PlannedSegment;
  obstacles: ActiveObstacle[];
  /** A station and the pool key it must go back to, or neither. */
  station: { group: THREE.Group; key: string } | null;
}

const STATION_EVERY = 7;
const STATION_VARIANTS = 8;

export class TrackManager {
  readonly root = new THREE.Group();
  readonly decor = new DecorScatter();

  private modules: ResidentModule[] = [];
  private segments: ResidentSegment[] = [];
  private activeObstacles: ActiveObstacle[] = [];
  private trains: Train[] = [];

  private modulePool = new KeyedPool<THREE.Group>(
    (key) => {
      const [variant, seed] = key.split('|');
      return buildTrackModule(variant as TrackVariant, Number(seed));
    },
    (g) => { g.visible = true; },
    (g) => { g.visible = false; g.parent?.remove(g); },
  );

  private obstaclePool = new KeyedPool<THREE.Group>(
    (key) => {
      const [id, seed] = key.split('|');
      return buildObstacleMesh(obstacleDef(id), Number(seed));
    },
    (g) => { g.visible = true; },
    (g) => { g.visible = false; g.parent?.remove(g); },
  );

  private stationPool = new KeyedPool<THREE.Group>(
    (key) => buildStation(Number(key)),
    (g) => { g.visible = true; },
    (g) => { g.visible = false; g.parent?.remove(g); },
  );

  private rng = new Random(1);
  private moduleFrontier = 0;
  private segmentCount = 0;
  private time = 0;
  private decorDensity = 1;

  constructor(
    private readonly generator: ProceduralGenerator,
    private readonly collision: CollisionSystem,
    private readonly coins: CollectibleManager,
    private readonly powerUps: PowerUpManager,
  ) {
    this.root.name = 'TRK_World';
    this.root.add(this.decor.root);
  }

  setDecorDensity(density: number): void {
    this.decorDensity = density;
  }

  reset(seed: number): void {
    for (const m of this.modules) this.modulePool.release(`${m.variant}|${moduleSeed(m.startZ)}`, m.group);
    this.modules = [];
    for (const s of this.segments) this.releaseSegment(s);
    this.segments = [];
    this.activeObstacles = [];
    this.trains = [];
    this.decor.clear();
    this.coins.clear();
    this.powerUps.clear();
    this.rng = new Random(seed);
    this.moduleFrontier = -CFG.segmentLength * 2;
    this.segmentCount = 0;
    this.time = 0;
    this.collision.setObstacles(this.activeObstacles);
  }

  /** Fills the world ahead of the player, then updates every resident. */
  update(dt: number, distance: number, speed: number): void {
    this.time += dt;
    this.ensureAhead(distance, speed);
    this.recycleBehind(distance);
    this.reposition(distance);
    this.decor.update(dt, distance);
    for (const train of this.trains) train.update(dt, this.time);
    this.updateDynamics(dt);
  }

  /** Generates and spawns until the world extends past the view distance. */
  private ensureAhead(distance: number, speed: number): void {
    const target = distance + CFG.viewDistance;

    while (this.moduleFrontier < target) {
      const variant = this.pickModuleVariant();
      const startZ = this.moduleFrontier;
      const key = `${variant}|${moduleSeed(startZ)}`;
      const group = this.modulePool.acquire(key);
      group.position.set(0, 0, startZ - distance + CFG.segmentLength / 2);
      this.root.add(group);
      this.modules.push({ group, variant, startZ });
      this.moduleFrontier += CFG.segmentLength;
    }

    while (this.generator.frontier < target) {
      const plan = this.generator.next(speed);
      this.spawnSegment(plan, distance);
    }
  }

  private pickModuleVariant(): TrackVariant {
    const { zone } = zoneAt(Math.max(0, this.moduleFrontier));
    const roll = this.rng.next();
    if (zone.id === 'ZONE_Elevated') return roll < 0.7 ? 'TRK_Elevated_01' : 'TRK_Straight_01';
    if (zone.id === 'ZONE_Metro') {
      if (roll < 0.3) return 'TRK_Platform_01';
      if (roll < 0.42) return 'TRK_PlatformEdge_01';
      if (roll < 0.5) return 'TRK_Junction_01';
    }
    if (zone.id === 'ZONE_Industrial' && roll < 0.28) return 'TRK_Maintenance_01';
    if (zone.id === 'ZONE_Construction' && roll < 0.22) return 'TRK_Crossing_01';
    if (zone.id === 'ZONE_Neon' && roll < 0.2) return 'TRK_Tunnel_01';
    if (roll < 0.12) return 'TRK_Switch_01';
    if (roll < 0.2) return 'TRK_Straight_02';
    if (roll < 0.26) return 'TRK_Long_01';
    return 'TRK_Straight_01';
  }

  /** Instantiates one planned segment's obstacles, coins and power-ups. */
  private spawnSegment(plan: PlannedSegment, distance: number): void {
    const obstacles: ActiveObstacle[] = [];

    for (const planned of plan.obstacles) {
      const key = `${planned.def.id}|${planned.seed % 8}`;
      const object = this.obstaclePool.acquire(key);
      object.position.set(
        laneX(planned.lane),
        0,
        planned.z - distance,
      );
      object.rotation.y = 0;
      this.root.add(object);

      const train = object.userData.train as Train | undefined;
      if (train) this.trains.push(train);

      obstacles.push({
        def: planned.def,
        z: planned.z,
        lane: planned.lane,
        x: laneX(planned.lane),
        baseY: 0,
        object,
        driftZ: planned.driftZ,
        driftX: planned.driftX,
        poolKey: key,
        hit: false,
        nearMissed: false,
        passed: false,
      });
    }

    this.coins.spawn(plan.coins);
    this.powerUps.spawn(plan.powerUps);

    // Stations appear on a cadence, dressed onto the platform modules.
    let station: ResidentSegment['station'] = null;
    this.segmentCount++;
    if (this.segmentCount % STATION_EVERY === 0) {
      const key = String(stationSeed(this.segmentCount));
      const group = this.stationPool.acquire(key);
      group.position.set(0, 0, plan.startZ + plan.length / 2 - distance);
      this.root.add(group);
      station = { group, key };
    }

    const { zone, index } = zoneAt(plan.startZ);
    this.decor.populate(plan.startZ, plan.length, zone, index, this.segmentCount, this.decorDensity);

    this.segments.push({ plan, obstacles, station });
    for (const o of obstacles) this.activeObstacles.push(o);
    this.collision.setObstacles(this.activeObstacles);
  }

  private recycleBehind(distance: number): void {
    while (this.modules.length > 0 && this.modules[0].startZ + CFG.segmentLength < distance - CFG.recycleDistance) {
      const m = this.modules.shift()!;
      this.modulePool.release(`${m.variant}|${moduleSeed(m.startZ)}`, m.group);
    }
    while (
      this.segments.length > 0 &&
      this.segments[0].plan.startZ + this.segments[0].plan.length < distance - CFG.recycleDistance
    ) {
      const s = this.segments.shift()!;
      this.releaseSegment(s);
    }
  }

  private releaseSegment(s: ResidentSegment): void {
    for (const o of s.obstacles) {
      const train = o.object.userData.train as Train | undefined;
      if (train) {
        const i = this.trains.indexOf(train);
        if (i >= 0) this.trains.splice(i, 1);
      }
      const index = this.activeObstacles.indexOf(o);
      if (index >= 0) this.activeObstacles.splice(index, 1);
      this.obstaclePool.release(o.poolKey, o.object as THREE.Group);
    }
    if (s.station) this.stationPool.release(s.station.key, s.station.group);
    this.collision.setObstacles(this.activeObstacles);
  }

  /** Positions every resident relative to the player's distance. */
  private reposition(distance: number): void {
    for (const m of this.modules) {
      m.group.position.z = m.startZ - distance + CFG.segmentLength / 2;
    }
    for (const s of this.segments) {
      if (s.station) s.station.group.position.z = s.plan.startZ + s.plan.length / 2 - distance;
    }
    for (const o of this.activeObstacles) {
      o.object.position.set(o.x, o.baseY, o.z - distance);
      o.object.visible = o.z - distance < CFG.viewDistance + 30;
    }
  }

  /** Moving hazards drift, and sliding barriers sweep across their lane. */
  private updateDynamics(dt: number): void {
    for (const o of this.activeObstacles) {
      if (o.driftZ !== 0) o.z += o.driftZ * dt;
      if (o.driftX !== 0) {
        // Oscillates within the lane rather than wandering into another one,
        // so the fairness proof for its lane still holds.
        const half = (CFG.laneWidth - o.def.width) / 2;
        o.x = laneX(o.lane) + Math.sin(this.time * o.driftX) * Math.max(0, half);
      }
      if (o.def.id === 'OBS_SwingSign_01') {
        o.object.rotation.z = Math.sin(this.time * 1.8 + o.z) * 0.22;
      }
      if (o.def.id === 'OBS_RollingDrum_01') {
        o.object.rotation.x = -this.time * 3.4;
      }
    }
  }

  /** Nearest train ahead, 0..1, used to drive the rolling-stock audio bed. */
  trainProximity(distance: number): number {
    let nearest = Infinity;
    for (const o of this.activeObstacles) {
      if (o.def.category !== 'train') continue;
      const d = Math.abs(o.z - distance);
      if (d < nearest) nearest = d;
    }
    if (!Number.isFinite(nearest)) return 0;
    return Math.max(0, 1 - nearest / 70);
  }

  get stats(): { modules: number; segments: number; obstacles: number; trains: number; decor: number } {
    return {
      modules: this.modules.length,
      segments: this.segments.length,
      obstacles: this.activeObstacles.length,
      trains: this.trains.length,
      decor: this.decor.stats.placed,
    };
  }

  get currentZone(): ZoneDef {
    return zoneAt(Math.max(0, this.moduleFrontier)).zone;
  }
}

function laneX(lane: number): number {
  return (lane - (CFG.laneCount - 1) / 2) * CFG.laneWidth;
}

/**
 * Stations cycle through a fixed set of dressings. Bounded, so the pool still
 * plateaus; derived from the segment count rather than a random draw, so a
 * replay of a seed puts the same benches and the same staircase in the same
 * station.
 */
function stationSeed(segmentCount: number): number {
  return Math.floor(segmentCount / STATION_EVERY) % STATION_VARIANTS;
}

function moduleSeed(startZ: number): number {
  return Math.abs(Math.floor(startZ / CFG.segmentLength)) % 8;
}

