# Asset licence register

Every asset in NEON RUN is **generated at runtime from code in this
repository**. Nothing is downloaded, bundled from a marketplace, or derived
from another game.

This register exists because the production bible asks for one, and because a
commercial release needs a defensible answer to "where did this come from?".
The answer here is unusually simple.

## Summary

| Category | Source | Licence | Third-party rights |
|---|---|---|---|
| Hero character (mesh, rig, skinning, LODs) | `src/assets/HeroFactory.ts`, `HeroRig.ts`, `HeroIdentity.ts` | Owned by this project | None |
| Hero animation (all 30+ clips) | `src/player/AnimationClips.ts` | Owned by this project | None |
| Trains, track, stations, city, props, vehicles, planting | `src/assets/*Factory.ts` | Owned by this project | None |
| Obstacles, coins, power-ups | `src/obstacles/`, `src/collectibles/`, `src/powerups/` | Owned by this project | None |
| Materials, textures, decals | `src/assets/MaterialLibrary.ts`, `TextureFactory.ts` | Owned by this project | None |
| VFX | `src/vfx/` | Owned by this project | None |
| Audio (every effect, ambience bed and music layer) | `src/audio/` | Owned by this project | None |
| UI, logo, typography | `src/ui/` + the OS font stack | Owned by this project | None |
| Runtime engine | [three.js](https://threejs.org) | MIT | three.js authors |
| Build tooling | Vite, TypeScript, esbuild, Playwright | MIT / Apache-2.0 | respective authors |

`three` is the only runtime dependency. Its MIT licence permits commercial use
and redistribution with attribution; the notice is preserved in
`node_modules/three/LICENSE` and must ship with any binary distribution.

## Why nothing was purchased or downloaded

The bible's Tier B (marketplace) and Tier C (CC0) routes are both legitimate.
This build took the fallback the bible specifies — *"If an asset is genuinely
unavailable, create a procedural/custom replacement that matches the game's
visual language"* — because the session had no purchased asset folders, no
network access to asset hosts, and no identity reference photo. Generating
everything has three side effects worth keeping:

1. **No licence surface.** There is no per-listing EULA to audit before
   release, and no risk of a supplier changing terms.
2. **A 200 KB gzipped build.** The entire game, including every texture and
   every sound, is smaller than a single 2K PNG.
3. **Seeded reproducibility.** The same seed produces the same world, because
   the assets are functions rather than files.

## Adding third-party assets later

If you do buy or download assets, they drop in alongside the generated ones —
the factories are plain functions returning `THREE.Object3D`, so a bought
train replaces `buildTrain()` without touching gameplay code.

Record every one of them here before it is committed:

```text
Asset name:
Creator:
Website:
Exact listing URL:
Licence (and version):
Purchase price / free:
Download date:
Where used in this project:
Modified? (yes/no, and how):
Proof of licence saved at:
```

**Do not assume "free" means commercially usable.** Verify the individual
listing, not just the marketplace's default terms, and keep a copy of the
licence text with the receipt.
