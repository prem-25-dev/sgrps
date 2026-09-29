/**
 * The same seed must build the same world.
 *
 * Two documents promise it — the asset register calls seeded reproducibility a
 * property of the world build, and DecorScatter's own comment says its scatter
 * "is the same on a replay of the same seed". Nothing had ever checked it.
 *
 * It matters beyond tidiness. Every other test in this repo that streams the
 * world and asserts something about what came out — fairness, soak, gameplay —
 * is only meaningful if a seed pins the run down. A single unseeded call
 * somewhere in the stream would make those suites sample a different world on
 * every CI run, and a rare failure would be unreproducible by construction.
 *
 * So this fingerprints the built world rather than trusting the code to look
 * deterministic: every mesh's name, world transform and geometry, quantised
 * and sorted, for two independent runs of the same seed and for a replay
 * through pooled objects on one instance. Sorting is deliberate — child order
 * is an artefact of pool free-lists and is invisible to the player, while a
 * bench that moved or a staircase that became an escalator is not.
 */
import * as THREE from 'three';
import { CFG } from '../src/core/Config';
import { CollectibleManager } from '../src/collectibles/CollectibleManager';
import { CollisionSystem } from '../src/core/CollisionSystem';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { PowerUpManager } from '../src/powerups/PowerUpManager';
import { ProceduralGenerator } from '../src/procedural/ProceduralGenerator';
import { TrackManager } from '../src/world/TrackManager';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const q = (n: number): string => (Math.abs(n) < 5e-4 ? '0' : n.toFixed(3));

/** One line per visible mesh: what it is, where it is, how big it is. */
function fingerprint(roots: THREE.Object3D[], coins?: CollectibleManager): string[] {
  const lines: string[] = [];
  if (coins) {
    // Coins are one InstancedMesh, so a traverse sees a single node. Their
    // positions live in the instance matrices and are dumped by hand.
    const arr = coins.mesh.instanceMatrix.array as ArrayLike<number>;
    for (let i = 0; i < coins.mesh.count; i++) {
      const x = arr[i * 16 + 12];
      const y = arr[i * 16 + 13];
      const z = arr[i * 16 + 14];
      if (y < -500) continue; // parked off-world
      lines.push(`COIN|${q(x)},${q(y)},${q(z)}`);
    }
  }
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !o.visible) return;
      for (let p: THREE.Object3D | null = o.parent; p; p = p.parent) if (!p.visible) return;
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      o.matrixWorld.decompose(pos, rot, scl);
      const g = m.geometry;
      const verts = g?.getAttribute('position')?.count ?? 0;
      lines.push(
        `${o.name || m.type}|${q(pos.x)},${q(pos.y)},${q(pos.z)}` +
        `|${q(rot.x)},${q(rot.y)},${q(rot.z)},${q(rot.w)}` +
        `|${q(scl.x)},${q(scl.y)},${q(scl.z)}|${g?.type ?? '-'}:${verts}`,
      );
    });
  }
  return lines.sort();
}

interface Stack {
  track: TrackManager;
  coins: CollectibleManager;
  powerUps: PowerUpManager;
  difficulty: DifficultyManager;
  run(seed: number, seconds: number): string[];
}

function makeStack(seed: number): Stack {
  const difficulty = new DifficultyManager();
  const generator = new ProceduralGenerator(seed, difficulty);
  const collision = new CollisionSystem();
  const coins = new CollectibleManager();
  const powerUps = new PowerUpManager();
  const track = new TrackManager(generator, collision, coins, powerUps);
  const stack: Stack = {
    track, coins, powerUps, difficulty,
    run(runSeed: number, seconds: number): string[] {
      generator.reset(runSeed);
      difficulty.reset();
      powerUps.reset();
      track.reset(runSeed);
      const dt = 1 / 60;
      let distance = 0;
      let elapsed = 0;
      for (let f = 0; f < Math.round(seconds * 60); f++) {
        elapsed += dt;
        const speed = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
        distance += speed * dt;
        difficulty.update(distance, dt);
        track.update(dt, distance, speed);
        coins.update(dt, distance, 0, 0, () => {});
        powerUps.update(dt, distance, 0, 0, () => {});
      }
      return fingerprint([track.root, powerUps.root], coins);
    },
  };
  return stack;
}

/** Where two fingerprints part company, in words. */
function firstDifference(a: string[], b: string[]): string {
  const inB = new Set(b);
  const onlyA = a.filter((l) => !inB.has(l));
  const inA = new Set(a);
  const onlyB = b.filter((l) => !inA.has(l));
  const names = new Set([...onlyA, ...onlyB].map((l) => l.split('|')[0]));
  return `${onlyA.length + onlyB.length} of ${a.length} lines differ ` +
    `(${[...names].slice(0, 6).join(', ')})\n       A: ${onlyA[0] ?? '-'}\n       B: ${onlyB[0] ?? '-'}`;
}

const SECONDS = 40;

// ------------------------------------------------- two independent worlds

const a = makeStack(4242).run(4242, SECONDS);
const b = makeStack(4242).run(4242, SECONDS);

check('the world is not empty', a.length > 500, `${a.length} meshes`);
check('two runs of one seed build the same world',
  a.length === b.length && a.every((l, i) => l === b[i]), firstDifference(a, b));

// ------------------------------------------------------- a different seed
//
// Without an anti-vacuity check the suite would pass on a world that ignored
// its seed entirely. The first version of this only compared whole worlds,
// and a generator hard-wired to seed 1 sailed through it: the decor and track
// scatter still differ by seed, so the worlds differ while the level layout
// does not. So the layout is checked where it is made.

const c = makeStack(9137).run(9137, SECONDS);
check('a different seed builds a different world', a.join('\n') !== c.join('\n'),
  'two seeds produced identical worlds');

function plans(seed: number, count = 60): string {
  const difficulty = new DifficultyManager();
  const generator = new ProceduralGenerator(seed, difficulty);
  generator.reset(seed);
  difficulty.reset();
  const out: string[] = [];
  let speed = CFG.speed.base;
  for (let i = 0; i < count; i++) {
    const p = generator.next(speed);
    out.push(
      `${p.templateId}@${q(p.startZ)}` +
      `|${p.obstacles.map((o) => `${o.def.id}:${o.lane}:${q(o.z)}:${q(o.driftZ)}:${q(o.driftX)}`).join(',')}` +
      `|${p.coins.map((k) => `${q(k.x)}:${q(k.y)}:${q(k.z)}`).join(',')}` +
      `|${p.powerUps.map((u) => `${u.id}:${q(u.x)}:${q(u.z)}`).join(',')}` +
      `|${p.exitLanes.join('')}`,
    );
    difficulty.update(p.startZ, 1);
    speed = Math.min(CFG.speed.max, speed + CFG.speed.acceleration);
  }
  return out.join('\n');
}

check('the generator repeats its layout on the same seed', plans(4242) === plans(4242),
  'the same seed produced two different levels');
check('the generator lays the level out from its seed', plans(4242) !== plans(9137),
  'two seeds produced the same obstacles, coins and power-ups');

// ------------------------------------------------------------- the replay
//
// Restarting mid-session goes back through pooled objects rather than freshly
// built ones. A pool that hands back a differently-built instance is the
// likeliest way for a replay to drift from the first run.

const stack = makeStack(4242);
stack.run(4242, SECONDS);
const replay = stack.run(4242, SECONDS);
check('a replay on the same instance rebuilds the same world',
  a.length === replay.length && a.every((l, i) => l === replay[i]), firstDifference(a, replay));

// ------------------------------------------------------------- the variety
//
// Determinism is easy to get by making every station identical, so this holds
// the other end: a run has to put up more than one dressing. Stations are
// found by name and fingerprinted individually as they stream past.

{
  const stack = makeStack(4242);
  const { track } = stack;
  const seen = new Set<string>();
  const signature = (station: THREE.Object3D): string => {
    const parts: string[] = [];
    station.updateMatrixWorld(true);
    station.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const local = o.position;
      parts.push(`${q(local.x)},${q(local.y)},${q(local.z)}:${m.geometry?.getAttribute('position')?.count ?? 0}`);
    });
    return parts.sort().join(';');
  };

  const difficulty = stack.difficulty;
  track.reset(4242);
  difficulty.reset();
  const dt = 1 / 60;
  let distance = 0;
  let elapsed = 0;
  for (let f = 0; f < 200 * 60; f++) {
    elapsed += dt;
    const speed = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
    distance += speed * dt;
    difficulty.update(distance, dt);
    track.update(dt, distance, speed);
    if (f % 30 === 0) {
      track.root.traverse((o) => { if (o.name === 'STA_Assembly' && o.visible) seen.add(signature(o)); });
    }
  }
  check('a run puts up more than one station dressing', seen.size >= 3,
    `${seen.size} distinct station${seen.size === 1 ? '' : 's'} over ${Math.round(distance)} m`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
