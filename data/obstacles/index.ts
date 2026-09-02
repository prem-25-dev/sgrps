import { ObstacleDef } from '../../src/core/Types';

/**
 * OBS_* gameplay metadata.
 *
 * These numbers are the contract between the art, the collision system and
 * the fairness validator. `requiredActions` is what the solver uses to prove a
 * pattern is survivable, so it must describe the real geometry: a 1.0 m tall
 * barrier is jumpable, a 2.6 m wall is not.
 *
 * Height conventions (player stands 1.78 m, slides at 0.85 m):
 *   ground   - sits on the deck, top between 0.85 and 1.25  -> jump or dodge
 *   overhead - hangs with its underside at 1.0 or above     -> slide or dodge
 *   full     - blocks the whole lane                        -> dodge only
 */
export const OBSTACLE_DEFS: ObstacleDef[] = [
  // --- Ground: jumpable -----------------------------------------------
  { id: 'OBS_Barrier_01', category: 'ground', difficulty: 0.0, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 2.0, height: 1.0, depth: 0.35, yOffset: 0.5, mesh: 'barrier', sfx: 'SFX_ImpactWood' },
  { id: 'OBS_Barricade_01', category: 'ground', difficulty: 0.1, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 2.1, height: 1.1, depth: 0.5, yOffset: 0.55, mesh: 'barricade', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_Crate_01', category: 'ground', difficulty: 0.05, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.15, height: 1.15, depth: 1.15, yOffset: 0.575, mesh: 'crate', sfx: 'SFX_ImpactWood' },
  { id: 'OBS_CrateStack_01', category: 'ground', difficulty: 0.25, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.5, height: 1.2, depth: 1.4, yOffset: 0.6, mesh: 'crateStack', sfx: 'SFX_ImpactWood' },
  { id: 'OBS_ConcreteBlock_01', category: 'ground', difficulty: 0.15, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.8, height: 0.95, depth: 0.8, yOffset: 0.475, mesh: 'concreteBlock', sfx: 'SFX_ImpactStone' },
  { id: 'OBS_LowWall_01', category: 'ground', difficulty: 0.2, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 2.2, height: 1.05, depth: 0.4, yOffset: 0.525, mesh: 'lowWall', sfx: 'SFX_ImpactStone' },
  { id: 'OBS_Equipment_01', category: 'ground', difficulty: 0.3, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.6, height: 1.1, depth: 1.0, yOffset: 0.55, mesh: 'equipment', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_Sandbags_01', category: 'ground', difficulty: 0.1, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.9, height: 0.9, depth: 0.9, yOffset: 0.45, mesh: 'sandbags', sfx: 'SFX_ImpactSoft' },
  { id: 'OBS_CableDrum_01', category: 'ground', difficulty: 0.2, collision: 'capsule', requiredActions: ['jump', 'laneChange'], width: 1.35, height: 1.35, depth: 1.35, yOffset: 0.675, mesh: 'cableDrum', sfx: 'SFX_ImpactWood' },
  { id: 'OBS_Toolbox_01', category: 'ground', difficulty: 0.0, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.2, height: 0.9, depth: 0.7, yOffset: 0.45, mesh: 'toolbox', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_Trolley_01', category: 'ground', difficulty: 0.35, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.5, height: 1.05, depth: 1.6, yOffset: 0.525, mesh: 'trolley', sfx: 'SFX_ImpactMetal' },

  // --- Overhead: slide under ------------------------------------------
  { id: 'OBS_OverheadBeam_01', category: 'overhead', difficulty: 0.15, collision: 'box', requiredActions: ['slide', 'laneChange'], width: 2.3, height: 0.55, depth: 0.4, yOffset: 1.4, mesh: 'beam', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_OverheadSign_01', category: 'overhead', difficulty: 0.2, collision: 'box', requiredActions: ['slide', 'laneChange'], width: 2.2, height: 0.85, depth: 0.2, yOffset: 1.55, mesh: 'overheadSign', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_Pipe_01', category: 'overhead', difficulty: 0.25, collision: 'capsule', requiredActions: ['slide', 'laneChange'], width: 2.4, height: 0.42, depth: 0.42, yOffset: 1.35, mesh: 'pipe', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_LowCeiling_01', category: 'overhead', difficulty: 0.4, collision: 'box', requiredActions: ['slide', 'laneChange'], width: 2.35, height: 1.4, depth: 1.8, yOffset: 1.9, mesh: 'lowCeiling', sfx: 'SFX_ImpactStone' },
  { id: 'OBS_CableRig_01', category: 'overhead', difficulty: 0.3, collision: 'box', requiredActions: ['slide', 'laneChange'], width: 2.3, height: 0.5, depth: 0.6, yOffset: 1.32, mesh: 'cableRig', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_Banner_01', category: 'overhead', difficulty: 0.1, collision: 'box', requiredActions: ['slide', 'laneChange'], width: 2.3, height: 0.9, depth: 0.12, yOffset: 1.5, mesh: 'banner', sfx: 'SFX_ImpactSoft' },
  { id: 'OBS_ScaffoldBeam_01', category: 'overhead', difficulty: 0.45, collision: 'box', requiredActions: ['slide', 'laneChange'], width: 2.4, height: 0.6, depth: 1.2, yOffset: 1.42, mesh: 'scaffoldBeam', sfx: 'SFX_ImpactMetal' },

  // --- Full height: lane change only ----------------------------------
  { id: 'OBS_TallBarrier_01', category: 'full', difficulty: 0.3, collision: 'box', requiredActions: ['laneChange'], width: 2.2, height: 2.7, depth: 0.4, yOffset: 1.35, mesh: 'tallBarrier', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_Container_01', category: 'full', difficulty: 0.35, collision: 'box', requiredActions: ['laneChange'], width: 2.3, height: 2.55, depth: 2.4, yOffset: 1.275, mesh: 'container', sfx: 'SFX_ImpactMetal', standable: true },
  { id: 'OBS_FencePanel_01', category: 'full', difficulty: 0.25, collision: 'box', requiredActions: ['laneChange'], width: 2.3, height: 2.4, depth: 0.16, yOffset: 1.2, mesh: 'fencePanel', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_SignalBox_01', category: 'full', difficulty: 0.4, collision: 'box', requiredActions: ['laneChange'], width: 2.0, height: 2.6, depth: 1.4, yOffset: 1.3, mesh: 'signalBox', sfx: 'SFX_ImpactStone' },
  { id: 'OBS_Wall_01', category: 'full', difficulty: 0.5, collision: 'box', requiredActions: ['laneChange'], width: 2.35, height: 3.0, depth: 0.6, yOffset: 1.5, mesh: 'wall', sfx: 'SFX_ImpactStone' },

  // --- Dynamic ---------------------------------------------------------
  { id: 'OBS_MovingTrolley_01', category: 'dynamic', difficulty: 0.55, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.5, height: 1.05, depth: 1.6, yOffset: 0.525, mesh: 'trolley', sfx: 'SFX_ImpactMetal', vfx: 'VFX_Sparks' },
  { id: 'OBS_RollingDrum_01', category: 'dynamic', difficulty: 0.6, collision: 'capsule', requiredActions: ['jump', 'laneChange'], width: 1.2, height: 1.2, depth: 1.2, yOffset: 0.6, mesh: 'drum', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_SwingSign_01', category: 'dynamic', difficulty: 0.65, collision: 'box', requiredActions: ['slide', 'laneChange'], width: 2.2, height: 0.9, depth: 0.2, yOffset: 1.52, mesh: 'overheadSign', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_SlidingBarrier_01', category: 'dynamic', difficulty: 0.7, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 1.9, height: 1.05, depth: 0.4, yOffset: 0.525, mesh: 'barrier', sfx: 'SFX_ImpactMetal' },
  { id: 'OBS_FallingCrate_01', category: 'dynamic', difficulty: 0.75, collision: 'box', requiredActions: ['laneChange'], width: 1.2, height: 1.2, depth: 1.2, yOffset: 0.6, mesh: 'crate', sfx: 'SFX_ImpactWood', vfx: 'VFX_Dust' },

  // --- Ramps: standable wedges that open up the rooftop routes ---------
  { id: 'OBS_Ramp_01', category: 'ground', difficulty: 0.3, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 2.2, height: 1.2, depth: 3.2, yOffset: 0.6, mesh: 'ramp', standable: true, slope: true, sfx: 'SFX_ImpactWood' },
  { id: 'OBS_Ramp_02', category: 'ground', difficulty: 0.45, collision: 'box', requiredActions: ['jump', 'laneChange'], width: 2.2, height: 1.6, depth: 3.6, yOffset: 0.8, mesh: 'ramp', standable: true, slope: true, sfx: 'SFX_ImpactMetal' },

  // --- Trains: full lane blockers with a runnable roof -----------------
  { id: 'OBS_TrainCar_01', category: 'train', difficulty: 0.2, collision: 'box', requiredActions: ['laneChange'], width: 2.85, height: 3.15, depth: 21, yOffset: 1.575, mesh: 'train', standable: true, sfx: 'SFX_TrainImpact' },
  { id: 'OBS_TrainCar_02', category: 'train', difficulty: 0.3, collision: 'box', requiredActions: ['laneChange'], width: 2.8, height: 3.1, depth: 19.5, yOffset: 1.55, mesh: 'train', standable: true, sfx: 'SFX_TrainImpact' },
  { id: 'OBS_TrainMoving_01', category: 'train', difficulty: 0.65, collision: 'box', requiredActions: ['laneChange'], width: 2.86, height: 3.18, depth: 23, yOffset: 1.59, mesh: 'train', standable: false, sfx: 'SFX_TrainImpact' },
];

export const OBSTACLE_BY_ID: Record<string, ObstacleDef> = Object.fromEntries(
  OBSTACLE_DEFS.map((d) => [d.id, d]),
);

/** Obstacles the generator may pick at a given difficulty. */
export function obstaclesForDifficulty(difficulty: number): ObstacleDef[] {
  return OBSTACLE_DEFS.filter((d) => d.difficulty <= difficulty + 0.12);
}
