import { CFG } from '../core/Config';
import { bus } from '../core/EventBus';

/**
 * Score, combo and multiplier.
 *
 * Distance is the baseline; coins and near misses are the skill expression.
 * The combo counter decays if the player stops taking risks, so a high
 * multiplier has to be maintained rather than banked.
 */
export interface RunStats {
  score: number;
  distance: number;
  coins: number;
  nearMisses: number;
  powerUpsUsed: number;
  topSpeed: number;
  bestMultiplier: number;
  /** Longest stretch without taking a hit, in metres. */
  noHitDistance: number;
  duration: number;
}

export class ScoreManager {
  private scoreValue = 0;
  private distanceScore = 0;
  private combo = 0;
  private comboTimer = 0;
  private multiplierValue = 1;
  /** Set by the score-multiplier power-up. */
  powerMultiplier = 1;
  /** Set by the coin-value power-up. */
  coinMultiplier = 1;

  private lastHitDistance = 0;

  readonly stats: RunStats = {
    score: 0, distance: 0, coins: 0, nearMisses: 0, powerUpsUsed: 0,
    topSpeed: 0, bestMultiplier: 1, noHitDistance: 0, duration: 0,
  };

  reset(): void {
    this.scoreValue = 0;
    this.distanceScore = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.multiplierValue = 1;
    this.powerMultiplier = 1;
    this.coinMultiplier = 1;
    this.lastHitDistance = 0;
    Object.assign(this.stats, {
      score: 0, distance: 0, coins: 0, nearMisses: 0, powerUpsUsed: 0,
      topSpeed: 0, bestMultiplier: 1, noHitDistance: 0, duration: 0,
    });
    this.emit();
  }

  get score(): number {
    return Math.floor(this.scoreValue);
  }

  get multiplier(): number {
    return this.multiplierValue * this.powerMultiplier;
  }

  get comboCount(): number {
    return this.combo;
  }

  /** Fraction of the way to the next multiplier step, for the HUD ring. */
  get comboProgress(): number {
    const step = CFG.score.comboPerMultiplier;
    return (this.combo % step) / step;
  }

  get comboTimeLeft(): number {
    return Math.max(0, this.comboTimer);
  }

  update(dt: number, distance: number, speed: number): void {
    this.stats.duration += dt;
    this.stats.distance = distance;
    this.stats.topSpeed = Math.max(this.stats.topSpeed, speed);
    this.stats.noHitDistance = Math.max(this.stats.noHitDistance, distance - this.lastHitDistance);

    const gained = speed * dt * CFG.score.perMetre;
    this.distanceScore += gained;
    this.scoreValue += gained * this.multiplier;

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.breakCombo();
    }
    this.stats.score = this.score;
  }

  /** Coins and near misses both feed the combo. */
  addCoin(value: number = CFG.score.perCoin): number {
    const amount = value * this.coinMultiplier;
    this.scoreValue += amount * this.multiplier;
    this.stats.coins++;
    this.bumpCombo();
    return amount;
  }

  addNearMiss(): void {
    this.scoreValue += CFG.score.nearMiss * this.multiplier;
    this.stats.nearMisses++;
    this.bumpCombo(2);
    bus.emit('ui:toast', { text: 'Near miss +' + Math.round(CFG.score.nearMiss * this.multiplier), tone: 'good' });
  }

  addBonus(amount: number): void {
    this.scoreValue += amount;
    this.stats.score = this.score;
    this.emit();
  }

  private bumpCombo(step: number = CFG.score.comboStep): void {
    this.combo = Math.min(CFG.score.comboMax, this.combo + step);
    this.comboTimer = CFG.score.comboWindow;
    const tier = 1 + Math.floor(this.combo / CFG.score.comboPerMultiplier);
    this.multiplierValue = Math.min(CFG.score.multiplierMax, tier);
    this.stats.bestMultiplier = Math.max(this.stats.bestMultiplier, this.multiplier);
    this.emit();
  }

  private breakCombo(): void {
    this.combo = 0;
    this.multiplierValue = 1;
    this.emit();
  }

  /** A hit resets the combo and closes the current clean-run streak. */
  onHit(distance: number): void {
    this.breakCombo();
    this.stats.noHitDistance = Math.max(this.stats.noHitDistance, distance - this.lastHitDistance);
    this.lastHitDistance = distance;
  }

  onPowerUp(): void {
    this.stats.powerUpsUsed++;
  }

  private emit(): void {
    bus.emit('score:changed', { score: this.score, multiplier: this.multiplier, combo: this.combo });
  }
}
