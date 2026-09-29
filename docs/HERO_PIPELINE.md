# Hero pipeline — making the runner look like you

The runner is Subash M, and `DEFAULT_IDENTITY` is measured from a reference
photograph rather than invented. Everything visual about the character is data,
so matching a real person is a config edit, not a remodel — this page is both
how that was done and how to do it again for somebody else.

## How the shipped identity was measured

Two photographs: a near-frontal shot on a plain background, and a
three-quarter shot in overcast daylight. The plain background is worth asking
for — it lets the head silhouette be extracted by threshold instead of by eye.

Landmarks were located by pixel, not by judgement, because judgement is exactly
what is unreliable here. Reading the face width off the frontal shot by eye gave
a width-to-length ratio of 0.61, which would have produced a head far narrower
than the person in the photograph; locating the pupils by luminance minimum and
the chin by the shading break under the jaw gave 0.727, and the two disagreed
because the widest part of the face is above the cheekbone and under the hair,
where there is nothing obvious to point at.

The measurements that fixed the model, and what each came from:

| Value | Measured from |
|---|---|
| Head length 355 px | Pupils at y 351, chin at 535; the eye line is the head's vertical midpoint, so the crown is the same distance above it |
| `widthRatio` 0.727 | 258 px across the cheekbones against those 355 |
| `eyeSpacing` 0.438 | Pupils 113 px apart (x 631 and 744) against the same 258 |
| `jawTaper` 0.62 | Jaw 174 px against 258 px bizygomatic |
| `noseLength` 0.56 | Brow 338 px to nose base 443 px: 0.30 of head length |
| `hair.volume` 0.049 | 75 px of hair above the crown, 0.21 of head length |
| Skin, hair, lip colours | Sampled and averaged across both exposures |

Two values a head-and-shoulders photograph cannot give are marked as estimates
in the file: standing height, which needs a full-length frame or a scale
reference, and `depthRatio`, which needs a profile.

One deliberate departure from the reference. He wears a black polo in both
shots, and the shirt keeps that charcoal — but worn flat it would lose the
runner against every night zone in the game, so the trim takes the one colour
he actually wears, the red thread on his right wrist. `outfit.band` puts that
thread on the model, on the correct wrist.

## Doing this for somebody else

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
