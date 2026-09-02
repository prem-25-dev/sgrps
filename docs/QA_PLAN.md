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

## What only looking at the game could catch

None of the 165 assertions can see the game. Three defects survived every one
of them and were obvious in the first screenshot:

1. **There was no ground.** Decor is placed at y=0 and the only large surface
   in the scene was the 9.6 m ballast, so every building, tree and parked
   vehicle hung in mid-air with sky underneath, and the track was a strip in a
   void. A single 1600 m plane fixes it, and it never needs to move: the
   player does not advance in world Z, so a plane centred on the origin stays
   under the camera for the whole run. `ZoneDef` gained a `ground` colour that
   cross-fades with fog and sky.
2. **The horizon had a bright seam.** The sky dome's gradient is already
   halfway to its zenith colour at the horizon, while the ground fades all the
   way to the fog colour, so the two met in a hard band. The sky shader now
   pulls toward the fog colour as it approaches the horizon.
3. **The shoulders had a notch and a spike.** The sleeve was clipped below the
   arm's shoulder dome, which left the dome as bare skin outboard of the shirt
   — a triangular hole — and stood the sleeve's flat top cap proud of the
   joint. Front-on it read as shoulder pads with a piece cut out. The sleeve
   now runs over the dome, putting the only seam at the hem.

### The bug that made the game unfinishable

Looking at the game-over screen turned up the worst defect in the project. At
1280x720, at 1024x600 and on a phone, the panel's "Run again" and "Menu"
buttons sat entirely below the fold. A player who died could not restart and
could not return to the menu. The same fault put the "Back" button off-screen
on Missions and Achievements, so those were dead ends too.

The cause is a CSS interaction with no visible symptom in the source. Panels
are centred with `transform: translate(-50%, -50%)`, and an animation's
transform *replaces* the base transform rather than composing with it — with
`animation-fill-mode: both` it keeps replacing it after the animation ends.
`.panel` shared the `pop` keyframes, which set only `scale`, so the centring
was discarded and every panel was pinned with its top edge at the vertical
midpoint. Panels now use their own `panelPop` keyframes carrying the translate
through every step.

The browser suite could not have caught this, and that is the point: it drives
buttons with `el.click()`, which works perfectly on an element no human can
see or reach. Every click "passed" while the game was unfinishable.
`test:ui-fit` now checks geometry instead of behaviour — after the open
animation settles, every button on every panel must lie inside the viewport at
five sizes from 1920x1080 down to a phone in landscape. Reverting the CSS
fails 8 of its 8 assertions at 1280x720 alone.

### The screenshot harness was lying too

A fourth "defect" was not one. Early captures showed the menu framing the back
of the hero's head, half out of frame. The menu camera was correct; the
capture was taken 0.28 s of *simulated* time after boot, mid-swing, because
under software rasterisation the simulation advances at a fraction of real
time and a fixed 3 s wall-clock pause is nowhere near enough. `playtest.mjs`
and `screenshot.mjs` now wait on the camera having actually settled, so the
artifacts CI uploads show what a player would see.

That is the same failure as the differential harness's three: a fixed wall of
wall-clock waiting, in an environment where wall clock means nothing.

And one more of the same family, found while writing `test:ui-fit`: every
`page.waitForFunction(fn, { timeout: N })` in the browser scripts was passing
its options object as Playwright's *argument* parameter — the signature is
`(fn, arg, options)`. Every one of those waits silently used the 30 s default
instead of the timeout written next to it. They passed anyway, right up until
a wait genuinely needed longer than 30 s, at which point the failure looked
like a game bug rather than a harness one. All of them now pass an explicit
`null` argument.

## What a second code review caught

A review of everything since the last one found six issues, four of them in
the very tests written to catch bugs.

**The sky was clipped away on two of the three quality profiles.** `camera.far`
is scaled by the quality profile — 420 m on high, 378 on medium, 315 on low —
while the sky dome is a fixed 400 m sphere at the origin. On medium and low
most of it fell outside the far plane and rendered as a huge black void
overhead. The dome is now scaled to sit inside the frustum, and the renderer
clears to the fog colour so anything else that gets clipped blends into the
haze rather than punching a hole in it. This one predated the ground plane but
the new ground made it far more conspicuous.

**The horizon fix had not worked.** The sky is a custom `ShaderMaterial`, which
gets no output colour-space conversion unless it asks for one, so `THREE.Color`
uniforms — held in the linear working space — were published as if they were
already sRGB. Sampling pixels: sky at `132,167,202` against ground at
`191,212,230`, a hard 60-level step in a single row, which is precisely the
seam the change had been written to remove. It was computing the right colour
and displaying the wrong one. With `#include <colorspace_fragment>` the sky
now reads `191,212,230` right up to the ground's fogged edge.

**The differential test flew moving hazards as if they were static.** The
replay pinned `driftZ` and `driftX` to zero, so the solver's drift sweep — the
part of the model that exists solely for those obstacles — was never
differentially tested. The replay now moves them exactly as `TrackManager`
does. Still zero divergences, which makes the claim mean more than it did.

**It could also fabricate solver failures.** Past `MAX_EXPLAINED` the fine
sweep returns a `-1` sentinel, which fell into the `widest <= 0` branch and was
filed as a hard divergence against a budget of zero. Unexplained failures are
now their own bucket with their own assertion.

**And it had an unbudgeted bucket.** The 65 routes that fly only once their
take-off is moved had no assertion at all; they now have a budget of 80.

**`test:ui-fit` could pass without testing anything.** A hidden screen measures
as all zeros, and zeros satisfy every bound it checks, so any panel that failed
to open passed silently — exactly the case the test exists for. It now asserts
the button it presses exists, that the screen actually opened, and that the
panel has a non-zero size before measuring it.

Four of those six are faults in test code. That keeps being the pattern: the
instruments need auditing at least as much as the thing they measure.

The colour-space fix is deliberately **not** guarded by a test. Two attempts at
one — a seam-continuity scan down a column, then a comparison of the sky just
above the skyline against `scene.fog` — both kept catching real geometry
(buildings, the ballast edge) instead of the seam, and locating the skyline
robustly across zones turned into more machinery than the bug warrants. A
flaky gate is worse than none, so the fix rests on the one-off measurement
recorded above and this note, rather than on a check that would cry wolf.


## Audio, which nothing had ever listened to

685 lines of WebAudio graph and 33 synthesised voices had no coverage at all.
A voice that fell silent, or started emitting NaN and poisoned the master bus,
would have shipped without a single assertion noticing. `test:audio` plays
every sound in the catalogue and measures the output.

Two things had to be right before the numbers meant anything, and getting both
wrong first is what makes them worth writing down.

**The render loop has to be stopped.** Under software rasterisation it starves
`setTimeout` so badly that a polling analyser reads almost nothing between
frames. The first version of this measurement concluded that **29 of 33 sounds
were silent**. They were not — the instrument was. WebAudio runs on its own
thread and keeps processing with the loop stopped.

**The tap has to be a ScriptProcessor, not an AnalyserNode.** An analyser
shows a window of the recent past, so a short transient — which most of these
are — falls between reads.

**And each voice needs the bus to fall quiet first.** Resetting the peak and
playing immediately measures the *previous* sound's tail, so a completely dead
voice reads as the decay of the one before it.

The catalogue is enumerated from `SFX_IDS`, which `SfxId` is now derived from,
so adding a sound to the type is the same act as adding it to the coverage.

Verified by sabotage: silencing `SFX_Coin` and `SFX_Jump` makes the test name
both. That check itself took two attempts — the first sabotage did not compile,
so the build kept the healthy bundle and the test "passed" against code that
was never broken. A green run against a failed build proves nothing, and the
build output has to be read, not assumed.

### And then it failed in CI, for the reason it documented

The version that shipped stopped the render loop for the sound effects but
deliberately left it running to measure the score, "while the game is actually
running". `ScriptProcessor.onaudioprocess` is a **main-thread** callback and is
starved by the loop exactly as a polling analyser is. It passed locally and
failed on CI at 1.7 fps, reading `0.00447` off a bus that is genuinely around
0.15 — the same false silence the file's own header warns about, in the half of
the test that had not been fixed.

Nothing in the measurement needs the loop: the score is scheduled by its own
25 ms interval, and the audio graph runs on the audio thread. The loop is now
stopped before anything is measured.

The test also counts the audio blocks it actually received. A starved
measurement and a silent bus are different failures, and being told which one
happened is the difference between a five-minute fix and the hour this cost.

## Playing with a thumb

Swiping is the primary input on a phone, and it had no coverage. `test:ui-fit`
checks that panels fit a phone screen, which says nothing about whether the
player can move; the gameplay suite drives the real `PlayerController` but only
ever presses keys.

The risk is concrete rather than theoretical. Taps and swipes share a code path
with the menu — a tap on the play surface means "confirm" — and an earlier bug
had *every* tap counting as confirm, so every button on the main menu started a
run. The guard that fixed it sits directly in the touch handler, which makes
this the part of the input system most likely to break silently for the players
least able to work around it.

`test:touch` drives a real phone viewport with synthetic touches: a tap starts
a run, left and right change lane, up jumps, down slides, and a movement under
the swipe threshold does none of those. Everything passed first time — no bug
here — but inverting the horizontal mapping makes it report `lane 1 -> 2` on a
left swipe, so it is a real gate rather than a formality.

## Effects, which nothing had ever watched

23 presets share one particle pool, and no other suite touched them. A preset
whose count fell to zero, or a switch case that stopped matching after a
rename, would look exactly like one that works: no error, no warning, just a
game that had quietly lost its sparkle. `test:vfx` plays every effect and
counts particles.

It runs headless in Node rather than a browser — the particle system is plain
`BufferGeometry` and needs no renderer, and the browser job is long enough
already.

Nothing was broken, but writing it turned up an inconsistency worth recording.
`VFX_SpeedLines` is in `VFXId` and has **no case in `play()` at all**: speed
lines are a dedicated mesh whose opacity tracks the player's speed from
`update`, so playing it is a silent no-op for any caller who tries. Rather than
excluding it and forgetting it, the test names it as a continuous effect and
asserts it on its own terms — opacity rises above 0.05 at full speed and falls
back by more than 5x when slow.

The rest of the suite covers what the soak cannot see: particles live in typed
arrays rather than the scene graph, so an exhausted or leaking pool is
invisible to an object count. Hammering all 23 presets for 400 frames peaks at
1,400 of 4,000 and drains to exactly zero.

Verified by sabotage: silencing `VFX_Debris` and `VFX_Steam` makes the test
name both.

## A guarantee the docs promised and nothing tested

The persistence suite's own header has always said it covers "a payload from
an older version". It did not. Every fixture carried the current version
number, so the one scenario that costs a real player their history — upgrading
the game — was never exercised. The claim had been sitting in the file since
the suite was written.

`SaveManager.load` deliberately ignores the stored version and coerces field by
field, which makes it forward-compatible by construction rather than by a
ladder of migrations. That turns out to be correct, and is now pinned down: a
v1 payload keeps its score, runs, coins and achievements; fields added since
get defaults rather than `undefined`; an unknown field from an old build is
ignored; and the save is re-stamped to the current version on the next flush.

A save from a *newer* version is covered too, which happens whenever someone
opens an older deployment or a cached tab. Losing someone's history because
their save came from the future would be worse than any corruption case.

Verified by sabotage: replacing the coercion with the migration someone would
naively write — `if (parsed.version !== SAVE_VERSION) reset()` — fails six of
the nine, naming exactly what was lost.

## Six zones nobody had ever seen

The game runs through seven zones over five and a half kilometres, and CI never
gets past the first: under software rasterisation a browser run reaches about
60 m. Six zones of content — palettes, buildings, props, vegetation, the whole
night city — went the entire build without anything, human or automated, ever
looking at them.

They were photographed by hand, by teleporting the run distance into each zone
with the player made invulnerable (the teleport otherwise drops them straight
into whatever is spawned there). All seven are correct: distinct palettes,
coherent content, no floating geometry, no missing ground, and the Neon zone —
lit windows and silhouetted towers against a purple-black sky — is the best
looking of them.

`test:zones` keeps them that way without depending on pixels, which are not
stable enough in this environment to assert on. It checks the schedule visits
every zone in order and then deliberately cycles (so a long run keeps varying
rather than freezing in the last one), that no two zones share a fog or ground
colour, that no zone fogs out past the camera's far plane, and that every zone
actually places decor — 77 to 105 objects each. A zone whose densities were
typo'd to zero would otherwise ship as an empty corridor nobody would notice
until a player arrived.

Writing it produced one false alarm worth recording: the first version asserted
the schedule ends after the last zone, and failed. The cycling is deliberate
and commented as such in `zoneAt`. The test was wrong, not the code — which is
the same lesson as the rest of this document, arriving from the other
direction.

## Rebindable controls, and the hole they exposed

Rebinding was added for players who cannot comfortably reach the default keys.
Storing bindings meant storing a much richer shape than the settings had held
before — and that turned out to matter more than the feature.

Settings were the one part of the save that was never parsed defensively.
Every top-level field went through a validator; the settings object was spread
in whole. So a `quality` value outside the three known levels reached
`QUALITY_PROFILE[quality]` as `undefined` on the first boot frame and threw:

```
quality        -> "ultra"
profile lookup -> undefined
BOOT THROWS    -> Cannot read properties of undefined (reading 'pixelRatio')
```

Because the same bad value is read again on every reload, the game would stay
dead until the player cleared their site data — from a rolled-back build, a
hand-edited entry, or any save written by a future version whose enum had
grown. The file's own docstring promised the opposite: that a corrupted payload
"degrades to defaults rather than breaking the boot sequence". It did, for
everything except the field that decides how the game renders.

Every settings field is now validated individually, on load and on live change
alike, and bindings have a rule of their own: an action left with no keys gets
its defaults back, because an action with no key is one the player can never
perform again — a runner who cannot jump, with nothing on screen to say why.

The rebind rules that keep that true are pure functions rather than click
handlers (`rebind` in `SaveManager`), because the cases worth testing are the
ones a click test would never think to try: taking a key from another action,
refusing to take its *last* key, collapsing a duplicate, and a slot index from
a stale render.

### What the sabotage passes caught

Five deliberate reversions, one per guard, to check the new suite actually
watches them. Four failed loudly. The fifth passed — and it was the one that
mattered: reverting `load()` to the original blind spread changed nothing,
because every settings assertion called the validator *directly* and none went
through the boot path where the bug had lived. The suite tested the fix and not
the defect. Adding a stored payload and constructing a `SaveManager` over it
closed that, and the reversion then failed three assertions.

### And a regression it caught in return

The new Controls section made the settings panel taller than a 1024x600 laptop
and a phone in landscape, and `test:ui-fit` failed exactly as designed — the
suite written after game-over buttons shipped below the fold.

This one was a false alarm, but only halfway. Panels have carried
`overflow-y: auto` all along, and measuring showed the Reset button coming
fully into view at both viewports once scrolled. So the content was reachable;
the check's proxy — "every button's rectangle lies inside the viewport" — had
simply stopped matching the invariant it stood for, which is *reachable*. It
now scrolls each button into view first, the way a player does with a wheel.

Relaxing a check that has just caught something needs its own guard, so the
original bug was reproduced against the relaxed version: it still fails, eight
assertions across four panels. Then the second sabotage — removing the
scrollbar entirely — and that one slipped through, because `scrollIntoView`
moves an `overflow: hidden` element perfectly well even though no wheel can.
The reachability check was therefore passing on a panel whose buttons real
players could never see. A panel with more content than box now has to
*declare* itself scrollable, which is the property a wheel actually depends on.

### One thing the screenshots caught that no assertion did

The capture state looks right on a phone — and on a phone there is no Escape
key, and usually no keyboard at all. Tapping a chip started a rebind that only
a keyboard could end. A tap anywhere else, or on the listening chip again, now
abandons it.

## A HUD you could not read

Colour accessibility was audited next, and came back clean: obstacle
affordance is carried by height and silhouette rather than colour (ground,
overhead and full-height are geometry), power-ups have deliberately distinct
shapes, mission cards carry ✓ / ▶ / · glyphs, and the toast tones carry
different words. Simulating dichromacy on the two toast colours confirms it —
the good/bad pair falls from ΔE 121 to about 33 under protanopia and
deuteranopia, a large loss but still an order of magnitude above the ~2.3
just-noticeable threshold, and redundant with the text either way. No
colourblind mode was added because there is nothing for one to fix.

Low vision was a different story. Score, distance and the coin count float
directly on the 3D scene, and measured against the pixels actually rendered
behind them they came in far under WCAG:

| element | measured | needs |
|---|---|---|
| score value | 2.73:1 | 3:1 |
| SCORE label | 1.32:1 | 4.5:1 |
| distance | 1.35:1 | 4.5:1 |
| coin count | 1.25:1 | 3:1 |

`.hud-score` already carried a `text-shadow`, which helps the eye and
contributes nothing measurable. The fix is a long eased scrim behind the top of
the HUD plus full-brightness readouts, with hierarchy carried by size and
weight instead of by dimness — a number the player is meant to read should not
be the one that fails the contrast check.

### Three instruments, two of them wrong

Worth recording, because the measurement was harder to get right than the fix.

The first version asked the DOM for each element's background. Every reading
came back comfortable, because the walk found an opaque ancestor *behind the
canvas* — a backdrop the text does not sit on during play. It reported eight of
eight passing on a HUD that was genuinely unreadable.

The second did the compositing itself in JavaScript, reading the gradient stops
and interpolating. It put the scrim at alpha 0.09 where it is 0.72, and would
have failed a HUD that was perfectly fine. A test that reimplements the
browser is a test of the reimplementation.

The third asks the renderer what it drew: the scene is replaced by a flat
sheet of the palest colour any zone paints, the HUD is screenshotted, and the
image is handed back to the page to be decoded and sampled there. That one
also had to be corrected once — it first read the foreground off the glyphs,
but at 8.8px very few pixels reach full coverage, so it judged small text more
harshly than WCAG, which is defined on the *specified* colour. It now takes
the specified colour and the measured backdrop.

Two details worth keeping. Overlaying the test sheet does not work: `#ui` sits
inside `#app`, which is its own stacking context, so a sheet appended to the
body paints over the interface at any z-index — hiding the canvas and colouring
`#app` has no such trap. And the palest zone sky, rgb(223,233,242), is the case
that matters: the first fix passed comfortably against a mid daylight sky and
still missed 4.5:1 against that one by 4.33 to 4.5.

The scrim was also rebuilt once for looks rather than numbers. The first one
faded over 91px and left a visible dark band across the sky, because the sky is
a smooth gradient and anything short reads as an edge. Spread over 220px with
an eased falloff it follows the sky's own zenith-to-horizon shading instead.

## The seed that did not pin the world down

Two documents promised seeded reproducibility — the asset register lists it as
a property of the world build, and `DecorScatter`'s own comment says its
scatter "is the same on a replay of the same seed". Nothing checked it, and it
was not true.

`test:determinism` fingerprints the built world rather than reading the code
for unseeded calls: every visible mesh's name, world transform, geometry type
and vertex count, plus every live coin's instance matrix, quantised and sorted.
Sorting is deliberate. Child order is an artefact of pool free-lists and is
invisible to a player; a bench that moved is not.

It found two breaks on the first run.

**Stations were drawn from `Math.random()`.** The station pool built each
assembly with `buildStation(Math.floor(Math.random() * 9999))`, and that seed
decides where the two benches sit and whether each platform gets stairs or an
escalator. Same seed, different station — the fingerprint caught it as one mesh
position holding 336 vertices in one run and 24 in the other. Stations now come
from a `KeyedPool` keyed on a bounded seed derived from the segment count, the
same shape the track modules already used. Eight dressings cycle, so the pool
still plateaus (the soak confirms it) and a replay puts the same staircase in
the same station.

**The coin clock ran across restarts.** `CollectibleManager.clear()` reset the
coins but not `time`, so a second run of the same seed started with every coin
on a different spin and bob phase. `TrackManager` and `PowerUpManager` both
already zeroed their own clocks on reset; the coins now do too.

This is worth more than tidiness. Fairness, soak and gameplay all stream the
world and assert things about what came out, and every one of those assertions
is only meaningful if a seed pins the run down. An unseeded call in the stream
would make them sample a different world on each CI run, and a rare failure
would be unreproducible by construction.

### What the guarantee deliberately excludes

Three systems still draw from `Math.random()`, and should. Particle sparks and
dust, the camera's shake seed, and the choice between the two idle animations
are noise laid over the world rather than part of it — seeding them would make
a replay identical in ways a player would read as a bug rather than a feature.
The guarantee is that the same seed builds the same *world*: the same level,
the same dressing, the same coins in the same places. The fingerprint reflects
that split — it samples meshes and coin instances, not the particle pool.

### The anti-vacuity check that was itself vacuous

Five sabotage passes were run. Restoring the random station seed, dropping the
coin clock reset, and pinning every station to one dressing were each caught by
the assertion that should catch them.

The fourth was not. A generator hard-wired to ignore its seed passed the check
that a *different seed builds a different world* — because the world has other
seeded systems. `TrackManager` keeps its own `Random`, and the decor scatter is
seeded per segment, so two runs differ visually while the level layout is
identical. The check was measuring the wrong thing at the wrong altitude.

The layout is now checked where it is made: sixty segments are pulled straight
out of the generator and compared as text — template, every obstacle with its
lane, Z and drift, every coin, every power-up, the exit lanes. Same seed must
give the same sixty; different seeds must not. The hard-wired generator fails
the second, and a generator that jitters its seed by one fails the first.

## A fourth negative result, and the guard it left behind

Two zones fog out past the low quality profile's far plane — `ZONE_Elevated`
at 340 m, `ZONE_CityEdge` at 320 m, against a plane at 315 m. That looked like
the same family as the sky-dome bug: a view distance that scales with quality
while something else stays fixed.

It is not a bug. `ZoneManager` already clears the renderer to the fog colour
for exactly this reason, and says so in a comment: ground cut by the far plane
meets a backdrop of precisely the haze it was fading into. The arithmetic
bounds what is left over — at 315 m, `ZONE_Elevated`'s fog has run 91.2% of its
range, so the ground is still 8 levels of 255 from fog colour where it is cut,
and `ZONE_CityEdge` 2. A step of 8/255 across a hazed horizon, on one zone, at
one quality setting.

An attempt to photograph it was abandoned rather than trusted: the sampling
column at 12% of the frame width runs through world geometry, not sky, and it
reported a step of 344 at high quality where there is nothing wrong. Rebuilding
it into an instrument that reliably finds the horizon across seven zones is
more machinery than an 8-level step justifies — the same call made earlier
about the colour-space seam.

What did come out of it is that `test:zones` had never checked what its own
comment described. The comment named the low profile's 315 m plane and warned
of "a hard edge where the world simply stopped"; the assertion compared against
420, the *high* profile, which no zone could ever exceed. It could not fail.

The check now measures the residual rather than the distance: how far the
ground still is from fog colour where the plane cuts it, against whichever
profile has the shortest view. Zones stay free to fog past the plane, because
the clear colour absorbs it; what they cannot do is fog so far that the ground
is still visibly itself at the cut. Sabotage from both ends — a zone fogged to
800 m, and a `viewScale` dropped to 0.4 — is caught, the second flagging five
zones at once. `QUALITY_PROFILE` moved from `Game` into `CFG` so the test reads
the same numbers the renderer does rather than a copy that could drift.

## Six green ticks on a camera aimed at nothing

The chase camera existed for the whole build without a single assertion. It is
pure maths — a `PerspectiveCamera` and a `PlayerState` in, a pose out — so it
can be driven headlessly and the hero projected into clip space to see where
they actually land in frame. `test:camera` does that across every speed, lane
and height the game can produce, plus the transients a screenshot rarely
catches: the top of a jump at maximum speed, the frame after mounting a train
roof, a slide during a lane change, and the game-over swing.

**The camera is sound. The first version of the test was not.** It passed six
of six on the first run, and then passed six of six again with the deck clamp
deleted, with the smoothing hard-coded to a frame-rate-dependent constant, and
with the camera aimed 57 m past the player. Three sabotage passes, three
silent survivals — the same fault as the contrast instruments, in its purest
form: assertions written to describe what the code does rather than to
constrain it.

Each one failed for its own reason, and all three are worth recording because
they are the standard ways a test of a smoothed system fools its author.

**"Inside the frustum" is not framing.** The original check asked whether the
hero projected within the clip cube with a margin. A camera pointed almost
anywhere satisfies that. Replaced with a band measured from the real camera —
head between -0.335 and 0.099, feet between -0.593 and -0.229, horizontal
offset never past 0.087 — with the bounds set just outside. That makes it a
regression bound on framing tuned by eye, not a claim about visibility, and
the comment says so: retuning the camera is *expected* to fail it, and the
numbers should then be re-measured and moved deliberately rather than widened
until it goes quiet.

**A scenario that never reaches the condition.** The clamp keeps the camera
from sinking through the surface underfoot. At rest it is never close: on the
tallest standable surface the game builds — a 3.15 m train car — the settled
camera still floats 2.2 m above it, and the clamp's steady-state condition is
unreachable below a 5.4 m surface. It exists purely for the transient. The
first test used a 2.7 m roof and no landing impact, which lands within a
millimetre of the clamp without ever crossing it. Now it uses the real tallest
surface and the impact a landing adds — and asserts the bound is *reached* as
well as respected, so a scenario that drifts away from the condition fails
instead of quietly proving nothing.

**Comparing where two runs end, when both converge.** Frame-rate independence
was checked by running two seconds at 30 fps and at 240 fps and comparing the
final position. Both converge on the same fixed point whatever the smoothing
does, which is why `k = 0.25` sailed through. The whole trajectory is compared
now — and that exposed two further faults in the measurement itself. Sampling
after an equal number of *updates* compares different instants and reported
53.9 cm of "divergence" from a correct camera; sampling by elapsed time cut it
to 7.8 cm. The remainder was also the test's: a sine trajectory sampled on two
grids is two different input signals, and a camera is a filter, so it was
reporting the difference in its input as a difference in itself. Driven with a
step whose edges land exactly on both grids, the divergence is 0.00 cm — the
camera is frame-rate independent to the precision measured, which is what the
class claimed all along.

Five sabotage passes now, each caught by the assertion that should catch it:
the clamp removed (dips to 0.693 m), fixed smoothing (85.8 cm apart), aiming
too far ahead (feet to -0.709), the camera no longer strafing with the lane
(head to -0.182), and the camera barely rising with the player (head to 0.354
on a roof-jump).

## The curve that ran the other way

`DifficultyManager` produces the one number the whole game's pacing hangs on —
the generator, the validator, the HUD and the tutorial all read it — and
nothing asserted its behaviour. Other suites drove it; none checked it.

`test:difficulty` checks it against what the documents claim, and the first
thing it found was that the documents were wrong.

The curve is `Math.pow(raw, 0.78)`. An exponent **below** one sits *above* the
linear ramp for the whole climb: pressure arrives faster than linear early and
flattens towards the top. Both the class comment and `GAME_DESIGN.md`
described it as "eased so the first few hundred metres stay gentle", which is
what an exponent above one does. The curve does the opposite of what two
documents said, and had since it was written.

In metres, which is how a player meets it:

| moment | actual | a linear ramp |
|---|---|---|
| leaves "Warm up" | 369 m | 630 m |
| leaves "Cruising" | 1,093 m | 1,470 m |
| moving hazards begin | 1,509 m | 1,890 m |

**Only the documents were changed.** Whether the curve should be front-loaded
is a balance decision, not a defect: the fairness engine proves every segment
survivable at whatever difficulty it is handed, so the shape changes how the
game feels, not whether it is fair. Flipping the exponent would retune every
run in the game, which is not a call to make while fixing a comment. Whether
the front-loading was intended or the exponent never matched the intent is not
recorded anywhere, and both documents now say so rather than guessing.

What the suite adds is that either choice becomes deliberate: the landmarks are
asserted in metres, so a retune shows up as a diff rather than as a vague
change in feel. Sabotage flipping the exponent to 1.4 — the gentle start the
prose described — fails three assertions and reports every landmark that
moved.

The rest of the suite holds the mechanics the design doc promises. Relief
after a stumble is real, and unlike the reaction guarantee (which was once
computed and never enforced) it is wired: `Game` grants it on a survivable
hit, it lowers what the generator builds without touching the raw curve that
scoring and the HUD read, it decays in about 1.1 s rather than lasting the
run, and it is capped so that repeated stumbles cannot switch the game off.
The tutorial ceiling clamps what is built while the raw curve climbs
underneath. Every derived gate the design doc lists — obstacle density,
power-up frequency, bonus coins, moving hazards, the 0.95 s to 0.52 s reaction
guarantee — is checked to move, and to move the right way.

Seven sabotage passes, each caught by the assertion that should catch it: the
exponent flipped and flattened, relief that never decays, relief uncapped,
hazards from the first metre, the ceiling ignored, and the reaction promise
broken.

## A mission nobody could finish

`GAME_DESIGN.md` prints the scoring rules for the player: 10 a coin, 25 a near
miss, both times the multiplier; combo +1 a coin and +2 a near miss, decaying
after 2.4 s; a multiplier step every 8 combo, "to x8"; and the score power-up
doubling that again "to a practical x16".

Every one of those held except the ceiling. `comboMax` was 30 and the tier is
`1 + floor(combo / 8)`, so the multiplier stopped at **x4**. `multiplierMax: 8`
was dead config — the clamp it applies could never bind — and reaching x8 needs
56 combo, nearly twice the cap.

That is not only a documentation error. `MIS_Multiplier8` — *"Reach the maximum
multiplier"*, tier 4, 600 coins — **could not be completed by any player**, and
it sits in the mission ladder blocking the tier behind it.

**And a reachability test said otherwise.** `test:progression` has always
claimed every mission is completable, and it is honest about its method in its
own comment: it feeds `1e9` into every metric and checks the tracker fires. That
proves the tracker can *store* a value, not that the game can *produce* one. The
distinction never mattered until a mission asked for a number the game could not
reach.

Two things changed. `comboMax` is now 56, the smallest cap that makes the top
tier reachable, with a comment tying the two constants together. And the
reachability check now compares every bounded mission and achievement target
against a ceiling measured from the real systems — the multiplier by running a
`ScoreManager` to its cap, top speed from `CFG`. Reverting the cap to 30 now
fails five assertions across the two suites, naming `MIS_Multiplier8`
specifically.

It was worth measuring before changing a tuning value. 56 combo means 56
pickups with no gap longer than 2.4 s, which is only a real target if the world
supplies coins that densely. Streaming three seeds of real generated track and
taking every coin gives peak uninterrupted chains of 779 to 1,115, with a
median gap of 0.06 s — so a player collecting a small fraction of what is laid
down can still hold the chain. The ceiling is demanding, not theoretical.

### The self-referential assertion

Six sabotage passes. Five were caught. The sixth changed `nearMiss` from 25 to
10 and everything still passed, because the assertion read the expected value
out of `CFG` and compared it against `CFG`: it proved the manager uses the
configured number, never that the configured number is the published one.

The literals the design document prints are now pinned separately, so the chain
has both links — config against the document, behaviour against config. A
retune has to move the document too, which is the point: those numbers are
published to the player as the rules of the game.

## The verb every obstacle teaches

"Every obstacle teaches one verb, and its geometry tells you which." That
sentence in `GAME_DESIGN.md` is the contract the affordance design rests on —
it is the reason the colourblind audit concluded no colourblind mode was
needed, since what an obstacle demands is carried by silhouette rather than
colour. Nothing checked it, and three of the published bands did not match the
data.

`test:vocabulary` checks both halves. The geometric assertions read the
archetype table; the behavioural ones fly the real `PlayerController` at the
real `CollisionSystem`, because the arithmetic is not trustworthy here — a
point-mass estimate said a 2.6 m signal box was clearable above 17 m/s, and it
is not clearable at any speed or timing.

What the measurement found, and what the document now says:

- **Ground is 0.85–1.35 m**, not 0.85–1.25: `OBS_CableDrum_01` is 1.35. Ramps
  sit in the same category but are their own verb and rise to 1.60 m, above
  the band, because they are run up rather than jumped.
- **Overhead undersides start at 1.05 m**, and the number that matters is not
  the documented 1.0 but the 0.85 m sliding collider. Tightest clearance is
  0.20 m.
- **"Full height — there is no other answer" is true of three of five.**
  `OBS_Container_01` at 2.55 m is standable and is the rooftop route the same
  document celebrates two sections earlier. `OBS_FencePanel_01` at 2.40 m is
  0.16 m deep, and a held jump carries the player over it at every speed
  tested. The other three cannot be cleared at all — including the signal box,
  which is under the 2.70 m jump peak but 1.4 m deep, so the player is
  descending before they are past it.
- **Dynamic hazards** are gated per archetype at 0.55 and above, so the "~0.5"
  claim holds even though the generator's `dynamicChance` opens at 0.45.

`requiredActions` stays lane-change-only on all five full-height archetypes
deliberately, and the suite asserts the measured set rather than changing the
data: it is what the fairness solver plans with, and a guarantee that depends
on frame-perfect timing is not a guarantee. Pinning the behaviour means an edit
that takes the rooftop route away, or makes a wall hoppable, is visible.

### Two harness lessons, one of them a repeat

The first version of the jump probe reported that **nothing** was clearable —
including the container, which the design document explicitly says the jump
clears. A uniform negative across five obstacles, one of them known-positive,
is an instrument failure rather than a finding. The cause was already written
down in this file: the probe sent keyup every frame, and releasing early runs
the ascent at `cutMultiplier` gravity, peaking at 1.29 m instead of 2.70 m.
The shared rig now carries that warning in its own header, where the next
person to write a probe will see it.

The probe was also 900 simulations per obstacle, sweeping the whole approach.
The apex is `velocity / |gravity|` seconds after takeoff, so the timing that
can work is a jump started about `speed × apexTime` metres out; searching a
narrow window around that finds the same two archetypes and brings the suite
to 19 seconds.

One sabotage pass also failed to apply — the pattern said `width: 2.4` where
the data says `2.3` — and reported a clean run. Checking that the edit landed
before believing the result is the difference between "the test is weak" and
"the sabotage missed", and this is the second time in this session that
distinction mattered.

Five sabotage passes now, each caught: a banner dropped below the sliding
collider, a moving hazard eligible in the warm-up, the fence panel raised out
of jump range, a weaker jump, and a taller sliding collider.

### The rig is now shared

`makeHarness` moved out of `test-gameplay.ts` into `scripts/harness.ts`, so
suites drive the same game rather than a copy of it. `test:gameplay` still
passes 46 of 46 across the move.

## The camera was pointing the wrong way

The worst bug in the project, found by a player looking at the screen for ten
seconds, after every suite in this file had gone green.

`TrackManager` draws the world ahead of the player at `absoluteZ - distance`,
so an obstacle 50 m away sits at **+50**. The chase camera trailed at **+7.4**
and looked toward **-Z**. Everything the player was running toward — every
obstacle, every coin, every power-up — was rendered *behind the camera*.
Measured on the running game: three obstacles resident, three projecting
outside the frustum, zero on screen.

The game was unplayable in the most literal sense. You could not see what was
coming. What the player did see was the empty track behind them, plus the
occasional coin swelling to fill the frame as it passed through the camera on
its way past — which is what prompted the report, phrased as "why is the guy in
front view, how can I find obstacles".

**Nothing failed, and the reason is worth writing down.** The fairness engine,
the generator, the collision system and the differential replay all work in
gameplay space, where z is a scalar and rendering does not exist. The browser
playtest drove the game, counted draw calls and console errors, opened every
panel — and never asked whether anything was in front of the camera. And
`test:camera`, added the same day, projects the *hero*, who stands at z = 0
and is in frame whichever way the camera faces. Sixteen suites and 323
assertions, all of them looking past it.

The camera now trails at -Z and looks toward +Z, and the hero turns to face the
way the world streams. `test:camera` gained the assertion that was missing —
a point 50 m ahead must project inside the frustum, one 50 m behind must not,
and the whole 210 m of streamed track must be in view. Reverting the camera to
its shipped direction fails five assertions and lists all 21 sampled distances
as invisible.

The lesson is not "add a frustum check". It is that every suite tested the
game's *model* and none tested what the player is shown. A pixel is the only
witness for that, and the only pixel anything looked at was the HUD's.

### What pointing the camera broke, and what caught it

Turning the camera round was correct and it broke two browser suites, which is
what they are for. Both failures were in the tests, and both are recurrences of
traps already written down in this file.

**The controls mirrored.** The camera looks along +Z, and with that view
direction screen-right is world **-X**. `laneToX` mapped increasing lane index
to increasing X, so lane 0 landed on the right of the screen and lane 2 on the
left: pressing right moved the runner visibly left. Every headless suite passed
throughout, because lane *indices* never changed — only where they appear. The
mapping is now inverted to match the view, `TrackManager`'s private copy of the
same formula is gone so the two cannot drift apart, and `test:camera` asserts
lane 0 projects left of the last lane.

**The waits were sized for a frame rate the renderer no longer has.** With the
world behind the camera it was culled, and the software rasteriser managed
1.8 fps; drawing it costs about 830 draw calls and the rate fell to 0.8. A lane
change takes 0.17 s of *simulated* time, which at 0.8 fps is several frames and
about three seconds of wall clock — against fixed 1.2 s waits in `test:touch`
and `test:rebind`. Measured on the running game: the lane change happened after
3,040 ms and 6 frames. The game was right and the wait was short.

Both suites now wait on the simulation — a condition, or a counted number of
rendered frames where the assertion is that *nothing* happens — so they hold at
any frame rate.

**And the fix had the same bug twice.** The first version of the `settle`
helper was `settle(fn, timeout)`, called as `settle(fn, before.lane)`: Playwright
reads that second argument as the value passed *into* the predicate, so the
predicate compared against `null` and the timeout became 1 ms. Both assertions
failed exactly as before and the wait looked innocent. `waitForFunction(fn, arg,
options)` has now cost this project three separate failures — the original
`{ timeout: N }` in the argument slot, and this pair — so both helpers carry the
signature in a comment above them.

The draw call figure this PR quoted for months, around 250, was measured while
the world was behind the camera and culled. Drawn, it is about 830, and about
910 with a consist of ambient traffic in view.

## The train that never moved

`OBS_TrainMoving_01` was stationary for the whole build. Drift was applied as
`dynamic ? ... : 0` where `dynamic` means `category === 'dynamic'`, and a
train's category is `'train'` — so the one archetype named for its motion was
the one archetype guaranteed not to have any. That is the third thing in this
project found to be named for a behaviour it did not have, after the near miss
that never fired and the reaction guarantee that was computed and never
enforced.

Fixing it needed two changes, and the second is the interesting one.

**The train now runs.** It closes at `speedFactor` (0.55) of the player's speed
on top of the approach the track already provides, so 1.55x overall. Measured
on the real streamer: 110 m of approach eaten in 2.55 s at 48.1 m/s against a
player doing 31.

**And it now runs at the player.** The first version was fast and completely
harmless, because the template put it in lane 2 with lanes 0 and 1 clear. The
fairness solver was perfectly happy at *any* closing speed — a hazard in one
lane of three forces no decision, so widening its swept Z span changes nothing.
Sweeping the speed from 0.55 to 1.8 produced byte-identical rejection counts,
which was the clue. The template now enters in the train's own lane with the
coin run leading down it, so the player is running at the train rather than
watching it pass somewhere they were never going. Rejections went from 7 with
0 repairs to 3 with 3 repairs: the solver is now doing work here.

### Provably fair is not the same as humanly possible

The solver accepts closing speeds far beyond what a person can play, because it
reasons about a reaction *distance* while a player has a reaction *time*. With
the hazard closing at (1 + f) times the player's speed, the real window is the
guarantee divided by that factor:

| closing speed | window at low difficulty | at maximum |
|---|---|---|
| 1.00x (parked) | 950 ms | 520 ms |
| **1.55x (chosen)** | **613 ms** | **335 ms** |
| 2.10x | 452 ms | 248 ms |

Human visual reaction is around 250 ms before any input, and a lane change
takes a further 170 ms. At 2.10x the solver still certifies every segment as
survivable and a person cannot play it. 1.55x is the fastest setting that
leaves a real window at maximum difficulty, and that is why it is the number,
not because the generator refused anything higher.

`CFG.oncomingTrain.speedFactor` is the knob, and this table is the reason to be
careful with it.

## The picture was pinned to the size the page opened at

Reported as "after clicking full screen it's not becoming full screen", with a
screenshot that showed something else as well: the game filling only the left
half of a wide panel, black beside it.

Two separate faults, and only one of them was about full screen.

**The canvas never followed the window.** `Game`'s constructor called
`renderer.setSize(w, h)` without the third argument, so three.js wrote an
inline `width: 700px; height: 760px` onto the canvas element. Every later
resize called `setSize(w, h, false)`, which deliberately leaves the style
alone — so the drawing buffer grew and the displayed size did not. Open the
game in a narrow panel, widen the panel, and the picture stays the width it
started at forever. Measured on a frame widened from 700 to 1360: buffer 1360,
CSS width still 700.

The constructor now passes `false` too, and the stylesheet's
`canvas { width: 100%; height: 100% }` drives the displayed size — which is
what it was always there for. A `ResizeObserver` on the container was added
alongside the window listener, because an embedded copy can change size without
the viewport doing anything.

**And the refusal was invisible.** The full screen control did report being
refused, via `toast()` — but `#toasts` was appended to the HUD screen, and the
HUD is hidden outside a run, so a message raised from the menu went into a
`display: none` subtree. It has moved to the interface root. The full screen
refusal now also writes a line that stays put rather than a toast that is gone
in a second and a half, because it is the one message the player has to act on:
open the game in its own tab.

The embed itself cannot be fixed from inside the page. A cross-origin frame can
only go full screen if the host grants it, and this one does not.

`playtest` gates on both: the canvas has to follow a viewport change, and the
full screen control has to exist and work. Reverting the constructor argument
fails with "the canvas does not follow the window when it resizes".

## A building planted in the middle of the track

Reported as "what is this thing in between while I'm running? Remove this
thing", with a screenshot of a dark portal spanning the rails ahead.

**The first diagnosis was wrong.** A fast build, driven to the reported
distance and photographed, looked like `TRK_Tunnel_01`, so the tunnel was
removed. The sabotage pass is what caught it: putting the tunnel back into
`TRACK_VARIANTS` produced no tunnel at all, which proved that list is a
catalogue and not the selection path -- `TrackManager.variantFor` picks by
zone with its own weights and never reads it. The only path that builds a
tunnel is a Neon-zone special case, and the player was in `ZONE_CityEdge`.

Probing the live scene by name instead of by eye gave the real answer:
`STA_Entrance@x0,z34`. The station entrance, a 5.4 m concrete facade, was
placed at `x = 0` -- straddling all three running lines, while every other
station piece sits beside the track at ±10.2. It carried no collider, so it
never read as an obstacle. It just looked solid and hid the track ahead.

It now sits in the back wall of each platform, turned to face across it, and
`test:zones` measures every piece of every station dressing against the
corridor. Putting the entrance back at `x = 0` fails it by name.

## Four things named for a behaviour they did not have

The tunnel was innocent of the report, but not of everything, and chasing it
turned up a pattern this codebase keeps repeating: a name that describes
behaviour, and nothing implementing it.

1. **The tunnel shell was a half-cylinder that was never spun about its own
   axis**, so it was the *side* half -- a wall down one side of the track and
   open sky down the other. Rotating it about the tunnel axis lifts the arch
   overhead, springing from ground level at both haunches.
2. **Its service lighting emitted no light.** The lamps are `MAT_NeonAmber`,
   and an emissive material lights nothing -- they were fittings in a dark
   room. The lining now carries a little emissive of its own and each lamp
   throws an additive pool on the ballast.
3. **`CFG.oncomingTrain.startsWithin` was dead config.** Its comment described
   a train that stands in its segment until the player is close, so it does not
   sweep back through whatever the generator placed behind it. Nothing read the
   value. The train set off the moment it spawned 210 m out; measured, it
   drifted 559 m over 1016 m of approach. Implementing the hold is strictly
   safer than the fairness proof, which widens the hazard's Z span by its drift
   across the whole crossing -- a train that spends part of that crossing
   stationary can only arrive later than the proof allows.
4. **The train's headlights were emissive too.** The one hazard that closes
   faster than anything else announced itself with two dull spots. There is now
   a real `SpotLight` that rides the nearest oncoming train and brightens as it
   closes.

### Why the headlight is not parented to the train

Because a light that streams in and out with a pooled object changes the
scene's light count, and three.js recompiles every shader when that number
moves -- a hitch at every portal and every train. The rig allocates one light
at boot, moves it onto whichever train is nearest, and parks it by driving
intensity to zero. The tunnel lamps are additive floor decals for the same
reason.

### The sabotage that walked straight through the guard

The check written to protect that invariant counted lights with
`scene.traverse`. Parking the headlight with `visible = false` instead of
intensity -- exactly the mistake the design exists to prevent -- passed it
cleanly, 25 of 25.

`traverse` visits invisible objects; the renderer does not. Only lights the
renderer actually walks are uploaded, so hiding one drops it from the count and
triggers the recompile. The counter uses `traverseVisible` now, and the same
sabotage fails with "light count moved away from 4".

Three sabotages, three catches, after the fix: removing the hold fails with the
559 m drift, zeroing the headlight fails with "brightest was 0", and hiding it
fails on the light count.

## Content nobody ever saw

The service train ran, closed at 1.55x, and was proved fair. Almost no
player ever met one.

Both templates were gated at difficulty 0.45 and 0.55, and the ramp does not
reach those until roughly 2 km. Measured across five seeds, the first service
train landed at 2040, 2208, 2256, 2304 and 2784 m. Runs end long before that:
two of this session's own harness runs died at 560 m and 1.9 km. The hazard
the whole game is built around was, in practice, unreachable content.

Gated at 0.08 and 0.13 now. First encounter across eight seeds: 528-984 m,
about seven per 6 km, with no extra generator rejections.

There is a general lesson in it. Every other check in this plan asks whether a
system *works*. None of them asked whether a player ever *reaches* it. A
correct feature behind an unreachable gate is indistinguishable, from the
player's side, from a feature that does not exist.

### The solver defect it uncovered

Lowering the gate changed which segments the differential sweep samples, and
one of the newly sampled ones diverged: `SEG_Signal_01` at 12 m/s, a route the
solver approved that no take-off offset could fly.

The solver called an obstacle jumped the instant the player's feet reached its
top -- no margin at all. The jump apex is 2.70 m. `OBS_SignalBox_01` is 2.6 m
and declares `laneChange` as its only action. So the solver was approving
routes that cleared it by ten centimetres, at a single instant of the arc, and
the fine sweep found no take-off whatsoever that flies them.

Feet must clear by `JUMP_CLEARANCE` = 0.15 m now. The number is chosen against
what the physics achieves, not to make a test pass:

    OBS_TallBarrier_01  2.70  needs 2.85  out of reach, dodge it
    OBS_SignalBox_01    2.60  needs 2.75  out of reach, dodge it
    OBS_FencePanel_01   2.40  needs 2.55  still jumpable, and test:vocabulary
                                          already measures it clearing with
                                          30 cm to spare

Everything the vocabulary means to be jumped is 1.35 m or shorter, so the
margin sits in a clean empty band and cannot drift into making a jumpable
obstacle unjumpable. 0.25 m would be too far: the solver starts choosing
take-offs its 0.5 m grid cannot state precisely, and the offset-route budget
goes from 80 to 91. Zeroing the clearance brings the divergence straight back.

## A run that was never static, and a jump that was

Reported as: the character should move his hands while running, and should not
be static while jumping.

**The first measurement said the animation was broken, and it was wrong.** A
probe reported the hands travelling 5.7 cm over two seconds at 12 m/s. The
probe had never entered `locomotion`: `PlayerAnimator` starts in `menuIdle`,
and `advanceStateMachine` only promotes `idle` to `locomotion`, so the rig was
holding a menu pose the whole time. Driven properly the hands sweep 56 cm and
the feet 134 cm. Another instrument lying until checked.

**The real fault was the axis.** All of that sweep is along Z, and the player
watches from directly behind, where fore-aft motion is foreshortened to almost
nothing. Measured laterally, the hands moved 13 cm and the pelvis 2 mm. The
run was full of movement that the one available camera angle could not see.

The abduction term oscillates with the stride now, and the pelvis crosses onto
each stance leg: 24 cm and 5 cm.

**The jump genuinely was a held pose**: 1.6 cm of lateral hand travel across a
whole arc. Deeper tuck, torso folding through the arc and opening to land,
arms driving up and out: 23 cm across and 37 cm vertically.

`test:animation` grows a section for what the gameplay camera can actually
see, with floors on those axes. Restoring the flat arm flare, the old pelvis
term, or the old airborne arms each fails it by name.

### And the silhouette

Close-up renders answered the "look like a real human" half. The arm's
shoulder dome reached y=1.496, above the torso's own shoulder ring at 1.462,
so the deltoid sat on the shoulder as a separate ball and the sleeve over it
read as a puffed sleeve. The legs were one dark column -- offset 0.095 with a
thigh radius up to 0.09 and 0.019 of trouser drape left about a centimetre
between them. The wrist carried a bright dot, which was the watch face offset
along the arm axis instead of seated on its strap.

`ARM_X` and `LEG_X` now live in `HeroRig` and are imported by `HeroFactory`.
They had been separate literals in both files, in six places: move the mesh
outboard for a better silhouette and the bones stay put, so the skinning
segments no longer run down the middle of the limb they drive.

One check worth recording: the first rear-view render appeared to show a face
through the back of the skull. It was the face in shadow -- `hero-shot.mjs`
labels its angles from the model's own axes, and the hero is turned by
`Math.PI - yaw` during a run, so "back" is the front. Verified before
reporting, unlike the tunnel.

## Lamps that lit nothing, and the merge that hid it

Four things in this world were named for lighting and emitted none. Two were
found chasing other bugs: the tunnel's service lamps, the train's nose lights.
The other two were found by going looking: `PROP_TrackLamp`, and
`PROP_StreetLight` -- a 6.4 m street light standing over a road it did not
light. Emissive materials glow; they do not illuminate.

The obvious fix is the one thing that cannot be done. Lamps are streamed
decor, and three.js recompiles every shader in the scene when the light count
changes, so a light travelling in and out with them would hitch continuously.
They cast an additive pool on the ground instead -- one shared material, no
light count change -- extracted into `LightPool` and shared with the tunnel
rather than left as a second copy.

`test:zones` checks both halves: every lamp casts, and streaming the whole
schedule never introduces a light.

### The sabotage that could not have failed

Writing that second check turned up why it was worthless as written.

`mergeByMaterial` silently discarded every non-mesh child. A light, a sprite
or a line added to a merged factory group ceased to exist -- no error, nothing
in the scene graph to show for it. A street lamp deliberately sabotaged with a
real `PointLight` passed the test 14 of 14, because the light never survived
the merge that built the prop.

Leaf non-meshes are carried across now, with their transform baked. Containers
are still dropped: their mesh children have just been merged and their geometry
disposed, so re-parenting one would draw from freed buffers -- the same
disposed-buffer trap that ate the ambient train carriages earlier in this
build.

With that fixed both sabotages bite: removing the pool fails with
"PROP_StreetLight still only glow", and adding the point light fails with
"never streams a light in with the scenery".

This is the second time in this session that a guard was written, passed a
sabotage, and turned out to be structurally incapable of failing -- the first
was the light counter using `traverse` instead of `traverseVisible`. Both were
caught only because the sabotage pass is run against every new guard, and
neither would have been caught by reading the test.

## Known limitations

- The hero's identity is the default config; supply a reference photo and
  fill in `HeroIdentity` to match a real person (see `HERO_PIPELINE.md`).
- LOD1 is 8.2k triangles, slightly under the bible's 10k–30k suggestion. It
  was left there deliberately: the silhouette holds at 26 m+ and the saving is
  real. LOD0 (21k) and LOD2 (3.5k) are both inside their bands.
- Frame rate has not been measured on real GPU hardware in this environment.
