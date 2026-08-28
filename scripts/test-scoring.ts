/**
 * Scoring, against the formula the design document prints.
 *
 * `GAME_DESIGN.md` states it exactly:
 *
 *     score = Σ (speed × dt × multiplier)
 *           + 10 × coins × coinMultiplier × multiplier
 *           + 25 × nearMisses × multiplier
 *
 *     - Combo +1 per coin, +2 per near miss, decaying after 2.4 s idle.
 *     - Every 8 combo raises the multiplier one step, to ×8.
 *     - The score multiplier power-up doubles it again, to a practical ×16.
 *
 * `test:gameplay` checked that coins score and that a combo builds. Nothing
 * checked the arithmetic, and nothing checked that the ceiling the document
 * advertises can be reached — which it could not.
 */
import { CFG } from '../src/core/Config';
import { ScoreManager } from '../src/progression/ScoreManager';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const S = CFG.score;

// ------------------------------------------------- the documented constants
//
// The behavioural checks below read their expected values out of `CFG`, which
// proves the manager uses the configured numbers but not that the configured
// numbers are the ones the design document prints. Changing `nearMiss` from 25
// to 10 passed every one of them. The literals are pinned here, so a retune
// has to move the document too — those numbers are published to the player as
// the rules of the game.

check('a coin is documented and configured at 10', S.perCoin === 10, `${S.perCoin}`);
check('a near miss at 25', S.nearMiss === 25, `${S.nearMiss}`);
check('a metre at 1 point', S.perMetre === 1.0, `${S.perMetre}`);
check('the combo window at 2.4 s', S.comboWindow === 2.4, `${S.comboWindow}`);
check('one combo step per pickup', S.comboStep === 1, `${S.comboStep}`);
check('a multiplier step every 8 combo', S.comboPerMultiplier === 8, `${S.comboPerMultiplier}`);
check('and a ceiling of x8', S.multiplierMax === 8, `${S.multiplierMax}`);

// ------------------------------------------------------------ the formula

{
  const m = new ScoreManager();
  m.reset();
  // One second at 12 m/s, no combo: the distance term alone.
  for (let i = 0; i < 60; i++) m.update(1 / 60, i / 60 * 12, 12);
  check('distance scores speed × time × perMetre',
    Math.abs(m.score - 12 * S.perMetre) <= 1, `${m.score} for 12 m at ×1`);
}

{
  const m = new ScoreManager();
  m.reset();
  m.addCoin();
  check(`a coin is worth ${S.perCoin}`, m.score === S.perCoin, `${m.score}`);
}

{
  const m = new ScoreManager();
  m.reset();
  m.addNearMiss();
  check(`a near miss is worth ${S.nearMiss}`, m.score === S.nearMiss, `${m.score}`);
}

{
  const m = new ScoreManager();
  m.reset();
  m.coinMultiplier = 2;
  m.addCoin();
  check('the coin power-up doubles coin value', m.score === S.perCoin * 2, `${m.score}`);
}

{
  const m = new ScoreManager();
  m.reset();
  m.powerMultiplier = 2;
  m.addCoin();
  check('the score power-up doubles the whole pickup', m.score === S.perCoin * 2, `${m.score}`);
  m.coinMultiplier = 2;
  const before = m.score;
  m.addCoin();
  check('and the two power-ups compound', m.score - before === S.perCoin * 4,
    `gained ${m.score - before}`);
}

// --------------------------------------------------------------- the combo

{
  const m = new ScoreManager();
  m.reset();
  m.addCoin();
  check('a coin adds one to the combo', m.comboCount === 1, `${m.comboCount}`);
  m.addNearMiss();
  check('a near miss adds two', m.comboCount === 3, `${m.comboCount}`);
}

{
  const m = new ScoreManager();
  m.reset();
  for (let i = 0; i < 10; i++) m.addCoin();
  const held = m.comboCount;
  // Just under the window: still alive.
  m.update(S.comboWindow - 0.05, 0, 10);
  check(`the combo survives ${S.comboWindow} s of quiet`, m.comboCount === held,
    `${m.comboCount} after ${S.comboWindow - 0.05} s`);
  m.update(0.1, 0, 10);
  check('and breaks just past it', m.comboCount === 0, `${m.comboCount}`);
  check('a broken combo drops the multiplier to 1', m.multiplier === 1, `${m.multiplier}`);
}

// ---------------------------------------------------------- the multiplier

{
  const m = new ScoreManager();
  m.reset();
  const steps: Array<[number, number]> = [];
  for (let i = 1; i <= S.comboMax + 8; i++) {
    m.addCoin();
    steps.push([m.comboCount, m.multiplier]);
  }
  const stepAt = (combo: number): number => steps.find(([c]) => c === combo)?.[1] ?? -1;
  check(`the multiplier steps up every ${S.comboPerMultiplier} combo`,
    stepAt(S.comboPerMultiplier) === 2 && stepAt(S.comboPerMultiplier * 2) === 3,
    `at ${S.comboPerMultiplier}: ×${stepAt(S.comboPerMultiplier)}, at ${S.comboPerMultiplier * 2}: ×${stepAt(S.comboPerMultiplier * 2)}`);

  const peak = Math.max(...steps.map(([, mult]) => mult));
  check(`the documented ×${S.multiplierMax} ceiling is reachable`, peak >= S.multiplierMax,
    `combo caps at ${S.comboMax}, so the multiplier tops out at ×${peak} — ` +
    `reaching ×${S.multiplierMax} needs ${(S.multiplierMax - 1) * S.comboPerMultiplier} combo`);

  const withPower = new ScoreManager();
  withPower.reset();
  withPower.powerMultiplier = 2;
  for (let i = 0; i < S.comboMax + 8; i++) withPower.addCoin();
  check(`and the power-up takes it to ×${S.multiplierMax * 2}`,
    withPower.multiplier >= S.multiplierMax * 2, `×${withPower.multiplier}`);
}

{
  // The two configured ceilings have to agree: a combo cap below the top
  // tier's threshold makes multiplierMax dead config rather than a limit.
  const tierAtCap = 1 + Math.floor(S.comboMax / S.comboPerMultiplier);
  check('the combo cap and the multiplier cap agree', tierAtCap >= S.multiplierMax,
    `comboMax ${S.comboMax} allows ×${tierAtCap}, multiplierMax says ×${S.multiplierMax}`);
}

// ------------------------------------------------------------------- hits

{
  const m = new ScoreManager();
  m.reset();
  m.powerMultiplier = 2;
  for (let i = 0; i < 16; i++) m.addCoin();
  const banked = m.score;
  m.onHit(100);
  check('a hit breaks the combo', m.comboCount === 0);
  check('but does not take the score back', m.score === banked, `${m.score} vs ${banked}`);
  check('and leaves the power-up multiplier alone', m.multiplier === 2, `×${m.multiplier}`);
}

// ------------------------------------------------------------------ stats

{
  const m = new ScoreManager();
  m.reset();
  for (let i = 0; i < 24; i++) m.addCoin();
  const peak = m.multiplier;
  m.update(S.comboWindow + 0.1, 200, 14);
  check('bestMultiplier remembers the peak after the combo breaks',
    m.stats.bestMultiplier === peak, `${m.stats.bestMultiplier} vs ${peak}`);
  check('topSpeed tracks the fastest moment', m.stats.topSpeed === 14, `${m.stats.topSpeed}`);
  check('coins and near misses are counted', m.stats.coins === 24 && m.stats.nearMisses === 0,
    `${m.stats.coins} coins`);

  const clean = new ScoreManager();
  clean.reset();
  clean.update(1, 500, 12);
  check('noHitDistance measures the clean stretch', clean.stats.noHitDistance === 500,
    `${clean.stats.noHitDistance}`);
  clean.onHit(500);
  clean.update(1, 700, 12);
  check('and restarts from the hit', clean.stats.noHitDistance === 500,
    `${clean.stats.noHitDistance} after a hit at 500 and running to 700`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
