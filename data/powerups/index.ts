import { PowerUpDef } from '../../src/core/Types';

/** PWR_* definitions. Durations are tuned so two can overlap without noise. */
export const POWERUP_DEFS: PowerUpDef[] = [
  {
    id: 'PWR_Magnet_01',
    label: 'Magnet',
    duration: 9,
    color: 0xe8443a,
    icon: 'magnet',
    description: 'Pulls nearby coins to you.',
  },
  {
    id: 'PWR_Shield_01',
    label: 'Shield',
    duration: 12,
    color: 0x63e8ff,
    icon: 'shield',
    description: 'Absorbs one collision.',
  },
  {
    id: 'PWR_Multiplier_01',
    label: 'Score x2',
    duration: 10,
    color: 0xffc93c,
    icon: 'multiplier',
    description: 'Doubles all score gained.',
  },
  {
    id: 'PWR_Boost_01',
    label: 'Boost',
    duration: 6,
    color: 0x51ffb0,
    icon: 'boost',
    description: 'Surges forward at high speed.',
  },
  {
    id: 'PWR_CoinValue_01',
    label: 'Coin x2',
    duration: 11,
    color: 0xff9a1f,
    icon: 'coin',
    description: 'Every coin is worth double.',
  },
];

export const POWERUP_BY_ID: Record<string, PowerUpDef> = Object.fromEntries(
  POWERUP_DEFS.map((d) => [d.id, d]),
);
