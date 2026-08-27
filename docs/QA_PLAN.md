# QA plan

## Automated suites

Run everything with `npm test`. Each suite exits non-zero on failure, so it
drops straight into CI.

### `npm run test:geometry` — geometry primitives
Guards the swept-surface builder that every asset is made from. The regression
that motivated it: profiles swept in −Y came out with inverted winding, which
made trouser legs, sleeves and shoulders render inside-out. The test asserts
that walls face outward and caps face opposite ways for sweeps along +Y, −Y
and −Z.

### `npm run test:fairness` — the fairness engine
- 15 hand-built cases covering jumpable, slideable, full-height, chained and
  rooftop layouts, plus the cases that *must* be rejected (all three lanes
  walled; a jump and a slide 0.6 m apart; a train roof with no ramp).
- A sweep of all 44 authored segment templates at 5 speeds from 12 to 31 m/s.
- A 12,000-segment generator soak across the whole difficulty curve, where
  every shipped segment is independently re-verified by a fresh solver.

Pass criterion: **zero** shipped segments without a survivable route.

### `npm run test:gameplay` — gameplay integration
Drives the real PlayerController, CollisionSystem, CollectibleManager,
PowerUpManager and ScoreManager at a fixed timestep with no renderer, in
hand-built scenarios where the right answer is known. 46 assertions covering
movement, jump physics, collision outcomes, coins, the magnet, every
power-up, scoring and combo decay, and the rooftop route.

This is the suite the browser playtest cannot replace: under software
rasterisation the simulation runs at a fraction of real time, so a run never
gets far enough to exercise a magnet, a shield or a train roof. It found three
bugs on its first run — see "Bugs this suite has caught" below.

### `npm run test:progression` — progression, persistence and difficulty
50 assertions over the systems that decide what a player keeps between runs.
Persistence is exercised against a real localStorage implementation rather
than a mock, covering the cases that actually bite: a corrupt payload, hostile
field types (a string where a score belongs, a negative run count, NaN, nulls
inside the achievement list), and a browser that throws on every write.

Also proves every one of the 15 missions and 12 achievements is reachable —
that no objective depends on a metric the tracker never supplies — and that
the difficulty curve, its relief-after-a-stumble, its ceiling, and the zone
schedule all behave.

### `npm run test:animation` — animation quality
21 assertions expressing, as numbers, the checks a person would otherwise make
by eye: no NaN or denormalised quaternion anywhere in the rig across all 23
clips and their crossfades, feet that neither sink through the deck nor float
above it, cadence and lean that rise with speed, arms that counter-swing
against the legs, the state machine's priorities, and the LOD swap.

The one that matters most is foot sliding. The hero never translates in world
Z — the world moves past instead — so a planted foot must travel backwards
through the character's local space at exactly the ground speed. The suite
samples the toe's velocity through the contact window at six speeds and fails
if it drifts either side of it. See "Bugs this suite has caught".

### `npm run test:tutorial` — first-run lesson
Drives the step machine headlessly at a fixed timestep, because the browser
cannot: under software rendering the simulation runs at roughly a fifth of
real time, so a run never travels the few hundred metres the later steps are
gated on. Covers an eager player, a player who ignores every prompt, ordering,
completion, the difficulty cap, and the specific bug that a step satisfied
immediately must clear rather than stick on screen.

### `npm run test:soak` — world streaming
Runs the real TrackManager, generator, collision, coin and power-up systems
for 12 simulated minutes (~20 km) with no renderer, sampling scene object and
geometry counts each minute. Pass criterion: the second half's average is
within 15% of the first half's — i.e. the pools plateau rather than leak.

### `npm run playtest` — browser
Boots the built game in Chromium, plays it with scripted input for 45 seconds,
restarts after death, then exercises pause, resume, quit and all three menu
panels. Reports draw calls, triangles, geometry growth, sustained frame rate
and every console error. Pass criterion: **zero console errors**.

Note the frame rate from this suite is not representative: CI runs on
SwiftShader (software rasterisation). Use it for correctness and draw-call
counts, not performance.

### `npm run test:hero` — character budget
Prints triangle counts per LOD, per-part bounds and skin-weight normalisation.
Pass criterion: LOD0 within the 20k–60k budget, all weights summing to 1.

## Manual checklist

### First run
- [ ] A profile with no history enters the tutorial
- [ ] Prompts appear, advance when performed, and time out when ignored
- [ ] Pausing mid-lesson resumes into the lesson, not past it
- [ ] Completing it hands back to normal play and lifts the difficulty cap
- [ ] It never appears again after a completed run

### Startup
- [ ] Loading bar advances and the screen clears completely
- [ ] Main menu shows the hero from the front, lit and animated
- [ ] Best score, distance, coins, runs and achievement count all read

### Player
- [ ] Character is visible and recognisably human at LOD0/1/2
- [ ] Run cycle stays locked to speed with no foot sliding at 11 or 31 m/s
- [ ] Jump, slide, lane change, stumble and death animations all fire
- [ ] Coyote time: a jump pressed just after leaving a roof still fires
- [ ] Jump buffering: a jump pressed just before landing still fires
- [ ] Releasing jump early gives a lower arc

### World
- [ ] Track generates continuously with no gaps or popping
- [ ] Segments recycle behind the player
- [ ] Zones transition gradually with lighting, fog and music changes
- [ ] Trains, stations, buildings, props, traffic and planting all appear

### Gameplay
- [ ] Obstacles spawn, collide, and are always survivable
- [ ] Ramps can be run up and train roofs landed on
- [ ] Coins collect; magnet attracts; combo builds and decays
- [ ] All five power-ups grant, display a timer, and expire
- [ ] Near misses score and fire their effect
- [ ] Difficulty visibly climbs over a long run

### UI
- [ ] HUD updates without stutter; nothing covers the play space
- [ ] Pause / resume / quit all work, including on tab blur
- [ ] Game over shows results, new bests, completed missions, achievements
- [ ] Restart works from game over; missions, achievements, settings all open
- [ ] Every settings control takes effect immediately

### Persistence
- [ ] Progress survives a reload
- [ ] A corrupted save falls back to defaults without blocking boot
- [ ] Private-browsing mode degrades gracefully with a visible notice

### Performance
- [ ] 60 fps on a mid-range discrete GPU at 1080p
- [ ] Quality setting visibly changes shadows, density and resolution
- [ ] Automatic quality drop triggers on sustained slow frames
- [ ] No memory growth over a 10-minute run

## Bugs this suite has caught

Recorded because each one had shipped through a green build, a clean
typecheck and a browser playtest without being noticed:

- **Near misses never fired.** The crossing test read `prevZ > centre && now
  <= centre`, but distance increases, so the condition was unsatisfiable. A
  headline scoring feature — with VFX, audio, a mission and an achievement
  attached — had never worked.
- **The near-miss radius was too small to ever trigger on a lane dodge.** At
  0.95 m it sat just under the 0.98 m clearance left by dodging a 2.2 m
  obstacle into an adjacent 2.4 m lane, so the signature move of the genre
  scored nothing. Now 1.15 m, which still excludes a two-lane berth at 3.38 m.
- **A planted foot skated forwards at every speed.** The authored cadences
  left the toe travelling backwards at only 77–80% of ground speed, so the
  feet slid under the body — the single most recognisable tell of a bad run
  cycle, and precisely what the bible warns about. Calibrated by sweeping a
  cadence multiplier and re-measuring: 1.28x lands at 98–103% across 6 to
  31 m/s. Both bounds are now asserted, so it cannot drift either way.
- **Jump height depended on the frame rate.** Stepping velocity before
  position undershoots the apex by `v·dt/2`: 2.55 m instead of the configured
  2.70 m at 60 fps, and lower still at 30. That also put the game out of step
  with the fairness solver, which proves against the analytic arc — so the
  solver could approve a clearance the game would not deliver. Fixed by
  including the acceleration term in the position update, which is exact for
  constant acceleration.

## Bugs a code review caught that the tests did not

A review pass over the whole diff found twelve issues the suites missed.
The two that mattered most were verified with a repro before being fixed:

- **The fairness guarantee was unsound.** A player who ran off the end of a
  roof was modelled as a point on the *jump* arc, which parked them 2.7 m
  above the roof for the whole descent instead of falling. A sliding player
  was worse: nothing checked support during a slide, so a slide carried the
  roof's height out over the gap beyond it and hovered there for its full
  length. The solver approved a route that kills the player; an independent
  brute-force simulator disagreed with it. Free fall is now its own mode with
  its own arc, and slides check for support like any other grounded state.
- **The reaction guarantee was never enforced.** `worstApproach` was computed,
  returned and stored — and never once compared to the requirement. The
  promise stated in the design doc simply was not kept. Enforcing it also
  exposed that the run-up was measured from the segment boundary, treating
  every module edge as a wall, and that a segment with no obstacles at all was
  judged against a requirement it could not meet.
- **The decor pools never reused anything.** Building, planting and vehicle
  keys embedded a per-instance seed, so every instance was its own pool key:
  1,236 retained building meshes after 17 km, growing linearly forever. The
  streaming soak missed it because pooled objects are detached from the scene
  graph, which is all it counted. Keys are now drawn from a bounded set and
  the soak asserts it.
- **Pausing during the death animation soft-locked the run.** The results
  panel was scheduled on a wall-clock timeout, which fires while paused; a
  tab-switch during the 1.5 s death sequence left a dead player in a frozen
  PLAYING state. It is driven from the frame loop now.
- **Every button on the main menu started a run.** A tap under the swipe
  threshold fired `confirm`, and menu clicks bubble to the window — where
  `pointerup` beats `click`. CI never saw it because the playtest drives
  buttons with `el.click()`, which emits no pointer events.
- Smaller ones: the game-over music was stopped on the line after it was
  started; score kept accruing for 1.5 s after death, so the results panel
  could show more than was banked; returning to the menu left the world empty;
  the saved invert-swipe preference was ignored until something was toggled;
  and the runtime collider added `baseY` twice for slopes, harmless only
  because every obstacle currently spawns at zero.

## What differential testing caught that neither suite did

The fairness suite proves the solver agrees with hand-written expectations.
The gameplay suite proves the physics behave in hand-built scenarios. For a
long time nothing checked the two against **each other** — and that gap is
where the solver's two earlier unsoundnesses had lived, both found by a
throwaway repro rather than by the 154 assertions passing at the time.

`npm run test:differential` closes it. The solver is asked not just *is this
survivable* but *show me the route*; the route is then flown through the real
`PlayerController` and `CollisionSystem` at a pinned speed, across a band of
take-off timings scaled to one frame at that speed. 416 routes per run, four
seeds x four speeds, in about 18 seconds.

### The bug it found: the player is a box, not a point

The solver planned on a grid of player **centres** and never modelled the
depth of the collision box. The real box is 0.3 m half-depth standing
(0.52 m sliding) — a number that lived only inside `PlayerController`, unknown
to the solver.

The consequence, reproduced on `SEG_Jump_02`: the solver approved a jump taken
at z=7.0 for a 0.95 m block spanning z=7.60–8.40. The step that would have
caught the clip was skipped for ending just short of the obstacle (7.5 < 7.6),
and the next step cleared it using the height at the *end* of that step
(1.29 m) — a height the player does not reach until well inside the block. In
the game the player is 0.86 m up when the front of the box touches the face,
and dies. No take-off within ±0.4 m survived.

The fix is two lines of model and one of config: `halfDepth` moved into `CFG`
as the single source of truth both systems read, and the solver's blocking
test widened by it. It removed the entire failure class (31 divergences to 11
in one change) and costs nothing in generation — 0 rejections across 12,000
segments, unchanged.

`test:fairness` now pins it with an assertion that fails on the old model: the
witness jump must clear the obstacle at its **leading edge**, not its centre.

### Three harness faults that each impersonated a solver bug

The first useful output of this test was a lie, three times over, and each one
looked exactly like the fairness engine routing a player into a wall. They are
recorded because the lesson outlived them: a differential test you have not
audited is worse than no test, because it manufactures confident false
findings.

1. **Replaying from the wrong entry lane — 188 false divergences.** The solver
   is asked to enter from any lane and picks whichever its route needs; the
   replay always started the player in the middle. Most "failures" were the
   player walking into an obstacle the route had simply gone around.
2. **Never sending keyup.** `InputManager` drops a repeat while an action is
   still held, so every press after the first in a given direction vanished.
   Routes with two lane changes appeared to ignore the second one entirely.
3. **A leaked held key across the shared rig — 32 false divergences.** Sharing
   one rig between flights is what makes the sweep fast, but `player.reset()`
   does not clear `InputManager`'s held set. A flight whose jump apex fell past
   the end of the segment left `jump` held, so the *next* flight's jump was
   dropped. Every affected case sat at exactly one speed, which was the clue:
   at 31 m/s the apex is 9.3 m away and lands outside the segment almost every
   time.

Fault 3 was briefly written up here as three solver clusters, complete with a
lane-transit explanation and a divergence budget of 32. That was wrong. The
budget is now **0** and holds: every route the solver names can be flown
through the real physics.

A fourth near-miss belongs with them. Fixing fault 2 by tapping the key broke
jumps instead, because the game gives variable jump height by running the
ascent at `cutMultiplier` gravity once the key is released — an instant tap
peaks at 1.29 m rather than 2.70 m. Lane keys must be released; jump must be
held to the apex, which is also the arc the solver proves against.

### What the test still reports rather than gates

Two witness routes survive only inside a window narrower than one frame. Both
are `SEG_Spiral_01`, whose single obstacle is a container in lane 0 with lanes
1 and 2 completely empty: the witness enters in lane 0 and mounts the 2.55 m
roof against a 2.70 m jump peak, when running past costs nothing. That is a
statement about the route the solver chose, not about whether the segment is
fair — the player is never obliged to follow it. It is kept as a budget of 2
so it cannot quietly grow.

A further 65 routes fly comfortably once the take-off is moved, with windows
over 20 frames wide. The solver plans on a 0.5 m grid on which a lane change
completes in one step, while the game slides across over 0.17 s, so a witness
names a decision point near — not at — where the player must act. The replay
leads lane presses by the transit time for exactly this reason.

## Known limitations

- The hero's identity is the default config; supply a reference photo and
  fill in `HeroIdentity` to match a real person (see `HERO_PIPELINE.md`).
- LOD1 is 8.2k triangles, slightly under the bible's 10k–30k suggestion. It
  was left there deliberately: the silhouette holds at 26 m+ and the saving is
  real. LOD0 (21k) and LOD2 (3.5k) are both inside their bands.
- Frame rate has not been measured on real GPU hardware in this environment.
