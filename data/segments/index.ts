import { LaneIndex, SegmentTemplate } from '../../src/core/Types';

/**
 * SEG_* template library.
 *
 * Every template is authored against a 24 m module. Templates declare which
 * lanes they can be entered and exited in so the generator can stitch them,
 * and every one is still put through the fairness solver at the real run speed
 * before it is spawned — the metadata is a filter, the solver is the proof.
 */

const ALL: LaneIndex[] = [0, 1, 2];

function t(
  id: string,
  kind: SegmentTemplate['kind'],
  minDifficulty: number,
  maxDifficulty: number,
  weight: number,
  items: SegmentTemplate['items'],
  opts: Partial<SegmentTemplate> = {},
): SegmentTemplate {
  return {
    id,
    kind,
    minDifficulty,
    maxDifficulty,
    weight,
    entryLanes: ALL,
    exitLanes: ALL,
    items,
    ...opts,
  };
}

export const SEGMENT_TEMPLATES: SegmentTemplate[] = [
  // ---- Breathers and coin corridors -----------------------------------
  t('SEG_Straight_01', 'straight', 0, 1, 10, []),
  t('SEG_Straight_02', 'straight', 0, 1, 6, [
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 4 },
  ]),
  t('SEG_CoinCorridor_01', 'coin', 0, 1, 8, [
    { type: 'coinPattern', id: 'PAT_Straight', lane: 0, z: 3 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 2, z: 3 },
  ]),
  t('SEG_CoinArc_01', 'coin', 0.05, 1, 7, [
    { type: 'coinPattern', id: 'PAT_Arc', lane: 1, z: 5 },
    { type: 'obstacle', id: 'OBS_Barrier_01', lane: 1, z: 11 },
  ]),
  t('SEG_CoinWeave_01', 'coin', 0.15, 1, 6, [
    { type: 'coinPattern', id: 'PAT_LaneSwitch', lane: 0, z: 4 },
    { type: 'coinPattern', id: 'PAT_ZigZag', lane: 2, z: 4 },
  ]),
  t('SEG_CoinWave_01', 'coin', 0.1, 1, 5, [
    { type: 'coinPattern', id: 'PAT_Wave', lane: 1, z: 3 },
  ]),

  // ---- Single obstacle: the tutorial vocabulary ------------------------
  t('SEG_LeftObstacle_01', 'obstacle', 0, 1, 8, [
    { type: 'obstacle', id: 'OBS_Barrier_01', lane: 0, z: 12 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 8 },
  ]),
  t('SEG_RightObstacle_01', 'obstacle', 0, 1, 8, [
    { type: 'obstacle', id: 'OBS_Crate_01', lane: 2, z: 12 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 8 },
  ]),
  t('SEG_CentreObstacle_01', 'obstacle', 0, 1, 8, [
    { type: 'obstacle', id: 'OBS_Barricade_01', lane: 1, z: 12 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 0, z: 8 },
  ]),
  t('SEG_Jump_01', 'jump', 0, 1, 9, [
    { type: 'obstacle', id: 'OBS_LowWall_01', lane: 1, z: 11 },
    { type: 'coinPattern', id: 'PAT_Arc', lane: 1, z: 6 },
  ]),
  t('SEG_Jump_02', 'jump', 0.1, 1, 7, [
    { type: 'obstacle', id: 'OBS_ConcreteBlock_01', lane: 0, z: 8 },
    { type: 'obstacle', id: 'OBS_ConcreteBlock_01', lane: 2, z: 16 },
    { type: 'coinPattern', id: 'PAT_Arc', lane: 0, z: 3 },
  ]),
  t('SEG_Slide_01', 'slide', 0.05, 1, 9, [
    { type: 'obstacle', id: 'OBS_OverheadBeam_01', lane: 1, z: 12 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 14 },
  ]),
  t('SEG_Slide_02', 'slide', 0.15, 1, 7, [
    { type: 'obstacle', id: 'OBS_Pipe_01', lane: 0, z: 9 },
    { type: 'obstacle', id: 'OBS_Pipe_01', lane: 1, z: 9 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 2, z: 6 },
  ]),

  // ---- Two-lane pressure ----------------------------------------------
  t('SEG_TwoLane_01', 'multiLane', 0.2, 1, 8, [
    { type: 'obstacle', id: 'OBS_Barrier_01', lane: 0, z: 10 },
    { type: 'obstacle', id: 'OBS_Barrier_01', lane: 1, z: 10 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 2, z: 8 },
  ], { exitLanes: [0, 1, 2] }),
  t('SEG_TwoLane_02', 'multiLane', 0.25, 1, 8, [
    { type: 'obstacle', id: 'OBS_TallBarrier_01', lane: 1, z: 9 },
    { type: 'obstacle', id: 'OBS_TallBarrier_01', lane: 2, z: 9 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 0, z: 7 },
  ]),
  t('SEG_Funnel_01', 'multiLane', 0.3, 1, 6, [
    { type: 'obstacle', id: 'OBS_FencePanel_01', lane: 0, z: 8 },
    { type: 'obstacle', id: 'OBS_FencePanel_01', lane: 2, z: 8 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 6 },
    { type: 'obstacle', id: 'OBS_LowWall_01', lane: 1, z: 17 },
  ]),
  t('SEG_Stagger_01', 'multiLane', 0.3, 1, 7, [
    { type: 'obstacle', id: 'OBS_Crate_01', lane: 0, z: 6 },
    { type: 'obstacle', id: 'OBS_Crate_01', lane: 1, z: 13 },
    { type: 'obstacle', id: 'OBS_Crate_01', lane: 2, z: 20 },
  ]),

  // ---- Mixed action chains --------------------------------------------
  t('SEG_JumpSlide_01', 'jump', 0.35, 1, 7, [
    { type: 'obstacle', id: 'OBS_LowWall_01', lane: 1, z: 7 },
    { type: 'obstacle', id: 'OBS_OverheadBeam_01', lane: 1, z: 17 },
    { type: 'coinPattern', id: 'PAT_Arc', lane: 1, z: 3 },
  ]),
  t('SEG_SlideJump_01', 'slide', 0.4, 1, 6, [
    { type: 'obstacle', id: 'OBS_Pipe_01', lane: 1, z: 7 },
    { type: 'obstacle', id: 'OBS_ConcreteBlock_01', lane: 1, z: 17 },
  ]),
  t('SEG_Gauntlet_01', 'obstacle', 0.45, 1, 6, [
    { type: 'obstacle', id: 'OBS_Barrier_01', lane: 0, z: 5 },
    { type: 'obstacle', id: 'OBS_OverheadBeam_01', lane: 1, z: 12 },
    { type: 'obstacle', id: 'OBS_Crate_01', lane: 2, z: 19 },
  ]),
  // The trailing barrier sits at 22.5 rather than 20: at top speed the player
  // needs 16.3 m of clear lane between two forced decisions, and 20 left only
  // 14.3 m after the crate stack.
  t('SEG_Gauntlet_02', 'obstacle', 0.55, 1, 5, [
    { type: 'obstacle', id: 'OBS_CrateStack_01', lane: 0, z: 5 },
    { type: 'obstacle', id: 'OBS_TallBarrier_01', lane: 1, z: 5 },
    { type: 'obstacle', id: 'OBS_Pipe_01', lane: 2, z: 14 },
    { type: 'obstacle', id: 'OBS_Barrier_01', lane: 0, z: 22.5 },
  ]),
  t('SEG_Weave_01', 'multiLane', 0.5, 1, 6, [
    { type: 'obstacle', id: 'OBS_Wall_01', lane: 0, z: 5 },
    { type: 'obstacle', id: 'OBS_Wall_01', lane: 2, z: 12 },
    { type: 'obstacle', id: 'OBS_Wall_01', lane: 0, z: 19 },
    { type: 'coinPattern', id: 'PAT_LaneSwitch', lane: 1, z: 3 },
  ]),

  // ---- Trains ----------------------------------------------------------
  t('SEG_Train_01', 'train', 0.1, 1, 8, [
    { type: 'train', id: 'OBS_TrainCar_01', lane: 0, z: 2, length: 21 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 5 },
  ]),
  t('SEG_Train_02', 'train', 0.2, 1, 8, [
    { type: 'train', id: 'OBS_TrainCar_02', lane: 2, z: 2, length: 19.5 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 5 },
  ]),
  t('SEG_TrainPair_01', 'train', 0.35, 1, 6, [
    { type: 'train', id: 'OBS_TrainCar_01', lane: 0, z: 2, length: 21 },
    { type: 'train', id: 'OBS_TrainCar_02', lane: 2, z: 2, length: 19.5 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 4 },
  ]),
  // A ramp is what makes the rooftop route reachable: the solver proves the
  // jump from the ramp lands on the roof, so the coins up there are earnable.
  t('SEG_TrainRoof_01', 'train', 0.4, 1, 5, [
    { type: 'obstacle', id: 'OBS_Ramp_01', lane: 1, z: 2 },
    { type: 'train', id: 'OBS_TrainCar_01', lane: 1, z: 6, length: 21 },
    { type: 'coinPattern', id: 'PAT_Roof', lane: 1, z: 9 },
  ]),
  t('SEG_Ramp_01', 'jump', 0.3, 1, 5, [
    { type: 'obstacle', id: 'OBS_Ramp_01', lane: 1, z: 8 },
    { type: 'coinPattern', id: 'PAT_Arc', lane: 1, z: 12 },
  ]),
  t('SEG_TrainGap_01', 'train', 0.5, 1, 5, [
    { type: 'train', id: 'OBS_TrainCar_01', lane: 0, z: 1, length: 9 },
    { type: 'train', id: 'OBS_TrainCar_01', lane: 0, z: 14, length: 9 },
    { type: 'obstacle', id: 'OBS_OverheadBeam_01', lane: 2, z: 11 },
  ]),
  // A service running the other way, down the lane the player is already in.
  //
  // The coins are the point: they lead along the lane the train is coming
  // down, so the player is running at it rather than watching it pass in a
  // lane they were never using. The other two lanes are clear at the decision
  // point, and the solver proves the break is makeable at the speed the player
  // will actually be doing — with the train's closing speed widening the
  // hazard, which is what makes the reaction guarantee bite here.
  //
  // Gated low on purpose. At 0.45 and 0.55 the first service train landed
  // between 2.0 and 2.8 km across every seed measured, and runs end long
  // before that -- the one hazard the game is named around was something
  // almost nobody ever met. The fairness solver, not this number, is what
  // keeps it survivable: it widens the hazard by its closing drift and
  // refuses any segment with no route through, so lowering the gate makes
  // the generator reject more attempts rather than ship an unfair one.
  t('SEG_TrainMoving_01', 'train', 0.08, 1, 5, [
    { type: 'train', id: 'OBS_TrainMoving_01', lane: 1, z: 2, length: 23 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 1 },
  ], { entryLanes: [1] }),
  t('SEG_TrainMoving_02', 'train', 0.13, 1, 4, [
    { type: 'train', id: 'OBS_TrainMoving_01', lane: 0, z: 2, length: 23 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 0, z: 1 },
  ], { entryLanes: [0] }),

  // ---- Risk and reward -------------------------------------------------
  t('SEG_RiskReward_01', 'riskReward', 0.25, 1, 6, [
    { type: 'coinPattern', id: 'PAT_RiskReward', lane: 0, z: 3 },
    { type: 'obstacle', id: 'OBS_Barrier_01', lane: 0, z: 19 },
  ]),
  t('SEG_RiskReward_02', 'riskReward', 0.4, 1, 5, [
    { type: 'coinPattern', id: 'PAT_RiskReward', lane: 2, z: 3 },
    { type: 'obstacle', id: 'OBS_OverheadBeam_01', lane: 2, z: 13 },
    { type: 'obstacle', id: 'OBS_Crate_01', lane: 2, z: 20 },
  ]),
  t('SEG_Spiral_01', 'riskReward', 0.3, 1, 4, [
    { type: 'coinPattern', id: 'PAT_Spiral', lane: 1, z: 4 },
    { type: 'obstacle', id: 'OBS_Container_01', lane: 0, z: 14 },
  ]),
  t('SEG_Burst_01', 'riskReward', 0.2, 1, 4, [
    { type: 'coinPattern', id: 'PAT_Burst', lane: 1, z: 9 },
    { type: 'obstacle', id: 'OBS_LowWall_01', lane: 1, z: 4 },
  ]),

  // ---- Power-up drops --------------------------------------------------
  t('SEG_PowerUp_01', 'powerup', 0.1, 1, 5, [
    { type: 'powerup', lane: 1, z: 12 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 1, z: 3 },
  ]),
  t('SEG_PowerUp_02', 'powerup', 0.3, 1, 4, [
    { type: 'powerup', lane: 0, z: 13 },
    { type: 'obstacle', id: 'OBS_Barrier_01', lane: 0, z: 6 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 2, z: 4 },
  ]),
  t('SEG_PowerUpJump_01', 'powerup', 0.35, 1, 4, [
    { type: 'powerup', lane: 1, z: 12, y: 2.3 },
    { type: 'obstacle', id: 'OBS_LowWall_01', lane: 1, z: 9 },
  ]),

  // ---- Dynamic hazards -------------------------------------------------
  t('SEG_Dynamic_01', 'special', 0.55, 1, 4, [
    { type: 'obstacle', id: 'OBS_MovingTrolley_01', lane: 1, z: 14 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 0, z: 4 },
  ]),
  t('SEG_Dynamic_02', 'special', 0.65, 1, 4, [
    { type: 'obstacle', id: 'OBS_RollingDrum_01', lane: 0, z: 15 },
    { type: 'obstacle', id: 'OBS_SwingSign_01', lane: 2, z: 10 },
  ]),
  t('SEG_Dynamic_03', 'special', 0.75, 1, 3, [
    { type: 'obstacle', id: 'OBS_SlidingBarrier_01', lane: 1, z: 13 },
    { type: 'obstacle', id: 'OBS_FallingCrate_01', lane: 0, z: 19 },
  ]),

  // ---- Set pieces ------------------------------------------------------
  t('SEG_Station_01', 'special', 0.15, 1, 5, [
    { type: 'train', id: 'OBS_TrainCar_01', lane: 0, z: 2, length: 21 },
    { type: 'coinPattern', id: 'PAT_Double', lane: 1, z: 5 },
    { type: 'powerup', lane: 2, z: 14 },
  ]),
  t('SEG_Maintenance_01', 'obstacle', 0.4, 1, 5, [
    { type: 'obstacle', id: 'OBS_Equipment_01', lane: 0, z: 6 },
    { type: 'obstacle', id: 'OBS_CableDrum_01', lane: 2, z: 12 },
    { type: 'obstacle', id: 'OBS_ScaffoldBeam_01', lane: 1, z: 18 },
  ]),
  t('SEG_Construction_01', 'obstacle', 0.5, 1, 5, [
    { type: 'obstacle', id: 'OBS_Sandbags_01', lane: 1, z: 5 },
    { type: 'obstacle', id: 'OBS_ScaffoldBeam_01', lane: 0, z: 12 },
    { type: 'obstacle', id: 'OBS_Toolbox_01', lane: 2, z: 18 },
  ]),
  t('SEG_Tunnel_01', 'special', 0.45, 1, 4, [
    { type: 'obstacle', id: 'OBS_LowCeiling_01', lane: 1, z: 11 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 0, z: 4 },
    { type: 'coinPattern', id: 'PAT_Straight', lane: 2, z: 4 },
  ]),
  t('SEG_Signal_01', 'obstacle', 0.35, 1, 5, [
    { type: 'obstacle', id: 'OBS_SignalBox_01', lane: 0, z: 10 },
    { type: 'obstacle', id: 'OBS_Banner_01', lane: 2, z: 16 },
  ]),
];

export const TEMPLATE_BY_ID: Record<string, SegmentTemplate> = Object.fromEntries(
  SEGMENT_TEMPLATES.map((s) => [s.id, s]),
);
