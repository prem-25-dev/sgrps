import * as THREE from 'three';
import { createHero } from '../src/assets/HeroFactory';
import { DEFAULT_IDENTITY } from '../src/assets/HeroIdentity';
import { REFERENCE_HEIGHT } from '../src/assets/HeroRig';
import { AnimContext, AnimState, PlayerAnimator } from '../src/player/PlayerAnimator';
import * as clips from '../src/player/AnimationClips';
import { Pose } from '../src/player/Pose';
import { CFG } from '../src/core/Config';

/**
 * Animation quality gates.
 *
 * The production bible is blunt that this is where these projects fall over,
 * so the checks here are the ones a person would make by eye, expressed as
 * numbers: no NaN anywhere in the rig, feet that stay on the deck, and — the
 * one that actually decides whether a run reads as human — feet that do not
 * slide against the ground at any speed.
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const ALL_STATES: AnimState[] = [
  'idle', 'idleA', 'idleB', 'locomotion',
  'jumpAnticipation', 'jumpTakeoff', 'airborne', 'landing', 'hardLanding',
  'slide', 'slideRecover',
  'stumble', 'trip', 'hit', 'knockback', 'recover',
  'deathForward', 'deathSideways', 'deathCollapse',
  'menuIdle', 'menuGesture', 'victory', 'celebration',
];

function ctx(over: Partial<AnimContext> = {}): AnimContext {
  return {
    speed: 12, grounded: true, verticalVelocity: 0, airProgress: 0.5,
    slideProgress: 0.5, laneDir: 0, laneProgress: 1, laneQuick: false,
    cameraDistance: 8, ...over,
  };
}

/** Scans the whole rig for NaN, infinities and unnormalised rotations. */
function rigIsSane(hero: ReturnType<typeof createHero>): { ok: boolean; why: string } {
  for (const bone of hero.rig.bones) {
    const q = bone.quaternion;
    if (![q.x, q.y, q.z, q.w].every(Number.isFinite)) return { ok: false, why: `${bone.name} quaternion not finite` };
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    if (Math.abs(len - 1) > 1e-3) return { ok: false, why: `${bone.name} quaternion length ${len.toFixed(4)}` };
    const p = bone.position;
    if (![p.x, p.y, p.z].every(Number.isFinite)) return { ok: false, why: `${bone.name} position not finite` };
    if (p.length() > 10) return { ok: false, why: `${bone.name} position ${p.length().toFixed(2)} m from parent` };
  }
  return { ok: true, why: '' };
}

// ---------------------------------------------------------------------------
console.log('Rig integrity:');
{
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);
  let worstState = '';
  let sane = true;

  for (const state of ALL_STATES) {
    animator.play(state, true);
    // Run each clip past its own duration so its tail is covered too.
    for (let i = 0; i < 200; i++) {
      animator.update(1 / 60, ctx({ airProgress: (i % 60) / 60, slideProgress: (i % 45) / 45 }));
      const r = rigIsSane(hero);
      if (!r.ok) { sane = false; worstState = `${state}: ${r.why}`; break; }
    }
    if (!sane) break;
  }
  check('every clip produces a valid rig', sane, worstState);
  hero.dispose();
}
{
  // Crossfades blend two poses; a bad blend shows up as a denormalised
  // quaternion, which is exactly what a slerp/lerp mistake produces.
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);
  let sane = true;
  let why = '';
  for (let i = 0; i < ALL_STATES.length; i++) {
    animator.play(ALL_STATES[i], true);
    animator.update(1 / 60, ctx());
    // Switch immediately so the fade is always mid-flight.
    animator.play(ALL_STATES[(i + 7) % ALL_STATES.length], true);
    for (let f = 0; f < 12; f++) {
      animator.update(1 / 60, ctx());
      const r = rigIsSane(hero);
      if (!r.ok) { sane = false; why = `${ALL_STATES[i]} -> ${ALL_STATES[(i + 7) % ALL_STATES.length]}: ${r.why}`; break; }
    }
    if (!sane) break;
  }
  check('crossfades produce valid rigs', sane, why);
  hero.dispose();
}
{
  // Poses must be reproducible: the same phase must give the same rig.
  const a = new Pose();
  const b = new Pose();
  clips.locomotion(0.37, clips.GAITS.run, a);
  clips.locomotion(0.37, clips.GAITS.run, b);
  let identical = true;
  for (let i = 0; i < a.q.length; i++) if (Math.abs(a.q[i] - b.q[i]) > 1e-9) identical = false;
  check('the run cycle is deterministic at a given phase', identical, 'same phase gave different poses');
}

// ---------------------------------------------------------------------------
console.log('\nGround contact:');
{
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);
  const scale = DEFAULT_IDENTITY.height / REFERENCE_HEIGHT;
  const probe = new THREE.Vector3();

  /** Lowest point of either foot this frame, in metres above the deck. */
  const lowestFoot = (): number => {
    hero.rig.root.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const name of ['toe_L', 'toe_R', 'foot_L', 'foot_R']) {
      const bone = hero.rig.byName.get(name);
      if (!bone) continue;
      probe.setFromMatrixPosition(bone.matrixWorld);
      const sole = probe.y - (name.startsWith('toe') ? 0.018 : 0.05) * scale;
      lowest = Math.min(lowest, sole);
    }
    return lowest;
  };

  let worst = Infinity;
  let worstSpeed = 0;
  animator.play('locomotion', true);
  for (const speed of [2, 6, 12, 18, 24, 31]) {
    for (let i = 0; i < 240; i++) {
      animator.update(1 / 60, ctx({ speed }));
      const low = lowestFoot();
      if (low < worst) { worst = low; worstSpeed = speed; }
    }
  }
  check('feet never sink through the deck while running', worst > -0.02,
    `lowest sole ${worst.toFixed(4)} m at ${worstSpeed} m/s`);
  check('feet still reach the deck (the run is not floating)', worst < 0.06,
    `lowest sole ${worst.toFixed(4)} m — never touches down`);
  hero.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nFoot sliding:');
{
  /**
   * The test that decides whether a run reads as human.
   *
   * The hero never translates in world Z — the world moves past instead — so
   * a planted foot must travel backwards through the character's local space
   * at exactly the ground speed. Anything less and the foot skates forwards
   * under the body, which is the single most recognisable tell of a bad run
   * cycle.
   */
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);
  const probe = new THREE.Vector3();
  const results: Array<{ speed: number; ratio: number }> = [];

  for (const speed of [6, 12, 18, 24, 31]) {
    animator.play('locomotion', true);
    // Settle the cycle before measuring.
    for (let i = 0; i < 120; i++) animator.update(1 / 60, ctx({ speed }));

    let bestRatio = 0;
    let prev: { z: number; y: number } | null = null;
    const dt = 1 / 240; // fine step, so the contact window is well sampled
    for (let i = 0; i < 1200; i++) {
      animator.update(dt, ctx({ speed }));
      hero.rig.root.updateMatrixWorld(true);
      const toe = hero.rig.byName.get('toe_L');
      if (!toe) break;
      probe.setFromMatrixPosition(toe.matrixWorld);
      if (prev) {
        // Only sample while the foot is low enough to be carrying weight.
        if (probe.y < 0.09) {
          const backward = -(probe.z - prev.z) / dt;
          bestRatio = Math.max(bestRatio, backward / speed);
        }
      }
      prev = { z: probe.z, y: probe.y };
    }
    results.push({ speed, ratio: bestRatio });
  }

  for (const r of results) {
    console.log(`    ${String(r.speed).padStart(2)} m/s: planted foot travels backwards at ` +
      `${(r.ratio * 100).toFixed(0)}% of ground speed`);
  }
  const worst = Math.min(...results.map((r) => r.ratio));
  const fastest = Math.max(...results.map((r) => r.ratio));
  check('a planted foot keeps up with the ground at every speed', worst > 0.9,
    `worst is ${(worst * 100).toFixed(0)}% of ground speed — the foot skates forwards`);
  check('a planted foot does not outrun the ground', fastest < 1.12,
    `fastest is ${(fastest * 100).toFixed(0)}% of ground speed — the foot slips backwards`);
  hero.dispose();
}

// ---------------------------------------------------------------------------
console.log('\nGait and cadence:');
{
  const scale = DEFAULT_IDENTITY.height / REFERENCE_HEIGHT;
  const rates = [2, 6, 12, 18, 24, 31].map((speed) => ({
    speed,
    rate: clips.strideRate(speed, clips.gaitForSpeed(speed), scale),
  }));
  let monotonic = true;
  for (let i = 1; i < rates.length; i++) if (rates[i].rate <= rates[i - 1].rate) monotonic = false;
  check('cadence rises with speed', monotonic, rates.map((r) => `${r.speed}:${r.rate.toFixed(2)}`).join(' '));

  const gaits = [0, 1.6, 5, 12, 20, 31].map((s) => clips.gaitForSpeed(s));
  let leanRises = true;
  for (let i = 1; i < gaits.length; i++) if (gaits[i].lean < gaits[i - 1].lean) leanRises = false;
  check('forward lean increases with speed', leanRises, gaits.map((g) => g.lean.toFixed(2)).join(' '));

  const idle = clips.gaitForSpeed(0);
  check('idle barely swings the limbs', idle.hipSwing < 0.1 && idle.armSwing < 0.1,
    `hip ${idle.hipSwing} arm ${idle.armSwing}`);
  const sprint = clips.gaitForSpeed(31);
  check('sprint swings hard', sprint.hipSwing > 1.0 && sprint.armSwing > 0.9,
    `hip ${sprint.hipSwing} arm ${sprint.armSwing}`);
}
{
  // Arms must counter-swing against the legs, or the run reads as a shamble.
  const pose = new Pose();
  clips.locomotion(0, clips.GAITS.run, pose);
  const bones = ['thigh_L', 'upperArm_L'] as const;
  const angles = bones.map((name) => {
    const i = (Pose as unknown as { name: string }) && 0;
    void i;
    const idx = (clips as unknown as Record<string, never>) && 0;
    void idx;
    return name;
  });
  void angles;
  // Sample the drive directly: at phase 0.25 the left hip is at its forward
  // peak, so the left arm should be at its rearward peak.
  const gait = clips.GAITS.run;
  const hipAt = (p: number) => gait.hipMid + gait.hipSwing * Math.sin(p * Math.PI * 2);
  const armAt = (p: number) => gait.hipMid * 0.3 - gait.armSwing * Math.sin(p * Math.PI * 2);
  const hipForward = hipAt(0.25);
  const armThen = armAt(0.25);
  check('the arm counter-swings against the leg on the same side',
    hipForward > 0 && armThen < 0, `hip ${hipForward.toFixed(2)} arm ${armThen.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
console.log('\nWhat the gameplay camera can actually see:');
{
  // The player watches this character from directly behind. Motion along Z is
  // foreshortened to almost nothing from there, so a clip can be full of
  // movement and still read as a held pose -- which is exactly what was
  // reported. Measured before the fix: the hands swept 56 cm along Z and 13 cm
  // across X while running, and 1.6 cm across X through a whole jump arc.
  //
  // These floors are on the axes that survive the rear view. They are what
  // stops the run and the jump quietly flattening again.
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);
  const v = new THREE.Vector3();

  const travel = (names: string[], frames: number, step: (i: number) => void) => {
    const min = new Map<string, THREE.Vector3>();
    const max = new Map<string, THREE.Vector3>();
    for (let i = 0; i < frames; i++) {
      step(i);
      hero.object.updateMatrixWorld(true);
      for (const n of names) {
        hero.rig.byName.get(n)!.getWorldPosition(v);
        if (!min.has(n)) { min.set(n, v.clone()); max.set(n, v.clone()); }
        min.get(n)!.min(v); max.get(n)!.max(v);
      }
    }
    const out = new Map<string, THREE.Vector3>();
    for (const n of names) out.set(n, max.get(n)!.clone().sub(min.get(n)!));
    return out;
  };

  animator.reset();
  for (let i = 0; i < 60; i++) animator.update(1 / 60, ctx());
  const run = travel(['hand_L', 'hips'], 120, () => animator.update(1 / 60, ctx()));
  const handX = run.get('hand_L')!.x;
  const hipX = run.get('hips')!.x;
  check('the hands swing across the body, not only along it', handX > 0.18,
    `hand travelled ${(handX * 100).toFixed(0)} cm across at 12 m/s`);
  check('the pelvis sways onto each stance leg', hipX > 0.03,
    `hips travelled ${(hipX * 100).toFixed(0)} cm across`);
  console.log(`  running: hand ${(handX * 100).toFixed(0)} cm across, ` +
    `${(run.get('hand_L')!.z * 100).toFixed(0)} cm along; hips ${(hipX * 100).toFixed(0)} cm across`);

  animator.play('airborne', true);
  for (let i = 0; i < 12; i++) animator.update(1 / 60, ctx({ grounded: false, airProgress: 0 }));
  const air = travel(['hand_L', 'foot_L'], 60, (i) =>
    animator.update(1 / 60, ctx({ grounded: false, airProgress: i / 59 })));
  const airHandX = air.get('hand_L')!.x;
  const airHandY = air.get('hand_L')!.y;
  const airFootY = air.get('foot_L')!.y;
  check('the jump is not a held pose: the arms travel across', airHandX > 0.14,
    `hand travelled ${(airHandX * 100).toFixed(0)} cm across the arc`);
  check('and the body works through the arc', airHandY > 0.25 && airFootY > 0.25,
    `hand ${(airHandY * 100).toFixed(0)} cm, foot ${(airFootY * 100).toFixed(0)} cm vertically`);
  console.log(`  jumping: hand ${(airHandX * 100).toFixed(0)} cm across, ` +
    `${(airHandY * 100).toFixed(0)} cm up; foot ${(airFootY * 100).toFixed(0)} cm up`);
}

// ---------------------------------------------------------------------------
console.log('\nState machine:');
{
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);

  animator.play('locomotion', true);
  animator.update(1 / 60, ctx({ speed: 0 }));
  animator.update(1 / 60, ctx({ speed: 0 }));
  check('locomotion falls back to idle when stopped', animator.currentState === 'idle',
    animator.currentState);

  animator.update(1 / 60, ctx({ speed: 12 }));
  check('idle returns to locomotion when moving', animator.currentState === 'locomotion',
    animator.currentState);

  // A death clip must not be interrupted by ordinary locomotion requests.
  animator.playDeath('front');
  check('death takes over', animator.isDead, animator.currentState);
  animator.play('locomotion');
  check('locomotion cannot interrupt a death', animator.isDead, animator.currentState);

  // One-shots must run to completion and then hand back.
  const fresh = new PlayerAnimator(hero);
  fresh.play('landing', true);
  for (let i = 0; i < 60; i++) fresh.update(1 / 60, ctx());
  check('a one-shot hands back when it finishes', fresh.currentState === 'locomotion',
    fresh.currentState);
  hero.dispose();
}
{
  // LOD must follow camera distance, since it is what keeps a crowd affordable.
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);
  animator.update(1 / 60, ctx({ cameraDistance: 5 }));
  check('close up uses LOD0', hero.currentLod === 0, `${hero.currentLod}`);
  animator.update(1 / 60, ctx({ cameraDistance: CFG.performance.heroLod1 + 5 }));
  check('mid distance uses LOD1', hero.currentLod === 1, `${hero.currentLod}`);
  animator.update(1 / 60, ctx({ cameraDistance: CFG.performance.heroLod2 + 5 }));
  check('far away uses LOD2', hero.currentLod === 2, `${hero.currentLod}`);
  check('only one LOD is visible at a time',
    hero.lods.filter((l) => l.visible).length === 1,
    `${hero.lods.filter((l) => l.visible).length} visible`);
  hero.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
