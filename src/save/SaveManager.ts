import { bus } from '../core/EventBus';

/**
 * Persistence. Everything is versioned and defensively parsed: a corrupted or
 * older payload degrades to defaults rather than breaking the boot sequence.
 */

export const SAVE_VERSION = 3;
const STORAGE_KEY = 'neon-run.save.v3';

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  quality: 'low' | 'medium' | 'high';
  shadows: boolean;
  cameraShake: boolean;
  showFps: boolean;
  invertSwipe: boolean;
  reducedMotion: boolean;
}

export interface SaveData {
  version: number;
  bestScore: number;
  bestDistance: number;
  coins: number;
  totalCoins: number;
  totalDistance: number;
  runs: number;
  topSpeed: number;
  bestNoHitDistance: number;
  totalNearMisses: number;
  totalPowerUps: number;
  missionsCompleted: string[];
  activeMissions: string[];
  achievements: string[];
  settings: Settings;
  lastPlayed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.55,
  sfxVolume: 0.8,
  quality: 'high',
  shadows: true,
  cameraShake: true,
  showFps: false,
  invertSwipe: false,
  reducedMotion: false,
};

function defaults(): SaveData {
  return {
    version: SAVE_VERSION,
    bestScore: 0,
    bestDistance: 0,
    coins: 0,
    totalCoins: 0,
    totalDistance: 0,
    runs: 0,
    topSpeed: 0,
    bestNoHitDistance: 0,
    totalNearMisses: 0,
    totalPowerUps: 0,
    missionsCompleted: [],
    activeMissions: [],
    achievements: [],
    settings: { ...DEFAULT_SETTINGS },
    lastPlayed: 0,
  };
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export class SaveManager {
  private data: SaveData = defaults();
  private dirty = false;
  private lastWrite = 0;
  /** Set when storage is unavailable (private mode, disabled cookies). */
  readonly persistent: boolean;

  constructor() {
    this.persistent = SaveManager.storageAvailable();
    this.load();
  }

  private static storageAvailable(): boolean {
    try {
      const probe = '__neon_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  get state(): Readonly<SaveData> {
    return this.data;
  }

  get settings(): Settings {
    return this.data.settings;
  }

  load(): void {
    if (!this.persistent) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const base = defaults();
      this.data = {
        version: SAVE_VERSION,
        bestScore: num(parsed.bestScore, base.bestScore),
        bestDistance: num(parsed.bestDistance, base.bestDistance),
        coins: num(parsed.coins, base.coins),
        totalCoins: num(parsed.totalCoins, base.totalCoins),
        totalDistance: num(parsed.totalDistance, base.totalDistance),
        runs: num(parsed.runs, base.runs),
        topSpeed: num(parsed.topSpeed, base.topSpeed),
        bestNoHitDistance: num(parsed.bestNoHitDistance, base.bestNoHitDistance),
        totalNearMisses: num(parsed.totalNearMisses, base.totalNearMisses),
        totalPowerUps: num(parsed.totalPowerUps, base.totalPowerUps),
        missionsCompleted: strings(parsed.missionsCompleted),
        activeMissions: strings(parsed.activeMissions),
        achievements: strings(parsed.achievements),
        settings: { ...base.settings, ...(typeof parsed.settings === 'object' && parsed.settings ? parsed.settings : {}) },
        lastPlayed: num(parsed.lastPlayed, 0),
      };
    } catch (err) {
      // A corrupt payload must never stop the game from booting.
      console.warn('[Save] corrupt save discarded', err);
      this.data = defaults();
      this.dirty = true;
      this.flush(true);
    }
  }

  /** Applies a mutation and marks the save dirty. */
  update(mutator: (data: SaveData) => void): void {
    mutator(this.data);
    this.dirty = true;
  }

  /** Writes at most once every two seconds unless forced. */
  flush(force = false): void {
    if (!this.dirty && !force) return;
    if (!this.persistent) {
      this.dirty = false;
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastWrite < 2000) return;
    this.data.lastPlayed = now;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.lastWrite = now;
      this.dirty = false;
    } catch (err) {
      console.warn('[Save] write failed', err);
    }
  }

  applySettings(patch: Partial<Settings>): void {
    Object.assign(this.data.settings, patch);
    this.dirty = true;
    this.flush(true);
    bus.emit('audio:settings', {});
  }

  reset(): void {
    this.data = defaults();
    this.dirty = true;
    this.flush(true);
  }
}
