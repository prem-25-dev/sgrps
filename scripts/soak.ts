/**
 * World-streaming soak test.
 *
 * Runs the real TrackManager, generator, collision, coin and power-up systems
 * for a long simulated run with no renderer, and checks that every pool
 * plateaus. A leak here would show up in a browser as steadily climbing
 * memory and geometry counts.
 */
import * as THREE from 'three';
import { CollisionSystem } from '../src/core/CollisionSystem';
import { CFG } from '../src/core/Config';
import { CollectibleManager } from '../src/collectibles/CollectibleManager';
import { PowerUpManager } from '../src/powerups/PowerUpManager';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { ProceduralGenerator } from '../src/procedural/ProceduralGenerator';
import { TrackManager } from '../src/world/TrackManager';

function countGeometries(root: THREE.Object3D): number {
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) seen.add(m.geometry);
  });
  return seen.size;
}

function countObjects(root: THREE.Object3D): number {
  let n = 0;
  root.traverse(() => n++);
  return n;
}

const difficulty = new DifficultyManager();
const generator = new ProceduralGenerator(9876, difficulty);
const collision = new CollisionSystem();
const coins = new CollectibleManager();
const powerUps = new PowerUpManager();
const track = new TrackManager(generator, collision, coins, powerUps);

track.reset(9876);

const dt = 1 / 60;
const MINUTES = Number(process.env.SOAK_MINUTES ?? 12);
const frames = Math.round(MINUTES * 60 * 60);
let distance = 0;
let elapsed = 0;

interface Sample { minute: number; distance: number; objects: number; geometries: number; obstacles: number; decor: number; coins: number; }
const samples: Sample[] = [];

const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  elapsed += dt;
  const speed = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
  distance += speed * dt;
  difficulty.update(distance, dt);
  track.update(dt, distance, speed);
  coins.update(dt, distance, 0, 0, () => {});
  powerUps.update(dt, distance, 0, 0, () => {});

  if (f % (60 * 60) === 0) {
    samples.push({
      minute: f / 3600,
      distance: Math.round(distance),
      objects: countObjects(track.root) + countObjects(powerUps.root),
      geometries: countGeometries(track.root) + countGeometries(powerUps.root),
      obstacles: track.stats.obstacles,
      decor: track.stats.decor,
      coins: coins.liveCount,
    });
  }
}
const ms = Date.now() - t0;

console.log('minute  distance   objects  geometries  obstacles  decor  coins');
for (const s of samples) {
  console.log(
    String(s.minute).padStart(5),
    `${(s.distance / 1000).toFixed(2)}km`.padStart(9),
    String(s.objects).padStart(9),
    String(s.geometries).padStart(11),
    String(s.obstacles).padStart(10),
    String(s.decor).padStart(6),
    String(s.coins).padStart(6),
  );
}

// A healthy system plateaus: compare the second half against the first.
const half = Math.floor(samples.length / 2);
const early = samples.slice(1, half);
const late = samples.slice(half);
const avg = (list: Sample[], key: keyof Sample) => list.reduce((a, s) => a + (s[key] as number), 0) / Math.max(1, list.length);

const objGrowth = avg(late, 'objects') / Math.max(1, avg(early, 'objects'));
const geoGrowth = avg(late, 'geometries') / Math.max(1, avg(early, 'geometries'));

console.log(`\n${MINUTES} simulated minutes, ${(distance / 1000).toFixed(1)} km, in ${(ms / 1000).toFixed(1)}s wall clock`);
console.log(`scene objects: early avg ${avg(early, 'objects').toFixed(0)} -> late avg ${avg(late, 'objects').toFixed(0)}  (x${objGrowth.toFixed(3)})`);
console.log(`geometries:    early avg ${avg(early, 'geometries').toFixed(0)} -> late avg ${avg(late, 'geometries').toFixed(0)}  (x${geoGrowth.toFixed(3)})`);
console.log(`generator:`, generator.stats);
console.log(`validator:`, generator.validatorStats);

let fail = 0;
const assert = (name: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) fail++;
};
assert('scene object count plateaus', objGrowth < 1.15, `grew x${objGrowth.toFixed(3)}`);
assert('geometry count plateaus', geoGrowth < 1.15, `grew x${geoGrowth.toFixed(3)}`);
assert('obstacle list stays bounded', Math.max(...samples.map((s) => s.obstacles)) < 90, 'too many live obstacles');
assert('coin pool stays bounded', Math.max(...samples.map((s) => s.coins)) <= 420, 'coin pool overflowed');
assert('generator never falls back to empty', generator.stats.fallbacks === 0, `${generator.stats.fallbacks} fallbacks`);

process.exit(fail > 0 ? 1 : 0);
