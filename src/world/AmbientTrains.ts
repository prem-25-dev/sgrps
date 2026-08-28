import * as THREE from 'three';
import { SIDE_LINE_X } from '../assets/TrackFactory';
import { buildTrain, Train, TRAIN_VARIANTS, TrainVariant } from '../assets/TrainFactory';
import { mergeByMaterial } from '../assets/GeometryUtil';
import { CFG } from '../core/Config';
import { KeyedPool } from '../core/ObjectPool';
import { Random } from '../core/Random';

/**
 * Traffic on the neighbouring lines.
 *
 * These trains are scenery: nothing here is in the collision system and the
 * fairness solver never sees them, so they cannot make a segment harder. What
 * they do is give the world a sense of being a working railway rather than a
 * corridor of obstacles — a consist pulls away up the line ahead of you, or
 * comes down the opposite road and is gone in a second and a half.
 *
 * They run on the same coordinates as everything else: absolute Z, drawn at
 * `absoluteZ - distance`, positive is ahead.
 */

/** Cars in a consist. */
const MIN_CARS = 3;
const MAX_CARS = 5;
/** Gap between the couplers of adjacent cars. */
const COUPLER_GAP = 0.55;
/**
 * How far ahead a departing consist is placed. Close enough to read as a train
 * rather than a speck, far enough that it is never mistaken for something in
 * the player's lane.
 */
const SPAWN_AHEAD = 55;
/** How far past the player a consist survives before it is recycled. */
const SPAWN_BEHIND = 70;

interface Consist {
  cars: Array<{ train: Train; key: string }>;
  group: THREE.Group;
  /** Absolute Z of the front of the train. */
  z: number;
  /** Metres per second along +Z. Negative comes toward the player. */
  speed: number;
  length: number;
  side: -1 | 1;
}

export class AmbientTrains {
  readonly root = new THREE.Group();

  private pool = new KeyedPool<Train>(
    (key) => {
      const [variant, role] = key.split('|');
      const train = buildTrain(variant as TrainVariant, role as 'lead' | 'middle' | 'tail', 'scenery');
      // Scenery detail drops the interior, the working doors and the roof kit;
      // merging then collapses what is left into one mesh per material. A
      // carriage on the neighbouring line is a silhouette with windows, and
      // paying full carriage price for one is paying for what nobody sees.
      //
      // `mergeByMaterial` returns a new group and disposes the geometries it
      // consumed, so the result has to replace the original — calling it for
      // its side effect leaves a carriage drawing from disposed buffers.
      const object = mergeByMaterial(train.object) as THREE.Group;
      return { ...train, object };
    },
    (t) => { t.object.visible = true; },
    (t) => { t.object.visible = false; t.object.parent?.remove(t.object); },
  );

  private live: Consist[] = [];
  private rng = new Random(1);
  private time = 0;
  private nextSpawn = 0;
  private enabled = true;

  constructor() {
    this.root.name = 'TRK_AmbientTrains';
  }

  /** Off on the low quality profile, where the budget is better spent elsewhere. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  reset(seed: number): void {
    this.clear();
    this.rng = new Random(seed ^ 0x5bd1);
    this.time = 0;
    this.nextSpawn = 2.5;
  }

  clear(): void {
    for (const c of this.live) this.release(c);
    this.live = [];
  }

  update(dt: number, distance: number): void {
    this.time += dt;

    if (this.enabled) {
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0) {
        this.spawn(distance);
        // Irregular, the way a timetable is: long enough that one has usually
        // cleared before the next appears.
        this.nextSpawn = this.rng.range(7, 16);
      }
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      c.z += c.speed * dt;

      const rel = c.z - distance;
      // Gone once the whole consist is behind the player, or so far ahead it
      // has left the streamed world.
      if (rel + c.length < -SPAWN_BEHIND || rel > CFG.viewDistance + 260) {
        this.release(c);
        this.live.splice(i, 1);
        continue;
      }
      c.group.position.set(c.side * SIDE_LINE_X, 0, rel);
    }
  }

  private spawn(distance: number): void {
    const side: -1 | 1 = this.rng.next() < 0.5 ? -1 : 1;
    // Left-hand running: the near line goes with you, the far line comes back.
    const departing = side === -1;
    const variant = TRAIN_VARIANTS[this.rng.int(0, TRAIN_VARIANTS.length)];
    const cars = this.rng.int(MIN_CARS, MAX_CARS + 1);

    const group = new THREE.Group();
    group.name = `TRN_Ambient_${variant}`;
    const built: Consist['cars'] = [];
    let offset = 0;
    for (let i = 0; i < cars; i++) {
      const role = i === 0 ? 'lead' : i === cars - 1 ? 'tail' : 'middle';
      const key = `${variant}|${role}`;
      const train = this.pool.acquire(key);
      // The consist runs back from its front along -Z.
      train.object.position.set(0, 0, -offset - train.spec.length / 2);
      // A train on the far line faces the other way.
      train.object.rotation.y = departing ? 0 : Math.PI;
      group.add(train.object);
      built.push({ train, key });
      offset += train.spec.length + COUPLER_GAP;
    }
    this.root.add(group);

    // Departing traffic pulls away from the player; oncoming traffic closes
    // fast, which is most of why it reads as speed.
    // Departing traffic only just outruns the player, so it stays in shot and
    // recedes for several seconds. Outrunning them by 30 m/s would put it over
    // the horizon before it had been seen.
    const speed = departing
      ? CFG.speed.base + this.rng.range(6, 13)
      : -CFG.speed.base * this.rng.range(1.6, 2.2);
    const z = departing ? distance + SPAWN_AHEAD : distance + CFG.viewDistance + 120;

    this.live.push({ cars: built, group, z, speed, length: offset, side });
  }

  private release(c: Consist): void {
    for (const { train, key } of c.cars) this.pool.release(key, train);
    c.group.parent?.remove(c.group);
  }

  get stats(): { live: number; cars: number } {
    return { live: this.live.length, cars: this.live.reduce((n, c) => n + c.cars.length, 0) };
  }
}
