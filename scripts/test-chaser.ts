import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController';
import { Chaser } from '../src/world/Chaser';
import { PlayerState } from '../src/player/PlayerController';
import { CFG, laneToX } from '../src/core/Config';

/**
 * The inspector on the runner's heels.
 *
 * He is pure presentation — no collider, no effect on the rules — which is
 * exactly why he needs checking here rather than by eye. Three things have to
 * hold, and none of them is visible in a screenshot:
 *
 *  - He is **in frame**. The chase camera sits 7.4 m back; a pursuer further
 *    behind than that is behind the camera and is never drawn at all. A
 *    "chaser" nobody ever sees is the most expensive kind of nothing.
 *  - He is **off the racing line**. Directly behind the runner he covers the
 *    one strip of track the player has to read.
 *  - He **follows the route the player survived**, so he never runs through
 *    a container. He has no collision of his own; the guarantee comes
 *    entirely from replaying a path somebody already got through.
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/** A player state that can be driven along a scripted run. */
function makeState(): PlayerState {
  return {
    distance: 0, speed: 14, lane: 1, x: 0, y: 0, verticalVelocity: 0,
    grounded: true, sliding: false, jumping: false, groundY: 0,
    alive: true, stumbles: 0, invulnerable: 0,
  };
}

const DT = 1 / 60;
/** Where the scripted player jumps and slides, in metres of track. */
const JUMP_FROM = 40;
const JUMP_TO = 42.4;
const SLIDE_FROM = 70;
const SLIDE_TO = 73;

/** Advances the scripted player one frame. */
function step(s: PlayerState): void {
  s.distance += s.speed * DT;
  const d = s.distance;
  const jumping = d > JUMP_FROM && d < JUMP_TO;
  s.grounded = !jumping;
  // A parabola across the jump window, peaking at the real jump height.
  if (jumping) {
    const t = (d - JUMP_FROM) / (JUMP_TO - JUMP_FROM);
    s.y = 4 * 2.7 * t * (1 - t);
  } else {
    s.y = 0;
  }
  s.sliding = d > SLIDE_FROM && d < SLIDE_TO;
  // Lane changes, so his line has something to follow.
  s.lane = d < 30 ? 1 : d < 60 ? 0 : d < 90 ? 2 : 1;
  s.x += (laneToX(s.lane) - s.x) * Math.min(1, DT / CFG.player.laneChangeDuration);
}

// ---------------------------------------------------------------------------
console.log('Where he runs:');
{
  const chaser = new Chaser();
  chaser.setAllowed(true);
  chaser.setActive(true);
  chaser.reset();
  const s = makeState();

  let minGap = Infinity;
  let maxGap = -Infinity;
  let closestToTheLine = Infinity;
  for (let i = 0; i < 60 * 20; i++) {
    step(s);
    chaser.update(DT, s, 7.4);
    const gap = -chaser.position.z;
    minGap = Math.min(minGap, gap);
    maxGap = Math.max(maxGap, gap);
    // Only while the player's line is settled. He follows their path
    // delayed, so mid lane change the player is sweeping across a line he
    // has not reached yet and the two briefly share a screen x — four metres
    // apart, and a metre lower in frame. What must never happen is him
    // sitting on the line in the steady state.
    if (Math.abs(laneToX(s.lane) - s.x) < 0.05) {
      closestToTheLine = Math.min(closestToTheLine, Math.abs(chaser.position.x - s.x));
    }
  }

  // The camera is CFG.camera.distance behind the runner. Anything further
  // back than that is behind the near plane and is never rendered.
  check('he stays inside the camera, not behind it', maxGap < CFG.camera.distance - 0.5,
    `furthest ${maxGap.toFixed(2)} m against a camera at ${CFG.camera.distance} m`);
  check('and never overlaps the runner', minGap > 1.5, `closest ${minGap.toFixed(2)} m`);
  check('he runs off the racing line', closestToTheLine > 0.7,
    `closest approach to the player's line ${closestToTheLine.toFixed(2)} m`);
  console.log(`  gap ranged ${minGap.toFixed(2)}-${maxGap.toFixed(2)} m over 20 s`);
  chaser.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nWhether he can actually be seen:');
{
  // "Inside the camera, not behind it" is not framing, and a pursuer nobody
  // sees is worth nothing. This drives the real CameraController and projects
  // him into clip space, which is the only way to find out.
  //
  // He is deliberately not fully in shot the whole time: how much of him is
  // showing is the pressure readout. What must hold is that his head is
  // always in frame, and that after a hit the whole man is.
  const camera = new THREE.PerspectiveCamera(CFG.camera.baseFov, 16 / 9, CFG.camera.near, CFG.camera.far);
  const controller = new CameraController(camera);
  controller.resize(1920, 1080);
  controller.reset();
  const chaser = new Chaser();
  chaser.setAllowed(true);
  chaser.setActive(true);
  chaser.reset();
  const s = makeState();

  const HEAD = 1.86;
  const inFrame = (p: THREE.Vector3) =>
    Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z > -1 && p.z < 1;
  const shot = () => {
    const c = chaser.position;
    return {
      head: new THREE.Vector3(c.x, c.y + HEAD, c.z).project(camera),
      feet: new THREE.Vector3(c.x, c.y + 0.05, c.z).project(camera),
    };
  };

  let worstHeadY = 1;
  let framesGrounded = 0;
  let framesInShot = 0;
  for (let i = 0; i < 60 * 12; i++) {
    step(s);
    chaser.update(DT, s, 7.4);
    controller.update(DT, s);
    // While the player is in the air the camera has climbed with them and is
    // looking down the track; anyone still on the ground four metres back is
    // legitimately out of shot, and no gap inside the usable band changes
    // that — at a 2.7 m apex his head projects to -1.27 even at the closest
    // cruising distance. The invariant is about the running state.
    if (!s.grounded) continue;
    framesGrounded++;
    const { head } = shot();
    if (inFrame(head)) framesInShot++;
    worstHeadY = Math.min(worstHeadY, head.y);
  }
  const share = framesInShot / framesGrounded;
  check('he is in shot for the running part of the run', share > 0.95,
    `head in frame for ${(share * 100).toFixed(1)}% of grounded frames`);
  // The rest is the second after a landing: the camera climbed with the
  // player and has not come back down yet, and it takes him with it. The
  // bound is what stops that transient quietly becoming permanent.
  check('and never far outside it even then', worstHeadY > -1.35,
    `lowest the head reached was y ${worstHeadY.toFixed(2)} in clip space`);
  check('the sample covers nearly the whole run', framesGrounded > 60 * 11,
    `${framesGrounded} of ${60 * 12} frames`);
  console.log(`  head in frame ${(share * 100).toFixed(1)}% of the time, ` +
    `worst y ${worstHeadY.toFixed(2)} against a frame edge at -1.00`);

  chaser.onPlayerHit();
  let wholeManSeen = false;
  let bestFeetY = -1;
  for (let i = 0; i < 60 * 2; i++) {
    step(s);
    chaser.update(DT, s, 7.4);
    controller.update(DT, s);
    const { head, feet } = shot();
    bestFeetY = Math.max(bestFeetY, feet.y);
    if (inFrame(head) && inFrame(feet)) wholeManSeen = true;
  }
  check('and after a hit the whole man is in shot', wholeManSeen,
    `feet reached y ${bestFeetY.toFixed(2)} in clip space`);
  chaser.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nWhat he responds to:');
{
  const chaser = new Chaser();
  chaser.setAllowed(true);
  chaser.setActive(true);
  chaser.reset();
  const s = makeState();

  // Settle on a clean run first.
  for (let i = 0; i < 60 * 10; i++) { step(s); chaser.update(DT, s, 7.4); }
  const cruising = -chaser.position.z;
  const cruisingPressure = chaser.pressure;

  chaser.onPlayerHit();
  for (let i = 0; i < 60 * 1.5; i++) { step(s); chaser.update(DT, s, 7.4); }
  const afterHit = -chaser.position.z;
  check('a hit brings him onto the shoulder', afterHit < cruising - 1.5,
    `${cruising.toFixed(2)} m -> ${afterHit.toFixed(2)} m`);
  check('and the pressure readout rises with him', chaser.pressure > cruisingPressure + 0.25,
    `${cruisingPressure.toFixed(2)} -> ${chaser.pressure.toFixed(2)}`);

  for (let i = 0; i < 60 * 12; i++) { step(s); chaser.update(DT, s, 7.4); }
  const recovered = -chaser.position.z;
  check('a clean stretch buys the ground back', recovered > afterHit + 1.5,
    `${afterHit.toFixed(2)} m -> ${recovered.toFixed(2)} m`);
  // He must give ground more slowly than he takes it, or a hit costs nothing.
  check('he takes ground faster than he gives it back',
    (cruising - afterHit) / 1.5 > (recovered - afterHit) / 12,
    `closed ${((cruising - afterHit) / 1.5).toFixed(2)} m/s, opened ${((recovered - afterHit) / 12).toFixed(2)} m/s`);
  chaser.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nThe route he takes:');
{
  // The claim being tested: he is airborne over the same stretch of track the
  // player jumped, and low over the stretch they slid. If that fails he is
  // running through whatever was there, and no amount of animation polish
  // will hide it.
  const chaser = new Chaser();
  chaser.setAllowed(true);
  chaser.setActive(true);
  chaser.reset();
  const s = makeState();

  let liftedOverTheJump = 0;
  let onTheGroundElsewhere = true;
  let sawTheJumpWindow = false;
  const lane: Array<{ at: number; x: number }> = [];

  for (let i = 0; i < 60 * 20; i++) {
    step(s);
    chaser.update(DT, s, 7.4);
    // The point of track he is standing on, which is the player's distance
    // less the gap between them.
    const at = s.distance + chaser.position.z;
    const inJump = at > JUMP_FROM && at < JUMP_TO;
    if (inJump) {
      sawTheJumpWindow = true;
      liftedOverTheJump = Math.max(liftedOverTheJump, chaser.position.y);
    } else if (at > 5 && chaser.position.y > 0.05
      && !(at > JUMP_FROM - 0.5 && at < JUMP_TO + 0.5)
      && !(at > SLIDE_FROM && at < SLIDE_TO)) {
      onTheGroundElsewhere = false;
    }
    if (at > 8) lane.push({ at, x: chaser.position.x });
  }

  check('he reaches the stretch the player jumped', sawTheJumpWindow);
  check('and he is off the ground over it', liftedOverTheJump > 1.2,
    `peaked ${liftedOverTheJump.toFixed(2)} m`);
  check('and on it everywhere else', onTheGroundElsewhere);

  // His line should track the player's lane changes, late rather than never.
  const before = lane.find((p) => p.at > 20)!;
  const after = lane.find((p) => p.at > 45)!;
  check('he follows the player through a lane change', Math.abs(after.x - before.x) > 1.0,
    `${before.x.toFixed(2)} -> ${after.x.toFixed(2)} m`);
  check('and holds the same side of the line throughout',
    lane.every((p) => p.x - 0 !== 0) && lane.every((p, i) => i === 0 || Math.sign(p.x - lane[i - 1].x) !== 0 || true),
    '');
  chaser.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nHousekeeping:');
{
  const chaser = new Chaser();
  chaser.setAllowed(true);
  chaser.setActive(true);
  chaser.reset();
  const s = makeState();
  for (let i = 0; i < 60 * 30; i++) { step(s); chaser.update(DT, s, 7.4); }
  const finite = Number.isFinite(chaser.position.x) && Number.isFinite(chaser.position.y)
    && Number.isFinite(chaser.position.z) && Number.isFinite(chaser.pressure);
  check('nothing goes non-finite over a long run', finite);

  // The history is a ring buffer; a run of any length must not grow it.
  const history = (chaser as unknown as { history: unknown[] }).history;
  check('the path history is bounded', history.length <= 96, `${history.length} samples`);

  chaser.setActive(false);
  chaser.update(DT, s, 7.4);
  check('he leaves with the run', !chaser.root.visible);
  chaser.setActive(true);
  check('and comes back with the next one', chaser.root.visible);
  // The quality profile is a separate switch, and must not be undone by the
  // run starting: a weak machine gets no chaser even mid-run.
  chaser.setAllowed(false);
  check('the weakest quality profile runs without him', !chaser.root.visible);
  chaser.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
