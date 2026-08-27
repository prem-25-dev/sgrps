import { DecorScatter } from '../src/world/DecorScatter';
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

  // The sky dome is scaled to sit inside the camera's far plane, which is
  // 420 m at full quality and 315 m on the low profile. A zone whose fog
  // reached past that would show a hard edge where the world simply stopped.
  const tooFar = ZONES.filter((z) => z.fog.far > 420);
  check('no zone fogs out beyond the far plane', tooFar.length === 0,
    tooFar.map((z) => `${z.id} far ${z.fog.far}`).join(', '));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
