import { AchievementDef, MissionDef } from '../../src/core/Types';

/** Three missions are active at a time, drawn from the lowest unfinished tier. */
export const MISSION_DEFS: MissionDef[] = [
  { id: 'MIS_Run500', label: 'Run 500 m in one run', metric: 'distance', target: 500, reward: 150, tier: 1 },
  { id: 'MIS_Coins100', label: 'Collect 100 coins in one run', metric: 'coins', target: 100, reward: 150, tier: 1 },
  { id: 'MIS_NearMiss5', label: 'Get 5 near misses in one run', metric: 'nearMiss', target: 5, reward: 150, tier: 1 },

  { id: 'MIS_Run1000', label: 'Run 1,000 m in one run', metric: 'distance', target: 1000, reward: 250, tier: 2 },
  { id: 'MIS_PowerUps3', label: 'Use 3 power-ups in one run', metric: 'powerUps', target: 3, reward: 250, tier: 2 },
  { id: 'MIS_Multiplier4', label: 'Reach a x4 multiplier', metric: 'multiplier', target: 4, reward: 250, tier: 2 },

  { id: 'MIS_Run2000', label: 'Run 2,000 m in one run', metric: 'distance', target: 2000, reward: 400, tier: 3 },
  { id: 'MIS_Clean800', label: 'Run 800 m without being hit', metric: 'noHitDistance', target: 800, reward: 400, tier: 3 },
  { id: 'MIS_Coins300', label: 'Collect 300 coins in one run', metric: 'coins', target: 300, reward: 400, tier: 3 },

  { id: 'MIS_NearMiss20', label: 'Get 20 near misses in one run', metric: 'nearMiss', target: 20, reward: 600, tier: 4 },
  { id: 'MIS_Score50k', label: 'Score 50,000 in one run', metric: 'score', target: 50000, reward: 600, tier: 4 },
  { id: 'MIS_Multiplier8', label: 'Reach the maximum multiplier', metric: 'multiplier', target: 8, reward: 600, tier: 4 },

  { id: 'MIS_Run4000', label: 'Run 4,000 m in one run', metric: 'distance', target: 4000, reward: 900, tier: 5 },
  { id: 'MIS_Clean2000', label: 'Run 2,000 m without being hit', metric: 'noHitDistance', target: 2000, reward: 900, tier: 5 },
  { id: 'MIS_Runs50', label: 'Complete 50 runs', metric: 'runs', target: 50, reward: 900, tier: 5 },
];

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'ACH_FirstRun', label: 'First Run', description: 'Finish your first run.', metric: 'runs', target: 1 },
  { id: 'ACH_Regular', label: 'Regular', description: 'Complete 25 runs.', metric: 'runs', target: 25 },
  { id: 'ACH_Veteran', label: 'Veteran', description: 'Complete 100 runs.', metric: 'runs', target: 100 },
  { id: 'ACH_CoinCollector', label: 'Coin Collector', description: 'Collect 1,000 coins in total.', metric: 'totalCoins', target: 1000 },
  { id: 'ACH_Treasury', label: 'Treasury', description: 'Collect 10,000 coins in total.', metric: 'totalCoins', target: 10000 },
  { id: 'ACH_Marathon', label: 'Marathon', description: 'Run 10 km in total.', metric: 'totalDistance', target: 10000 },
  { id: 'ACH_UltraMarathon', label: 'Ultra', description: 'Run 100 km in total.', metric: 'totalDistance', target: 100000 },
  { id: 'ACH_SpeedDemon', label: 'Speed Demon', description: 'Hit the top speed.', metric: 'topSpeed', target: 30.5 },
  { id: 'ACH_Untouchable', label: 'Untouchable', description: 'Run 1,500 m without a scratch.', metric: 'noHitDistance', target: 1500 },
  { id: 'ACH_RiskTaker', label: 'Risk Taker', description: 'Rack up 250 near misses.', metric: 'nearMiss', target: 250 },
  { id: 'ACH_Charged', label: 'Charged', description: 'Use 100 power-ups.', metric: 'powerUps', target: 100 },
  { id: 'ACH_MasterRunner', label: 'Master Runner', description: 'Score 250,000 in a single run.', metric: 'bestScore', target: 250000 },
];
