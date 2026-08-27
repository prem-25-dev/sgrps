# Hero pipeline — making the runner look like you

No reference photo reached this build, so the hero uses `DEFAULT_IDENTITY`: a
neutral adult build. Everything visual about the character is data, so
matching a real person is a config edit, not a remodel.

## What to change

Open `src/assets/HeroIdentity.ts`. Every number is a measurement you can read
off a photograph.

### Proportions
| Field | How to read it off a photo |
|---|---|
| `height` | Actual height in metres |
| `build` | 0 slight → 1 heavy set |
| `shoulderRatio` | Shoulder width ÷ height (typically 0.23–0.26) |
| `hipRatio` | Hip width ÷ height (typically 0.17–0.20) |

### Face
Take a front-on and a profile photo.

| Field | How to read it off a photo |
|---|---|
| `face.length` | Chin to crown, in metres (0.21–0.25 for adults) |
| `face.widthRatio` | Face width ÷ face length |
| `face.depthRatio` | Head depth ÷ face length (from the profile shot) |
| `face.jawTaper` | 0 square jaw → 1 pointed chin |
| `face.cheekbone` | 0 flat → 1 prominent |
| `face.brow` | 0 flat → 1 heavy brow ridge |
| `face.noseLength` / `noseBridge` / `noseWidth` | 0–1 each |
| `face.lips` | 0 thin → 1 full |
| `face.eyeSpacing` | Pupil distance ÷ face width (usually ~0.46) |
| `face.eyeSize` | 0 small → 1 large |
| `face.ear` | 0 small → 1 large |

### Colour
Sample directly from the photo with any colour picker:
`skin`, `skinShadow` (a shaded area of the same skin), `hair`, `brow`, `iris`,
`lips`. Then pick the outfit: `shirt`, `shirtAccent`, `pants`, `shoeBody`,
`shoeSole`, `accent`.

### Hair and outfit
`hair.style` is `short` | `medium` | `curly`; `volume` is the hair mass above
the skull in metres; `fringe` and `sideburn` move the hairline; `stubble` is
facial-hair coverage. `outfit` picks a tee or long sleeves, joggers or jeans,
and toggles a watch, wristband and backpack.

## Checking your work

```bash
npm run test:hero          # triangle budgets, part bounds, skin weights
npm run build && npx vite preview
node scripts/hero-shot.mjs # front, 3/4, side, face, legs, shoulder, back
```

`scripts/hero-shot.mjs` writes close-ups to `/tmp/playtest/hero-*.png`. It was
written for exactly this loop — it stops the frame loop, hides the UI, lights
the character neutrally, and photographs it from seven angles.

## Quality checks before accepting a hero

- Feet meet the ground; no penetration during the run cycle
- Knees and elbows bend the right way
- Shoulders do not collapse when the arms swing
- The face does not deform unexpectedly when the head turns
- Clothing does not clip through the body — if it does, the cause is almost
  always sampling the garment from a filtered section list instead of
  clipping resampled rings (see `clipRings` in `HeroFactory.ts`)
- Hair does not intersect the face
- The run, jump, landing and slide all read as human

## Swapping in a modelled character instead

If you would rather use a sculpted and rigged character (Blender, Mixamo, a
marketplace asset), `createHero()` is the only seam you need to replace. It
must return a `Hero`: an object with a `THREE.Group`, a `Rig` whose bones are
named as in `HeroRig.ts`, three LOD groups, and a `setLod` method. The
animation system drives bones by name, so any humanoid rig with those names
will animate without further changes.

Record anything you import in `ASSET_LICENSE_REGISTER.md` before committing it.
