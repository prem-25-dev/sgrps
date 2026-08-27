# NEON RUN

An original 3D endless runner for the browser. You run, permanently and
accelerating, through a procedurally generated metro city — dodging, jumping,
sliding and running along train roofs.

Every asset is generated at runtime from code in this repository: the rigged
character, its animation, the trains, the track, the city, the materials, the
particle effects, the music and every sound. There are no downloads, no
marketplace purchases and no licence surface. The whole game is 202 KB gzipped.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm run build        # typecheck + production build to dist/
npm run preview      # serve the build
```

Requires Node 22+ and a WebGL-capable browser. Nothing else — no engine, no
asset store account, no Blender.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Change lane | ← → / A D | swipe left / right |
| Jump | ↑ / W / Space | swipe up |
| Slide | ↓ / S / Shift | swipe down |
| Pause | Esc / P | — |

## Tests

```bash
npm test             # geometry + fairness + streaming soak
npm run playtest     # boots the real game in Chromium and plays it
```

| Suite | What it proves |
|---|---|
| `test:geometry` | Swept surfaces have correct winding in every direction |
| `test:fairness` | No unsurvivable pattern can reach the player (verified over 288 km) |
| `test:soak` | World streaming pools plateau over 20 km — no leaks |
| `playtest` | Real browser boot, play, death, restart, pause, all panels, zero console errors |
| `test:hero` | Character LOD budgets and skin-weight normalisation |

## What's in it

- **A modelled, rigged human** — 25-bone humanoid, skinned body and clothing,
  face and hair parented to the head bone, three LODs (21k / 8.2k / 3.5k tris).
- **30+ animation clips** driven as functions of phase, so the run cycle stays
  locked to ground speed and never foot-slides at any speed.
- **A fairness engine** — every generated pattern is proved survivable by a
  breadth-first search over the player's state space before it spawns, with a
  guaranteed reaction window. The generator cannot kill you.
- **Seven zones**, 44 segment templates, 33 obstacle archetypes, 6 train
  variants, 48 props, 8 vehicles, 8 plant types, 12 coin patterns.
- **5 power-ups**, combos and multipliers, near-miss scoring, 15 missions,
  12 achievements, persistent progression.
- **Synthesised audio** — adaptive three-layer score, per-zone ambience,
  and every effect generated through WebAudio.

## Documentation

| | |
|---|---|
| [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) | The loop, the numbers, fairness rules, progression |
| [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) | How it is built, and the two bugs that shaped it |
| [`docs/HERO_PIPELINE.md`](docs/HERO_PIPELINE.md) | Making the runner look like a specific person |
| [`docs/QA_PLAN.md`](docs/QA_PLAN.md) | Automated suites and the manual checklist |
| [`docs/ASSET_LICENSE_REGISTER.md`](docs/ASSET_LICENSE_REGISTER.md) | Provenance of everything shipped |

## Making the hero you

The character is driven entirely by `src/assets/HeroIdentity.ts` — proportions,
face shape, hair, outfit and colours are all data. Supply a reference photo,
fill in the numbers, and the same rig and animation set carry over unchanged.
See [`docs/HERO_PIPELINE.md`](docs/HERO_PIPELINE.md).

## Licence

The game's code and generated assets are this project's own work. The only
runtime dependency is [three.js](https://threejs.org) (MIT).
