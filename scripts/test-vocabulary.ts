/**
 * "Every obstacle teaches one verb, and its geometry tells you which."
 *
 * That sentence in GAME_DESIGN.md is the contract the whole affordance design
 * rests on — it is why the colourblind audit concluded no colourblind mode was
 * needed, since what an obstacle demands is carried by its silhouette rather
 * than its colour. Nothing checked it, and three of the published bands did
 * not match the data.
 *
 * Two kinds of assertion here. The geometric ones read the archetype table.
 * The behavioural ones fly the real `PlayerController` at the real
 * `CollisionSystem` and find out what actually clears, because the arithmetic
 * is not reliable: a point-mass estimate said a 2.6 m signal box was clearable
 * above 17 m/s, and it is not clearable at any speed.
 */
import * as THREE from 'three';
import { LightingRig } from '../src/world/ZoneManager';
import { ActiveObstacle } from '../src/core/CollisionSystem';
import { CFG } from '../src/core/Config';
import { OBSTACLE_DEFS } from '../data/obstacles';
import { ObstacleDef } from '../src/core/Types';
import { CollectibleManager } from '../src/collectibles/CollectibleManager';
import { CollisionSystem } from '../src/core/CollisionSystem';
import { PowerUpManager } from '../src/powerups/PowerUpManager';
import { TrackManager } from '../src/world/TrackManager';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { ProceduralGenerator } from '../src/procedural/ProceduralGenerator';
import { makeHarness } from './harness';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const top = (o: ObstacleDef): number => o.yOffset + o.height / 2;
const under = (o: ObstacleDef): number => o.yOffset - o.height / 2;
const of = (cat: string): ObstacleDef[] => OBSTACLE_DEFS.filter((o) => o.category === cat);

const JUMP_PEAK = (CFG.jump.velocity * CFG.jump.velocity) / (2 * -CFG.jump.gravity);

check('the archetype count the documents quote is right', OBSTACLE_DEFS.length === 33,
  `${OBSTACLE_DEFS.length}`);
check(`the jump peak is the documented ${JUMP_PEAK.toFixed(2)} m`, Math.abs(JUMP_PEAK - 2.70) < 1e-9,
  `${JUMP_PEAK}`);

// -------------------------------------------------------------- ground
//
// "Ground (top 0.85–1.25 m) — jump, or change lane." Ramps are a separate verb
// in the same category: you run up them, so their top is not a jump target.

{
  const plain = of('ground').filter((o) => !o.slope);
  const outside = plain.filter((o) => top(o) < 0.85 || top(o) > 1.35);
  check('every ground obstacle sits in the 0.85–1.35 m band', outside.length === 0,
    outside.map((o) => `${o.id} ${top(o).toFixed(2)}`).join(', '));
  console.log(`  ground tops: ${Math.min(...plain.map(top)).toFixed(2)}–${Math.max(...plain.map(top)).toFixed(2)} m ` +
    `(the document said 0.85–1.25; OBS_CableDrum_01 is 1.35)`);

  const noJump = plain.filter((o) => !o.requiredActions.includes('jump'));
  check('and every one of them accepts a jump', noJump.length === 0, noJump.map((o) => o.id).join(', '));
  const tooTall = plain.filter((o) => top(o) >= JUMP_PEAK);
  check('and none is taller than the jump can reach', tooTall.length === 0,
    tooTall.map((o) => o.id).join(', '));
}

// ------------------------------------------------------------ overhead
//
// "Overhead (underside at 1.0 m+) — slide, or change lane." The number that
// matters for play is not 1.0 but the sliding collider, 0.85 m.

{
  const over = of('overhead');
  const low = over.filter((o) => under(o) < 1.0);
  check('every overhead obstacle has its underside at 1.0 m or higher', low.length === 0,
    low.map((o) => `${o.id} ${under(o).toFixed(2)}`).join(', '));

  const tight = over.filter((o) => under(o) <= CFG.slide.height);
  check(`and clears the ${CFG.slide.height} m sliding collider`, tight.length === 0,
    tight.map((o) => `${o.id} ${under(o).toFixed(2)}`).join(', '));
  const margin = Math.min(...over.map((o) => under(o) - CFG.slide.height));
  console.log(`  tightest slide clearance: ${margin.toFixed(2)} m`);

  const noSlide = over.filter((o) => !o.requiredActions.includes('slide'));
  check('and every one of them accepts a slide', noSlide.length === 0, noSlide.map((o) => o.id).join(', '));
}

// -------------------------------------------------------------- dynamic
//
// "They only appear above ~0.5 difficulty." The generator's dynamicChance
// opens at 0.45, but each archetype carries its own gate, and those are what
// actually hold the line.

{
  const early = of('dynamic').filter((o) => o.difficulty < 0.5);
  check('no moving hazard is eligible below 0.5 difficulty', early.length === 0,
    early.map((o) => `${o.id} ${o.difficulty}`).join(', '));
}

// ----------------------------------------------------------- full height
//
// "Full height — change lane; there is no other answer." Measured, that is
// true of three of the five. The container is standable and is the rooftop
// route the same document celebrates; the fence panel is 2.40 m and 0.16 m
// deep, so a held jump carries the player over it at every speed.
//
// `requiredActions` stays lane-change-only for all five on purpose: it is what
// the fairness solver plans with, and a guarantee that depends on frame-perfect
// timing is not a guarantee. This pins the real behaviour so a geometry edit
// that makes a wall hoppable — or takes the rooftop route away — is visible.

function clearableByJump(id: string): boolean {
  // The apex is `velocity / |gravity|` seconds after takeoff, so the timing
  // that matters is a jump started about `speed * apexTime` metres out. The
  // search is a narrow window around that rather than the whole approach: a
  // full sweep is 900 simulations per obstacle and most of them are nowhere
  // near the answer.
  const apexTime = CFG.jump.velocity / -CFG.jump.gravity;
  for (const speed of [12, 18, 24]) {
    const ideal = speed * apexTime;
    for (let trigger = Math.max(1, ideal - 4); trigger <= ideal + 4; trigger += 0.2) {
      const h = makeHarness();
      h.player.state.speed = speed;
      const o = h.addObstacle(id, 1, 40);
      let jumped = false;
      // Held, never released: an early release runs the ascent at cut gravity
      // and peaks at 1.29 m, which reports everything as unclearable.
      h.step(4.0, () => {
        if (!jumped && o.z - h.player.state.distance <= trigger) { jumped = true; h.key('ArrowUp'); }
      });
      const survived = h.events.hits.length === 0 && h.player.state.distance > 40;
      h.dispose();
      if (survived) return true;
    }
  }
  return false;
}

{
  const full = of('full');
  const noLaneChange = full.filter((o) => !o.requiredActions.includes('laneChange'));
  check('a lane change is always an answer to a full-height obstacle', noLaneChange.length === 0,
    noLaneChange.map((o) => o.id).join(', '));

  const jumpable = full.filter((o) => clearableByJump(o.id)).map((o) => o.id).sort();
  const expected = ['OBS_Container_01', 'OBS_FencePanel_01'];
  check('exactly the two known full-height archetypes are also passable by jumping',
    jumpable.join(',') === expected.join(','),
    `measured [${jumpable.join(', ')}], expected [${expected.join(', ')}]`);
  console.log(`  passable by a held jump: ${jumpable.join(', ') || 'none'}`);
}

// ------------------------------------------------------- the service train
//
// `OBS_TrainMoving_01` spent the whole build stationary. Drift was applied
// only to `category === 'dynamic'`, and a train's category is `'train'`, so
// the one archetype named for its motion was the one archetype that never
// moved. It is the third thing in this project found to be named for a
// behaviour it did not have, after the near miss that never fired and the
// reaction guarantee that was computed and never enforced.

{
  const difficulty = new DifficultyManager();
  const generator = new ProceduralGenerator(20260828, difficulty);
  generator.reset(20260828);
  difficulty.reset();

  let drifting = 0;
  let parked = 0;
  let worstClosing = 0;
  let speed = CFG.speed.base;
  let z = 0;
  let elapsed = 0;
  for (let i = 0; i < 1500; i++) {
    const plan = generator.next(speed);
    for (const o of plan.obstacles) {
      if (o.def.id === 'OBS_TrainMoving_01') {
        if (o.driftZ < 0) { drifting++; worstClosing = Math.max(worstClosing, -o.driftZ / speed); }
        else parked++;
      }
    }
    elapsed += plan.length / speed;
    z += plan.length;
    speed = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
    difficulty.update(z, plan.length / speed);
  }

  check('the service train is generated at all', drifting + parked > 0,
    `${drifting + parked} in 1500 segments`);
  check('and every one of them is actually running', parked === 0,
    `${parked} of ${drifting + parked} were stationary`);
  check('toward the player, at the configured closing speed',
    Math.abs(worstClosing - CFG.oncomingTrain.speedFactor) < 1e-6,
    `${worstClosing.toFixed(3)} of the player's speed`);
  console.log(`  ${drifting} service trains, closing at ${(CFG.oncomingTrain.speedFactor * 100).toFixed(0)}% ` +
    `of player speed on top of the approach ` +
    `(${(CFG.difficulty.reactionTimeHard / (1 + CFG.oncomingTrain.speedFactor) * 1000).toFixed(0)} ms ` +
    `to react at maximum difficulty)`);
}

// The plan is one thing; what the streamer does with it is another. This runs
// the real TrackManager and watches a service train come the whole way in.

{
  const difficulty = new DifficultyManager();
  const generator = new ProceduralGenerator(4242, difficulty);
  const collision = new CollisionSystem();
  const coins = new CollectibleManager();
  const powerUps = new PowerUpManager();
  const track = new TrackManager(generator, collision, coins, powerUps);
  track.reset(4242);
  difficulty.reset();

  const dt = 1 / 60;
  let distance = 0;
  // Start up the curve, where the service train is eligible.
  let elapsed = 300;
  let ratio = 0;
  let approach = 0;

  outer:
  for (let f = 0; f < 60 * 300; f++) {
    elapsed += dt;
    const speed = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
    distance += speed * dt;
    difficulty.update(distance, dt);
    track.update(dt, distance, speed);

    for (const o of collision.active) {
      if (o.def.id !== 'OBS_TrainMoving_01') continue;
      const rel = o.z - distance;
      // Inside `startsWithin`, so the window measures the train running rather
      // than a mix of the hold and the run.
      if (rel < 70 || rel > 80) continue;
      // Follow this one to the player and time the approach.
      const startRel = rel;
      const startTime = elapsed;
      let last = rel;
      for (let g = 0; g < 60 * 30; g++) {
        elapsed += dt;
        const sp = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
        distance += sp * dt;
        difficulty.update(distance, dt);
        track.update(dt, distance, sp);
        last = o.z - distance;
        if (last <= 0) break;
      }
      const sp = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
      ratio = ((startRel - last) / (elapsed - startTime)) / sp;
      approach = startRel;
      break outer;
    }
  }

  check('a service train is met in a run', approach > 0, 'none appeared in 300 s of streaming');
  check('and it closes faster than the track alone would bring it',
    Math.abs(ratio - (1 + CFG.oncomingTrain.speedFactor)) < 0.05,
    `closed at ${ratio.toFixed(2)}x the player's speed, expected ${(1 + CFG.oncomingTrain.speedFactor).toFixed(2)}x`);
  console.log(`  a service train eats ${approach.toFixed(0)} m of approach at ${ratio.toFixed(2)}x player speed`);
}

// ------------------------------------------ the hold, and the headlight
//
// `startsWithin` described a train that stands in its segment until the player
// is close, and nothing implemented it -- so the train set off the moment it
// spawned 210 m out and swept back through whatever was behind it. And the
// nose lamps that should announce it are emissive, which lights nothing.
//
// Both are checked against a real streamed run: the train must hold, then run,
// and the headlight must ride it without ever changing the scene's light count
// (three.js recompiles every shader when that number moves).

{
  const difficulty = new DifficultyManager();
  const generator = new ProceduralGenerator(4242, difficulty);
  const collision = new CollisionSystem();
  const track = new TrackManager(generator, collision, new CollectibleManager(), new PowerUpManager());
  track.reset(4242);
  difficulty.reset();

  const scene = new THREE.Scene();
  const rig = new LightingRig(scene);
  // `traverseVisible`, not `traverse`. The renderer only uploads lights it
  // actually walks, so hiding a light drops it from the count and triggers the
  // shader recompile this design exists to avoid -- and a `traverse` counter
  // sails straight past that, as it did on the first attempt at this check.
  const countLights = () => {
    let n = 0;
    scene.traverseVisible((o) => { if ((o as THREE.Light).isLight) n++; });
    return n;
  };
  const lightsAtBoot = countLights();
  let lightCountMoved = false;

  const dt = 1 / 60;
  let distance = 0;
  let elapsed = 300;
  let heldStill = 0;      // metres the player covered while a far train stood
  let farTrainDrift = 0;  // how far that train moved in its own frame meanwhile
  let ranWhenClose = 0;   // and how far it moved once inside the trigger
  let litNear = 0;        // brightest the headlight got with a train close
  let litFar = 0;         // brightest it got with none in sight
  let darkFrames = 0;

  for (let f = 0; f < 60 * 400; f++) {
    elapsed += dt;
    const speed = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
    distance += speed * dt;
    difficulty.update(distance, dt);

    const before = new Map<ActiveObstacle, number>();
    for (const o of collision.active) {
      if (o.def.id === 'OBS_TrainMoving_01') before.set(o, o.z);
    }
    track.update(dt, distance, speed);

    for (const [o, z] of before) {
      if (!collision.active.includes(o)) continue;
      const rel = o.z - distance;
      if (rel > CFG.oncomingTrain.startsWithin + 15) {
        heldStill += speed * dt;
        farTrainDrift += Math.abs(o.z - z);
      } else if (rel > 5) {
        ranWhenClose += Math.abs(o.z - z);
      }
    }

    const nose = track.nearestOncoming(distance);
    rig.aimHeadlight(nose, dt);
    if (countLights() !== lightsAtBoot) lightCountMoved = true;
    if (nose && nose.z < 60) litNear = Math.max(litNear, rig.headlight.intensity);
    // Only once the fade has had time to finish -- the frame after a train
    // recycles is still legitimately lit.
    darkFrames = nose ? 0 : darkFrames + 1;
    if (darkFrames > 40) litFar = Math.max(litFar, rig.headlight.intensity);
  }

  check('a far service train holds its ground', heldStill > 50 && farTrainDrift < 1e-6,
    `it drifted ${farTrainDrift.toFixed(2)} m over ${heldStill.toFixed(0)} m of approach`);
  check('and runs once the player is inside the trigger', ranWhenClose > 20,
    `it moved ${ranWhenClose.toFixed(1)} m while close`);
  check('the headlight lights up for a train that is nearly on the player', litNear > 40,
    `brightest was ${litNear.toFixed(0)}`);
  check('and goes dark when there is no train to light', litFar === 0,
    `it still burned at ${litFar.toFixed(1)} with nothing in sight`);
  check('and the scene never gains or loses a light', !lightCountMoved,
    `light count moved away from ${lightsAtBoot}`);
  console.log(`  headlight peaks at ${litNear.toFixed(0)} with a train closing, ` +
    `${litFar.toFixed(0)} with none, across ${lightsAtBoot} fixed lights`);
}

// ---------------------------------------------------------------- trains

{
  const trains = of('train');
  const standable = trains.filter((o) => o.standable).map((o) => o.id);
  check('parked train cars are a route', standable.length === 2, standable.join(', '));
  const moving = trains.find((o) => o.id === 'OBS_TrainMoving_01');
  check('and the moving one is not', moving !== undefined && !moving.standable);
}

// ------------------------------------------------------------ every verb

{
  // Nothing may be silent about what it wants.
  const mute = OBSTACLE_DEFS.filter((o) => o.requiredActions.length === 0);
  check('every archetype names at least one survivable action', mute.length === 0,
    mute.map((o) => o.id).join(', '));
  const cats = new Set(OBSTACLE_DEFS.map((o) => o.category));
  check('all five categories are populated', cats.size === 5, [...cats].join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
