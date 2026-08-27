/**
 * Keyboard, touch and pointer input unified into game actions.
 * Buffering lives in the player controller; this layer only reports intent.
 */

export type Action = 'left' | 'right' | 'jump' | 'slide' | 'pause' | 'confirm';

type Listener = (action: Action) => void;

export interface InputSettings {
  swipeThreshold: number;
  invertVertical: boolean;
}

export class InputManager {
  private listeners = new Set<Listener>();
  private held = new Set<Action>();
  private touchStart: { x: number; y: number; t: number } | null = null;
  private pointerStart: { x: number; y: number; t: number } | null = null;
  private disposers: Array<() => void> = [];
  private enabled = true;

  settings: InputSettings = { swipeThreshold: 26, invertVertical: false };

  constructor(private readonly target: HTMLElement | Window = window) {}

  attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      const action = this.mapKey(e.code);
      if (!action) return;
      if (action !== 'pause' && action !== 'confirm') e.preventDefault();
      if (this.held.has(action)) return;
      this.held.add(action);
      this.fire(action);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const action = this.mapKey(e.code);
      if (action) this.held.delete(action);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!this.enabled) return;
      const t = e.changedTouches[0];
      this.touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!this.enabled || !this.touchStart) return;
      const t = e.changedTouches[0];
      this.resolveSwipe(t.clientX - this.touchStart.x, t.clientY - this.touchStart.y);
      this.touchStart = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!this.enabled || e.pointerType === 'touch') return;
      this.pointerStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!this.enabled || e.pointerType === 'touch' || !this.pointerStart) return;
      this.resolveSwipe(e.clientX - this.pointerStart.x, e.clientY - this.pointerStart.y);
      this.pointerStart = null;
    };

    const t = this.target as Window;
    t.addEventListener('keydown', onKeyDown as EventListener);
    t.addEventListener('keyup', onKeyUp as EventListener);
    t.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
    t.addEventListener('touchend', onTouchEnd as EventListener, { passive: true });
    t.addEventListener('pointerdown', onPointerDown as EventListener);
    t.addEventListener('pointerup', onPointerUp as EventListener);

    this.disposers = [
      () => t.removeEventListener('keydown', onKeyDown as EventListener),
      () => t.removeEventListener('keyup', onKeyUp as EventListener),
      () => t.removeEventListener('touchstart', onTouchStart as EventListener),
      () => t.removeEventListener('touchend', onTouchEnd as EventListener),
      () => t.removeEventListener('pointerdown', onPointerDown as EventListener),
      () => t.removeEventListener('pointerup', onPointerUp as EventListener),
    ];
  }

  private resolveSwipe(dx: number, dy: number): void {
    const threshold = this.settings.swipeThreshold;
    const ay = this.settings.invertVertical ? -dy : dy;
    if (Math.abs(dx) < threshold && Math.abs(ay) < threshold) {
      this.fire('confirm');
      return;
    }
    if (Math.abs(dx) > Math.abs(ay)) this.fire(dx > 0 ? 'right' : 'left');
    else this.fire(ay < 0 ? 'jump' : 'slide');
  }

  private mapKey(code: string): Action | null {
    switch (code) {
      case 'ArrowLeft': case 'KeyA': return 'left';
      case 'ArrowRight': case 'KeyD': return 'right';
      case 'ArrowUp': case 'KeyW': case 'Space': return 'jump';
      case 'ArrowDown': case 'KeyS': case 'ShiftLeft': case 'ShiftRight': return 'slide';
      case 'Escape': case 'KeyP': return 'pause';
      case 'Enter': return 'confirm';
      default: return null;
    }
  }

  /** True while a jump key is physically down; drives variable jump height. */
  isHeld(action: Action): boolean {
    return this.held.has(action);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.held.clear();
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(action: Action): void {
    for (const listener of this.listeners) listener(action);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.listeners.clear();
    this.held.clear();
  }
}
