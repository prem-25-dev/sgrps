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

Every keyboard binding above is a default, not a fixture. Settings → Controls
rebinds any of them: click a key, press the one you want. Bindings are stored
by physical position rather than by printed letter, so the defaults land on the
same cluster on AZERTY and Dvorak as they do on QWERTY, and the panel asks the
browser for your layout before naming a key.

## Tests

```bash
npm test             # geometry + fairness + streaming soak
npm run playtest     # boots the real game in Chromium and plays it
```

| Suite | What it proves |
|---|---|
| `test:geometry` | Swept surfaces have correct winding in every direction |
| `test:fairness` | No unsurvivable pattern can reach the player (verified over 288 km) |
| `test:differential` | The fairness solver's own escape routes replayed through the real physics |
| `test:gameplay` | The game actually plays: movement, collision, coins, magnet, every power-up, scoring, rooftop route |
| `test:progression` | Saves survive reloads and corruption; every mission and achievement is reachable |
| `test:controls` | Rebinding keeps every action playable; no stored settings value can break boot |
| `test:animation` | No NaN in the rig, feet stay on the deck, and a planted foot does not slide at any speed |
| `test:vfx` | Every effect emits, the shared particle pool never overflows and always drains |
| `test:zones` | All seven zones are distinct and none is an empty corridor |
| `test:tutorial` | The first-run lesson advances, times out and hands back cleanly |
| `test:soak` | World streaming pools plateau over 20 km — no leaks |
| `test:hero` | Character LOD budgets and skin-weight normalisation |

Six more run in a real browser, under `npm run playtest`:

| Suite | What it proves |
|---|---|
| `playtest` | Real browser boot, play, death, restart, pause, all panels, zero console errors |
| `test:ui-fit` | Every panel button is reachable at five viewports — the game can always be restarted or left |
| `test:audio` | All 33 synthesised voices make a sound, and nothing puts NaN on the master bus |
| `test:touch` | The game is playable with a thumb: tap, and every swipe direction |
| `test:rebind` | A key rebound in the panel actually drives the character, and the one it replaced stops |
| `test:hud-contrast` | The HUD clears WCAG contrast over the brightest sky the game paints |

CI runs all of these on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

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
- **A first-run tutorial** that teaches by asking rather than blocking — the
  run is real from the first metre, each step waits for you to do it once,
  and anything you ignore times out.
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
