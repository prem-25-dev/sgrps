import { ZoneDef } from '../../src/core/Types';

/**
 * ZONE_* environment set. Zones change look, lighting and music, never the
 * rules of play — so a player who learns the game in the city edge is not
 * ambushed by different physics downtown.
 */
export const ZONES: ZoneDef[] = [
  {
    id: 'ZONE_CityEdge',
    label: 'City Edge',
    fromDistance: 0,
    fog: { color: 0xbfd4e6, near: 60, far: 320 },
    sky: { top: 0x74a7d8, bottom: 0xdfe9f2 },
    sun: { color: 0xfff2dc, intensity: 2.4, position: [-40, 62, 30] },
    ambient: { color: 0x9fb6cc, intensity: 1.05 },
    buildingScale: 0.55,
    propDensity: 0.6,
    lightDensity: 0.3,
    vegetationDensity: 1.0,
    decalDensity: 0.5,
    neon: 0.0,
    palette: [0x8fa8bd, 0xc7cfd6, 0xa5b4a0],
    music: 'calm',
  },
  {
    id: 'ZONE_Metro',
    label: 'Metro District',
    fromDistance: 700,
    fog: { color: 0xa8bccd, near: 50, far: 290 },
    sky: { top: 0x5f92c4, bottom: 0xd2dee8 },
    sun: { color: 0xffeccd, intensity: 2.2, position: [-30, 58, 24] },
    ambient: { color: 0x93a9bd, intensity: 1.0 },
    buildingScale: 0.8,
    propDensity: 1.0,
    lightDensity: 0.5,
    vegetationDensity: 0.5,
    decalDensity: 0.8,
    neon: 0.15,
    palette: [0x7e94a8, 0xb9c3cc, 0x6f8298],
    music: 'drive',
  },
  {
    id: 'ZONE_Downtown',
    label: 'Downtown',
    fromDistance: 1600,
    fog: { color: 0x8fa3bb, near: 44, far: 270 },
    sky: { top: 0x40699c, bottom: 0xb9c9dc },
    sun: { color: 0xffe3bb, intensity: 2.0, position: [-22, 54, 16] },
    ambient: { color: 0x8397ae, intensity: 0.95 },
    buildingScale: 1.35,
    propDensity: 1.2,
    lightDensity: 0.8,
    vegetationDensity: 0.3,
    decalDensity: 0.7,
    neon: 0.4,
    palette: [0x5f7794, 0x9fb2c8, 0x44607f],
    music: 'drive',
  },
  {
    id: 'ZONE_Industrial',
    label: 'Industrial Belt',
    fromDistance: 2500,
    fog: { color: 0x9a8f7f, near: 40, far: 240 },
    sky: { top: 0x8a7f6d, bottom: 0xd4c6ad },
    sun: { color: 0xffd9a0, intensity: 1.9, position: [-16, 46, 10] },
    ambient: { color: 0x9c927f, intensity: 0.95 },
    buildingScale: 0.9,
    propDensity: 1.4,
    lightDensity: 0.6,
    vegetationDensity: 0.15,
    decalDensity: 1.3,
    neon: 0.2,
    palette: [0x7a6f5e, 0xa89a82, 0x5d5449],
    music: 'intense',
  },
  {
    id: 'ZONE_Elevated',
    label: 'Elevated Line',
    fromDistance: 3400,
    fog: { color: 0xa9b6c6, near: 55, far: 340 },
    sky: { top: 0x3f628f, bottom: 0xc4b39c },
    sun: { color: 0xffc98a, intensity: 2.1, position: [-52, 32, -6] },
    ambient: { color: 0x93a2b6, intensity: 0.9 },
    buildingScale: 0.7,
    propDensity: 0.7,
    lightDensity: 0.7,
    vegetationDensity: 0.35,
    decalDensity: 0.6,
    neon: 0.35,
    palette: [0x6d829b, 0xb4a48d, 0x87919e],
    music: 'drive',
  },
  {
    id: 'ZONE_Construction',
    label: 'Construction Zone',
    fromDistance: 4300,
    fog: { color: 0x8c8578, near: 38, far: 230 },
    sky: { top: 0x3d4657, bottom: 0x9c8f79 },
    sun: { color: 0xffb877, intensity: 1.7, position: [-44, 26, -12] },
    ambient: { color: 0x7d7b74, intensity: 0.85 },
    buildingScale: 0.85,
    propDensity: 1.5,
    lightDensity: 0.9,
    vegetationDensity: 0.1,
    decalDensity: 1.4,
    neon: 0.3,
    palette: [0x6b6558, 0x9a8b6f, 0x4d4a43],
    music: 'intense',
  },
  {
    id: 'ZONE_Neon',
    label: 'Neon District',
    fromDistance: 5200,
    fog: { color: 0x181428, near: 30, far: 210 },
    sky: { top: 0x0a0a18, bottom: 0x2a1740 },
    sun: { color: 0x6f7fd8, intensity: 0.55, position: [30, 40, -40] },
    ambient: { color: 0x3a3260, intensity: 0.7 },
    buildingScale: 1.2,
    propDensity: 1.3,
    lightDensity: 1.6,
    vegetationDensity: 0.2,
    decalDensity: 1.0,
    neon: 1.0,
    palette: [0x2a1c46, 0x123a48, 0x3d1436],
    music: 'intense',
  },
];

export const ZONE_BY_ID: Record<string, ZoneDef> = Object.fromEntries(ZONES.map((z) => [z.id, z]));

/** Zone for a distance, with a blend factor into the next one. */
export function zoneAt(distance: number): { zone: ZoneDef; next: ZoneDef; blend: number; index: number } {
  // Zones cycle once the last one is passed, so a very long run keeps varying.
  const span = ZONES[ZONES.length - 1].fromDistance + 900;
  const wrapped = distance % span;
  let index = 0;
  for (let i = 0; i < ZONES.length; i++) if (wrapped >= ZONES[i].fromDistance) index = i;
  const zone = ZONES[index];
  const next = ZONES[(index + 1) % ZONES.length];
  const nextStart = index + 1 < ZONES.length ? ZONES[index + 1].fromDistance : span;
  const transition = 240;
  const blend = Math.min(1, Math.max(0, (wrapped - (nextStart - transition)) / transition));
  return { zone, next, blend, index: index + Math.floor(distance / span) * ZONES.length };
}
