import { bus } from '../core/EventBus';

/**
 * Persistence. Everything is versioned and defensively parsed: a corrupted or
 * older payload degrades to defaults rather than breaking the boot sequence.
 */

export const SAVE_VERSION = 3;
const STORAGE_KEY = 'neon-run.save.v3';

/**
 * The actions a player can move to a different key.
 *
 * `confirm` is deliberately absent. It is how a menu is operated, so a player
 * who rebound it to a key they then could not press would have no way back
 * into the game — the one binding that must never be lost.
 */
export const BINDABLE_ACTIONS = ['left', 'right', 'jump', 'slide', 'pause'] as const;
export type BindableAction = typeof BINDABLE_ACTIONS[number];

/**
 * Physical key codes per action, in the order they are shown.
 *
 * These are `KeyboardEvent.code` values, which name a key by its position
 * rather than by the letter printed on it. That is what makes the default
 * WASD binding land on the same three-and-one cluster on AZERTY and Dvorak as
 * it does on QWERTY; it also means a code is not a label, so the settings
 * panel asks the browser for the layout before naming a key.
 */
export type KeyBindings = Record<BindableAction, string[]>;

export const DEFAULT_BINDINGS: KeyBindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['ArrowUp', 'KeyW', 'Space'],
  slide: ['ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
};

export const QUALITY_LEVELS = ['low', 'medium', 'high'] as const;

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  quality: typeof QUALITY_LEVELS[number];
  shadows: boolean;
  cameraShake: boolean;
  showFps: boolean;
  invertSwipe: boolean;
  reducedMotion: boolean;
  keyBindings: KeyBindings;
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
  keyBindings: DEFAULT_BINDINGS,
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
    // Through the reader, so the returned bindings are a fresh copy rather
    // than a shared reference into DEFAULT_BINDINGS.
    settings: readSettings(DEFAULT_SETTINGS),
    lastPlayed: 0,
  };
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function unit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Reads the stored bindings, keeping every action playable.
 *
 * An action with no keys left cannot be performed at all, so an empty or
 * unusable list falls back to its default rather than stranding the player
 * mid-air with no way to land.
 */
export function readBindings(value: unknown): KeyBindings {
  const source = (typeof value === 'object' && value ? value : {}) as Record<string, unknown>;
  const out = {} as KeyBindings;
  for (const action of BINDABLE_ACTIONS) {
    const keys = strings(source[action]).filter((k) => k.length > 0);
    // Duplicates within one action would show the same key twice in settings.
    const unique = [...new Set(keys)];
    out[action] = unique.length > 0 ? unique : [...DEFAULT_BINDINGS[action]];
  }
  return out;
}

/** The outcome of a rebind: the new bindings, or why it was refused. */
export type RebindResult =
  | { ok: true; bindings: KeyBindings }
  | { ok: false; reason: 'reserved' | 'last-key'; conflict?: BindableAction };

/**
 * Moves one key onto one action, keeping every action playable.
 *
 * A key can only mean one thing, so taking it from whichever action held it is
 * the point of a rebind rather than an error — except when that action has no
 * other key, which would leave it unperformable. That case is refused and
 * explained instead, so a player cannot quietly delete their own ability to
 * jump while trying to reach the slide key.
 *
 * Pure, and separate from the panel that calls it, because the interesting
 * cases are the ones a click test would never think to try.
 */
export function rebind(
  bindings: KeyBindings,
  action: BindableAction,
  slot: number,
  code: string,
): RebindResult {
  if (code === 'Enter') return { ok: false, reason: 'reserved' };

  const next = {} as KeyBindings;
  for (const a of BINDABLE_ACTIONS) next[a] = [...bindings[a]];

  for (const other of BINDABLE_ACTIONS) {
    if (other === action || !next[other].includes(code)) continue;
    if (next[other].length === 1) return { ok: false, reason: 'last-key', conflict: other };
    next[other] = next[other].filter((k) => k !== code);
  }

  const target = next[action];
  if (slot >= 0 && slot < target.length) target[slot] = code;
  else target.push(code);
  next[action] = [...new Set(target)];

  return { ok: true, bindings: next };
}

/**
 * Validates a settings payload field by field.
 *
 * Every other part of the save is parsed defensively; settings used to be
 * spread in wholesale, which meant one out-of-range value could stop the game
 * booting at all. A `quality` outside the three known levels reached
 * `QUALITY_PROFILE[quality]` as `undefined` on the first boot frame and threw
 * — and because the bad value was read again on every reload, the game stayed
 * broken until the player cleared their site data. Nothing here can throw:
 * anything unrecognised becomes the default for that one field.
 */
export function readSettings(value: unknown): Settings {
  const v = (typeof value === 'object' && value ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    musicVolume: unit(v.musicVolume, d.musicVolume),
    sfxVolume: unit(v.sfxVolume, d.sfxVolume),
    quality: oneOf(v.quality, QUALITY_LEVELS, d.quality),
    shadows: bool(v.shadows, d.shadows),
    cameraShake: bool(v.cameraShake, d.cameraShake),
    showFps: bool(v.showFps, d.showFps),
    invertSwipe: bool(v.invertSwipe, d.invertSwipe),
    reducedMotion: bool(v.reducedMotion, d.reducedMotion),
    keyBindings: readBindings(v.keyBindings),
  };
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
        settings: readSettings(parsed.settings),
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
    // Re-validated rather than merged blind, so the same guarantee holds for a
    // live change as for a stored one.
    this.data.settings = readSettings({ ...this.data.settings, ...patch });
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
