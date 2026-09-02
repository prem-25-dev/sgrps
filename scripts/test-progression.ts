import { AchievementManager, MissionManager } from '../src/progression/MissionManager';
import { ScoreManager } from '../src/progression/ScoreManager';
import { SAVE_VERSION, SaveManager, DEFAULT_SETTINGS } from '../src/save/SaveManager';
import { MISSION_DEFS, ACHIEVEMENT_DEFS } from '../data/missions';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { zoneAt, ZONES } from '../data/difficulty/zones';
import { CFG } from '../src/core/Config';
import { bus } from '../src/core/EventBus';

/**
 * Progression, persistence and the difficulty curve.
 *
 * These systems decide what the player keeps between runs, so a silent bug
 * here costs someone their history. Persistence is exercised against a real
 * localStorage implementation rather than a mock, including the cases that
 * matter most: a corrupted payload, a payload from an older version, and a
 * browser that refuses to store anything at all.
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/** Minimal localStorage, so SaveManager runs its real code path. */
class MemoryStorage {
  private map = new Map<string, string>();
  /** Set to make every write throw, as a browser in private mode does. */
  readonly: boolean = false;
  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void {
    if (this.readonly) throw new DOMException('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  /** Test hook: write a raw value without going through SaveManager. */
  poke(k: string, v: string): void { this.map.set(k, v); }
  raw(k: string): string | null { return this.map.get(k) ?? null; }
}

const STORE_KEY = 'neon-run.save.v3';
let store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;
(globalThis as unknown as { DOMException: unknown }).DOMException =
  (globalThis as unknown as { DOMException?: unknown }).DOMException ?? class extends Error {};

function freshStore(): MemoryStorage {
  store = new MemoryStorage();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;
  return store;
}

// ---------------------------------------------------------------------------
console.log('Persistence:');
{
  freshStore();
  const save = new SaveManager();
  check('detects that storage works', save.persistent, 'reported unavailable');
  check('starts from defaults', save.state.runs === 0 && save.state.bestScore === 0,
    `runs ${save.state.runs}`);

  save.update((d) => { d.bestScore = 4242; d.runs = 7; d.totalCoins = 900; });
  save.flush(true);
  const reloaded = new SaveManager();
  check('survives a reload', reloaded.state.bestScore === 4242 && reloaded.state.runs === 7,
    `${reloaded.state.bestScore} / ${reloaded.state.runs}`);
}
{
  // A corrupt payload must not stop the game booting. SaveManager logs a
  // warning when it discards one, which is correct — silence it here so the
  // expected stack trace does not clutter the report.
  freshStore().poke(STORE_KEY, '{ this is not json');
  const warn = console.warn;
  console.warn = () => {};
  const save = new SaveManager();
  console.warn = warn;
  check('a corrupt payload falls back to defaults', save.state.runs === 0, `runs ${save.state.runs}`);
  check('the corrupt payload is replaced', (store.raw(STORE_KEY) ?? '').startsWith('{"version"'),
    `${(store.raw(STORE_KEY) ?? '').slice(0, 20)}`);
}
{
  // A save written by an older build of the game. The docstring above has
  // always promised this case and nothing actually covered it: every fixture
  // used the current version number, so the one scenario that costs a real
  // player their history — upgrading the game — was never exercised.
  //
  // `load` deliberately ignores the stored version and coerces field by field,
  // which makes it forward-compatible by construction rather than by a ladder
  // of migrations. These assertions pin that behaviour down.
  freshStore().poke(STORE_KEY, JSON.stringify({
    version: 1,
    bestScore: 3100,
    bestDistance: 1480,
    coins: 220,
    totalCoins: 5400,
    runs: 63,
    achievements: ['ACH_FirstRun', 'ACH_Marathon'],
    // A field this build no longer knows about.
    favouriteHat: 'trilby',
    // Fields added after v1 are simply absent.
  }));
  const save = new SaveManager();
  check('a v1 save keeps the best score', save.state.bestScore === 3100, `${save.state.bestScore}`);
  check('a v1 save keeps the run count', save.state.runs === 63, `${save.state.runs}`);
  check('a v1 save keeps banked coins', save.state.totalCoins === 5400, `${save.state.totalCoins}`);
  check('a v1 save keeps unlocked achievements',
    save.state.achievements.length === 2, JSON.stringify(save.state.achievements));
  check('fields added since v1 get defaults rather than undefined',
    save.state.totalNearMisses === 0 && save.state.topSpeed === 0
      && Number.isFinite(save.state.bestNoHitDistance),
    `nearMisses ${save.state.totalNearMisses}, topSpeed ${save.state.topSpeed}`);
  check('settings added since v1 get defaults',
    typeof save.state.settings.reducedMotion === 'boolean'
      && typeof save.state.settings.quality === 'string',
    JSON.stringify(save.state.settings));
  save.flush(true);
  check('the upgraded save is re-stamped to the current version',
    JSON.parse(store.raw(STORE_KEY) ?? '{}').version === SAVE_VERSION,
    `${JSON.parse(store.raw(STORE_KEY) ?? '{}').version}`);
}
{
  // A save from a *newer* build, which happens whenever someone opens an older
  // deployment or a cached tab. Losing a player's history because their save
  // is from the future would be worse than any corruption case.
  freshStore().poke(STORE_KEY, JSON.stringify({
    version: SAVE_VERSION + 5,
    bestScore: 999,
    runs: 12,
    totalCoins: 77,
    somethingFromTheFuture: { nested: true },
  }));
  const save = new SaveManager();
  check('a save from a newer version still loads',
    save.state.bestScore === 999 && save.state.runs === 12,
    `${save.state.bestScore} / ${save.state.runs}`);
  check('a save from a newer version keeps banked coins',
    save.state.totalCoins === 77, `${save.state.totalCoins}`);
}
{
  // Hostile or partial values must be rejected field by field, not trusted.
  freshStore().poke(STORE_KEY, JSON.stringify({
    version: 3, bestScore: 'lots', runs: -5, totalCoins: null,
    bestDistance: NaN, achievements: ['ACH_FirstRun', 42, null],
    missionsCompleted: 'nope', settings: { musicVolume: 0.3, quality: 'ultra' },
  }));
  const save = new SaveManager();
  check('a non-numeric score is rejected', save.state.bestScore === 0, `${save.state.bestScore}`);
  check('a negative run count is rejected', save.state.runs === 0, `${save.state.runs}`);
  check('a null total is rejected', save.state.totalCoins === 0, `${save.state.totalCoins}`);
  check('NaN is rejected', save.state.bestDistance === 0, `${save.state.bestDistance}`);
  check('non-string achievements are filtered out',
    save.state.achievements.length === 1 && save.state.achievements[0] === 'ACH_FirstRun',
    JSON.stringify(save.state.achievements));
  check('a non-array mission list becomes an array',
    Array.isArray(save.state.missionsCompleted) && save.state.missionsCompleted.length === 0,
    JSON.stringify(save.state.missionsCompleted));
  check('a valid setting is kept', save.settings.musicVolume === 0.3, `${save.settings.musicVolume}`);
  check('missing settings fall back to defaults',
    save.settings.sfxVolume === DEFAULT_SETTINGS.sfxVolume, `${save.settings.sfxVolume}`);
}
{
  // Private browsing: writes throw. The game must still run, just not persist.
  const s = freshStore();
  s.readonly = true;
  const save = new SaveManager();
  check('unavailable storage is detected', !save.persistent, 'claimed to be persistent');
  save.update((d) => { d.runs = 3; });
  save.flush(true);
  check('in-memory progress still works without storage', save.state.runs === 3, `${save.state.runs}`);
}
{
  freshStore();
  const save = new SaveManager();
  save.update((d) => { d.bestScore = 100; });
  save.flush(true);
  save.reset();
  check('reset clears both memory and storage',
    save.state.bestScore === 0 && new SaveManager().state.bestScore === 0, 'value survived');
}

// ---------------------------------------------------------------------------
console.log('\nMissions:');
{
  freshStore();
  const save = new SaveManager();
  const missions = new MissionManager(save);
  check('three missions are active', missions.missions.length === 3, `${missions.missions.length}`);
  check('they come from the lowest tier',
    missions.missions.every((m) => m.def.tier === 1), missions.missions.map((m) => m.def.tier).join(','));

  const completed: string[] = [];
  const off = bus.on('mission:complete', ({ id }) => completed.push(id));
  missions.startRun();

  // Satisfy the tier-1 distance mission and nothing else.
  const stats = {
    score: 0, distance: 600, coins: 0, nearMisses: 0, powerUpsUsed: 0,
    topSpeed: 0, bestMultiplier: 1, noHitDistance: 0, duration: 0,
  };
  missions.update(stats, 0);
  check('a met objective completes', completed.includes('MIS_Run500'), completed.join(','));
  check('an unmet objective does not', !completed.includes('MIS_Coins100'), completed.join(','));
  check('the reward is banked', save.state.coins === 150, `${save.state.coins}`);

  missions.endRun();
  check('a completed mission is replaced', !missions.missions.some((m) => m.def.id === 'MIS_Run500'),
    missions.missions.map((m) => m.def.id).join(','));
  check('completion persists', save.state.missionsCompleted.includes('MIS_Run500'),
    save.state.missionsCompleted.join(','));
  off();
}
{
  // Every mission must be reachable: no metric the tracker cannot supply.
  freshStore();
  const save = new SaveManager();
  const missions = new MissionManager(save);
  const stats = {
    score: 1e9, distance: 1e9, coins: 1e9, nearMisses: 1e9, powerUpsUsed: 1e9,
    topSpeed: 1e9, bestMultiplier: 1e9, noHitDistance: 1e9, duration: 1e9,
  };
  // Drain every tier by repeatedly satisfying everything.
  for (let i = 0; i < MISSION_DEFS.length + 5; i++) {
    missions.startRun();
    missions.update(stats, 1e9);
    missions.endRun();
  }
  check('every mission is completable',
    save.state.missionsCompleted.length === MISSION_DEFS.length,
    `${save.state.missionsCompleted.length}/${MISSION_DEFS.length}`);
  check('the active list empties once all are done', missions.missions.length === 0,
    `${missions.missions.length}`);
}

{
  // The check above feeds 1e9 into every metric, so it proves the tracker can
  // *store* a value, not that the game can *produce* one. It passed for a long
  // time on MIS_Multiplier8 — "Reach the maximum multiplier", target x8 —
  // while the combo cap held the multiplier at x4, making a tier-4 mission
  // impossible to finish. Metrics with a real ceiling are now checked against
  // what the game can actually reach.
  const topMultiplier = (() => {
    const s = new ScoreManager();
    s.reset();
    for (let i = 0; i < CFG.score.comboMax + CFG.score.comboPerMultiplier; i++) s.addCoin();
    return s.multiplier;
  })();
  // Boost multiplies speed after the clamp, so the ceiling is at least the cap.
  const topSpeed = CFG.speed.max;

  const ceilings: Record<string, number> = { multiplier: topMultiplier, topSpeed };
  const unreachable = MISSION_DEFS
    .filter((m) => m.metric in ceilings && m.target > ceilings[m.metric])
    .map((m) => `${m.id} wants ${m.metric} ${m.target}, game reaches ${ceilings[m.metric]}`);
  check('no mission asks for more than the game can produce', unreachable.length === 0,
    unreachable.join('; '));

  const unreachableAch = ACHIEVEMENT_DEFS
    .filter((a) => (a as { metric?: string }).metric === 'topSpeed' &&
      ((a as { target?: number }).target ?? 0) > topSpeed)
    .map((a) => a.id);
  check('no achievement asks for a speed the game cannot reach', unreachableAch.length === 0,
    unreachableAch.join(', '));
  console.log(`  ceilings: multiplier x${topMultiplier}, top speed ${topSpeed} m/s`);
}

// ---------------------------------------------------------------------------
console.log('\nAchievements:');
{
  freshStore();
  const save = new SaveManager();
  const achievements = new AchievementManager(save);
  check('none are unlocked initially', achievements.unlockedCount === 0, `${achievements.unlockedCount}`);

  save.update((d) => { d.runs = 1; });
  const first = achievements.evaluate();
  check('a first run unlocks First Run', first.some((a) => a.id === 'ACH_FirstRun'),
    first.map((a) => a.id).join(','));

  const again = achievements.evaluate();
  check('an achievement does not unlock twice', again.length === 0, again.map((a) => a.id).join(','));

  save.update((d) => {
    d.runs = 1000; d.totalCoins = 1e6; d.totalDistance = 1e6; d.bestScore = 1e7;
    d.topSpeed = 100; d.bestNoHitDistance = 1e5; d.totalNearMisses = 1e5; d.totalPowerUps = 1e5;
  });
  achievements.evaluate();
  check('every achievement is reachable', achievements.unlockedCount === ACHIEVEMENT_DEFS.length,
    `${achievements.unlockedCount}/${ACHIEVEMENT_DEFS.length}`);
  check('unlocks persist', new SaveManager().state.achievements.length === ACHIEVEMENT_DEFS.length,
    `${new SaveManager().state.achievements.length}`);
}

// ---------------------------------------------------------------------------
console.log('\nScore and combo:');
{
  const score = new ScoreManager();
  score.reset();
  for (let i = 0; i < CFG.score.comboPerMultiplier; i++) score.addCoin();
  check('a full combo step raises the multiplier', score.multiplier === 2, `x${score.multiplier}`);

  for (let i = 0; i < CFG.score.comboMax * 2; i++) score.addCoin();
  // Equality, not `<=`: the old form passed at x4 against a cap of x8, which
  // is exactly the state that made MIS_Multiplier8 impossible.
  check('the multiplier reaches its cap and stops there',
    score.multiplier === CFG.score.multiplierMax, `x${score.multiplier} of x${CFG.score.multiplierMax}`);

  score.update(CFG.score.comboWindow + 0.1, 100, 12);
  check('the combo expires after the window', score.multiplier === 1, `x${score.multiplier}`);
}
{
  const score = new ScoreManager();
  score.reset();
  score.update(1, 100, 12);
  const distanceOnly = score.score;
  score.reset();
  score.powerMultiplier = 2;
  score.update(1, 100, 12);
  check('the power-up multiplier scales distance score', score.score > distanceOnly,
    `${score.score} vs ${distanceOnly}`);
}
{
  // noHitDistance is the *longest* clean stretch, which is what the missions
  // and the Untouchable achievement ask for — not the current one.
  const score = new ScoreManager();
  score.reset();
  score.update(1, 300, 12);
  score.onHit(300);
  score.update(1, 1000, 12);
  check('a later, longer clean streak replaces an earlier one',
    Math.abs(score.stats.noHitDistance - 700) < 20, `${score.stats.noHitDistance.toFixed(0)} m`);

  score.onHit(1000);
  score.update(1, 1100, 12);
  check('a shorter streak afterwards does not reduce the best',
    Math.abs(score.stats.noHitDistance - 700) < 20, `${score.stats.noHitDistance.toFixed(0)} m`);

  const fresh = new ScoreManager();
  fresh.reset();
  fresh.update(1, 900, 12);
  check('a run with no hits counts the whole distance',
    Math.abs(fresh.stats.noHitDistance - 900) < 20, `${fresh.stats.noHitDistance.toFixed(0)} m`);
}

// ---------------------------------------------------------------------------
console.log('\nDifficulty and zones:');
{
  const d = new DifficultyManager();
  d.reset();
  check('starts at zero', d.current === 0, `${d.current}`);
  d.update(CFG.difficulty.rampDistance, 1 / 60);
  check('reaches maximum at the ramp distance', Math.abs(d.current - 1) < 1e-6, `${d.current}`);
  d.update(CFG.difficulty.rampDistance * 10, 1 / 60);
  check('never exceeds maximum', d.current <= 1, `${d.current}`);

  d.reset();
  d.update(CFG.difficulty.rampDistance * 0.5, 1 / 60);
  const before = d.current;
  d.grantRelief();
  check('a stumble eases the difficulty', d.current < before, `${before} -> ${d.current}`);
  for (let i = 0; i < 60 * 20; i++) d.update(CFG.difficulty.rampDistance * 0.5, 1 / 60);
  check('relief wears off', Math.abs(d.current - before) < 1e-6, `${d.current} vs ${before}`);

  d.setCeiling(0.1);
  check('the ceiling clamps the difficulty', d.current <= 0.1, `${d.current}`);
}
{
  // Monotonic pressure: density and reaction time must move the right way.
  const easy = new DifficultyManager();
  easy.reset();
  easy.update(100, 1 / 60);
  const hard = new DifficultyManager();
  hard.reset();
  hard.update(CFG.difficulty.rampDistance, 1 / 60);
  check('obstacle density rises with difficulty', hard.obstacleDensity > easy.obstacleDensity,
    `${easy.obstacleDensity.toFixed(2)} -> ${hard.obstacleDensity.toFixed(2)}`);
  check('bonus coins thin out as it gets harder', hard.bonusCoinChance < easy.bonusCoinChance,
    `${easy.bonusCoinChance.toFixed(2)} -> ${hard.bonusCoinChance.toFixed(2)}`);
  check('moving hazards only appear later', easy.dynamicChance === 0 && hard.dynamicChance > 0,
    `${easy.dynamicChance} -> ${hard.dynamicChance}`);
}
{
  const seen = new Set<string>();
  for (let dist = 0; dist < 8000; dist += 50) seen.add(zoneAt(dist).zone.id);
  check('every zone is reached within a long run', seen.size === ZONES.length,
    `${seen.size}/${ZONES.length}: ${[...seen].join(', ')}`);
  check('the first zone starts at zero', zoneAt(0).zone.id === ZONES[0].id, zoneAt(0).zone.id);

  // Zones cycle rather than sticking on the last one forever.
  const late = new Set<string>();
  for (let dist = 20000; dist < 30000; dist += 50) late.add(zoneAt(dist).zone.id);
  check('zones keep cycling on a very long run', late.size > 1, `${late.size}`);

  let blendOk = true;
  for (let dist = 0; dist < 8000; dist += 13) {
    const b = zoneAt(dist).blend;
    if (!(b >= 0 && b <= 1)) blendOk = false;
  }
  check('the zone blend stays in range', blendOk, 'blend left 0..1');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
