/**
 * Small synthesis toolkit. Every sound in the game is generated from these
 * primitives at runtime, which means no audio downloads and no licensing.
 */

export function createNoiseBuffer(ctx: BaseAudioContext, seconds: number, kind: 'white' | 'pink' | 'brown' = 'white'): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    // Voss-McCartney approximation: cheap and stable.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

export interface EnvelopeOptions {
  attack: number;
  decay: number;
  sustain?: number;
  release?: number;
  peak?: number;
}

/** Applies an AD or ADSR envelope to a gain node starting at `when`. */
export function envelope(gain: GainNode, when: number, opts: EnvelopeOptions, duration: number): void {
  const peak = opts.peak ?? 1;
  const sustain = opts.sustain ?? 0;
  const release = opts.release ?? 0.05;
  const p = gain.gain;
  p.cancelScheduledValues(when);
  p.setValueAtTime(0.0001, when);
  p.linearRampToValueAtTime(peak, when + Math.max(0.001, opts.attack));
  if (sustain > 0) {
    p.linearRampToValueAtTime(peak * sustain, when + opts.attack + opts.decay);
    p.setValueAtTime(peak * sustain, when + Math.max(opts.attack + opts.decay, duration - release));
    p.exponentialRampToValueAtTime(0.0001, when + duration);
  } else {
    p.exponentialRampToValueAtTime(0.0001, when + Math.max(0.02, opts.attack + opts.decay));
  }
}

/** A quick impulse-response reverb, built from decaying noise. */
export function createReverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

/** Musical helper: MIDI note number to frequency. */
export function noteFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Scale degrees for the game's key (D minor pentatonic, driving and neutral). */
export const SCALE = [0, 3, 5, 7, 10];
export const ROOT_MIDI = 38; // D2
