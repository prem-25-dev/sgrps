import { bus } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';
import { createNoiseBuffer, createReverbImpulse, envelope, noteFreq, ROOT_MIDI, SCALE } from './Synth';

/**
 * The whole soundtrack and effects library, synthesised.
 *
 * Layout: master -> [music bus, sfx bus, ambience bus], with a shared reverb
 * send. The music is a scheduled sequencer with three intensity layers that
 * fade in as the run gets faster, so the score reacts to play rather than
 * looping obliviously.
 */

export type SfxId =
  | 'SFX_Footstep' | 'SFX_Jump' | 'SFX_Land' | 'SFX_LandHard' | 'SFX_Slide'
  | 'SFX_Stumble' | 'SFX_Collision' | 'SFX_Whoosh'
  | 'SFX_Coin' | 'SFX_CoinStreak' | 'SFX_PowerUp' | 'SFX_PowerDown'
  | 'SFX_ShieldHit' | 'SFX_Magnet' | 'SFX_Boost'
  | 'SFX_TrainHorn' | 'SFX_TrainBrake' | 'SFX_TrainDoor' | 'SFX_TrainPass'
  | 'SFX_ImpactMetal' | 'SFX_ImpactWood' | 'SFX_ImpactStone' | 'SFX_ImpactSoft'
  | 'SFX_TrainImpact' | 'SFX_ElectricArc'
  | 'SFX_UIHover' | 'SFX_UIClick' | 'SFX_UIBack' | 'SFX_Transition'
  | 'SFX_MissionComplete' | 'SFX_Achievement' | 'SFX_GameOver' | 'SFX_Countdown';

export type MusicTrack = 'menu' | 'gameplay' | 'gameover' | 'none';
export type AmbienceId = 'AMB_City' | 'AMB_Railway' | 'AMB_Wind' | 'AMB_Machinery' | 'AMB_Electrical' | 'AMB_Crowd';

interface Loop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  target: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambienceBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private compressor!: DynamicsCompressorNode;

  private noiseWhite!: AudioBuffer;
  private noisePink!: AudioBuffer;
  private noiseBrown!: AudioBuffer;

  private ambience = new Map<AmbienceId, Loop>();
  private trainLoop: Loop | null = null;

  private musicTrack: MusicTrack = 'none';
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private tempo = 132;
  /** 0..1: drives which musical layers are audible. */
  private intensity = 0;
  private targetIntensity = 0;

  private footstepIndex = 0;
  private coinPitch = 0;
  private lastCoinTime = 0;
  private started = false;
  private suspended = false;

  constructor(private readonly save: SaveManager) {
    bus.on('audio:settings', () => this.applyVolumes());
  }

  get ready(): boolean {
    return this.started && !!this.ctx;
  }

  /**
   * Browsers require a user gesture before audio can start, so this is called
   * from the first interaction rather than at boot.
   */
  async start(): Promise<void> {
    if (this.started) {
      await this.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.22;
    this.compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.compressor);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = createReverbImpulse(ctx, 2.4, 3.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.24;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    for (const busNode of [this.musicBus, this.sfxBus, this.ambienceBus]) busNode.connect(this.master);
    this.sfxBus.connect(this.reverbSend);
    this.musicBus.connect(this.reverbSend);

    this.noiseWhite = createNoiseBuffer(ctx, 2, 'white');
    this.noisePink = createNoiseBuffer(ctx, 3, 'pink');
    this.noiseBrown = createNoiseBuffer(ctx, 4, 'brown');

    this.started = true;
    this.applyVolumes();
    await this.resume();
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
    this.suspended = false;
  }

  suspend(): void {
    this.suspended = true;
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = this.save.settings;
    this.musicBus.gain.setTargetAtTime(s.musicVolume * 0.8, this.ctx.currentTime, 0.08);
    this.sfxBus.gain.setTargetAtTime(s.sfxVolume, this.ctx.currentTime, 0.05);
    this.ambienceBus.gain.setTargetAtTime(s.sfxVolume * 0.4, this.ctx.currentTime, 0.2);
  }

  // -------------------------------------------------------------------------
  // Sound effects
  // -------------------------------------------------------------------------

  private noiseSource(buffer: AudioBuffer, playbackRate = 1): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = playbackRate;
    return src;
  }

  private tone(type: OscillatorType, freq: number): OscillatorNode {
    const osc = this.ctx!.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    return osc;
  }

  /** Filtered noise burst: the basis of every impact and footstep. */
  private impact(opts: {
    buffer?: AudioBuffer;
    filter: BiquadFilterType;
    freq: number;
    q?: number;
    duration: number;
    gain: number;
    rate?: number;
    sweepTo?: number;
    destination?: AudioNode;
  }): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const src = this.noiseSource(opts.buffer ?? this.noiseWhite, opts.rate ?? 1);
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter;
    filter.frequency.value = opts.freq;
    filter.Q.value = opts.q ?? 1;
    if (opts.sweepTo) {
      filter.frequency.setValueAtTime(opts.freq, now);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), now + opts.duration);
    }
    const gain = ctx.createGain();
    envelope(gain, now, { attack: 0.004, decay: opts.duration, peak: opts.gain }, opts.duration);
    src.connect(filter).connect(gain).connect(opts.destination ?? this.sfxBus);
    src.start(now);
    src.stop(now + opts.duration + 0.05);
  }

  /** Pitched blip used by coins, power-ups and UI. */
  private blip(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', slideTo?: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const osc = this.tone(type, freq);
    if (slideTo) {
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), now + duration);
    }
    const g = ctx.createGain();
    envelope(g, now, { attack: 0.005, decay: duration, peak: gain }, duration);
    osc.connect(g).connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /** Fires one effect. Safe to call before audio has started. */
  play(id: SfxId, variation = 0): void {
    if (!this.ready || this.suspended) return;
    const ctx = this.ctx!;

    switch (id) {
      case 'SFX_Footstep': {
        // Eight variants: different filter centres and rates, so a run cycle
        // never sounds like the same click repeating.
        this.footstepIndex = (this.footstepIndex + 1) % 8;
        const v = this.footstepIndex;
        this.impact({
          buffer: this.noisePink,
          filter: 'bandpass',
          freq: 900 + v * 130 + Math.random() * 120,
          q: 1.4,
          duration: 0.075 + (v % 3) * 0.012,
          gain: 0.16 + variation * 0.1,
          rate: 0.9 + (v % 4) * 0.08,
          sweepTo: 380,
        });
        break;
      }
      case 'SFX_Jump':
        this.impact({ filter: 'highpass', freq: 320, duration: 0.16, gain: 0.2, sweepTo: 1400 });
        this.blip(320, 0.12, 0.08, 'triangle', 620);
        break;
      case 'SFX_Land':
        this.impact({ buffer: this.noiseBrown, filter: 'lowpass', freq: 780, duration: 0.16, gain: 0.32, sweepTo: 200 });
        break;
      case 'SFX_LandHard':
        this.impact({ buffer: this.noiseBrown, filter: 'lowpass', freq: 620, duration: 0.3, gain: 0.5, sweepTo: 110 });
        this.blip(78, 0.24, 0.28, 'sine', 44);
        break;
      case 'SFX_Slide':
        this.impact({ buffer: this.noisePink, filter: 'bandpass', freq: 2100, q: 0.9, duration: 0.62, gain: 0.24, sweepTo: 620 });
        break;
      case 'SFX_Stumble':
        this.impact({ buffer: this.noiseBrown, filter: 'lowpass', freq: 500, duration: 0.36, gain: 0.4, sweepTo: 130 });
        this.blip(180, 0.3, 0.14, 'sawtooth', 90);
        break;
      case 'SFX_Collision':
      case 'SFX_TrainImpact':
        this.impact({ buffer: this.noiseBrown, filter: 'lowpass', freq: 900, duration: 0.5, gain: 0.6, sweepTo: 90 });
        this.impact({ filter: 'bandpass', freq: 2400, q: 2, duration: 0.22, gain: 0.3 });
        this.blip(62, 0.5, 0.34, 'sine', 38);
        break;
      case 'SFX_Whoosh':
        this.impact({ buffer: this.noisePink, filter: 'bandpass', freq: 500, q: 0.7, duration: 0.3, gain: 0.16, sweepTo: 2600 });
        break;
      case 'SFX_Coin': {
        // Pitch climbs with a coin streak and resets after a gap.
        const now = ctx.currentTime;
        if (now - this.lastCoinTime > 1.1) this.coinPitch = 0;
        this.lastCoinTime = now;
        this.coinPitch = Math.min(14, this.coinPitch + 1);
        const base = noteFreq(ROOT_MIDI + 36 + SCALE[this.coinPitch % SCALE.length] + Math.floor(this.coinPitch / SCALE.length) * 12);
        this.blip(base, 0.1, 0.16, 'triangle');
        this.blip(base * 2, 0.07, 0.07, 'sine');
        break;
      }
      case 'SFX_CoinStreak':
        for (let i = 0; i < 4; i++) {
          setTimeout(() => this.blip(noteFreq(ROOT_MIDI + 48 + SCALE[i]), 0.1, 0.12, 'triangle'), i * 55);
        }
        break;
      case 'SFX_PowerUp':
        for (let i = 0; i < 3; i++) {
          setTimeout(() => this.blip(noteFreq(ROOT_MIDI + 36 + SCALE[i] + 12), 0.16, 0.16, 'square'), i * 60);
        }
        break;
      case 'SFX_PowerDown':
        this.blip(520, 0.3, 0.12, 'square', 180);
        break;
      case 'SFX_ShieldHit':
        this.blip(880, 0.3, 0.2, 'sine', 220);
        this.impact({ filter: 'bandpass', freq: 3200, q: 3, duration: 0.28, gain: 0.22, sweepTo: 900 });
        break;
      case 'SFX_Magnet':
        this.blip(180, 0.4, 0.12, 'sawtooth', 620);
        break;
      case 'SFX_Boost':
        this.blip(140, 0.55, 0.2, 'sawtooth', 900);
        this.impact({ buffer: this.noisePink, filter: 'bandpass', freq: 700, q: 1.1, duration: 0.6, gain: 0.2, sweepTo: 3200 });
        break;
      case 'SFX_TrainHorn': {
        const now = ctx.currentTime;
        for (const f of [196, 233, 294]) {
          const osc = this.tone('sawtooth', f);
          const g = ctx.createGain();
          envelope(g, now, { attack: 0.05, decay: 0.15, sustain: 0.75, release: 0.35, peak: 0.1 }, 1.1);
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 1600;
          osc.connect(filter).connect(g).connect(this.sfxBus);
          osc.start(now);
          osc.stop(now + 1.2);
        }
        break;
      }
      case 'SFX_TrainBrake':
        this.impact({ buffer: this.noiseWhite, filter: 'bandpass', freq: 3800, q: 8, duration: 1.4, gain: 0.16, sweepTo: 1800 });
        break;
      case 'SFX_TrainDoor':
        this.impact({ buffer: this.noisePink, filter: 'bandpass', freq: 1400, q: 2, duration: 0.5, gain: 0.14, sweepTo: 600 });
        this.blip(720, 0.1, 0.1, 'square');
        break;
      case 'SFX_TrainPass':
        this.impact({ buffer: this.noiseBrown, filter: 'lowpass', freq: 1400, duration: 1.6, gain: 0.34, sweepTo: 260 });
        break;
      case 'SFX_ImpactMetal':
        this.impact({ filter: 'bandpass', freq: 2600, q: 4, duration: 0.3, gain: 0.34, sweepTo: 900 });
        this.blip(420, 0.26, 0.14, 'triangle', 180);
        break;
      case 'SFX_ImpactWood':
        this.impact({ buffer: this.noisePink, filter: 'bandpass', freq: 900, q: 2.2, duration: 0.22, gain: 0.34, sweepTo: 320 });
        break;
      case 'SFX_ImpactStone':
        this.impact({ buffer: this.noiseBrown, filter: 'lowpass', freq: 1100, duration: 0.3, gain: 0.4, sweepTo: 180 });
        break;
      case 'SFX_ImpactSoft':
        this.impact({ buffer: this.noiseBrown, filter: 'lowpass', freq: 420, duration: 0.24, gain: 0.3, sweepTo: 120 });
        break;
      case 'SFX_ElectricArc':
        this.impact({ filter: 'highpass', freq: 2400, duration: 0.18, gain: 0.22, rate: 1.6 });
        break;
      case 'SFX_UIHover':
        this.blip(1250, 0.05, 0.05, 'sine');
        break;
      case 'SFX_UIClick':
        this.blip(760, 0.07, 0.11, 'triangle', 980);
        break;
      case 'SFX_UIBack':
        this.blip(620, 0.09, 0.1, 'triangle', 380);
        break;
      case 'SFX_Transition':
        this.impact({ buffer: this.noisePink, filter: 'bandpass', freq: 400, q: 0.8, duration: 0.45, gain: 0.14, sweepTo: 3400 });
        break;
      case 'SFX_MissionComplete':
        [0, 3, 5, 7].forEach((d, i) =>
          setTimeout(() => this.blip(noteFreq(ROOT_MIDI + 36 + d + 12), 0.22, 0.14, 'triangle'), i * 90),
        );
        break;
      case 'SFX_Achievement':
        [0, 4, 7, 12].forEach((d, i) =>
          setTimeout(() => this.blip(noteFreq(ROOT_MIDI + 36 + d + 12), 0.3, 0.15, 'square'), i * 110),
        );
        break;
      case 'SFX_GameOver':
        [12, 7, 3, 0].forEach((d, i) =>
          setTimeout(() => this.blip(noteFreq(ROOT_MIDI + 24 + d), 0.5, 0.16, 'sawtooth'), i * 160),
        );
        break;
      case 'SFX_Countdown':
        this.blip(660, 0.14, 0.14, 'square');
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Ambience
  // -------------------------------------------------------------------------

  private startLoop(buffer: AudioBuffer, filterType: BiquadFilterType, freq: number, q: number, rate: number): Loop {
    const ctx = this.ctx!;
    const src = this.noiseSource(buffer, rate);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.ambienceBus);
    src.start();
    return { source: src, gain, target: 0 };
  }

  /** Sets the ambience mix; unlisted beds fade out. */
  setAmbience(levels: Partial<Record<AmbienceId, number>>): void {
    if (!this.ready) return;
    const specs: Record<AmbienceId, [AudioBuffer, BiquadFilterType, number, number, number]> = {
      AMB_City: [this.noisePink, 'lowpass', 800, 0.7, 0.35],
      AMB_Railway: [this.noiseBrown, 'lowpass', 340, 0.8, 0.25],
      AMB_Wind: [this.noisePink, 'bandpass', 520, 0.5, 0.5],
      AMB_Machinery: [this.noiseBrown, 'bandpass', 180, 2.5, 0.4],
      AMB_Electrical: [this.noiseWhite, 'bandpass', 3200, 12, 0.9],
      AMB_Crowd: [this.noisePink, 'bandpass', 1100, 0.9, 0.3],
    };

    for (const id of Object.keys(specs) as AmbienceId[]) {
      const level = levels[id] ?? 0;
      let loop = this.ambience.get(id);
      if (!loop && level > 0.001) {
        const [buffer, type, freq, q, rate] = specs[id];
        loop = this.startLoop(buffer, type, freq, q, rate);
        this.ambience.set(id, loop);
      }
      if (loop) {
        loop.target = level;
        loop.gain.gain.setTargetAtTime(level, this.ctx!.currentTime, 1.2);
      }
    }
  }

  /** Rolling stock bed; level tracks how close the nearest train is. */
  setTrainProximity(level: number): void {
    if (!this.ready) return;
    if (!this.trainLoop && level > 0.001) {
      this.trainLoop = this.startLoop(this.noiseBrown, 'lowpass', 260, 1.1, 0.5);
    }
    if (this.trainLoop) {
      this.trainLoop.gain.gain.setTargetAtTime(level * 0.5, this.ctx!.currentTime, 0.4);
    }
  }

  // -------------------------------------------------------------------------
  // Music
  // -------------------------------------------------------------------------

  setMusic(track: MusicTrack): void {
    if (!this.ready) return;
    this.musicTrack = track;
    this.step = 0;
    this.nextNoteTime = this.ctx!.currentTime + 0.08;
    this.tempo = track === 'menu' ? 96 : track === 'gameover' ? 72 : 132;
    if (track === 'none') {
      this.stopMusic();
      return;
    }
    if (this.musicTimer === null) {
      this.musicTimer = window.setInterval(() => this.scheduleMusic(), 25);
    }
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /** 0..1, normally the player's speed fraction. */
  setIntensity(value: number): void {
    this.targetIntensity = Math.min(1, Math.max(0, value));
  }

  /**
   * Lookahead scheduler: queues notes a little ahead of the clock so timing
   * does not depend on the frame rate.
   */
  private scheduleMusic(): void {
    if (!this.ctx || this.musicTrack === 'none' || this.suspended) return;
    const ctx = this.ctx;
    const secondsPerStep = 60 / this.tempo / 4;
    this.intensity += (this.targetIntensity - this.intensity) * 0.02;

    while (this.nextNoteTime < ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextNoteTime, secondsPerStep);
      this.nextNoteTime += secondsPerStep;
      this.step = (this.step + 1) % 64;
    }
  }

  private voice(
    type: OscillatorType,
    freq: number,
    when: number,
    duration: number,
    peak: number,
    filterFreq: number,
    detune = 0,
  ): void {
    const ctx = this.ctx!;
    const osc = this.tone(type, freq);
    osc.detune.value = detune;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, when);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, filterFreq * 0.4), when + duration);
    filter.Q.value = 3;
    const gain = ctx.createGain();
    envelope(gain, when, { attack: 0.008, decay: duration * 0.9, peak }, duration);
    osc.connect(filter).connect(gain).connect(this.musicBus);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  private drum(kind: 'kick' | 'snare' | 'hat', when: number, peak: number): void {
    const ctx = this.ctx!;
    if (kind === 'kick') {
      const osc = this.tone('sine', 110);
      osc.frequency.setValueAtTime(120, when);
      osc.frequency.exponentialRampToValueAtTime(42, when + 0.11);
      const g = ctx.createGain();
      envelope(g, when, { attack: 0.002, decay: 0.16, peak }, 0.18);
      osc.connect(g).connect(this.musicBus);
      osc.start(when);
      osc.stop(when + 0.24);
      return;
    }
    const src = this.noiseSource(kind === 'snare' ? this.noiseWhite : this.noisePink, kind === 'hat' ? 1.8 : 1);
    const filter = ctx.createBiquadFilter();
    filter.type = kind === 'hat' ? 'highpass' : 'bandpass';
    filter.frequency.value = kind === 'hat' ? 7200 : 1900;
    filter.Q.value = kind === 'hat' ? 0.7 : 1.2;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.05 : 0.15;
    envelope(g, when, { attack: 0.001, decay: dur, peak }, dur);
    src.connect(filter).connect(g).connect(this.musicBus);
    src.start(when);
    src.stop(when + dur + 0.05);
  }

  /** One 16th-note step of the arrangement. */
  private playStep(step: number, when: number, stepDuration: number): void {
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const i = this.intensity;

    if (this.musicTrack === 'gameover') {
      if (beat === 0) {
        const root = ROOT_MIDI + [0, -2, -4, -5][bar % 4];
        this.voice('sawtooth', noteFreq(root), when, stepDuration * 14, 0.12, 700);
        this.voice('sine', noteFreq(root + 7), when, stepDuration * 14, 0.06, 900);
      }
      return;
    }

    if (this.musicTrack === 'menu') {
      // Sparse, patient: a pad and an occasional arpeggio.
      if (beat === 0) {
        const root = ROOT_MIDI + [0, 5, 3, 7][bar % 4];
        this.voice('sawtooth', noteFreq(root), when, stepDuration * 15, 0.07, 620, -6);
        this.voice('sawtooth', noteFreq(root + 12), when, stepDuration * 15, 0.05, 800, 6);
      }
      if (beat % 4 === 2) {
        const note = ROOT_MIDI + 24 + SCALE[(step / 2 + bar) % SCALE.length];
        this.voice('triangle', noteFreq(note), when, stepDuration * 2.5, 0.05, 2400);
      }
      if (beat % 8 === 0) this.drum('hat', when, 0.04);
      return;
    }

    // Gameplay: three layers that come in with intensity.
    // Layer 1 (always): kick, bass, hats.
    if (beat % 4 === 0) this.drum('kick', when, 0.34);
    if (beat === 4 || beat === 12) this.drum('snare', when, 0.16 + i * 0.1);
    if (beat % 2 === 0) this.drum('hat', when, 0.03 + i * 0.035);

    const bassNote = ROOT_MIDI + SCALE[[0, 0, 2, 1, 0, 3, 2, 1][bar % 8] % SCALE.length];
    if (beat % 4 === 0 || (i > 0.35 && beat % 4 === 2)) {
      this.voice('sawtooth', noteFreq(bassNote), when, stepDuration * 3, 0.16, 420 + i * 500);
    }

    // Layer 2 (from ~30%): a driving arpeggio.
    if (i > 0.3 && beat % 2 === 1) {
      const idx = (step + bar * 3) % SCALE.length;
      const note = ROOT_MIDI + 24 + SCALE[idx] + (step % 8 >= 4 ? 12 : 0);
      this.voice('square', noteFreq(note), when, stepDuration * 1.6, 0.05 + i * 0.05, 1800 + i * 2600);
    }

    // Layer 3 (from ~65%): a high counter-melody and open hats.
    if (i > 0.65) {
      if (beat % 8 === 6) {
        const note = ROOT_MIDI + 36 + SCALE[(bar + step) % SCALE.length];
        this.voice('triangle', noteFreq(note), when, stepDuration * 5, 0.06, 3800);
      }
      if (beat % 8 === 7) this.drum('hat', when, 0.05);
    }
  }

  /** Stops everything, used when leaving a run. */
  stopAll(): void {
    this.stopMusic();
    if (!this.ctx) return;
    for (const loop of this.ambience.values()) {
      loop.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
    if (this.trainLoop) this.trainLoop.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  dispose(): void {
    this.stopMusic();
    for (const loop of this.ambience.values()) {
      try { loop.source.stop(); } catch { /* already stopped */ }
    }
    this.ambience.clear();
    if (this.trainLoop) {
      try { this.trainLoop.source.stop(); } catch { /* already stopped */ }
      this.trainLoop = null;
    }
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
