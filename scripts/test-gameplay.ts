import { ActiveObstacle, CollisionSystem, HitResult } from '../src/core/CollisionSystem';
import { CFG, laneToX } from '../src/core/Config';
import { OBSTACLE_BY_ID } from '../data/obstacles';
import { Harness, makeHarness } from './harness';

/**
 * Gameplay integration tests.
 *
 * The fairness suite proves patterns are *survivable*; this proves the game
 * actually plays. It drives the real PlayerController, CollisionSystem,
 * CollectibleManager, PowerUpManager and ScoreManager at a fixed timestep with
 * no renderer, in hand-built scenarios where the right answer is known.
 *
 * The browser playtest cannot cover this: under software rasterisation the
 * simulation runs at a fraction of real time, so a run never gets far enough
 * to exercise a magnet, a shield or a rooftop route.
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/** Stands in for a DOM event target so InputManager runs its real code path. */




/** Presses a key for one frame's worth of intent, then releases it. */
function tap(h: Harness, code: string): void {
  h.key(code);
  h.key(code, true);
}

// ---------------------------------------------------------------------------
console.log('Movement and physics:');
{
  const h = makeHarness();
  h.step(3);
  const s = h.player.state;
  check('the player runs forward', s.distance > 30, `${s.distance.toFixed(1)} m`);
  check('speed accelerates from base', s.speed > CFG.speed.base, `${s.speed.toFixed(2)} m/s`);
  check('starts grounded in the centre lane', s.lane === 1 && Math.abs(s.x) < 1e-6, `lane ${s.lane}, x ${s.x}`);
  h.dispose();
}
{
  const h = makeHarness();
  tap(h, 'ArrowLeft');
  h.step(0.5);
  check('a left input changes lane', h.player.state.lane === 0, `lane ${h.player.state.lane}`);
  tap(h, 'ArrowLeft');
  h.step(0.5);
  check('lane input clamps at the edge', h.player.state.lane === 0, `lane ${h.player.state.lane}`);
  tap(h, 'ArrowRight');
  tap(h, 'ArrowRight');
  h.step(0.8);
  check('two right inputs reach the far lane', h.player.state.lane === 2, `lane ${h.player.state.lane}`);
  h.dispose();
}
{
  // Jump apex must match the configured 2.70 m, and the player must land.
  const h = makeHarness();
  let peak = 0;
  h.key('Space');
  h.step(1.0, () => { peak = Math.max(peak, h.player.state.y); });
  check('jump reaches its designed apex', Math.abs(peak - 2.70) < 0.12, `peak ${peak.toFixed(2)} m`);
  check('the player lands again', h.player.state.grounded && h.player.state.y < 0.01, `y ${h.player.state.y.toFixed(3)}`);
  h.dispose();
}
{
  // Releasing the jump key early must produce a lower arc than holding it.
  const held = makeHarness();
  let heldPeak = 0;
  held.key('Space');
  held.step(1.0, () => { heldPeak = Math.max(heldPeak, held.player.state.y); });
  held.dispose();

  const cut = makeHarness();
  let cutPeak = 0;
  cut.key('Space');
  cut.step(1.0, (t) => {
    if (t > 0.08) cut.key('Space', true);
    cutPeak = Math.max(cutPeak, cut.player.state.y);
  });
  check('releasing jump early cuts the arc', cutPeak < heldPeak - 0.3,
    `cut ${cutPeak.toFixed(2)} vs held ${heldPeak.toFixed(2)}`);
  cut.dispose();
}
{
  // The apex must not depend on the frame rate. Semi-implicit Euler
  // undershoots by v*dt/2, so a 30 fps player would jump lower than a 60 fps
  // one and clear obstacles the solver proved they could clear.
  const peaks: number[] = [];
  for (const rate of [30, 60, 120]) {
    const hero = makeHarness();
    let peak = 0;
    hero.key('Space');
    const frames = Math.round(1.0 * rate);
    for (let i = 0; i < frames; i++) {
      hero.player.update(1 / rate, 8);
      peak = Math.max(peak, hero.player.state.y);
    }
    peaks.push(peak);
    hero.dispose();
  }
  const spread = Math.max(...peaks) - Math.min(...peaks);
  check('jump height is frame-rate independent', spread < 0.03,
    `30/60/120 fps peaks: ${peaks.map((p) => p.toFixed(3)).join(', ')}`);
}
{
  const h = makeHarness();
  tap(h, 'ArrowDown');
  h.step(0.2);
  check('slide engages', h.player.state.sliding, 'not sliding');
  h.step(CFG.slide.duration + 0.2);
  check('slide ends on its own', !h.player.state.sliding, 'still sliding');
  h.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nCollision:');
{
  // Running into a ground obstacle without jumping must end the run.
  const h = makeHarness();
  h.addObstacle('OBS_TallBarrier_01', 1, 40);
  h.step(6);
  check('running into a full-height barrier is fatal', !h.player.state.alive, 'survived');
  check('the death is reported once', h.events.deaths.length === 1, `${h.events.deaths.length} deaths`);
  h.dispose();
}
{
  // Jumping at the right moment must clear the same class of obstacle.
  const h = makeHarness();
  const z = 40;
  h.addObstacle('OBS_LowWall_01', 1, z);
  h.step(6, () => {
    const s = h.player.state;
    // Take off about 5 m out, which the airtime comfortably covers.
    if (s.grounded && z - s.distance < 5.2 && z - s.distance > 4.8) h.key('Space');
  });
  check('jumping clears a low wall', h.player.state.alive, 'died');
  check('clearing it counts as a near miss', h.events.nearMisses.length === 1,
    `${h.events.nearMisses.length}`);
  h.dispose();
}
{
  // Sliding must clear an overhead, and standing must not.
  const h = makeHarness();
  const z = 40;
  h.addObstacle('OBS_LowCeiling_01', 1, z);
  h.step(6, () => {
    const s = h.player.state;
    if (!s.sliding && z - s.distance < 5 && z - s.distance > 4.5) tap(h, 'ArrowDown');
  });
  check('sliding clears a low ceiling', h.player.state.alive, 'died');
  h.dispose();
}
{
  const h = makeHarness();
  h.addObstacle('OBS_LowCeiling_01', 1, 40);
  h.step(6);
  check('running upright into a low ceiling is fatal', !h.player.state.alive, 'survived');
  h.dispose();
}
{
  // Changing lane must avoid an obstacle entirely.
  const h = makeHarness();
  h.addObstacle('OBS_TallBarrier_01', 1, 40);
  tap(h, 'ArrowLeft');
  h.step(6);
  check('changing lane avoids the obstacle', h.player.state.alive, 'died');
  check('passing it close counts as a near miss', h.events.nearMisses.length === 1,
    `${h.events.nearMisses.length}`);
  h.dispose();
}
{
  // Dodging two lanes clear is not a close pass and must not score.
  const h = makeHarness();
  h.addObstacle('OBS_TallBarrier_01', 0, 40);
  tap(h, 'ArrowRight');
  h.step(6);
  check('a wide berth is not a near miss', h.events.nearMisses.length === 0,
    `${h.events.nearMisses.length}`);
  check('the player survives a wide berth', h.player.state.alive, 'died');
  h.dispose();
}
{
  // Sliding under an overhead should read as a near miss too.
  const h = makeHarness();
  const z = 40;
  h.addObstacle('OBS_OverheadBeam_01', 1, z);
  h.step(6, () => {
    const s = h.player.state;
    if (!s.sliding && z - s.distance < 4.6 && z - s.distance > 4.2) tap(h, 'ArrowDown');
  });
  check('sliding under an overhead counts as a near miss',
    h.player.state.alive && h.events.nearMisses.length === 1,
    `alive=${h.player.state.alive} misses=${h.events.nearMisses.length}`);
  h.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nCollectibles and power-ups:');
{
  const h = makeHarness();
  h.coins.spawn([{ x: 0, y: CFG.coins.height, z: 30 }, { x: 0, y: CFG.coins.height, z: 32 }]);
  h.step(4);
  check('coins in the lane are collected', h.score.stats.coins === 2, `${h.score.stats.coins}`);
  check('collecting coins scores', h.score.score > 0, `${h.score.score}`);
  check('coins build a combo', h.score.comboCount >= 2, `${h.score.comboCount}`);
  h.dispose();
}
{
  // A coin two lanes away must be missed without a magnet, and taken with one.
  const withoutMagnet = makeHarness();
  withoutMagnet.coins.spawn([{ x: laneToX(2), y: CFG.coins.height, z: 30 }]);
  withoutMagnet.step(4);
  check('a coin in another lane is not collected', withoutMagnet.score.stats.coins === 0,
    `${withoutMagnet.score.stats.coins}`);
  withoutMagnet.dispose();

  const withMagnet = makeHarness();
  withMagnet.powerUps.grant('PWR_Magnet_01');
  withMagnet.coins.spawn([{ x: laneToX(2), y: CFG.coins.height, z: 30 }]);
  withMagnet.step(4);
  check('the magnet pulls in a coin from another lane', withMagnet.score.stats.coins === 1,
    `${withMagnet.score.stats.coins}`);
  withMagnet.dispose();
}
{
  const h = makeHarness();
  h.powerUps.grant('PWR_Shield_01');
  check('the shield reports as active', h.powerUps.shielded, 'not shielded');
  h.addObstacle('OBS_TallBarrier_01', 1, 40);
  h.step(6);
  check('the shield absorbs a fatal collision', h.player.state.alive, 'died anyway');
  check('the absorb is signalled once', h.events.shieldAbsorbs === 1, `${h.events.shieldAbsorbs}`);
  check('the shield is consumed', !h.powerUps.shielded, 'still shielded');
  h.dispose();
}
{
  const h = makeHarness();
  h.powerUps.grant('PWR_Boost_01');
  const boosted = h.powerUps.speedMultiplier;
  h.step(0.5);
  const fast = h.player.state.speed;
  h.step(7);
  check('boost raises the speed multiplier', boosted > 1.3, `${boosted}`);
  check('boost expires', h.powerUps.speedMultiplier === 1, `${h.powerUps.speedMultiplier}`);
  check('speed drops back after the boost', h.player.state.speed < fast, `${h.player.state.speed.toFixed(2)}`);
  h.dispose();
}
{
  const h = makeHarness();
  h.powerUps.grant('PWR_CoinValue_01');
  h.coins.spawn([{ x: 0, y: CFG.coins.height, z: 30 }]);
  h.step(4);
  const doubled = h.score.score;
  h.dispose();

  const plain = makeHarness();
  plain.coins.spawn([{ x: 0, y: CFG.coins.height, z: 30 }]);
  plain.step(4);
  check('the coin multiplier doubles coin value', doubled > plain.score.score,
    `${doubled} vs ${plain.score.score}`);
  plain.dispose();
}
{
  const h = makeHarness();
  h.powerUps.grant('PWR_Multiplier_01');
  check('the score multiplier applies', h.score.multiplier === 2 || h.powerUps.scoreMultiplier === 2,
    `${h.powerUps.scoreMultiplier}`);
  h.step(11);
  check('the score multiplier expires', h.powerUps.scoreMultiplier === 1, `${h.powerUps.scoreMultiplier}`);
  h.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nScoring:');
{
  const h = makeHarness();
  h.step(2);
  const early = h.score.score;
  h.step(2);
  check('score accrues with distance', h.score.score > early, `${early} -> ${h.score.score}`);
  h.dispose();
}
{
  const h = makeHarness();
  const coins = [];
  for (let i = 0; i < 10; i++) coins.push({ x: 0, y: CFG.coins.height, z: 30 + i * 1.5 });
  h.coins.spawn(coins);
  h.step(4);
  check('a coin run raises the multiplier', h.score.multiplier > 1, `x${h.score.multiplier}`);
  const peak = h.score.multiplier;
  h.step(CFG.score.comboWindow + 1);
  check('the combo decays when the player stops collecting', h.score.multiplier < peak,
    `x${peak} -> x${h.score.multiplier}`);
  h.dispose();
}
{
  const h = makeHarness();
  const coins = [];
  for (let i = 0; i < 6; i++) coins.push({ x: 0, y: CFG.coins.height, z: 30 + i * 1.5 });
  h.coins.spawn(coins);
  h.step(4);
  const before = h.score.multiplier;
  h.addObstacle('OBS_Barrier_01', 1, 90);
  h.step(6);
  check('taking a hit breaks the combo', h.score.multiplier < before || !h.player.state.alive,
    `x${before} -> x${h.score.multiplier}`);
  h.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nRooftop route:');
{
  // The marquee feature: run up a ramp, jump, land on a train roof, run along.
  const h = makeHarness();
  // Spacing mirrors SEG_TrainRoof_01: the ramp ends 2.4 m before the train, so
  // the arc off the ramp lands on the roof rather than back on the deck.
  const rampCentre = 40;
  const rampEnd = rampCentre + OBSTACLE_BY_ID.OBS_Ramp_01.depth / 2;
  const trainDef = OBSTACLE_BY_ID.OBS_TrainCar_01;
  const h2 = h;
  h2.addObstacle('OBS_Ramp_01', 1, rampCentre);
  const train = h2.addObstacle('OBS_TrainCar_01', 1, rampEnd + 2.4 + trainDef.depth / 2);
  let maxY = 0;
  let onRoof = 0;
  h.step(8, () => {
    const s = h.player.state;
    // Take off from the top of the ramp.
    if (s.grounded && s.distance > rampEnd - 0.9 && s.distance < rampEnd + 0.3) h.key('Space');
    maxY = Math.max(maxY, s.y);
    if (s.grounded && s.y > 2.5) onRoof++;
  });
  const roofTop = train.def.yOffset + train.def.height / 2;
  check('the ramp can be run up', maxY > 1.0, `max y ${maxY.toFixed(2)}`);
  check('the player lands on the train roof', onRoof > 10,
    `${onRoof} frames on a surface above 2.5 m (roof is ${roofTop.toFixed(2)} m)`);
  check('the player survives the rooftop route', h.player.state.alive, 'died');
  h.dispose();
}
{
  // Without a ramp the same train is a wall, not a route.
  const h = makeHarness();
  h.addObstacle('OBS_TrainCar_01', 1, 50);
  h.step(6, () => {
    const s = h.player.state;
    if (s.grounded && 50 - 10.5 - s.distance < 6 && 50 - 10.5 - s.distance > 5) h.key('Space');
  });
  check('a train with no ramp cannot be jumped onto', !h.player.state.alive, 'survived');
  h.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
