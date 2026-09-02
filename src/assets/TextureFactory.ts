import * as THREE from 'three';

/**
 * Every texture in NEON RUN is generated at runtime on a canvas: no external
 * image downloads, no licence questions, and the whole build stays tiny.
 * Generators are deterministic so the look never shifts between sessions.
 */

const cache = new Map<string, THREE.Texture>();

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise. Wraps on `period` so textures repeat seamlessly. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v: number) => ((v % period) + period) % period;
  const x0 = wrap(xi);
  const x1 = wrap(xi + 1);
  const y0 = wrap(yi);
  const y1 = wrap(yi + 1);
  const n00 = hash(x0, y0, seed);
  const n10 = hash(x1, y0, seed);
  const n01 = hash(x0, y1, seed);
  const n11 = hash(x1, y1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

/** Multi-octave tileable fBm in 0..1. */
export function fbm(x: number, y: number, octaves: number, basePeriod: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * period, y * period, period, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

export interface CanvasSurface {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D;
}

/** Works in browsers and in the headless playtest harness (which stubs canvas). */
export function createSurface(size: number): CanvasSurface | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  return { canvas, ctx };
}

function toTexture(
  surface: CanvasSurface | null,
  repeat: number,
  colorSpace: THREE.ColorSpace,
): THREE.Texture {
  if (!surface) {
    const tex = new THREE.Texture();
    tex.colorSpace = colorSpace;
    return tex;
  }
  const tex = new THREE.CanvasTexture(surface.canvas as HTMLCanvasElement);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface NoiseTextureOptions {
  size?: number;
  repeat?: number;
  octaves?: number;
  period?: number;
  seed?: number;
  /** Two colours the noise ramps between, as #rrggbb. */
  colorA: string;
  colorB: string;
  /** Extra contrast applied to the noise before the ramp. */
  contrast?: number;
  /** Optional per-pixel decorator run after the base fill. */
  decorate?: (ctx: CanvasRenderingContext2D, size: number) => void;
  colorSpace?: THREE.ColorSpace;
}

/** Cached generator so 40 materials sharing "concrete" only rasterise once. */
export function noiseTexture(key: string, opts: NoiseTextureOptions): THREE.Texture {
  const cached = cache.get(key);
  if (cached) return cached;

  const size = opts.size ?? 256;
  const surface = createSurface(size);
  if (surface) {
    const { ctx } = surface;
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const a = new THREE.Color(opts.colorA);
    const b = new THREE.Color(opts.colorB);
    const contrast = opts.contrast ?? 1;
    const period = opts.period ?? 8;
    const octaves = opts.octaves ?? 4;
    const seed = opts.seed ?? 7;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let n = fbm(x / size, y / size, octaves, period, seed);
        n = Math.min(1, Math.max(0, (n - 0.5) * contrast + 0.5));
        const i = (y * size + x) * 4;
        data[i] = (a.r + (b.r - a.r) * n) * 255;
        data[i + 1] = (a.g + (b.g - a.g) * n) * 255;
        data[i + 2] = (a.b + (b.b - a.b) * n) * 255;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    opts.decorate?.(ctx, size);
  }

  const tex = toTexture(surface, opts.repeat ?? 1, opts.colorSpace ?? THREE.SRGBColorSpace);
  cache.set(key, tex);
  return tex;
}

/** Derives a tangent-space normal map from a height field callback. */
export function normalFromHeight(
  key: string,
  size: number,
  repeat: number,
  strength: number,
  height: (x: number, y: number) => number,
): THREE.Texture {
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(size);
  if (surface) {
    const { ctx } = surface;
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const at = (x: number, y: number) => height(((x % size) + size) % size, ((y % size) + size) % size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
        data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
        data[i + 2] = (1 / len) * 0.5 * 255 + 127;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const tex = toTexture(surface, repeat, THREE.NoColorSpace);
  cache.set(key, tex);
  return tex;
}

/** Single channel map (roughness / metalness / AO) from a callback in 0..1. */
export function dataTexture(
  key: string,
  size: number,
  repeat: number,
  value: (x: number, y: number) => number,
): THREE.Texture {
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(size);
  if (surface) {
    const { ctx } = surface;
    const image = ctx.createImageData(size, size);
    const data = image.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = Math.min(1, Math.max(0, value(x, y))) * 255;
        const i = (y * size + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const tex = toTexture(surface, repeat, THREE.NoColorSpace);
  cache.set(key, tex);
  return tex;
}

/** Canvas painted directly by a draw callback (signage, decals, coin faces). */
export function paintedTexture(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  opts: { repeat?: number; transparent?: boolean; colorSpace?: THREE.ColorSpace } = {},
): THREE.Texture {
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(size);
  if (surface) {
    if (!opts.transparent) {
      surface.ctx.fillStyle = '#000000';
      surface.ctx.fillRect(0, 0, size, size);
    }
    draw(surface.ctx, size);
  }
  const tex = toTexture(surface, opts.repeat ?? 1, opts.colorSpace ?? THREE.SRGBColorSpace);
  cache.set(key, tex);
  return tex;
}

export function clearTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

export function textureCacheSize(): number {
  return cache.size;
}
