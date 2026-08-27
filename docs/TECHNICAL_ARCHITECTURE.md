# Technical architecture

## Stack

TypeScript, three.js r169, Vite. No other runtime dependency. The production
build is ~750 KB (202 KB gzipped), of which almost all is three.js — the game
itself, including every texture, mesh and sound, is a few tens of kilobytes,
because they are all code.

## The one idea that shapes everything

**The player never moves in world Z.**

`PlayerState.distance` is a scalar. Every resident object is positioned at
`absoluteZ - distance` each frame. Consequences:

- Floating-point precision is identical at 10 m and at 100 km. There is no
  origin rebase, and no jitter at long distances.
- Recycling is a range test on a number.
- Particles, coins and obstacles all share one coordinate convention.

The character faces **−Z**. Lanes are on X, `laneToX(i) = (i − 1) × 2.4`.

## Module map

```
src/core/          Config, Types, EventBus, GameStateManager, ObjectPool,
                   CollisionSystem, Random, Game (renderer + frame loop)
src/assets/        TextureFactory, MaterialLibrary, GeometryUtil,
                   HeroIdentity/HeroRig/HeroFactory,
                   Track/Train/Station/City/Prop/Vehicle/Vegetation factories
src/player/        Pose, AnimationClips, PlayerAnimator, PlayerController,
                   InputManager
src/camera/        CameraController
src/world/         TrackManager, DecorScatter, ZoneManager (+ LightingRig)
src/procedural/    SegmentValidator, ProceduralGenerator, DifficultyManager
src/obstacles/     ObstacleFactory
src/collectibles/  CoinFactory, CollectibleManager
src/powerups/      PowerUpFactory, PowerUpManager
src/progression/   ScoreManager, MissionManager, AchievementManager
src/save/          SaveManager
src/audio/         Synth, AudioManager
src/vfx/           ParticleSystem, VFXManager
src/ui/            UIManager, styles.css
data/              segments, obstacles, powerups, missions, difficulty/zones
```

Data lives in `data/` as typed TypeScript modules rather than JSON, so a typo
in a segment template is a compile error rather than a runtime surprise.

## Frame order

```
input → player (lanes, gravity, slide, collisions)
      → difficulty → world streaming (generate, spawn, recycle, reposition)
      → collectibles → power-ups
      → score → missions
      → zones → camera → VFX → audio → HUD → render
```

Delta time is clamped to 1/15 s. A tab switch or a long GC therefore runs the
game in slow motion rather than teleporting the player through a wall.

## Assets are functions, not files

Every mesh comes from a builder. The core primitive is `sweep()`: a tube
through a list of oriented cross-sections, with per-ring radius, offset and a
superellipse shape function. Bodies, trains, rails, limbs, clothing, car
bodies and pipes are all sweeps.

Two subtleties that cost real bugs:

1. **Winding depends on sweep direction.** A profile swept in −Y produces the
   opposite winding to one swept in +Y. `sweep()` now detects this from
   `(u × v) · axis` and reverses the index order. Before that fix, every
   downward-swept part — legs, arms, trousers, sleeves — rendered inside-out.
   `npm run test:geometry` guards it.

2. **Clothing must be sampled from the same spline as the body.** Rings are
   resampled through a Catmull-Rom spline for smoothness. Filtering the
   *control sections* before resampling produces a different curve, and the
   body then bulges through the cloth. All garments resample the full section
   list and clip the resulting *rings* (`clipRings`).

Textures are generated on a canvas (tileable value-noise fBm, plus painted
decals and signage) and cached by key, so 60+ materials rasterise a few dozen
images once at load.

## The hero

- 25-bone humanoid rig, rest pose arms-down.
- Body, clothing and shoes are skinned; face detail and hair are parented to
  the head bone, which keeps small features crisp for no skinning cost.
- Automatic skin weighting by inverse distance to bone segments, with a side
  penalty (stops the left thigh claiming right-leg vertices) and a relative
  cutoff (stops weight smearing across joints).
- LOD0 21,056 tris / LOD1 8,160 / LOD2 3,480, swapped by camera distance.
- Everything visual is driven by `HeroIdentity` — proportions, face shape,
  hair, outfit, colours — so matching a real person is a config change.

## Animation

Clips are **functions of phase**, not baked keyframes:

- One parametrised locomotion generator covers idle → walk → jog → run →
  fast run → sprint by blending gait parameters.
- The cycle is driven by ground speed, so feet never slide at any speed.
- Jump clips are driven by real airtime, so the arc always matches the physics.
- Additive layers ride on top: lane-change lean, breathing, head levelling.
- A foot-contact pass lifts the pelvis so the lower foot never penetrates the
  deck.

`PlayerAnimator` owns a small state machine with priorities and crossfades.
Poses are flat `Float32Array` quaternion buffers, so blending allocates nothing.

## Procedural generation and the fairness engine

`ProceduralGenerator` picks a template that fits the current difficulty *and*
the lanes the player can actually be in on arrival, expands it, and then
proves it survivable before it is allowed near the player.

`SegmentValidator` is a breadth-first search over
`(z, lane, vertical mode, standing surface)`:

- Vertical modes are ground, airborne (indexed by step along the real jump
  arc) and sliding.
- Standing surfaces are collected from the actual standable obstacles in the
  window — ramps are sampled along their rise, so a roof route is only
  considered reachable if the jump arc really gets there.
- A lane change sweeps both lanes for its full duration.
- Moving hazards are proved over the whole range they can occupy while the
  player crosses the segment, not just where they start.

On top of survivability it enforces a reaction guarantee: at the point the
player must commit, they had at least `reactionDistance` of clear approach in
a lane they could have been standing in.

If a segment fails, the generator removes the obstacles the solver flagged and
retries; if it still fails, it tries a different template; if all else fails it
ships a clean segment. **An unfair pattern cannot reach the player.**

Cost: ~0.7 ms per solve, roughly once per second of play.

The runtime collider (`CollisionSystem`) implements the *same* model — ramp
slopes, standable tops, slide heights — because a proof against a different
model would be worthless.

## Performance

- One `InstancedMesh` for every coin in the world.
- One points system with a shared buffer for all 23 VFX presets.
- `mergeByMaterial` collapses each static prop, building and vehicle to one
  mesh per material at build time; a signal gantry goes from 15 draws to 3.
- Keyed object pools for track modules, obstacles, props, buildings, planting
  and traffic. Nothing is allocated during a run.
- Three hero LODs; distant planting uses crossed-plane impostors.
- Quality profiles scale pixel ratio, shadow map size, decor density, draw
  distance and particle counts; sustained slow frames drop quality
  automatically.

Measured at 1280×720: ~183 draw calls in typical play, ~300k triangles,
plateauing object counts over 20 km.

## Audio

Entirely synthesised through WebAudio. Master → music / SFX / ambience buses
with a shared convolution reverb built from decaying noise. Effects are
filtered noise bursts and pitched blips; ambience is filtered noise loops
cross-faded per zone; music is a lookahead-scheduled sequencer in D minor
pentatonic with three layers that fade in with the player's speed.

## Saving

`localStorage`, versioned, defensively parsed field by field. A corrupt
payload is discarded and replaced with defaults rather than blocking boot.
Storage being unavailable (private mode) is detected once and surfaced in the
menu instead of throwing.
