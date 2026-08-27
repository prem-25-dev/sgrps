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

  reset(): void {
    this.value = 0;
    this.relief = 0;
  }

  update(distance: number, dt: number): void {
    const raw = Math.min(1, distance / CFG.difficulty.rampDistance);
    // Ease the curve: the first few hundred metres stay gentle, the top end
    // approaches 1 asymptotically rather than slamming into it.
    this.value = Math.pow(raw, 0.78);
    this.relief = Math.max(0, this.relief - dt * 0.25);
  }

  /** Called when the player takes a survivable hit. */
  grantRelief(amount = 0.28): void {
    this.relief = Math.min(0.5, this.relief + amount);
  }

  /** Difficulty the generator should build to right now. */
  get current(): number {
    return Math.max(0, this.value - this.relief);
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
