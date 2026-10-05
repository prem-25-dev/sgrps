import { ZoneDef } from '../../src/core/Types';

/**
 * ZONE_* environment set. Zones change look, lighting and music, never the
 * rules of play — so a player who learns the game in the city edge is not
 * ambushed by different physics downtown.
 *
 * Every sun sits behind the camera (negative Z), and that is the whole reason
 * the world reads. The camera looks along +Z, so the faces the player can see
 * are the ones pointing back at them — and with the key light ahead, every one
 * of those was turned away from it. The sun lit the far side of every building,
 * the tops of the trees and the runner's chest, none of which is on screen,
 * while the near wall, the canopy and the runner's back took nothing but
 * hemisphere fill. Measured on the city edge at 94 m, the mean luminance of the
 * building band was 0.14 and the runner was a 0.07 silhouette against 0.45 of
 * sky. Moving the sun behind the camera and keeping it well off-axis puts the
 * light on the surfaces that face the player while still leaving each solid a
 * lit side and a shaded one, which is what makes a shape read as a shape rather
 * than as a flat sticker.
 */
export const ZONES: ZoneDef[] = [
  {
    id: 'ZONE_CityEdge',
    label: 'City Edge',
    fromDistance: 0,
    fog: { color: 0xbfd4e6, near: 60, far: 320 },
    ground: 0x7e9163,
    sky: { top: 0x74a7d8, bottom: 0xdfe9f2 },
    sun: { color: 0xfff2dc, intensity: 2.5, position: [-38, 58, -46] },
    ambient: { color: 0xa8c0d6, intensity: 1.25 },
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
    ground: 0x6f7472,
    sky: { top: 0x5f92c4, bottom: 0xd2dee8 },
    sun: { color: 0xffeccd, intensity: 2.35, position: [-34, 56, -44] },
    ambient: { color: 0x9db3c8, intensity: 1.2 },
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
    ground: 0x565b6c,
    sky: { top: 0x40699c, bottom: 0xb9c9dc },
    sun: { color: 0xffe3bb, intensity: 2.25, position: [-30, 54, -42] },
    ambient: { color: 0x8ea3ba, intensity: 1.15 },
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
    ground: 0x7a6e58,
    sky: { top: 0x8a7f6d, bottom: 0xd4c6ad },
    sun: { color: 0xffd9a0, intensity: 2.2, position: [-26, 48, -40] },
    ambient: { color: 0xa69c88, intensity: 1.15 },
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
    ground: 0x6b747e,
    sky: { top: 0x3f628f, bottom: 0xc4b39c },
    sun: { color: 0xffc98a, intensity: 2.3, position: [-44, 40, -38] },
    ambient: { color: 0x9eadc1, intensity: 1.1 },
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
    ground: 0x827863,
    sky: { top: 0x3d4657, bottom: 0x9c8f79 },
    sun: { color: 0xffb877, intensity: 2.0, position: [-40, 36, -36] },
    ambient: { color: 0x8a8880, intensity: 1.05 },
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
    ground: 0x1b1730,
    sky: { top: 0x0a0a18, bottom: 0x2a1740 },
    sun: { color: 0x8c9ae8, intensity: 0.85, position: [26, 38, -40] },
    ambient: { color: 0x4a4176, intensity: 0.85 },
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
