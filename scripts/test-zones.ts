import * as THREE from 'three';
import { DecorScatter } from '../src/world/DecorScatter';
import { buildStation } from '../src/assets/StationFactory';
import { CollectibleManager } from '../src/collectibles/CollectibleManager';
import { CollisionSystem } from '../src/core/CollisionSystem';
import { PowerUpManager } from '../src/powerups/PowerUpManager';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { ProceduralGenerator } from '../src/procedural/ProceduralGenerator';
import { TrackManager } from '../src/world/TrackManager';
import { CFG } from '../src/core/Config';
import { ZONES, zoneAt } from '../data/difficulty/zones';

/**
 * Every zone has to be a real place.
 *
 * The game runs through seven zones over five and a half kilometres, and CI
 * never sees past the first one: under software rasterisation a browser run
 * reaches about 60 m. Six zones of content — their palettes, their buildings,
 * their props and vegetation — went the entire build without anything, human
 * or automated, ever looking at them.
 *
 * They were eventually photographed by hand and are all correct. This keeps
 * them that way. A zone whose decor silently stopped spawning, or whose
 * densities were typo'd to zero, would otherwise ship as a corridor of empty
 * ground that nobody would notice until a player got there.
 *
 * It asserts content rather than pixels: counts, ranges and distinctness are
 * stable, while screenshot comparison in this environment is not.
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

check('every zone in the schedule is reachable', ZONES.length >= 7, `${ZONES.length} zones`);

// --------------------------------------------------------- the schedule

{
  // Zones cycle deliberately, so a very long run keeps varying rather than
  // freezing in the last one. One pass through the span must visit all seven
  // in order; past it, the schedule starts again.
  const span = ZONES[ZONES.length - 1].fromDistance + 900;
  const seen: string[] = [];
  for (let d = 0; d < span; d += 25) {
    const { zone } = zoneAt(d);
    if (!zone) { check(`a zone is defined at ${d} m`, false); break; }
    if (seen[seen.length - 1] !== zone.id) seen.push(zone.id);
  }
  check('one pass visits every zone', seen.length === ZONES.length,
    `${seen.length} of ${ZONES.length}: ${seen.join(' -> ')}`);
  check('zones arrive in schedule order',
    seen.join(',') === ZONES.map((z) => z.id).join(','), seen.join(' -> '));
  check('the schedule cycles rather than ending',
    zoneAt(span + 10).zone.id === ZONES[0].id, zoneAt(span + 10).zone.id);
  // The index keeps climbing across wraps, which is what keeps decor varying
  // on the second lap rather than repeating the first exactly.
  check('the zone index keeps increasing across a wrap',
    zoneAt(span + 10).index > zoneAt(span - 10).index,
    `${zoneAt(span - 10).index} -> ${zoneAt(span + 10).index}`);
}

// --------------------------------------------------------- distinct looks

{
  // If two zones share a palette the journey stops reading as travel. Fog is
  // the strongest cue, so it at least must differ.
  const fogs = new Set(ZONES.map((z) => z.fog.color));
  check('no two zones share a fog colour', fogs.size === ZONES.length,
    `${fogs.size} distinct of ${ZONES.length}`);

  const grounds = new Set(ZONES.map((z) => z.ground));
  check('no two zones share a ground colour', grounds.size === ZONES.length,
    `${grounds.size} distinct of ${ZONES.length}`);

  const bad = ZONES.filter((z) => !(z.fog.near > 0 && z.fog.far > z.fog.near + 50));
  check('every zone has a usable fog range', bad.length === 0,
    bad.map((z) => `${z.id} ${z.fog.near}..${z.fog.far}`).join(', '));

  // The camera's far plane scales with quality: 420 m at high, 315 m on low.
  // A zone is allowed to fog out past the low plane — ZONE_Elevated does, at
  // 340 — because the renderer clears to the fog colour, so ground cut by the
  // far plane meets a backdrop of exactly the haze it was fading into.
  //
  // What that mitigation cannot absorb is a zone whose fog is so long that the
  // ground is still obviously itself where the plane cuts it. So the residual
  // is what gets checked, not the distance: how far the ground still is from
  // fog colour at the cut. ZONE_Elevated leaves 8 levels of 255 and
  // ZONE_CityEdge 2; a zone fogging to 800 m would leave 55 and draw a line
  // across the horizon.
  //
  // (This replaced a check against 420 whose own comment described 315. The
  // assertion had never matched the invariant it was written for, and the
  // invariant it described was not the one the renderer actually relies on.)
  const nearestFar = CFG.camera.far * Math.min(...Object.values(CFG.quality).map((q) => q.viewScale));
  const residual = (z: (typeof ZONES)[number]): number => {
    const reached = Math.min(1, Math.max(0, (nearestFar - z.fog.near) / (z.fog.far - z.fog.near)));
    const ground = [(z.ground >> 16) & 255, (z.ground >> 8) & 255, z.ground & 255];
    const fog = [(z.fog.color >> 16) & 255, (z.fog.color >> 8) & 255, z.fog.color & 255];
    return Math.max(...ground.map((g, i) => Math.abs(g - fog[i]) * (1 - reached)));
  };
  const MAX_RESIDUAL = 16;
  const harsh = ZONES.filter((z) => residual(z) > MAX_RESIDUAL);
  check(`no zone leaves a visible edge where the far plane cuts it (${Math.round(nearestFar)} m)`,
    harsh.length === 0,
    harsh.map((z) => `${z.id} fog ${z.fog.far} leaves ${Math.round(residual(z))}/255`).join(', '));
  console.log(`  worst residual at the ${Math.round(nearestFar)} m plane: ` +
    ZONES.map((z) => `${z.id.replace('ZONE_', '')} ${Math.round(residual(z))}`)
      .sort((a, b) => Number(b.split(' ')[1]) - Number(a.split(' ')[1]))[0]);
}

// --------------------------------------------------------- actual content

{
  const empty: string[] = [];
  const report: string[] = [];
  for (const zone of ZONES) {
    const decor = new DecorScatter();
    // Several segments' worth, so a zone with sparse densities still gets a
    // fair chance to place something.
    for (let i = 0; i < 12; i++) {
      decor.populate(i * 60, 60, zone, ZONES.indexOf(zone), i, 1);
    }
    const { placed, buildings, props } = decor.stats;
    report.push(`${zone.id}: ${placed} placed (${buildings} buildings, ${props} props)`);
    if (placed === 0) empty.push(zone.id);
    decor.clear();
  }
  for (const line of report) console.log(`  ${line}`);
  check('no zone is an empty corridor', empty.length === 0, empty.join(', '));
}

// ------------------------------------------------- the running corridor
//
// A player reported "something in between while I'm running": the station
// entrance, a 5.4 m concrete facade placed at x = 0, straddling all three
// running lines. It carried no collider, so it never registered as an
// obstacle -- it just looked solid and hid the track ahead.
//
// Scenery is scenery: only obstacles belong inside the corridor the player
// runs down. Every station piece, at every dressing, is measured here.

{
  const half = (CFG.laneCount * CFG.laneWidth) / 2;
  const clearance = half + 0.4; // the player's shoulders at the outer lanes
  const box = new THREE.Box3();
  const intruders: string[] = [];

  for (let seed = 0; seed < 12; seed++) {
    const station = buildStation(seed);
    station.updateMatrixWorld(true);
    station.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      box.setFromObject(mesh);
      // Ground-hugging trim is walked over, not into.
      if (box.max.y < 0.5) return;
      if (box.min.x < clearance && box.max.x > -clearance) {
        const name = mesh.parent?.name || mesh.name || 'unnamed';
        intruders.push(`${name}@seed${seed} x ${box.min.x.toFixed(1)}..${box.max.x.toFixed(1)}`);
      }
    });
  }

  check('no station piece stands inside the running corridor',
    intruders.length === 0, [...new Set(intruders)].slice(0, 6).join('; '));
}

// ------------------------------------------------------- module variety
//
// Streaming the whole schedule also proves the world does not collapse onto
// one module: `TRACK_VARIANTS` is a catalogue, and `TrackManager.variantFor`
// picks by zone with its own weights, so only a real run shows what is built.

{
  const difficulty = new DifficultyManager();
  const generator = new ProceduralGenerator(7, difficulty);
  const track = new TrackManager(generator, new CollisionSystem(), new CollectibleManager(), new PowerUpManager());
  track.reset(7);
  difficulty.reset();

  const dt = 1 / 60;
  let distance = 0;
  let elapsed = 0;
  const built = new Set<string>();
  const span = ZONES[ZONES.length - 1].fromDistance + 1000;
  while (distance < span) {
    elapsed += dt;
    const speed = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * elapsed);
    distance += speed * dt;
    difficulty.update(distance, dt);
    track.update(dt, distance, speed);
    track.root.traverse((o) => { if (o.name?.startsWith('TRK_')) built.add(o.name); });
  }

  check(`the world uses a spread of module variants over ${Math.round(distance)} m`,
    built.size >= 8, `${built.size} kinds: ${[...built].sort().join(', ')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
