/** Payloads for every cross-system signal in the game. */
export interface GameEvents {
  'state:changed': { from: string; to: string };
  'run:start': { seed: number };
  'run:end': { score: number; distance: number; coins: number; cause: string };
  'player:jump': { speed: number };
  'player:land': { hard: boolean; speed: number };
  'player:slide': { speed: number };
  'player:laneChange': { from: number; to: number };
  'player:stumble': { obstacle: string };
  'player:hit': { obstacle: string; fatal: boolean };
  'player:nearMiss': { obstacle: string; distance: number };
  'player:footstep': { speed: number };
  'coin:collect': { value: number; combo: number; position: [number, number, number] };
  'powerup:collect': { id: string };
  'powerup:expire': { id: string };
  'shield:absorb': Record<string, never>;
  'score:changed': { score: number; multiplier: number; combo: number };
  'distance:changed': { distance: number; speed: number };
  'zone:changed': { id: string; label: string };
  'mission:progress': { id: string; value: number; target: number };
  'mission:complete': { id: string; label: string; reward: number };
  'achievement:unlocked': { id: string; label: string };
  'audio:settings': Record<string, never>;
  'ui:toast': { text: string; tone?: 'info' | 'good' | 'bad' };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

/** Minimal typed pub/sub. No allocation on emit for the common case. */
export class EventBus {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event as string);
    if (!set) {
      set = new Set();
      this.handlers.set(event as string, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => this.off(event, handler);
  }

  off<K extends keyof GameEvents>(event: K, handler: Handler<K>): void {
    this.handlers.get(event as string)?.delete(handler as (payload: unknown) => void);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event as string);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
