import * as THREE from 'three';
import { CFG, laneToX } from '../core/Config';
import { hash01, mergeGeometries, place, roundedBox } from './GeometryUtil';
import { decal, material } from './MaterialLibrary';
import { createSurface } from './TextureFactory';

/**
 * TRK_* modular track kit.
 *
 * The railway is built from interchangeable modules of a fixed length so the
 * generator can stitch any order together without seams. Each module returns a
 * single group whose repeated parts (sleepers, ballast stones, fixings) are
 * instanced, keeping a 24 m module to a handful of draw calls.
 */

export type TrackVariant =
  | 'TRK_Straight_01'
  | 'TRK_Straight_02'
  | 'TRK_Short_01'
  | 'TRK_Long_01'
  | 'TRK_Junction_01'
  | 'TRK_Switch_01'
  | 'TRK_Platform_01'
  | 'TRK_PlatformEdge_01'
  | 'TRK_Maintenance_01'
  | 'TRK_Tunnel_01'
  | 'TRK_Elevated_01'
  | 'TRK_Crossing_01';

/**
 * Every variant that exists. Note this is the catalogue, not the selection
 * list: `TrackManager.variantFor` picks by zone with its own weights and never
 * reads this. Tests enumerate it to build one of everything.
 */
export const TRACK_VARIANTS: TrackVariant[] = [
  'TRK_Straight_01', 'TRK_Straight_02', 'TRK_Short_01', 'TRK_Long_01',
  'TRK_Junction_01', 'TRK_Switch_01', 'TRK_Platform_01', 'TRK_PlatformEdge_01',
  'TRK_Maintenance_01', 'TRK_Tunnel_01', 'TRK_Elevated_01', 'TRK_Crossing_01',
];

const GAUGE = 0.75;
const RAIL_TOP = 0.12;
const SLEEPER_TOP = 0;
const BALLAST_DEPTH = 0.34;
export const TRACK_HALF_WIDTH = (CFG.laneCount * CFG.laneWidth) / 2 + 1.2;

/**
 * Centre of the neighbouring running lines, one either side of the formation
 * the player uses. Nothing on them collides — they exist so there is somewhere
 * for traffic to pass. Placed outside the cess and its drainage, and inside
 * the band the lineside decor is scattered into.
 */
export const SIDE_LINE_X = TRACK_HALF_WIDTH + 5.4;

/** Rail profile: a real I-beam section rather than a plain box. */
function railGeometry(length: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Foot, web, head.
  parts.push(place(new THREE.BoxGeometry(0.13, 0.022, length), [0, 0.011, 0]));
  parts.push(place(new THREE.BoxGeometry(0.045, 0.07, length), [0, 0.057, 0]));
  parts.push(place(new THREE.BoxGeometry(0.09, 0.03, length), [0, 0.107, 0]));
  return mergeGeometries(parts);
}

function sleeperGeometry(): THREE.BufferGeometry {
  return roundedBox(2.05, 0.11, 0.24, 0.02, 2);
}

/** Chairs that hold the rail to the sleeper; small but they sell the scale. */
function fixingGeometry(): THREE.BufferGeometry {
  return roundedBox(0.16, 0.05, 0.14, 0.015, 1);
}

function ballastGeometry(length: number, width: number): THREE.BufferGeometry {
  // Trapezoid section: wide at the base, narrower at the sleeper line.
  const half = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half - 0.55, -BALLAST_DEPTH);
  shape.lineTo(half + 0.55, -BALLAST_DEPTH);
  shape.lineTo(half, -0.04);
  shape.lineTo(-half, -0.04);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  geo.translate(0, 0, -length / 2);
  return geo;
}

interface ModuleContext {
  length: number;
  seed: number;
}

/** Adds the running rails and their sleepers for all three lanes. */
function addPermanentWay(group: THREE.Group, ctx: ModuleContext): void {
  const { length } = ctx;

  const rail = new THREE.Mesh(railGeometry(length), material('MAT_RailSteel'));
  rail.castShadow = false;
  rail.receiveShadow = true;
  for (let lane = 0; lane < CFG.laneCount; lane++) {
    const x = laneToX(lane);
    for (const side of [-1, 1]) {
      const r = rail.clone();
      r.position.set(x + side * GAUGE, SLEEPER_TOP, 0);
      group.add(r);
    }
  }

  // Sleepers: one instanced mesh for the whole module.
  const spacing = 0.62;
  const count = Math.floor(length / spacing);
  const sleepers = new THREE.InstancedMesh(sleeperGeometry(), material('MAT_Sleeper'), count * CFG.laneCount);
  sleepers.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  let i = 0;
  for (let lane = 0; lane < CFG.laneCount; lane++) {
    const x = laneToX(lane);
    for (let n = 0; n < count; n++) {
      const z = -length / 2 + spacing * (n + 0.5);
      const jitter = (hash01(ctx.seed + lane * 31 + n) - 0.5) * 0.03;
      p.set(x, -0.06 + jitter * 0.4, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), jitter * 0.5);
      m.compose(p, q, s);
      sleepers.setMatrixAt(i++, m);
    }
  }
  sleepers.count = i;
  sleepers.instanceMatrix.needsUpdate = true;
  group.add(sleepers);

  // Rail fixings, two per sleeper per rail.
  const fixings = new THREE.InstancedMesh(fixingGeometry(), material('MAT_PaintedMetalDark'), i * 2);
  let f = 0;
  for (let lane = 0; lane < CFG.laneCount; lane++) {
    const x = laneToX(lane);
    for (let n = 0; n < count; n++) {
      const z = -length / 2 + spacing * (n + 0.5);
      for (const side of [-1, 1]) {
        p.set(x + side * GAUGE, -0.02, z);
        m.compose(p, new THREE.Quaternion(), s);
        fixings.setMatrixAt(f++, m);
      }
    }
  }
  fixings.count = f;
  fixings.instanceMatrix.needsUpdate = true;
  group.add(fixings);

  // Ballast bed.
  const ballast = new THREE.Mesh(ballastGeometry(length, TRACK_HALF_WIDTH * 2), material('MAT_Ballast'));
  ballast.receiveShadow = true;
  group.add(ballast);
}

/**
 * The neighbouring running lines. Rails and sleepers only: no ballast shoulder
 * and no fixings, because they are seen at a distance and in motion, and the
 * detail would be spent where nobody is looking.
 */
function addSideLines(group: THREE.Group, ctx: ModuleContext): void {
  const { length } = ctx;
  const rail = new THREE.Mesh(railGeometry(length), material('MAT_RailSteel'));
  rail.receiveShadow = true;

  const spacing = 0.62;
  const count = Math.floor(length / spacing);
  const sleepers = new THREE.InstancedMesh(sleeperGeometry(), material('MAT_Sleeper'), count * 2);
  sleepers.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  let i = 0;

  for (const side of [-1, 1]) {
    const cx = side * SIDE_LINE_X;
    for (const rs of [-1, 1]) {
      const r = rail.clone();
      r.position.set(cx + rs * GAUGE, SLEEPER_TOP, 0);
      group.add(r);
    }
    for (let n = 0; n < count; n++) {
      const z = -length / 2 + spacing * (n + 0.5);
      const jitter = (hash01(ctx.seed + 977 + n + (side > 0 ? 61 : 0)) - 0.5) * 0.03;
      p.set(cx, -0.06 + jitter * 0.4, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), jitter * 0.5);
      m.compose(p, q, one);
      sleepers.setMatrixAt(i++, m);
    }
  }
  sleepers.count = i;
  sleepers.instanceMatrix.needsUpdate = true;
  group.add(sleepers);
}

/** Cess: the walkable strip and drainage either side of the running lines. */
function addCess(group: THREE.Group, ctx: ModuleContext): void {
  const { length } = ctx;
  for (const side of [-1, 1]) {
    const walkway = new THREE.Mesh(
      place(new THREE.BoxGeometry(1.5, 0.1, length), [side * (TRACK_HALF_WIDTH + 0.75), -0.06, 0]),
      material('MAT_ConcreteDirty'),
    );
    walkway.receiveShadow = true;
    group.add(walkway);

    const drain = new THREE.Mesh(
      place(new THREE.BoxGeometry(0.42, 0.3, length), [side * (TRACK_HALF_WIDTH + 1.72), -0.22, 0]),
      material('MAT_Concrete'),
    );
    group.add(drain);
  }
}

/** Cable troughing and lineside cable runs. */
function addCableRoute(group: THREE.Group, ctx: ModuleContext): void {
  const { length } = ctx;
  for (const side of [-1, 1]) {
    const trough = new THREE.Mesh(
      place(roundedBox(0.44, 0.3, length, 0.04, 2), [side * (TRACK_HALF_WIDTH + 1.35), 0.05, 0]),
      material('MAT_Concrete'),
    );
    group.add(trough);
  }
}

/** Painted markings and grime, applied as decal planes just above the deck. */
function addDecals(group: THREE.Group, ctx: ModuleContext, density: number): void {
  const count = Math.round(density * 4);
  for (let i = 0; i < count; i++) {
    const r = hash01(ctx.seed * 7 + i * 13);
    const kind = r < 0.35 ? 'DEC_Dirt' : r < 0.6 ? 'DEC_Oil' : r < 0.8 ? 'DEC_RailMarking' : 'DEC_Arrow';
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), decal(kind as never));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(
      (hash01(ctx.seed + i * 3) - 0.5) * TRACK_HALF_WIDTH * 1.7,
      0.01,
      (hash01(ctx.seed + i * 5) - 0.5) * ctx.length,
    );
    plane.rotation.z = hash01(ctx.seed + i * 9) * Math.PI;
    group.add(plane);
  }
}

/** Side platform, the module that turns plain track into a station approach. */
function addPlatform(group: THREE.Group, ctx: ModuleContext, sides: number[]): void {
  const { length } = ctx;
  const height = 1.05;
  for (const side of sides) {
    const x = side * (TRACK_HALF_WIDTH + 3.4);
    const deck = new THREE.Mesh(
      place(new THREE.BoxGeometry(6.4, height, length), [x, height / 2 - 0.3, 0]),
      material('MAT_PlatformTile'),
    );
    deck.receiveShadow = true;
    group.add(deck);

    // Tactile warning strip along the platform edge.
    const edge = new THREE.Mesh(
      place(new THREE.BoxGeometry(0.55, 0.03, length), [x - side * 2.95, height - 0.29, 0]),
      material('MAT_PlatformEdge'),
    );
    group.add(edge);

    // Coping stones under the lip.
    const coping = new THREE.Mesh(
      place(new THREE.BoxGeometry(0.3, 0.9, length), [x - side * 3.25, 0.18, 0]),
      material('MAT_Concrete'),
    );
    group.add(coping);
  }
}

function addMaintenanceKit(group: THREE.Group, ctx: ModuleContext): void {
  const side = hash01(ctx.seed) > 0.5 ? 1 : -1;
  const base = side * (TRACK_HALF_WIDTH + 1.9);

  const hut = new THREE.Mesh(roundedBox(1.6, 1.9, 1.4, 0.06, 2), material('MAT_Corrugated'));
  hut.position.set(base + side * 1.2, 0.9, -ctx.length * 0.2);
  group.add(hut);

  const pile = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.14, 2.4), material('MAT_WoodWorn'), 6);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) {
    m.makeRotationY(hash01(ctx.seed + i) * 0.2);
    m.setPosition(base + (i % 3) * 0.2, 0.07 + Math.floor(i / 3) * 0.15, ctx.length * 0.22 + (i % 3) * 0.05);
    pile.setMatrixAt(i, m);
  }
  pile.instanceMatrix.needsUpdate = true;
  group.add(pile);

  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.88, 12), material('MAT_RustedMetal'));
  drum.position.set(base + side * 0.5, 0.44, 0);
  group.add(drum);
}

function addSwitchWork(group: THREE.Group, ctx: ModuleContext): void {
  // A diverging stub of rail plus the point machine that drives it.
  const stub = new THREE.Mesh(railGeometry(ctx.length * 0.45), material('MAT_RailSteel'));
  stub.position.set(laneToX(0) - 1.3, 0, -ctx.length * 0.2);
  stub.rotation.y = 0.09;
  group.add(stub);

  const machine = new THREE.Mesh(roundedBox(0.9, 0.5, 0.6, 0.05, 2), material('MAT_PaintedMetal'));
  machine.position.set(laneToX(0) - 1.15, 0.2, 0);
  group.add(machine);

  const rodding = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), material('MAT_StainlessSteel'));
  rodding.position.set(laneToX(0) - 0.6, 0.06, 0);
  group.add(rodding);
}

function addCrossing(group: THREE.Group, ctx: ModuleContext): void {
  // A level crossing deck laid between the rails.
  const deck = new THREE.Mesh(
    place(new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2 + 3, 0.14, 3.4), [0, 0.02, 0]),
    material('MAT_AsphaltMarked'),
  );
  deck.receiveShadow = true;
  group.add(deck);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.6, 8), material('MAT_HazardStripe'));
    post.position.set(side * (TRACK_HALF_WIDTH + 1.4), 1.3, 1.9);
    group.add(post);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), material('MAT_TailLight'));
    lamp.position.set(side * (TRACK_HALF_WIDTH + 1.4), 2.5, 1.9);
    group.add(lamp);
  }
  void ctx;
}

/**
 * The tunnel lining, shared across every tunnel module so they still batch.
 *
 * It carries a little emissive of its own. The world has three lights and all
 * of them are outside: a shell that blocks the sun and takes only hemisphere
 * ambient renders as a black void, and a player running into one is running
 * blind. A dim self-lit lining means the tunnel always reads as a tunnel, even
 * beyond the reach of the service lamps.
 */
let tunnelLining: THREE.MeshStandardMaterial | null = null;
function liningMaterial(): THREE.MeshStandardMaterial {
  if (!tunnelLining) {
    tunnelLining = material('MAT_ConcreteRib').clone();
    tunnelLining.side = THREE.BackSide;
    tunnelLining.emissive = new THREE.Color(0x2c3138);
    tunnelLining.emissiveIntensity = 1;
  }
  return tunnelLining;
}

/** The soft additive puddle a service lamp throws on the tunnel floor. */
let lampPool: THREE.Material | null = null;
function poolMaterial(): THREE.Material {
  if (!lampPool) {
    lampPool = new THREE.MeshBasicMaterial({
      color: 0xffc27a,
      map: radialFalloff() ?? undefined,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return lampPool;
}

/**
 * A round white-to-black gradient, so the pool has no visible edge. Built
 * through `createSurface`, which returns null under the headless harness where
 * there is no canvas -- the tunnel then just has no floor pool, rather than
 * throwing on `document` in a test run.
 */
let falloff: THREE.Texture | null | undefined;
function radialFalloff(): THREE.Texture | null {
  if (falloff === undefined) {
    const size = 64;
    const surface = createSurface(size);
    if (!surface) {
      falloff = null;
    } else {
      const c = surface.ctx;
      const grad = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.45, '#8a8a8a');
      grad.addColorStop(1, '#000000');
      c.fillStyle = grad;
      c.fillRect(0, 0, size, size);
      falloff = new THREE.CanvasTexture(surface.canvas as HTMLCanvasElement);
      falloff.colorSpace = THREE.SRGBColorSpace;
      falloff.needsUpdate = true;
    }
  }
  return falloff;
}

function addTunnelShell(group: THREE.Group, ctx: ModuleContext): void {
  const radius = TRACK_HALF_WIDTH + 2.6;
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, ctx.length, 18, 1, true, 0, Math.PI),
    liningMaterial(),
  );
  // The half-cylinder has to be spun about its own axis to become a vault.
  // Left at zero it is the *side* half: a wall down one side of the track with
  // open sky down the other, which is what shipped -- a tunnel you could see
  // the city through. The middle term is the spin about the tunnel axis (it is
  // applied before the tilt), and PI/2 lifts the arch overhead, springing from
  // ground level at both haunches.
  shell.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  shell.position.y = -0.3;
  group.add(shell);

  // Tunnel service lighting. An emissive material lights nothing, so the lamps
  // were fittings in a dark room. The fix is deliberately *not* a point light
  // per lamp: the scene keeps a fixed three lights, and three.js recompiles
  // every shader when that count changes, so a light travelling in and out
  // with a streamed module would hitch on entry to each tunnel. Instead the
  // lamps throw an additive pool onto the floor beneath them -- no light, no
  // recompile, and the tunnel reads as lit.
  const lampCount = Math.floor(ctx.length / 6);
  for (let i = 0; i < lampCount; i++) {
    const z = -ctx.length / 2 + (i + 0.5) * 6;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), material('MAT_NeonAmber'));
    lamp.position.set(-radius * 0.72, 3.6, z);
    group.add(lamp);

    const pool = new THREE.Mesh(new THREE.PlaneGeometry(radius * 1.1, 5.4), poolMaterial());
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(-radius * 0.36, 0.06, z);
    group.add(pool);
  }
}

function addElevatedDeck(group: THREE.Group, ctx: ModuleContext): void {
  const half = TRACK_HALF_WIDTH + 1.4;
  const deck = new THREE.Mesh(
    place(new THREE.BoxGeometry(half * 2, 0.7, ctx.length), [0, -0.72, 0]),
    material('MAT_Concrete'),
  );
  group.add(deck);
  for (const side of [-1, 1]) {
    const parapet = new THREE.Mesh(
      place(new THREE.BoxGeometry(0.28, 1.15, ctx.length), [side * half, 0.2, 0]),
      material('MAT_ConcreteDirty'),
    );
    group.add(parapet);
  }
  // Piers every half module.
  for (let i = 0; i < 2; i++) {
    const pier = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 1.05, 7, 10),
      material('MAT_Concrete'),
    );
    pier.position.set(0, -4.6, -ctx.length / 2 + ctx.length * (0.25 + i * 0.5));
    group.add(pier);
  }
}

/** Builds one track module. Modules are pooled and reused by TrackManager. */
export function buildTrackModule(variant: TrackVariant, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = variant;
  const length = variant === 'TRK_Short_01' ? CFG.segmentLength : variant === 'TRK_Long_01' ? CFG.segmentLength : CFG.segmentLength;
  const ctx: ModuleContext = { length, seed };

  addPermanentWay(group, ctx);
  addSideLines(group, ctx);
  addCess(group, ctx);
  addCableRoute(group, ctx);

  switch (variant) {
    case 'TRK_Straight_01':
      addDecals(group, ctx, 1);
      break;
    case 'TRK_Straight_02':
      addDecals(group, ctx, 2);
      break;
    case 'TRK_Short_01':
      addDecals(group, ctx, 0.5);
      break;
    case 'TRK_Long_01':
      addDecals(group, ctx, 1.5);
      break;
    case 'TRK_Junction_01':
      addSwitchWork(group, ctx);
      addDecals(group, ctx, 1);
      break;
    case 'TRK_Switch_01':
      addSwitchWork(group, ctx);
      break;
    case 'TRK_Platform_01':
      addPlatform(group, ctx, [-1, 1]);
      break;
    case 'TRK_PlatformEdge_01':
      addPlatform(group, ctx, [hash01(seed) > 0.5 ? 1 : -1]);
      break;
    case 'TRK_Maintenance_01':
      addMaintenanceKit(group, ctx);
      addDecals(group, ctx, 2);
      break;
    case 'TRK_Tunnel_01':
      addTunnelShell(group, ctx);
      break;
    case 'TRK_Elevated_01':
      addElevatedDeck(group, ctx);
      break;
    case 'TRK_Crossing_01':
      addCrossing(group, ctx);
      break;
  }

  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.receiveShadow = true;
  });
  return group;
}

export { RAIL_TOP, GAUGE };
