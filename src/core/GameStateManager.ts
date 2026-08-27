import { GameState } from './Types';
import { bus } from './EventBus';

/** Legal transitions. Anything not listed is rejected and logged. */
const TRANSITIONS: Record<GameState, GameState[]> = {
  [GameState.BOOT]: [GameState.LOADING],
  [GameState.LOADING]: [GameState.MAIN_MENU],
  [GameState.MAIN_MENU]: [
    GameState.PLAYING,
    GameState.TUTORIAL,
    GameState.SETTINGS,
    GameState.MISSIONS,
    GameState.ACHIEVEMENTS,
  ],
  [GameState.TUTORIAL]: [GameState.PLAYING, GameState.MAIN_MENU, GameState.PAUSED],
  [GameState.PLAYING]: [GameState.PAUSED, GameState.GAME_OVER, GameState.MAIN_MENU],
  [GameState.PAUSED]: [GameState.PLAYING, GameState.MAIN_MENU, GameState.SETTINGS],
  [GameState.GAME_OVER]: [GameState.PLAYING, GameState.MAIN_MENU, GameState.MISSIONS],
  [GameState.SETTINGS]: [GameState.MAIN_MENU, GameState.PAUSED],
  [GameState.MISSIONS]: [GameState.MAIN_MENU],
  [GameState.ACHIEVEMENTS]: [GameState.MAIN_MENU],
};

export class GameStateManager {
  private current: GameState = GameState.BOOT;
  /** Where a modal panel should return to when dismissed. */
  private returnTo: GameState = GameState.MAIN_MENU;

  get state(): GameState {
    return this.current;
  }

  get previous(): GameState {
    return this.returnTo;
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.current);
  }

  /** True while the simulation should advance. */
  get simulating(): boolean {
    return this.current === GameState.PLAYING || this.current === GameState.TUTORIAL;
  }

  set(next: GameState): boolean {
    if (next === this.current) return true;
    const allowed = TRANSITIONS[this.current] ?? [];
    if (!allowed.includes(next)) {
      console.warn(`[GameState] illegal transition ${this.current} -> ${next}`);
      return false;
    }
    const from = this.current;
    if (next === GameState.SETTINGS || next === GameState.MISSIONS || next === GameState.ACHIEVEMENTS) {
      this.returnTo = from;
    }
    this.current = next;
    bus.emit('state:changed', { from, to: next });
    return true;
  }
}
