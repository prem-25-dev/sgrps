import { POWERUP_DEFS } from '../../data/powerups';
import { bus } from '../core/EventBus';
import { GameState } from '../core/Types';
import { AudioManager } from '../audio/AudioManager';
import { AchievementManager, MissionManager } from '../progression/MissionManager';
import { RunStats } from '../progression/ScoreManager';
import * as fullscreen from './Fullscreen';
import {
  SaveManager, Settings, BINDABLE_ACTIONS, BindableAction, DEFAULT_BINDINGS, rebind,
} from '../save/SaveManager';

/**
 * The whole interface: loading, menu, HUD, pause, game over, missions,
 * achievements and settings. Built as real DOM so it is crisp at any DPI,
 * keyboard navigable, and costs nothing on the render thread.
 */

export interface UICallbacks {
  onPlay(): void;
  onResume(): void;
  onRestart(): void;
  onHome(): void;
  onOpen(panel: 'missions' | 'achievements' | 'settings'): void;
  onClosePanel(): void;
  onSettingChange(patch: Partial<Settings>): void;
  /** Suspends game input while the settings panel waits for a key to bind. */
  onCaptureKeys(active: boolean): void;
  /** What a key currently does, so a clash can be reported before it happens. */
  actionFor(code: string): string | null;
}

const ACTION_LABEL: Record<BindableAction, string> = {
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump',
  slide: 'Slide',
  pause: 'Pause',
};

/**
 * Names a physical key for a human.
 *
 * `KeyboardEvent.code` names a position, not a letter, so `KeyA` is the key
 * printed A on QWERTY and Q on AZERTY. Chromium exposes the real mapping via
 * `navigator.keyboard.getLayoutMap()`; where it is missing the code is
 * prettified instead, which is right for everyone on a QWERTY-like layout and
 * at least unambiguous for everyone else.
 */
const KEY_ALIAS: Record<string, string> = {
  ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193',
  Space: 'Space', Escape: 'Esc', Enter: 'Enter',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt',
};

function prettyKey(code: string, layout?: Map<string, string>): string {
  const alias = KEY_ALIAS[code];
  if (alias) return alias;
  const printed = layout?.get(code);
  if (printed) return printed.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

const POWERUP_ICON: Record<string, string> = {
  PWR_Magnet_01: 'M',
  PWR_Shield_01: 'S',
  PWR_Multiplier_01: '2x',
  PWR_Boost_01: '>>',
  PWR_CoinValue_01: 'C',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function fmt(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

function metres(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)} km` : `${Math.floor(n)} m`;
}

export class UIManager {
  private root: HTMLElement;
  private screens = new Map<string, HTMLElement>();

  // Live HUD nodes, cached so the per-frame update touches no selectors.
  private scoreEl!: HTMLElement;
  private distanceEl!: HTMLElement;
  private coinsEl!: HTMLElement;
  private multiplierEl!: HTMLElement;
  private comboFill!: HTMLElement;
  private powerupsEl!: HTMLElement;
  private missionTrackEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private toastsEl!: HTMLElement;
  private zoneBanner!: HTMLElement;
  private tutorialEl!: HTMLElement;
  private tutorialShown = '';
  private loadingFill!: HTMLElement;
  private loadingLabel!: HTMLElement;

  private lastScore = -1;
  private lastCoins = -1;
  private lastDistance = -1;
  private powerupNodes = new Map<string, { chip: HTMLElement; bar: HTMLElement }>();

  constructor(
    container: HTMLElement,
    private readonly save: SaveManager,
    private readonly missions: MissionManager,
    private readonly achievements: AchievementManager,
    private readonly audio: AudioManager,
    private readonly callbacks: UICallbacks,
  ) {
    this.root = el('div');
    this.root.id = 'ui';
    container.appendChild(this.root);

    this.buildLoading();
    this.buildMenu();
    this.buildHud();
    this.buildPause();
    this.buildGameOver();
    this.buildMissions();
    this.buildAchievements();
    this.buildSettings();
    this.bindEvents();
  }

  // ---------------------------------------------------------------- Screens

  private addScreen(id: string, overlay = false): HTMLElement {
    const screen = el('div', `screen${overlay ? ' overlay' : ''}`);
    screen.id = id;
    this.root.appendChild(screen);
    this.screens.set(id, screen);
    return screen;
  }

  private show(id: string): void {
    for (const [key, node] of this.screens) {
      if (key === 'hud') continue;
      node.classList.toggle('active', key === id);
    }
  }

  private hideAll(): void {
    for (const [key, node] of this.screens) {
      if (key === 'hud') continue;
      node.classList.remove('active');
    }
  }

  setHudVisible(visible: boolean): void {
    this.screens.get('hud')?.classList.toggle('active', visible);
  }

  /** Drives which screen is on for a given game state. */
  onState(state: GameState): void {
    switch (state) {
      case GameState.LOADING: this.show('loading'); this.setHudVisible(false); break;
      case GameState.MAIN_MENU: this.show('menu'); this.setHudVisible(false); this.refreshMenu(); break;
      case GameState.PLAYING:
      case GameState.TUTORIAL: this.hideAll(); this.setHudVisible(true); break;
      case GameState.PAUSED: this.show('pause'); break;
      case GameState.GAME_OVER: this.show('gameover'); this.setHudVisible(false); break;
      case GameState.MISSIONS: this.show('missions'); this.refreshMissions(); break;
      case GameState.ACHIEVEMENTS: this.show('achievements'); this.refreshAchievements(); break;
      case GameState.SETTINGS: this.show('settings'); this.refreshSettings(); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- Loading

  private buildLoading(): void {
    const screen = this.addScreen('loading');
    screen.classList.add('active');
    const wrap = el('div');
    wrap.style.display = 'grid';
    wrap.style.placeItems = 'center';
    wrap.style.height = '100%';
    wrap.style.gap = 'calc(var(--u) * 1.4)';

    wrap.appendChild(el('div', 'logo', 'NEON<br>RUN<small>Endless</small>'));
    const bar = el('div', 'loading-bar');
    this.loadingFill = el('div', 'loading-fill');
    bar.appendChild(this.loadingFill);
    wrap.appendChild(bar);
    this.loadingLabel = el('div', 'loading-label', 'Building the world');
    wrap.appendChild(this.loadingLabel);
    screen.appendChild(wrap);
  }

  setLoadingProgress(fraction: number, label: string): void {
    this.loadingFill.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    this.loadingLabel.textContent = label;
  }

  // ------------------------------------------------------------------- Menu

  private menuStats!: HTMLElement;

  private buildMenu(): void {
    const screen = this.addScreen('menu');
    const top = el('div', 'menu-top');
    top.appendChild(el('div', 'logo', 'NEON<br>RUN<small>Endless</small>'));

    const actions = el('div', 'menu-actions');
    const play = el('button', 'primary');
    play.textContent = 'Play';
    play.addEventListener('click', () => { this.click(); this.callbacks.onPlay(); });
    actions.appendChild(play);

    const row = el('div');
    row.style.display = 'flex';
    row.style.gap = 'calc(var(--u) * 0.5)';
    for (const [label, panel] of [
      ['Missions', 'missions'],
      ['Achievements', 'achievements'],
      ['Settings', 'settings'],
    ] as const) {
      const b = el('button', 'small');
      b.textContent = label;
      b.style.flex = '1';
      b.style.justifyContent = 'center';
      b.addEventListener('click', () => { this.click(); this.callbacks.onOpen(panel); });
      row.appendChild(b);
    }
    actions.appendChild(row);

    const fs = this.fullscreenButton();
    if (fs) {
      fs.button.style.width = '100%';
      actions.append(fs.button, fs.note);
    }
    top.appendChild(actions);

    const hint = el('div', 'hint');
    hint.innerHTML = 'Swipe or use the keys to move, jump and slide.';
    const keys = el('div', 'keys');
    keys.innerHTML = '<kbd>&larr;</kbd><kbd>&rarr;</kbd> lane <kbd>&uarr;</kbd> / <kbd>Space</kbd> jump <kbd>&darr;</kbd> / <kbd>Shift</kbd> slide <kbd>Esc</kbd> pause';
    hint.appendChild(keys);
    top.appendChild(hint);

    screen.appendChild(top);
    this.menuStats = el('div', 'menu-stats');
    screen.appendChild(this.menuStats);
  }

  private refreshMenu(): void {
    const s = this.save.state;
    this.menuStats.innerHTML = '';
    const cells: Array<[string, string]> = [
      [fmt(s.bestScore), 'Best score'],
      [metres(s.bestDistance), 'Best distance'],
      [fmt(s.coins), 'Coins'],
      [fmt(s.runs), 'Runs'],
      [`${this.achievements.unlockedCount}/${this.achievements.all.length}`, 'Achievements'],
    ];
    for (const [value, label] of cells) {
      const stat = el('div', 'stat');
      stat.appendChild(el('b', undefined, value));
      stat.appendChild(el('span', undefined, label));
      this.menuStats.appendChild(stat);
    }
    if (!this.save.persistent) {
      const warn = el('div', 'hint', 'Progress cannot be saved in this browser session.');
      this.menuStats.appendChild(warn);
    }
  }

  // -------------------------------------------------------------------- HUD

  private buildHud(): void {
    const screen = this.addScreen('hud');
    screen.classList.remove('overlay');

    const left = el('div', 'hud-row hud-left');
    this.scoreEl = el('div', 'hud-score', '0');
    left.appendChild(this.scoreEl);
    left.appendChild(el('div', 'hud-label', 'Score'));
    this.distanceEl = el('div', 'hud-distance', '0 m');
    left.appendChild(this.distanceEl);
    screen.appendChild(left);

    const centre = el('div', 'hud-row hud-centre');
    this.multiplierEl = el('div', 'multiplier', 'x1');
    centre.appendChild(this.multiplierEl);
    const bar = el('div', 'combo-bar');
    this.comboFill = el('div', 'combo-fill');
    bar.appendChild(this.comboFill);
    centre.appendChild(bar);
    screen.appendChild(centre);

    const right = el('div', 'hud-row hud-right');
    this.coinsEl = el('div', 'hud-coins', '<i class="coin-dot"></i><span>0</span>');
    right.appendChild(this.coinsEl);
    screen.appendChild(right);

    this.powerupsEl = el('div', 'powerups');
    screen.appendChild(this.powerupsEl);

    this.missionTrackEl = el('div', 'mission-track');
    screen.appendChild(this.missionTrackEl);

    // Not on this screen: the HUD is hidden outside a run, and a message
    // raised from the menu — "this page cannot go full screen", say — would
    // never be seen. Toasts live on the interface root so they show wherever
    // they are raised from.
    this.toastsEl = el('div');
    this.toastsEl.id = 'toasts';
    this.root.appendChild(this.toastsEl);

    this.zoneBanner = el('div', 'zone-banner');
    screen.appendChild(this.zoneBanner);

    this.tutorialEl = el('div', 'tutorial');
    screen.appendChild(this.tutorialEl);

    this.fpsEl = el('div');
    this.fpsEl.id = 'fps';
    screen.appendChild(this.fpsEl);
  }

  /** Called every frame. Writes only what changed. */
  updateHud(score: number, distance: number, coins: number, multiplier: number, comboProgress: number): void {
    if (score !== this.lastScore) {
      this.scoreEl.textContent = fmt(score);
      this.lastScore = score;
    }
    const rounded = Math.floor(distance);
    if (rounded !== this.lastDistance) {
      this.distanceEl.textContent = metres(rounded);
      this.lastDistance = rounded;
    }
    if (coins !== this.lastCoins) {
      (this.coinsEl.lastElementChild as HTMLElement).textContent = fmt(coins);
      this.lastCoins = coins;
    }
    const showMultiplier = multiplier > 1;
    this.multiplierEl.classList.toggle('show', showMultiplier);
    if (showMultiplier) this.multiplierEl.textContent = `x${multiplier}`;
    this.comboFill.style.width = `${Math.round(comboProgress * 100)}%`;
  }

  /** Rebuilds the active power-up chips. */
  updatePowerUps(effects: Array<{ id: string; label: string; remaining: number; duration: number; color: number }>): void {
    const seen = new Set<string>();
    for (const e of effects) {
      seen.add(e.id);
      let node = this.powerupNodes.get(e.id);
      if (!node) {
        const chip = el('div', 'powerup-chip');
        const hex = `#${e.color.toString(16).padStart(6, '0')}`;
        chip.style.color = hex;
        const icon = el('div', 'powerup-icon', POWERUP_ICON[e.id] ?? '?');
        icon.style.background = hex;
        chip.appendChild(icon);
        const text = el('div');
        text.appendChild(el('div', undefined, e.label));
        const timer = el('div', 'powerup-timer');
        const bar = el('i');
        timer.appendChild(bar);
        text.appendChild(timer);
        chip.appendChild(text);
        this.powerupsEl.appendChild(chip);
        node = { chip, bar };
        this.powerupNodes.set(e.id, node);
      }
      node.bar.style.width = `${Math.round((e.remaining / e.duration) * 100)}%`;
    }
    for (const [id, node] of [...this.powerupNodes]) {
      if (seen.has(id)) continue;
      node.chip.remove();
      this.powerupNodes.delete(id);
    }
  }

  updateMissionTrack(): void {
    this.missionTrackEl.innerHTML = '';
    for (const m of this.missions.missions) {
      const line = el('div', 'mission-line');
      line.innerHTML = `${m.def.label} <b>${Math.min(m.def.target, Math.floor(m.value))}/${m.def.target}</b>`;
      if (m.complete) line.style.color = 'var(--good)';
      this.missionTrackEl.appendChild(line);
    }
  }

  /** Shows the current tutorial prompt, or clears it when passed null. */
  setTutorial(step: { id: string; prompt: string; keys: string } | null): void {
    const id = step?.id ?? '';
    if (id === this.tutorialShown) return;
    this.tutorialShown = id;
    if (!step) {
      this.tutorialEl.classList.remove('show');
      return;
    }
    this.tutorialEl.innerHTML =
      `<b>${step.prompt}</b>${step.keys ? `<span>${step.keys}</span>` : ''}`;
    this.tutorialEl.classList.remove('show');
    void this.tutorialEl.offsetWidth;
    this.tutorialEl.classList.add('show');
  }

  setFps(text: string, visible: boolean): void {
    this.fpsEl.classList.toggle('active', visible);
    if (visible) this.fpsEl.textContent = text;
  }

  toast(text: string, tone: 'info' | 'good' | 'bad' = 'info'): void {
    const node = el('div', `toast ${tone}`, text);
    this.toastsEl.appendChild(node);
    setTimeout(() => node.remove(), 1600);
  }

  showZone(label: string): void {
    this.zoneBanner.innerHTML = `<span>Entering</span><b>${label}</b>`;
    this.zoneBanner.classList.remove('show');
    // Force a reflow so the animation restarts.
    void this.zoneBanner.offsetWidth;
    this.zoneBanner.classList.add('show');
  }

  // ------------------------------------------------------------------ Pause

  private buildPause(): void {
    const screen = this.addScreen('pause', true);
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', undefined, 'Paused'));
    panel.appendChild(el('div', 'hint', 'Take a breath. The run is waiting.'));

    const actions = el('div', 'panel-actions');
    const resume = el('button', 'primary');
    resume.textContent = 'Resume';
    resume.addEventListener('click', () => { this.click(); this.callbacks.onResume(); });
    const settings = el('button');
    settings.textContent = 'Settings';
    settings.addEventListener('click', () => { this.click(); this.callbacks.onOpen('settings'); });
    const home = el('button', 'ghost');
    home.textContent = 'Quit';
    home.addEventListener('click', () => { this.click(); this.callbacks.onHome(); });
    actions.append(resume, settings, home);
    const fs = this.fullscreenButton();
    if (fs) panel.append(fs.button, fs.note);
    panel.appendChild(actions);
    screen.appendChild(panel);
  }

  /**
   * A fullscreen toggle. Hidden entirely where the browser cannot do it (iOS
   * Safari), and it says so if the attempt is refused — which is what happens
   * when the game is embedded in a frame that was not given the permission.
   */
  private fullscreenButton(cls = 'small'): { button: HTMLElement; note: HTMLElement } | null {
    if (!fullscreen.available()) return null;
    const b = el('button', cls);
    b.style.justifyContent = 'center';

    // A refused request needs to say so somewhere that stays put. A toast is
    // gone in a second and a half, and this is the one message a player has to
    // act on rather than just notice.
    const note = el('div', 'hint');
    note.style.display = 'none';
    note.style.marginTop = 'calc(var(--u) * 0.4)';

    const label = () => { b.textContent = fullscreen.isFullscreen() ? 'Exit full screen' : 'Full screen'; };
    label();
    b.addEventListener('click', async () => {
      this.click();
      const ok = await fullscreen.toggle(document.documentElement);
      if (ok) {
        note.style.display = 'none';
      } else {
        // Embedded in a frame that was not granted the permission. Nothing the
        // page can do about it from the inside, so say what will work.
        note.textContent = 'This window will not allow full screen. Open the game in its own browser tab.';
        note.style.display = 'block';
      }
      label();
    });
    // UIManager lives for the page, so this listener is never removed.
    fullscreen.onChange(label);
    return { button: b, note };
  }

  // -------------------------------------------------------------- Game over

  private gameOverPanel!: HTMLElement;

  private buildGameOver(): void {
    const screen = this.addScreen('gameover', true);
    this.gameOverPanel = el('div', 'panel');
    screen.appendChild(this.gameOverPanel);
  }

  showResults(stats: RunStats, isBestScore: boolean, isBestDistance: boolean, completed: Array<{ label: string; reward: number }>, unlocked: Array<{ label: string }>): void {
    const p = this.gameOverPanel;
    p.innerHTML = '';
    p.appendChild(el('h2', undefined, 'Run over'));
    if (isBestScore) p.appendChild(el('div', 'new-best', 'New best score'));
    p.appendChild(el('div', 'big-score', fmt(stats.score)));

    const grid = el('div', 'result-grid');
    const cells: Array<[string, string, boolean]> = [
      [metres(stats.distance), 'Distance', isBestDistance],
      [fmt(stats.coins), 'Coins', false],
      [`x${stats.bestMultiplier}`, 'Best multiplier', false],
      [fmt(stats.nearMisses), 'Near misses', false],
      [metres(stats.noHitDistance), 'Longest clean run', false],
      [`${stats.topSpeed.toFixed(1)} m/s`, 'Top speed', false],
    ];
    for (const [value, label, best] of cells) {
      const cell = el('div', `result-cell${best ? ' best' : ''}`);
      cell.appendChild(el('b', undefined, value));
      cell.appendChild(el('span', undefined, label));
      grid.appendChild(cell);
    }
    p.appendChild(grid);

    if (completed.length > 0) {
      p.appendChild(el('h3', undefined, 'Missions complete'));
      const list = el('div', 'card-list');
      for (const m of completed) {
        const card = el('div', 'card complete');
        card.appendChild(el('div', 'card-badge', '✓'));
        const body = el('div');
        body.appendChild(el('div', 'card-title', m.label));
        card.appendChild(body);
        card.appendChild(el('div', 'card-reward', `+${m.reward}`));
        list.appendChild(card);
      }
      p.appendChild(list);
    }

    if (unlocked.length > 0) {
      p.appendChild(el('h3', undefined, 'Achievements unlocked'));
      const list = el('div', 'card-list');
      for (const a of unlocked) {
        const card = el('div', 'card complete');
        card.appendChild(el('div', 'card-badge', '★'));
        const body = el('div');
        body.appendChild(el('div', 'card-title', a.label));
        card.appendChild(body);
        list.appendChild(card);
      }
      p.appendChild(list);
    }

    const actions = el('div', 'panel-actions');
    const again = el('button', 'primary');
    again.textContent = 'Run again';
    again.addEventListener('click', () => { this.click(); this.callbacks.onRestart(); });
    const home = el('button', 'ghost');
    home.textContent = 'Menu';
    home.addEventListener('click', () => { this.click(); this.callbacks.onHome(); });
    actions.append(again, home);
    p.appendChild(actions);
  }

  // --------------------------------------------------------------- Missions

  private missionsPanel!: HTMLElement;

  private buildMissions(): void {
    const screen = this.addScreen('missions', true);
    this.missionsPanel = el('div', 'panel');
    screen.appendChild(this.missionsPanel);
  }

  private refreshMissions(): void {
    const p = this.missionsPanel;
    p.innerHTML = '';
    p.appendChild(el('h2', undefined, 'Missions'));
    p.appendChild(el('div', 'hint', 'Three are active at a time. Clear them to unlock the next tier.'));

    const all = this.missions.allWithState;
    let tier = -1;
    for (const entry of all) {
      if (entry.def.tier !== tier) {
        tier = entry.def.tier;
        p.appendChild(el('h3', undefined, `Tier ${tier}`));
      }
      const card = el('div', `card${entry.complete ? ' complete' : ''}`);
      card.appendChild(el('div', 'card-badge', entry.complete ? '✓' : entry.active ? '▶' : '·'));
      const body = el('div');
      body.appendChild(el('div', 'card-title', entry.def.label));
      if (entry.active) {
        const live = this.missions.missions.find((m) => m.def.id === entry.def.id);
        if (live) {
          body.appendChild(el('div', 'card-sub', `${Math.floor(live.value)} / ${entry.def.target}`));
          const bar = el('div', 'progress');
          const fill = el('i');
          fill.style.width = `${Math.min(100, (live.value / entry.def.target) * 100)}%`;
          bar.appendChild(fill);
          body.appendChild(bar);
        }
      }
      card.appendChild(body);
      card.appendChild(el('div', 'card-reward', `+${entry.def.reward}`));
      p.appendChild(card);
    }
    p.appendChild(this.closeButton());
  }

  // ----------------------------------------------------------- Achievements

  private achievementsPanel!: HTMLElement;

  private buildAchievements(): void {
    const screen = this.addScreen('achievements', true);
    this.achievementsPanel = el('div', 'panel');
    screen.appendChild(this.achievementsPanel);
  }

  private refreshAchievements(): void {
    const p = this.achievementsPanel;
    p.innerHTML = '';
    const all = this.achievements.all;
    p.appendChild(el('h2', undefined, 'Achievements'));
    p.appendChild(el('div', 'hint', `${this.achievements.unlockedCount} of ${all.length} unlocked.`));

    const list = el('div', 'card-list');
    list.style.marginTop = 'calc(var(--u) * 1)';
    for (const entry of all) {
      const card = el('div', `card${entry.unlocked ? ' complete' : ''}`);
      card.appendChild(el('div', 'card-badge', entry.unlocked ? '★' : '☆'));
      const body = el('div');
      body.appendChild(el('div', 'card-title', entry.def.label));
      body.appendChild(el('div', 'card-sub', entry.def.description));
      card.appendChild(body);
      card.appendChild(el('div'));
      list.appendChild(card);
    }
    p.appendChild(list);
    p.appendChild(this.closeButton());
  }

  // --------------------------------------------------------------- Settings

  private settingsPanel!: HTMLElement;

  private buildSettings(): void {
    const screen = this.addScreen('settings', true);
    this.settingsPanel = el('div', 'panel');
    screen.appendChild(this.settingsPanel);
  }

  private refreshSettings(): void {
    const p = this.settingsPanel;
    p.innerHTML = '';
    p.appendChild(el('h2', undefined, 'Settings'));
    const s = this.save.settings;

    const slider = (label: string, key: 'musicVolume' | 'sfxVolume') => {
      const row = el('div', 'setting');
      row.appendChild(el('label', undefined, label));
      const input = el('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.05';
      input.value = String(s[key]);
      input.addEventListener('input', () => {
        this.callbacks.onSettingChange({ [key]: Number(input.value) } as Partial<Settings>);
      });
      row.appendChild(input);
      p.appendChild(row);
    };

    const toggle = (label: string, key: keyof Settings) => {
      const row = el('div', 'setting');
      row.appendChild(el('label', undefined, label));
      const sw = el('div', `switch${s[key] ? ' on' : ''}`);
      sw.setAttribute('role', 'switch');
      sw.tabIndex = 0;
      const flip = () => {
        const next = !this.save.settings[key];
        sw.classList.toggle('on', next);
        this.click();
        this.callbacks.onSettingChange({ [key]: next } as Partial<Settings>);
      };
      sw.addEventListener('click', flip);
      sw.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') flip(); });
      row.appendChild(sw);
      p.appendChild(row);
    };

    p.appendChild(el('h3', undefined, 'Audio'));
    slider('Music', 'musicVolume');
    slider('Sound effects', 'sfxVolume');

    p.appendChild(el('h3', undefined, 'Graphics'));
    const qualityRow = el('div', 'setting');
    qualityRow.appendChild(el('label', undefined, 'Quality'));
    const select = el('select');
    for (const option of ['low', 'medium', 'high']) {
      const o = el('option');
      o.value = option;
      o.textContent = option[0].toUpperCase() + option.slice(1);
      if (s.quality === option) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      this.callbacks.onSettingChange({ quality: select.value as Settings['quality'] });
    });
    qualityRow.appendChild(select);
    p.appendChild(qualityRow);
    toggle('Shadows', 'shadows');
    toggle('Camera shake', 'cameraShake');
    toggle('Reduced motion', 'reducedMotion');
    toggle('Show performance', 'showFps');

    p.appendChild(el('h3', undefined, 'Controls'));
    toggle('Invert swipe up/down', 'invertSwipe');
    this.bindingsEl = el('div', 'bindings');
    p.appendChild(this.bindingsEl);
    const resetRow = el('div', 'setting');
    resetRow.appendChild(el('label', undefined, 'Keyboard'));
    const reset = el('button');
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => {
      this.click();
      this.callbacks.onSettingChange({ keyBindings: DEFAULT_BINDINGS });
      this.renderBindings();
    });
    resetRow.appendChild(reset);
    p.appendChild(resetRow);
    this.renderBindings();
    // Chromium can say which letter each physical key actually prints; when it
    // answers, the labels are redrawn with the player's real layout.
    this.loadKeyboardLayout();

    p.appendChild(this.closeButton());
  }

  // ------------------------------------------------------------ Key binding

  private bindingsEl!: HTMLElement;
  private layout?: Map<string, string>;
  /** The chip currently waiting for a key, if any. */
  private capturing: { action: BindableAction; slot: number; chip: HTMLElement } | null = null;

  private async loadKeyboardLayout(): Promise<void> {
    const kb = (navigator as unknown as {
      keyboard?: { getLayoutMap(): Promise<Map<string, string>> };
    }).keyboard;
    if (this.layout || !kb?.getLayoutMap) return;
    try {
      this.layout = await kb.getLayoutMap();
      this.renderBindings();
    } catch {
      // Not available under permissions policy; the fallback labels stand.
    }
  }

  /** Draws one row per action, with a button per bound key. */
  private renderBindings(): void {
    this.cancelCapture();
    this.bindingsEl.innerHTML = '';
    const bindings = this.save.settings.keyBindings;
    for (const action of BINDABLE_ACTIONS) {
      const row = el('div', 'setting binding-row');
      row.appendChild(el('label', undefined, ACTION_LABEL[action]));
      const keys = el('div', 'binding-keys');
      bindings[action].forEach((code, slot) => {
        const chip = el('button', 'key-chip');
        chip.textContent = prettyKey(code, this.layout);
        chip.title = `${ACTION_LABEL[action]} — click to rebind (${code})`;
        chip.setAttribute('aria-label', `${ACTION_LABEL[action]}: ${prettyKey(code, this.layout)}. Click to rebind.`);
        chip.addEventListener('click', () => this.beginCapture(action, slot, chip));
        keys.appendChild(chip);
      });
      row.appendChild(keys);
      this.bindingsEl.appendChild(row);
    }
  }

  private beginCapture(action: BindableAction, slot: number, chip: HTMLElement): void {
    // Tapping the listening chip again backs out of it.
    if (this.capturing?.chip === chip) {
      this.cancelCapture();
      this.renderBindings();
      return;
    }
    this.cancelCapture();
    this.click();
    this.capturing = { action, slot, chip };
    chip.classList.add('listening');
    chip.textContent = 'Press a key';
    // Game input is suspended for the duration, so the key being bound does not
    // also pause the game or jump the player behind the open panel.
    this.callbacks.onCaptureKeys(true);
    window.addEventListener('keydown', this.onCaptureKey, true);
    // Escape is the way out on a keyboard, but a phone has neither an Escape
    // key nor, usually, any key at all — without this, a stray tap on a chip
    // would leave the panel waiting forever for a press that cannot come.
    window.addEventListener('pointerdown', this.onCapturePointer, true);
  }

  private cancelCapture(): void {
    if (!this.capturing) return;
    window.removeEventListener('keydown', this.onCaptureKey, true);
    window.removeEventListener('pointerdown', this.onCapturePointer, true);
    this.callbacks.onCaptureKeys(false);
    this.capturing = null;
  }

  /** A press anywhere but the listening chip abandons the rebind. */
  private readonly onCapturePointer = (e: PointerEvent): void => {
    if (!this.capturing) return;
    // The chip itself is left alone so its own click can toggle the capture off.
    if (this.capturing.chip.contains(e.target as Node)) return;
    this.cancelCapture();
    this.renderBindings();
  };

  /**
   * Takes the next key press as the new binding.
   *
   * Registered in the capture phase and stopped there, which is what keeps the
   * key from reaching anything else on its way down — including the panel's own
   * buttons, where a space or an enter would otherwise re-trigger the chip that
   * started the capture.
   */
  private readonly onCaptureKey = (e: KeyboardEvent): void => {
    if (!this.capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const { action, slot } = this.capturing;
    const code = e.code;

    if (code === 'Escape') { this.cancelCapture(); this.renderBindings(); return; }

    const result = rebind(this.save.settings.keyBindings, action, slot, code);
    if (!result.ok) {
      this.toast(
        result.reason === 'reserved'
          ? 'Enter is reserved for menus'
          : `${prettyKey(code, this.layout)} is the only key for ${ACTION_LABEL[result.conflict!]}`,
        'bad',
      );
      this.cancelCapture();
      this.renderBindings();
      return;
    }

    this.cancelCapture();
    this.callbacks.onSettingChange({ keyBindings: result.bindings });
    this.audio.play('SFX_UIClick');
    this.renderBindings();
  };

  private closeButton(): HTMLElement {
    const actions = el('div', 'panel-actions');
    const close = el('button', 'primary');
    close.textContent = 'Back';
    close.addEventListener('click', () => {
      // Leaving the panel mid-capture would otherwise leave game input suspended.
      this.cancelCapture();
      this.click();
      this.callbacks.onClosePanel();
    });
    actions.appendChild(close);
    return actions;
  }

  // ----------------------------------------------------------------- Events

  private click(): void {
    this.audio.play('SFX_UIClick');
  }

  private bindEvents(): void {
    bus.on('ui:toast', ({ text, tone }) => this.toast(text, tone ?? 'info'));
    bus.on('zone:changed', ({ label }) => this.showZone(label));
    bus.on('mission:complete', ({ label, reward }) => {
      this.toast(`${label}  +${reward}`, 'good');
      this.audio.play('SFX_MissionComplete');
      this.updateMissionTrack();
    });
    bus.on('achievement:unlocked', ({ label }) => {
      this.toast(`Achievement: ${label}`, 'good');
      this.audio.play('SFX_Achievement');
    });
    bus.on('powerup:collect', ({ id }) => {
      const def = POWERUP_DEFS.find((d) => d.id === id);
      if (def) this.toast(def.label, 'good');
    });
    bus.on('player:stumble', () => this.toast('Close one', 'bad'));

    // Hover feedback on every button, added once by delegation.
    this.root.addEventListener('pointerover', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') this.audio.play('SFX_UIHover');
    });
  }

  /** Resets the cached HUD values so the next frame writes everything. */
  resetHud(): void {
    this.lastScore = -1;
    this.lastCoins = -1;
    this.lastDistance = -1;
    this.tutorialShown = '';
    this.tutorialEl.classList.remove('show');
    for (const node of this.powerupNodes.values()) node.chip.remove();
    this.powerupNodes.clear();
    this.updateMissionTrack();
  }
}
