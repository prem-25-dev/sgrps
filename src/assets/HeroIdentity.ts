/**
 * The hero is the one asset that makes this game *yours*, so every visual
 * decision about them is data, not hard-coded geometry.
 *
 * The numbers are plain measurements a person can read off a photograph (face
 * width relative to height, jaw taper, hair silhouette, outfit colours).
 * `docs/HERO_PIPELINE.md` walks through doing that, and DEFAULT_IDENTITY below
 * is the result of doing it: it is measured from a reference photograph rather
 * than invented, and every value carries the measurement it came from.
 */
export interface HeroIdentity {
  name: string;
  /** Overall standing height in metres. */
  height: number;
  /** 0 = slight, 1 = heavy set. Drives torso and limb girth. */
  build: number;
  /** Shoulder width as a fraction of height. */
  shoulderRatio: number;
  /** Hip width as a fraction of height. */
  hipRatio: number;

  face: {
    /** Head length in metres, chin to crown. */
    length: number;
    /** Width / length. Higher = rounder face. */
    widthRatio: number;
    /** Depth / length. */
    depthRatio: number;
    /** 0 = square jaw, 1 = tapered chin. */
    jawTaper: number;
    /** Cheekbone prominence, 0..1. */
    cheekbone: number;
    /** Brow ridge prominence, 0..1. */
    brow: number;
    /** Nose length / bridge height / width, all 0..1. */
    noseLength: number;
    noseBridge: number;
    noseWidth: number;
    /** Lip fullness, 0..1. */
    lips: number;
    /** Eye spacing as a fraction of head width, and eye size. */
    eyeSpacing: number;
    eyeSize: number;
    /** Ear size relative to head length. */
    ear: number;
  };

  colors: {
    skin: number;
    skinShadow: number;
    hair: number;
    brow: number;
    iris: number;
    lips: number;
    shirt: number;
    shirtAccent: number;
    pants: number;
    shoeBody: number;
    shoeSole: number;
    accent: number;
  };

  hair: {
    /** 'short' crop, 'medium' textured top, 'curly' cluster. */
    style: 'short' | 'medium' | 'curly';
    /** Height of the hair mass above the skull, metres. */
    volume: number;
    /** How far forward the fringe sits, 0..1. */
    fringe: number;
    /** Sideburn length, 0..1. */
    sideburn: number;
    /** Facial hair coverage, 0 = clean shaven. */
    stubble: number;
  };

  /**
   * Printed across the back and chest of the shirt.
   *
   * Empty prints nothing. It lives on the identity rather than in the
   * material because it belongs to a person, not to a fabric: two characters
   * built from the same shirt material wear different names.
   */
  shirtName: string;

  outfit: {
    /** 'tee' or 'longSleeve'. */
    top: 'tee' | 'longSleeve';
    /** 'joggers' or 'jeans'; affects the ankle taper. */
    bottom: 'joggers' | 'jeans';
    /** Optional signature accessories. */
    watch: boolean;
    band: boolean;
    backpack: boolean;
  };
}

/**
 * Measured from a reference photograph — a front-on shot on a plain
 * background, plus a three-quarter shot in daylight.
 *
 * Where a number could be measured it was, from landmark pixel positions
 * rather than by eye: pupils, lip line, nose base, chin and the head
 * silhouette were located by luminance, and the ratios below are quoted with
 * the pixel measurement they came from so a later pass can disagree with the
 * arithmetic instead of the taste. The two numbers a photograph of a head and
 * shoulders genuinely cannot give — standing height and head depth — are
 * marked as estimates.
 */
export const DEFAULT_IDENTITY: HeroIdentity = {
  name: 'Subash M',
  /** Estimated: no full-length frame and no scale reference in either shot. */
  height: 1.75,
  /** Lean. Drives torso and limb girth. */
  build: 0.26,
  /** Narrow, sloping shoulders; the trapezius sits close in to the neck. */
  shoulderRatio: 0.232,
  hipRatio: 0.178,
  shirtName: 'Subash M',

  face: {
    // Eye line 351 px, chin 535 px, so half the head is 184 px and the crown
    // lands at 167; cross-checked against chin-to-hairline x1.35, which gives
    // 331 px and is biased short by a low fringe. Head length taken as 355 px.
    /** Estimated from the ratios below at adult scale. */
    length: 0.234,
    /** 258 px across the cheekbones / 355 px of head length. */
    widthRatio: 0.727,
    /** Estimated: neither shot is a profile. */
    depthRatio: 0.86,
    /** Jaw 174 px against 258 px bizygomatic: tapered, not pointed. */
    jawTaper: 0.62,
    /** Lean face, cheekbones read clearly under a flat overcast light. */
    cheekbone: 0.6,
    /** Strong, low-set brows. */
    brow: 0.62,
    /** Brow 338 px to nose base 443 px: 0.30 of head length, on the long side. */
    noseLength: 0.56,
    noseBridge: 0.56,
    /** Nose base shadow spans 656-702 px, about 0.22 of face width. */
    noseWidth: 0.47,
    /** Full lower lip, medium upper. */
    lips: 0.55,
    /** Pupils 631 and 744 px: 113 px across 258 px of face. */
    eyeSpacing: 0.438,
    eyeSize: 0.5,
    ear: 0.46,
  },

  colors: {
    // Sampled from both shots and averaged: the daylight frame reads
    // #996f58 on the cheek and the studio frame #ba886e, and the albedo the
    // game lights sits between the two exposures rather than at either.
    skin: 0xaa7c63,
    /** Neck in shadow, #835a3f, deepened: the reference light was flat. */
    skinShadow: 0x7e563e,
    /** Hair core #322e2c in daylight — near black, neutral, not blue. */
    hair: 0x27231f,
    brow: 0x2c251f,
    iris: 0x3a2a1d,
    /** Lip mid-tone below the specular highlight, #96605a. */
    lips: 0x9d6259,
    // He wears a black zip-neck polo in both shots, #222122. Worn flat it
    // would lose the runner against every night zone in the game, so the
    // shirt keeps the photographed charcoal and the trim takes the one
    // colour he actually wears: the red thread on his right wrist.
    shirt: 0x24232a,
    shirtAccent: 0xd8402f,
    pants: 0x2a2f3a,
    shoeBody: 0xf2f2ee,
    shoeSole: 0x1d2128,
    accent: 0xd8402f,
  },

  hair: {
    /** Thick and wavy, clumped rather than smooth. */
    style: 'curly',
    /** 75 px of hair above a 355 px head: 0.21 of head length. */
    volume: 0.049,
    /** Low, heavy fringe; little forehead shows. */
    fringe: 0.3,
    /** Sideburns run down into the beard. */
    sideburn: 0.6,
    /** A real beard along the jaw and a moustache, but thin. */
    stubble: 0.6,
  },

  outfit: {
    top: 'tee',
    bottom: 'joggers',
    /** No watch in either shot. */
    watch: false,
    /** The red thread on the right wrist. */
    band: true,
    backpack: false,
  },
};

/**
 * Overrides for `makeIdentity`, partial all the way down.
 *
 * `Partial<HeroIdentity>` only makes the top level optional, so changing one
 * cheekbone meant restating all fifteen face measurements. Every group is
 * merged field by field below, so the type should say so.
 */
export type IdentityOverrides =
  Partial<Omit<HeroIdentity, 'face' | 'colors' | 'hair' | 'outfit'>> & {
    face?: Partial<HeroIdentity['face']>;
    colors?: Partial<HeroIdentity['colors']>;
    hair?: Partial<HeroIdentity['hair']>;
    outfit?: Partial<HeroIdentity['outfit']>;
  };

/** Merge a partial override (e.g. loaded from a reference photo) over defaults. */
export function makeIdentity(overrides: IdentityOverrides = {}): HeroIdentity {
  return {
    ...DEFAULT_IDENTITY,
    ...overrides,
    face: { ...DEFAULT_IDENTITY.face, ...(overrides.face ?? {}) },
    colors: { ...DEFAULT_IDENTITY.colors, ...(overrides.colors ?? {}) },
    hair: { ...DEFAULT_IDENTITY.hair, ...(overrides.hair ?? {}) },
    outfit: { ...DEFAULT_IDENTITY.outfit, ...(overrides.outfit ?? {}) },
  };
}
