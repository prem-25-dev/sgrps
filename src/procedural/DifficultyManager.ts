import { CFG } from '../core/Config';

/**
 * Difficulty is one normalised number, 0 (tutorial) to 1 (extreme). Every
 * system that scales with pressure reads it from here so the curve can be
 * retuned in one place.
 */
export class DifficultyManager {
  private value = 0;
  /** Temporary relief applied after a stumble so a recovery is winnable. */
  private relief = 0;
  /** Hard ceiling, used to hold the world gentle while the tutorial runs. */
  private ceiling = 1;

  reset(): void {
    this.value = 0;
    this.relief = 0;
    this.ceiling = 1;
  }

  /** Clamps how hard the generator is allowed to build. */
  setCeiling(ceiling: number): void {
    this.ceiling = Math.min(1, Math.max(0, ceiling));
  }

  update(distance: number, dt: number): void {
    const raw = Math.min(1, distance / CFG.difficulty.rampDistance);
    // An exponent below one sits above the linear ramp for the whole climb, so
    // pressure arrives early and then flattens rather than slamming into 1.
    // The player leaves "Warm up" at 369 m rather than 630, and meets moving
    // hazards at 1,509 m rather than 1,890. Whether that front-loading was
    // intended is not recorded — the comment here used to describe the curve
    // as a gentle start, which is what an exponent ABOVE one gives, so the
    // exponent and the intent may never have agreed. Changing it is a balance
    // decision, not a fix. `test:difficulty` pins the shape and the landmarks
    // so either choice is deliberate.
    this.value = Math.pow(raw, 0.78);
    this.relief = Math.max(0, this.relief - dt * 0.25);
  }

  /** Called when the player takes a survivable hit. */
  grantRelief(amount = 0.28): void {
    this.relief = Math.min(0.5, this.relief + amount);
  }

  /** Difficulty the generator should build to right now. */
  get current(): number {
    return Math.min(this.ceiling, Math.max(0, this.value - this.relief));
  }

  /** Raw curve without relief, used for scoring and the HUD. */
  get raw(): number {
    return this.value;
  }

  /** Fraction of segments that should carry obstacles. */
  get obstacleDensity(): number {
    const d = this.current;
    return CFG.difficulty.densityEasy + (CFG.difficulty.densityHard - CFG.difficulty.densityEasy) * d;
  }

  /** How often a power-up should appear, per segment. */
  get powerUpChance(): number {
    // Power-ups get slightly more common as the game gets harder.
    return 0.06 + this.current * 0.06;
  }

  /** How often a coin pattern should appear when the template has none. */
  get bonusCoinChance(): number {
    return 0.45 - this.current * 0.15;
  }

  /** Chance a segment uses a moving hazard. */
  get dynamicChance(): number {
    return Math.max(0, (this.current - 0.45) * 0.5);
  }

  get label(): string {
    const d = this.current;
    if (d < 0.15) return 'Warm up';
    if (d < 0.35) return 'Cruising';
    if (d < 0.55) return 'Pressure';
    if (d < 0.75) return 'Hard';
    if (d < 0.9) return 'Brutal';
    return 'Extreme';
  }
}
