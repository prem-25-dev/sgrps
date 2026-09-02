/**
 * The hero is the one asset that makes this game *yours*, so every visual
 * decision about them is data, not hard-coded geometry.
 *
 * Supply an identity reference photo by filling in this table: the numbers are
 * plain measurements a person can read off a photograph (face width relative
 * to height, jaw taper, hair silhouette, outfit colours). `docs/HERO_PIPELINE.md`
 * walks through doing that. Until a reference is provided the DEFAULT_IDENTITY
 * below is used, which is a neutral adult male build.
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

export const DEFAULT_IDENTITY: HeroIdentity = {
  name: 'Runner',
  height: 1.78,
  build: 0.42,
  shoulderRatio: 0.244,
  hipRatio: 0.185,

  face: {
    length: 0.232,
    widthRatio: 0.76,
    depthRatio: 0.86,
    jawTaper: 0.52,
    cheekbone: 0.55,
    brow: 0.5,
    noseLength: 0.5,
    noseBridge: 0.5,
    noseWidth: 0.5,
    lips: 0.5,
    eyeSpacing: 0.46,
    eyeSize: 0.5,
    ear: 0.5,
  },

  colors: {
    skin: 0xd99a6f,
    skinShadow: 0xa06b45,
    hair: 0x191310,
    brow: 0x1a1310,
    iris: 0x3a2415,
    lips: 0x9b5a52,
    shirt: 0x1c6f86,
    shirtAccent: 0x51fff0,
    pants: 0x232a38,
    shoeBody: 0xf2f2ee,
    shoeSole: 0x1d2128,
    accent: 0xff3ea8,
  },

  hair: {
    style: 'medium',
    volume: 0.032,
    fringe: 0.55,
    sideburn: 0.45,
    stubble: 0.25,
  },

  outfit: {
    top: 'tee',
    bottom: 'joggers',
    watch: true,
    band: false,
    backpack: false,
  },
};

/** Merge a partial override (e.g. loaded from a reference photo) over defaults. */
export function makeIdentity(overrides: Partial<HeroIdentity> = {}): HeroIdentity {
  return {
    ...DEFAULT_IDENTITY,
    ...overrides,
    face: { ...DEFAULT_IDENTITY.face, ...(overrides.face ?? {}) },
    colors: { ...DEFAULT_IDENTITY.colors, ...(overrides.colors ?? {}) },
    hair: { ...DEFAULT_IDENTITY.hair, ...(overrides.hair ?? {}) },
    outfit: { ...DEFAULT_IDENTITY.outfit, ...(overrides.outfit ?? {}) },
  };
}
