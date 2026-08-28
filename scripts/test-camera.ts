/**
 * The player has to be on screen.
 *
 * It is the one thing a chase camera exists to do, and nothing checked it. The
 * camera is pure maths — a `PerspectiveCamera` and a `PlayerState` in, a pose
 * out — so it can be driven headlessly and the hero projected into clip space
 * to see where they actually land in frame.
 *
 * The interesting states are the ones a screenshot rarely catches: the top of
 * a jump at maximum speed, the frame after mounting a train roof, a slide
 * taken while the lane-change is still settling, and the game-over swing.
 * Every one moves the camera and the player in different directions at once.
 *
 * `PlayerState.y` is an absolute world height, not a height above the surface
 * underfoot — `updateVertical` assigns `s.y = surface` when grounded — so the
 * hero standing on a 2.7 m train roof has y = 2.7, and the camera's look
 * target follows y directly. The interface comment says otherwise; the code
 * is the authority and this test follows the code.
 */
import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController';
import { CFG, laneToX } from '../src/core/Config';
import { PlayerState } from '../src/player/PlayerController';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const HERO_HEIGHT = 1.8;
/** The tallest standable surface the game can build: OBS_TrainCar_01. */
const ROOF = 3.15;

function state(over: Partial<PlayerState> = {}): PlayerState {
  return {
    distance: 100, speed: CFG.speed.base, lane: 1, x: 0, y: 0,
    verticalVelocity: 0, grounded: true, sliding: false, jumping: false,
    groundY: 0, alive: true, stumbles: 0, invulnerable: 0,
    ...over,
  };
}

function rig(): { cam: THREE.PerspectiveCamera; ctrl: CameraController } {
  const cam = new THREE.PerspectiveCamera(CFG.camera.baseFov, 16 / 9, CFG.camera.near, CFG.camera.far);
  return { cam, ctrl: new CameraController(cam) };
}

/** Where the hero's feet and head land in clip space, -1..1 on each axis. */
function framing(cam: THREE.PerspectiveCamera, s: PlayerState): { feet: THREE.Vector3; head: THREE.Vector3 } {
  cam.updateMatrixWorld(true);
  const feet = new THREE.Vector3(s.x, s.y, 0).project(cam);
  const head = new THREE.Vector3(s.x, s.y + (s.sliding ? HERO_HEIGHT * 0.45 : HERO_HEIGHT), 0).project(cam);
  return { feet, head };
}

function settle(ctrl: CameraController, s: PlayerState, seconds = 1.5, dt = 1 / 60): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) ctrl.update(dt, s);
}

// -------------------------------------------------- the world must be in view
//
// The one thing no assertion checked, and the one that mattered most: the
// camera spent the whole build pointing the wrong way. `TrackManager` draws
// everything ahead of the player at `absoluteZ - distance`, so an obstacle
// 50 m away sits at +50 — while the camera trailed at +7.4 m and looked toward
// -Z. Every obstacle, coin and power-up was rendered behind the camera. The
// game was unplayable in the most literal sense: you could not see what was
// coming, and nothing failed, because every suite either ran headless in
// gameplay space or only ever projected the hero, who stands at z = 0 and is
// in frame whichever way the camera faces.

{
  const { cam, ctrl } = rig();
  const s = state({ speed: CFG.speed.max });
  settle(ctrl, s);
  cam.updateMatrixWorld(true);

  check('the camera trails the player rather than leading them', cam.position.z < 0,
    `camera at z ${cam.position.z.toFixed(2)}, world ahead is +Z`);

  const e = cam.matrixWorld.elements;
  const lookZ = -e[10];
  check('and looks the way the world streams from', lookZ > 0.9,
    `look direction z ${lookZ.toFixed(3)}`);

  // The decisive one, in the same terms a player experiences: something on the
  // track ahead has to project inside the frustum, and something already
  // passed has to fall outside it.
  const ahead = new THREE.Vector3(0, 1, 50).project(cam);
  const behind = new THREE.Vector3(0, 1, -50).project(cam);
  const inFrame = (v: THREE.Vector3): boolean =>
    Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1;
  check('an obstacle 50 m ahead is on screen', inFrame(ahead),
    `projects to ${ahead.toArray().map((n) => n.toFixed(2)).join(', ')}`);
  check('and one 50 m behind is not', !inFrame(behind),
    `projects to ${behind.toArray().map((n) => n.toFixed(2)).join(', ')}`);

  // Handedness. The camera looks along +Z, so screen-right is world -X, and
  // `laneToX` is inverted to match. Get that wrong and the controls mirror:
  // the right key moves the runner visibly left, while every headless test
  // still passes because lane indices are unchanged. That is what happened
  // when the camera was turned round, and `test:touch` and `test:rebind` in
  // the browser are what caught it.
  const leftLane = new THREE.Vector3(laneToX(0), 1, 20).project(cam);
  const rightLane = new THREE.Vector3(laneToX(CFG.laneCount - 1), 1, 20).project(cam);
  check('lane 0 is on the left of the screen and the last lane on the right',
    leftLane.x < -0.01 && rightLane.x > 0.01,
    `lane 0 at ${leftLane.x.toFixed(3)}, lane ${CFG.laneCount - 1} at ${rightLane.x.toFixed(3)}`);

  // The whole visible run of track, not just one point.
  const missing: number[] = [];
  for (let z = 10; z <= CFG.viewDistance; z += 10) {
    if (!inFrame(new THREE.Vector3(0, 1, z).project(cam))) missing.push(z);
  }
  check(`the whole ${CFG.viewDistance} m of streamed track is in view`, missing.length === 0,
    `not visible at ${missing.join(', ')} m`);
}

// ------------------------------------------------------ the hero is in frame
//
// Not "inside the frustum" — that passes on a camera pointed almost anywhere,
// which is how the first version of this suite gave six green ticks to a
// camera aimed 57 m past the player. The band below is measured from the real
// camera across every standing state (head -0.25..-0.05, feet -0.59..-0.31,
// horizontal offset never past 0.05 even in the outer lane) and then given
// margin. A hero who drifts outside it is framed wrongly even if still drawn.

// Baseline, measured: head -0.335..0.099, feet -0.593..-0.229, side 0.087.
// The bounds sit just outside that, which makes this a regression bound on
// framing that was tuned by eye rather than a claim about what is physically
// visible. Retuning the camera is expected to fail it; the numbers should then
// be re-measured and moved deliberately, not widened until it goes quiet.
const HEAD_BAND = [-0.40, 0.16] as const;
const FEET_BAND = [-0.66, -0.19] as const;
const SIDE_LIMIT = 0.13;

{
  const bad: string[] = [];
  let checked = 0;
  const extremes = { headLo: 1, headHi: -1, feetLo: 1, feetHi: -1, side: 0 };
  for (const speed of [CFG.speed.base, (CFG.speed.base + CFG.speed.max) / 2, CFG.speed.max]) {
    for (const lane of [0, 1, 2]) {
      for (const vertical of ['ground', 'jump-apex', 'slide', 'roof', 'roof-jump'] as const) {
        const s = state({ speed, lane, x: laneToX(lane) });
        // 2.70 m is the jump apex: velocity 18.0 against gravity -60.
        if (vertical === 'jump-apex') { s.y = 2.70; s.grounded = false; s.jumping = true; }
        if (vertical === 'slide') s.sliding = true;
        if (vertical === 'roof') { s.y = ROOF; s.groundY = ROOF; }
        if (vertical === 'roof-jump') { s.y = ROOF + 2.2; s.groundY = ROOF; s.grounded = false; s.jumping = true; }

        const { cam, ctrl } = rig();
        settle(ctrl, s);
        const { feet, head } = framing(cam, s);
        checked++;
        extremes.headLo = Math.min(extremes.headLo, head.y);
        extremes.headHi = Math.max(extremes.headHi, head.y);
        extremes.feetLo = Math.min(extremes.feetLo, feet.y);
        extremes.feetHi = Math.max(extremes.feetHi, feet.y);
        extremes.side = Math.max(extremes.side, Math.abs(head.x), Math.abs(feet.x));

        const off = [
          (head.y < HEAD_BAND[0] || head.y > HEAD_BAND[1]) && `head y ${head.y.toFixed(3)}`,
          (feet.y < FEET_BAND[0] || feet.y > FEET_BAND[1]) && `feet y ${feet.y.toFixed(3)}`,
          Math.abs(head.x) > SIDE_LIMIT && `head x ${head.x.toFixed(3)}`,
          feet.y >= head.y && 'upside down',
        ].filter(Boolean);
        if (off.length) bad.push(`${speed.toFixed(0)} m/s lane ${lane} ${vertical}: ${off.join(', ')}`);
      }
    }
  }
  check(`the hero is framed as tuned in all ${checked} standing states`, bad.length === 0,
    bad.slice(0, 4).join(' | '));
  console.log(`  head ${extremes.headLo.toFixed(3)}..${extremes.headHi.toFixed(3)}, ` +
    `feet ${extremes.feetLo.toFixed(3)}..${extremes.feetHi.toFixed(3)}, ` +
    `worst side offset ${extremes.side.toFixed(3)}`);
}

// --------------------------------------------------- and stays in frame while
//                                                      everything is moving
{
  // A full lane sweep at top speed, jumping and landing on a roof part-way,
  // checked on every single frame rather than once it has settled.
  const { cam, ctrl } = rig();
  const s = state({ speed: CFG.speed.max, lane: 0, x: laneToX(0) });
  settle(ctrl, s);

  const dt = 1 / 60;
  let worst = 0;
  let worstAt = '';
  for (let f = 0; f < 240; f++) {
    const t = f * dt;
    // Slide across all three lanes over two seconds.
    s.x = laneToX(0) + (laneToX(2) - laneToX(0)) * Math.min(1, t / 2);
    // Jump at 0.5 s, land on a roof at 1.1 s, slide from 2.6 s.
    if (t > 0.5 && t < 1.1) { s.grounded = false; s.jumping = true; s.y = 2.7 * Math.sin(((t - 0.5) / 0.6) * Math.PI); }
    else if (t >= 1.1 && t < 2.6) { s.grounded = true; s.jumping = false; s.y = ROOF; s.groundY = ROOF; }
    else if (t >= 2.6) { s.sliding = true; s.y = ROOF; s.groundY = ROOF; }
    if (f === 30) ctrl.addImpact(1.0);
    if (f === 66) ctrl.addShake(1.2);

    ctrl.update(dt, s);
    const { feet, head } = framing(cam, s);
    const excursion = Math.max(Math.abs(feet.x), Math.abs(head.x), -feet.y, head.y);
    if (excursion > worst) { worst = excursion; worstAt = `t=${t.toFixed(2)}s x=${s.x.toFixed(2)} y=${s.y.toFixed(2)}`; }
  }
  check('the hero never leaves the frame during a moving run', worst < 0.9,
    `worst excursion ${worst.toFixed(3)} at ${worstAt}`);
  console.log(`  worst framing excursion over the run: ${worst.toFixed(3)} of 1.0 (${worstAt})`);
}

// -------------------------------------------------------- the deck clamp
//
// The camera is not allowed to sink through the surface underfoot. At rest it
// never comes close — on the tallest standable surface in the game (a 3.15 m
// train car) the settled camera still floats 2.2 m above it. The clamp exists
// for the transient: the frame the player mounts a roof, the camera is still
// down at track level and has a 0.09 s half-life to climb.
//
// The first version of this check used a 2.7 m roof and no landing impact,
// which lands within a millimetre of the clamp without ever crossing it — it
// passed with the clamp deleted. So it now uses the real tallest surface and
// the impact a landing actually adds, and asserts that the bound is *reached*
// as well as respected. A scenario that stops exercising the clamp fails the
// second half rather than quietly proving nothing.

{
  const { cam, ctrl } = rig();
  const s = state({ speed: CFG.speed.max });
  settle(ctrl, s);
  let lowest = Infinity;
  const dt = 1 / 60;
  for (let f = 0; f < 180; f++) {
    if (f === 30) { s.y = ROOF; s.groundY = ROOF; ctrl.addImpact(1.4); }
    if (f === 120) s.sliding = true;
    ctrl.update(dt, s);
    lowest = Math.min(lowest, cam.position.y - s.groundY);
  }
  check('the camera never sinks through the surface underfoot', lowest >= 0.85 - 1e-6,
    `dipped to ${lowest.toFixed(3)} m above it`);
  check('and the mount actually drives it onto that floor', lowest < 0.85 + 1e-3,
    `never got closer than ${lowest.toFixed(3)} m — the scenario stopped testing the clamp`);
}

// ------------------------------------------------------------ nothing is NaN

{
  const { cam, ctrl } = rig();
  const s = state({ speed: CFG.speed.max });
  ctrl.addImpact(1.4);
  ctrl.addShake(1.2);
  ctrl.startGameOverShot();
  const dt = 1 / 60;
  let finite = true;
  for (let f = 0; f < 300; f++) {
    ctrl.update(dt, s);
    for (const v of [cam.position.x, cam.position.y, cam.position.z,
                     cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w,
                     cam.fov, ctrl.timeScale]) {
      if (!Number.isFinite(v)) finite = false;
    }
  }
  check('the game-over shot stays finite for its whole swing', finite);
  check('slow motion returns towards real time', ctrl.timeScale > 0.9,
    `timeScale ${ctrl.timeScale.toFixed(3)}`);
}

// --------------------------------------------------- frame-rate independence
//
// The class claims it: "everything is exponential smoothing on a half-life, so
// behaviour is frame-rate independent". Comparing only where the two runs end
// proves nothing — both converge on the same fixed point whatever the
// smoothing does, which is why a hard-coded `k = 0.25` passed the first
// version of this check. The whole trajectory is compared instead, sampled
// every 0.1 s, so the transient has to match too.

{
  const trajectory = (dt: number): THREE.Vector3[] => {
    const { cam, ctrl } = rig();
    const s = state({ speed: CFG.speed.max, lane: 2, x: laneToX(2) });
    const steps = Math.round(2.5 / dt);
    const out: THREE.Vector3[] = [];
    let nextSample = 0.1;
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      // A step, not a curve. A smooth trajectory sampled on two different
      // grids is two different input signals, and the camera is a filter: it
      // would report the difference in the input as a difference in itself.
      // The edges sit at 0.5 s and 1.5 s, which both step sizes land on
      // exactly, so each run sees the identical signal.
      s.y = t >= 0.5 && t < 1.5 ? 2.4 : 0;
      s.grounded = s.y === 0;
      ctrl.update(dt, s);
      // Sampled by elapsed time, not by update count: one step of 1/30 s and
      // one of 1/240 s are not the same instant, and comparing them would
      // report the difference in step size as a difference in behaviour.
      if (t + dt >= nextSample - 1e-9) { out.push(cam.position.clone()); nextSample += 0.1; }
    }
    return out;
  };
  const slow = trajectory(1 / 30);
  const fast = trajectory(1 / 240);
  let worst = 0;
  let worstAt = 0;
  for (let i = 0; i < Math.min(slow.length, fast.length); i++) {
    const d = slow[i].distanceTo(fast[i]);
    if (d > worst) { worst = d; worstAt = i * 0.1; }
  }
  check('the whole path is the same at 30 fps and at 240 fps', worst < 0.005,
    `${(worst * 100).toFixed(1)} cm apart at t=${worstAt.toFixed(1)}s`);
  console.log(`  worst 30-vs-240 fps divergence: ${(worst * 100).toFixed(2)} cm at t=${worstAt.toFixed(1)}s`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
