/**
 * Shared type vocabulary for NEON RUN.
 * Kept dependency-free so data files and systems can both import it.
 */

export type LaneIndex = 0 | 1 | 2;

/** High level game state machine states. */
export enum GameState {
  BOOT = 'BOOT',
  LOADING = 'LOADING',
  MAIN_MENU = 'MAIN_MENU',
  TUTORIAL = 'TUTORIAL',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  GAME_OVER = 'GAME_OVER',
  SETTINGS = 'SETTINGS',
  MISSIONS = 'MISSIONS',
  ACHIEVEMENTS = 'ACHIEVEMENTS',
}

/** The action a player must take to survive an obstacle. */
export type TraversalAction = 'jump' | 'slide' | 'laneChange' | 'none';

export type ColliderKind = 'box' | 'capsule' | 'trigger';

/** Gameplay-facing description of an obstacle archetype. */
export interface ObstacleDef {
  id: string;
  category: 'ground' | 'overhead' | 'full' | 'dynamic' | 'train';
  /** 0 = tutorial friendly, 1 = extreme. Gate for the difficulty curve. */
  difficulty: number;
  collision: ColliderKind;
  /** Actions that let the player survive this obstacle in-lane, or lane change. */
  requiredActions: TraversalAction[];
  /** Axis aligned local bounds in metres. */
  width: number;
  height: number;
  depth: number;
  /** Vertical offset of the collider centre from the track surface. */
  yOffset: number;
  /** If true the top surface is standable (train roofs, container tops). */
  standable?: boolean;
  /**
   * If true the obstacle is a ramp: its walkable surface rises linearly from
   * the deck at its near edge to `height` at its far edge, so the player runs
   * up it rather than being stopped by it. Implies `standable`.
   */
  slope?: boolean;
  /** Visual builder key resolved by the ObstacleFactory. */
  mesh: string;
  sfx?: string;
  vfx?: string;
}

export type SegmentItemType =
  | 'obstacle'
  | 'coin'
  | 'coinPattern'
  | 'powerup'
  | 'prop'
  | 'train';

export interface SegmentItem {
  type: SegmentItemType;
  /** Obstacle/prop/powerup id, or coin pattern id. */
  id?: string;
  lane: LaneIndex;
  /** Local Z offset inside the segment, metres from the segment entry. */
  z: number;
  /** Optional Y offset for elevated items (coins over a train roof). */
  y?: number;
  /** Length in metres for stretched items such as trains. */
  length?: number;
}

export interface SegmentTemplate {
  id: string;
  /** Broad purpose, used by the generator's pacing rules. */
  kind:
    | 'straight'
    | 'coin'
    | 'obstacle'
    | 'jump'
    | 'slide'
    | 'train'
    | 'multiLane'
    | 'riskReward'
    | 'powerup'
    | 'special';
  /** Difficulty window in which this template may be selected (0..1). */
  minDifficulty: number;
  maxDifficulty: number;
  /** Relative selection weight. */
  weight: number;
  /** Lanes that are open at the segment entry / exit, used for stitching. */
  entryLanes: LaneIndex[];
  exitLanes: LaneIndex[];
  items: SegmentItem[];
  /** Optional zone restriction. */
  zones?: string[];
  /** Cooldown in segments before this template can repeat. */
  cooldown?: number;
}

export interface PowerUpDef {
  id: string;
  label: string;
  duration: number;
  color: number;
  icon: string;
  description: string;
}

export interface MissionDef {
  id: string;
  label: string;
  metric:
    | 'distance'
    | 'coins'
    | 'nearMiss'
    | 'powerUps'
    | 'multiplier'
    | 'noHitDistance'
    | 'runs'
    | 'score';
  target: number;
  reward: number;
  /** Missions are grouped into tiers that unlock in order. */
  tier: number;
}

export interface AchievementDef {
  id: string;
  label: string;
  description: string;
  metric:
    | 'totalDistance'
    | 'totalCoins'
    | 'bestScore'
    | 'topSpeed'
    | 'noHitDistance'
    | 'nearMiss'
    | 'runs'
    | 'powerUps';
  target: number;
}

export interface ZoneDef {
  id: string;
  label: string;
  /** Distance in metres at which this zone starts being eligible. */
  fromDistance: number;
  fog: { color: number; near: number; far: number };
  /**
   * Colour of the ground plane beyond the track.
   *
   * Without a ground the world is a strip of ballast in the void, and every
   * building, tree and parked vehicle — all placed at y=0 — hangs in mid-air
   * with sky visible underneath. Fog hides the plane's far edge, so it only
   * ever reads as terrain receding into haze.
   */
  ground: number;
  sky: { top: number; bottom: number };
  sun: { color: number; intensity: number; position: [number, number, number] };
  ambient: { color: number; intensity: number };
  /** Cosmetic density knobs, never gameplay affecting. */
  buildingScale: number;
  propDensity: number;
  lightDensity: number;
  vegetationDensity: number;
  decalDensity: number;
  neon: number;
  palette: number[];
  music: 'calm' | 'drive' | 'intense';
}
