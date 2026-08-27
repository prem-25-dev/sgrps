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

## Known limitations

- The hero's identity is the default config; supply a reference photo and
  fill in `HeroIdentity` to match a real person (see `HERO_PIPELINE.md`).
- LOD1 is 8.2k triangles, slightly under the bible's 10k–30k suggestion. It
  was left there deliberately: the silhouette holds at 26 m+ and the saving is
  real. LOD0 (21k) and LOD2 (3.5k) are both inside their bands.
- Frame rate has not been measured on real GPU hardware in this environment.
