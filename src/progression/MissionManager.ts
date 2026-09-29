import { ACHIEVEMENT_DEFS, MISSION_DEFS } from '../../data/missions';
import { bus } from '../core/EventBus';
import { AchievementDef, MissionDef } from '../core/Types';
import { SaveManager } from '../save/SaveManager';
import { RunStats } from './ScoreManager';

/**
 * Missions are per-run objectives drawn from the lowest tier the player has
 * not cleared. Achievements are lifetime milestones. Both read from the same
 * stats so there is one source of truth for "what did the player do".
 */

export interface MissionProgress {
  def: MissionDef;
  value: number;
  complete: boolean;
}

const ACTIVE_COUNT = 3;

export class MissionManager {
  private active: MissionProgress[] = [];
  private completedThisRun: MissionDef[] = [];

  constructor(private readonly save: SaveManager) {
    this.refreshActive();
  }

  /** Picks the next three unfinished missions, lowest tier first. */
  refreshActive(): void {
    const done = new Set(this.save.state.missionsCompleted);
    const remaining = MISSION_DEFS.filter((m) => !done.has(m.id)).sort((a, b) => a.tier - b.tier);
    this.active = remaining.slice(0, ACTIVE_COUNT).map((def) => ({ def, value: 0, complete: false }));
    this.save.update((d) => {
      d.activeMissions = this.active.map((m) => m.def.id);
    });
  }

  get missions(): readonly MissionProgress[] {
    return this.active;
  }

  get completed(): readonly MissionDef[] {
    return this.completedThisRun;
  }

  /** All missions with their lifetime completion state, for the panel. */
  get allWithState(): Array<{ def: MissionDef; complete: boolean; active: boolean }> {
    const done = new Set(this.save.state.missionsCompleted);
    const activeIds = new Set(this.active.map((m) => m.def.id));
    return MISSION_DEFS.map((def) => ({
      def,
      complete: done.has(def.id),
      active: activeIds.has(def.id),
    }));
  }

  startRun(): void {
    this.completedThisRun = [];
    for (const m of this.active) {
      m.value = 0;
      m.complete = false;
    }
  }

  /** Called every frame with the live run stats. */
  update(stats: RunStats, runsCompleted: number): void {
    for (const m of this.active) {
      if (m.complete) continue;
      const value = this.metricValue(m.def, stats, runsCompleted);
      if (value <= m.value) continue;
      m.value = value;
      bus.emit('mission:progress', { id: m.def.id, value, target: m.def.target });
      if (value >= m.def.target) {
        m.complete = true;
        this.completedThisRun.push(m.def);
        this.save.update((d) => {
          if (!d.missionsCompleted.includes(m.def.id)) d.missionsCompleted.push(m.def.id);
          d.coins += m.def.reward;
        });
        bus.emit('mission:complete', { id: m.def.id, label: m.def.label, reward: m.def.reward });
      }
    }
  }

  private metricValue(def: MissionDef, stats: RunStats, runsCompleted: number): number {
    switch (def.metric) {
      case 'distance': return stats.distance;
      case 'coins': return stats.coins;
      case 'nearMiss': return stats.nearMisses;
      case 'powerUps': return stats.powerUpsUsed;
      case 'multiplier': return stats.bestMultiplier;
      case 'noHitDistance': return stats.noHitDistance;
      case 'score': return stats.score;
      case 'runs': return runsCompleted;
      default: return 0;
    }
  }

  /** After a run: bank progress and roll in replacements for cleared missions. */
  endRun(): void {
    if (this.completedThisRun.length > 0) this.refreshActive();
    this.save.flush(true);
  }
}

export class AchievementManager {
  constructor(private readonly save: SaveManager) {}

  get all(): Array<{ def: AchievementDef; unlocked: boolean }> {
    const unlocked = new Set(this.save.state.achievements);
    return ACHIEVEMENT_DEFS.map((def) => ({ def, unlocked: unlocked.has(def.id) }));
  }

  get unlockedCount(): number {
    return this.save.state.achievements.length;
  }

  /** Evaluated once per run end against lifetime totals. */
  evaluate(): AchievementDef[] {
    const s = this.save.state;
    const unlocked = new Set(s.achievements);
    const newly: AchievementDef[] = [];

    for (const def of ACHIEVEMENT_DEFS) {
      if (unlocked.has(def.id)) continue;
      let value = 0;
      switch (def.metric) {
        case 'totalDistance': value = s.totalDistance; break;
        case 'totalCoins': value = s.totalCoins; break;
        case 'bestScore': value = s.bestScore; break;
        case 'topSpeed': value = s.topSpeed; break;
        case 'noHitDistance': value = s.bestNoHitDistance; break;
        case 'nearMiss': value = s.totalNearMisses; break;
        case 'runs': value = s.runs; break;
        case 'powerUps': value = s.totalPowerUps; break;
      }
      if (value >= def.target) {
        newly.push(def);
        this.save.update((d) => d.achievements.push(def.id));
        bus.emit('achievement:unlocked', { id: def.id, label: def.label });
      }
    }
    if (newly.length > 0) this.save.flush(true);
    return newly;
  }
}
