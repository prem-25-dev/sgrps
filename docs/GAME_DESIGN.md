# NEON RUN — game design

## The pitch

A third-person 3D endless runner. You run, permanently and accelerating,
through a procedurally generated metro city: three lanes of railway, trains to
dodge and run along, coins to chase into risky lanes, and a difficulty curve
that never asks for something you cannot do.

It is genre-inspired by lane-based endless runners. It copies none of them:
every character, model, texture, sound, piece of music and line of UI in this
repository was made for it.

## Core loop

```
run → read the road → dodge / jump / slide → collect → chain a combo
    → power-up → survive → speed rises → difficulty rises → game over
    → missions and achievements bank → replay
```

The loop is 15–90 seconds early on and several minutes once a player is good.
The thing that should keep them going is the **combo**: coins and near misses
both feed it, it decays in 2.4 s of playing safe, and it drives a multiplier
up to ×8. Playing safe is survivable. Playing safe is not how you score.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Change lane | ← → or A D | swipe left / right |
| Jump | ↑, W or Space | swipe up |
| Slide | ↓, S or Shift | swipe down |
| Pause | Esc or P | — |

Three things make the controls feel fair rather than twitchy:

- **Coyote time** (0.11 s) — a jump pressed just after running off a train
  roof still fires.
- **Jump buffering** (0.16 s) — a jump pressed just before landing fires on
  touchdown instead of being eaten.
- **Variable jump height** — releasing early cuts the arc, so the same button
  clears a low crate or a tall barrier.

A second lane input mid-move sharpens the dodge rather than queuing it.

## Movement numbers

| | |
|---|---|
| Lanes | 3, 2.4 m apart |
| Base speed | 11.5 m/s, +0.085 m/s², capped at 31 m/s |
| Jump | 18.0 m/s initial, −60 m/s² gravity → 2.70 m peak, 0.60 s airtime |
| Slide | 0.72 s, collider height 0.85 m |
| Lane change | 0.17 s (0.12 s when sharpened) |

The jump peak is set deliberately: 2.70 m clears a 2.55 m container, and from
a 1.2 m ramp it reaches a 3.15 m train roof. Those two numbers are what make
rooftop routes real rather than decorative.

## Obstacle vocabulary

Every obstacle teaches one verb, and its geometry tells you which:

- **Ground** (top 0.85–1.25 m) — jump, or change lane.
- **Overhead** (underside at 1.0 m+) — slide, or change lane.
- **Full height** — change lane; there is no other answer.
- **Ramps** — run up them; they are how you reach the roofs.
- **Trains** — block a lane entirely, and their roofs are a route.
- **Dynamic** — trolleys, drums, swinging signs, sliding barriers, falling
  crates. They only appear above ~0.5 difficulty.

33 archetypes. The metadata each one carries (`requiredActions`, height,
`standable`, `slope`) is the contract the fairness engine reasons about.

## Fairness

The design rule is absolute: **the generator may never kill you.**

Before any pattern is spawned, a breadth-first search over the player's full
state space proves at least one survivable route exists at the speed the
player will actually be doing. It also proves the player had a minimum clear
approach before each forced decision — 0.95 s of reaction time at low
difficulty, tightening to 0.52 s at maximum.

Patterns that fail are repaired by removing the offending obstacles, or
replaced. Verified over 288 km of generated track: zero unsurvivable segments.

Difficulty also *backs off* after a stumble, so a recovery is winnable.

## Scoring

```
score = Σ (speed × dt × multiplier)      distance
      + 10 × coins × coinMultiplier × multiplier
      + 25 × nearMisses × multiplier
```

- Combo +1 per coin, +2 per near miss, decaying after 2.4 s idle.
- Every 8 combo raises the multiplier one step, to ×8.
- The score multiplier power-up doubles it again, to a practical ×16.

## Power-ups

| | Effect | Duration |
|---|---|---|
| Magnet | Pulls coins within 9.5 m | 9 s |
| Shield | Absorbs one collision | 12 s |
| Score ×2 | Doubles all score | 10 s |
| Boost | 1.42× speed surge | 6 s |
| Coin ×2 | Doubles coin value | 11 s |

They stack. A shield plus a boost plus a score multiplier is the run where
you push into the outside lane on purpose.

## Zones

Seven, unlocking by distance and cycling afterwards so a long run keeps
changing: City Edge → Metro District → Downtown → Industrial Belt → Elevated
Line → Construction → Neon District. Each changes buildings, props, planting,
lighting, fog, materials and music intensity. None changes the rules of play.

## Progression

- **Missions** — three active at a time, drawn from the lowest unfinished
  tier, 15 across 5 tiers. Completing them pays coins and unlocks the next
  tier.
- **Achievements** — 12 lifetime milestones, from First Run to Master Runner.
- **Persistence** — best score, best distance, coins, totals, top speed,
  longest clean run, missions and achievements, plus all settings.

## Difficulty curve

One normalised number, 0 → 1 over 4,200 m, eased so the first few hundred
metres stay gentle. It drives obstacle density, which templates are eligible,
how often dynamic hazards appear, power-up frequency, and the reaction-time
guarantee. The player feels it as: more lanes closed at once, less room
between decisions, and hazards that move.

## Presentation

- Camera: smooth chase with lane lean, speed FOV, landing impact, a slide
  drop, near-miss shake, and a slow-motion orbit on death. It never clips
  through the deck.
- VFX: 23 effects from one shared particle system — dust, sparks, coin bursts,
  speed lines, shield bubble, magnet field, collision debris.
- Audio: adaptive three-layer score that thickens with speed, per-zone
  ambience beds, and a rolling-stock bed that swells as trains pass.

## Definition of done

Tracked against the production bible's checklist in `QA_PLAN.md`. The one
item that remains open by design: the hero uses the default identity config
until a reference photo is supplied — see `HERO_PIPELINE.md`.
