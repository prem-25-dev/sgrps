/**
 * The shared gameplay rig.
 *
 * A real `PlayerController`, `CollisionSystem`, `PlayerAnimator` and rigged
 * hero, driven by synthetic key events through the real `InputManager`, with
 * no renderer. Extracted from `test-gameplay.ts` so other suites drive the
 * same game rather than a copy of it.
 *
 * Two traps this rig has already caught the hard way, both recorded in
 * QA_PLAN.md, and both easy to walk back into:
 *
 * - **Hold the jump.** Releasing the key early runs the ascent at
 *   `cutMultiplier` gravity and peaks at 1.29 m rather than 2.70 m. A probe
 *   that sends keyup every frame reports that nothing is clearable.
 * - **Send keyup eventually.** `InputManager` drops a repeat while an action
 *   is held, so a key left down forever swallows every later press of it.
 */
import * as THREE from 'three';
import { createHero } from '../src/assets/HeroFactory';
import { DEFAULT_IDENTITY } from '../src/assets/HeroIdentity';
import { CollectibleManager } from '../src/collectibles/CollectibleManager';
import { ActiveObstacle, CollisionSystem, HitResult } from '../src/core/CollisionSystem';
import { laneToX } from '../src/core/Config';
import { bus } from '../src/core/EventBus';
import { ObstacleDef } from '../src/core/Types';
import { InputManager } from '../src/player/InputManager';
import { PlayerAnimator } from '../src/player/PlayerAnimator';
import { PlayerController } from '../src/player/PlayerController';
import { PowerUpManager } from '../src/powerups/PowerUpManager';
import { ScoreManager } from '../src/progression/ScoreManager';
import { OBSTACLE_BY_ID } from '../data/obstacles';

export const DT = 1 / 60;

class StubTarget {
  private handlers = new Map<string, Array<(ev: unknown) => void>>();
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type: string, ev: unknown): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(ev);
  }
}

export interface Harness {
  player: PlayerController;
  collision: CollisionSystem;
  coins: CollectibleManager;
  powerUps: PowerUpManager;
  score: ScoreManager;
  obstacles: ActiveObstacle[];
  events: { hits: string[]; nearMisses: string[]; deaths: string[]; stumbles: number; shieldAbsorbs: number };
  key(code: string, up?: boolean): void;
  step(seconds: number, onFrame?: (t: number) => void): void;
  addObstacle(id: string, lane: number, z: number): ActiveObstacle;
  dispose(): void;
}

export function makeHarness(): Harness {
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);
  const target = new StubTarget();
  const input = new InputManager(target as unknown as HTMLElement);
  input.attach();

  const collision = new CollisionSystem();
  const coins = new CollectibleManager();
  const powerUps = new PowerUpManager();
  const score = new ScoreManager();
  const obstacles: ActiveObstacle[] = [];
  const events = { hits: [] as string[], nearMisses: [] as string[], deaths: [] as string[], stumbles: 0, shieldAbsorbs: 0 };

  const offShield = bus.on('shield:absorb', () => { events.shieldAbsorbs++; });
  const offStumble = bus.on('player:stumble', () => { events.stumbles++; });

  const player = new PlayerController(hero, animator, collision, input, {
    onHit(hit: HitResult) {
      events.hits.push(hit.obstacle.def.id);
      if (powerUps.consumeShield()) return true;
      score.onHit(player.state.distance);
      return false;
    },
    onNearMiss(obstacle) {
      events.nearMisses.push(obstacle.def.id);
      score.addNearMiss();
    },
    onDeath(cause) { events.deaths.push(cause); },
  });
  player.reset();
  score.reset();
  collision.setObstacles(obstacles);

  return {
    player, collision, coins, powerUps, score, obstacles, events,
    key(code: string, up = false) {
      target.dispatch(up ? 'keyup' : 'keydown', { code, preventDefault() {} });
    },
    step(seconds: number, onFrame?: (t: number) => void) {
      const frames = Math.round(seconds / DT);
      for (let i = 0; i < frames; i++) {
        const s = player.state;
        onFrame?.(i * DT);
        player.speedMultiplier = powerUps.speedMultiplier;
        player.update(DT, 8);
        coins.magnetActive = powerUps.magnetActive;
        score.coinMultiplier = powerUps.coinMultiplier;
        score.powerMultiplier = powerUps.scoreMultiplier;
        coins.update(DT, s.distance, s.x, s.y, () => { score.addCoin(); });
        powerUps.update(DT, s.distance, s.x, s.y, () => { score.onPowerUp(); });
        score.update(DT, s.distance, s.speed);
      }
    },
    addObstacle(id: string, lane: number, z: number) {
      const def: ObstacleDef = OBSTACLE_BY_ID[id];
      if (!def) throw new Error(`unknown obstacle ${id}`);
      const o: ActiveObstacle = {
        def, z, lane, x: laneToX(lane), baseY: 0,
        object: new THREE.Object3D(), driftZ: 0, driftX: 0,
        poolKey: `${id}|0`, hit: false, nearMissed: false, passed: false,
      };
      obstacles.push(o);
      collision.setObstacles(obstacles);
      return o;
    },
    dispose() {
      offShield(); offStumble();
      input.dispose();
      coins.dispose();
      hero.dispose();
    },
  };
}
