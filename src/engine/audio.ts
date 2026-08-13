/**
 * Procedural audio.
 *
 * Every sound is synthesised at runtime with WebAudio — there is not a single
 * audio file in this project. That keeps the download tiny (a real constraint
 * on mobile), makes skins able to re-tune the game's voice as data, and lets
 * the placement sound rise in pitch with the number being played, which does
 * more for game feel than any sample could.
 */

export type SfxName =
  | 'place'
  | 'hover'
  | 'reject'
  | 'charge'
  | 'blackhole'
  | 'devour'
  | 'win'
  | 'lose'
  | 'draw'
  | 'levelup'
  | 'unlock'
  | 'click'
  | 'tick'
  | 'warn';

export interface AudioSettings {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicTimer: number | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private unlocked = false;

  settings: AudioSettings = { sfxVolume: 0.7, musicVolume: 0.35, muted: false };

  /**
   * Browsers require a user gesture before audio may start, so this is called
   * from the first tap rather than at load.
   */
  unlock(): void {
    if (this.unlocked) return;
    try {
      const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.settings.sfxVolume;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.settings.musicVolume;
      this.musicBus.connect(this.master);

      this.noiseBuffer = this.createNoiseBuffer();
      this.unlocked = true;
    } catch {
      this.ctx = null;
    }
    void this.ctx?.resume();
  }

  applySettings(settings: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (this.master) this.master.gain.value = this.settings.muted ? 0 : 1;
    if (this.sfxBus) this.sfxBus.gain.value = this.settings.sfxVolume;
    if (this.musicBus) this.musicBus.gain.value = this.settings.musicVolume;
  }

  private createNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** One synth voice: oscillator -> optional filter -> envelope -> bus. */
  private tone(options: {
    freq: number;
    endFreq?: number;
    type?: OscillatorType;
    duration: number;
    attack?: number;
    gain?: number;
    delay?: number;
    filter?: { type: BiquadFilterType; freq: number; endFreq?: number; q?: number };
    bus?: GainNode | null;
  }): void {
    if (!this.ctx || !this.sfxBus) return;
    const {
      freq,
      endFreq,
      type = 'sine',
      duration,
      attack = 0.005,
      gain = 0.3,
      delay = 0,
      filter,
      bus = this.sfxBus,
    } = options;

    const t0 = this.now() + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    let node: AudioNode = osc;
    if (filter) {
      const biquad = this.ctx.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.setValueAtTime(filter.freq, t0);
      if (filter.endFreq !== undefined) {
        biquad.frequency.exponentialRampToValueAtTime(Math.max(1, filter.endFreq), t0 + duration);
      }
      biquad.Q.value = filter.q ?? 1;
      node.connect(biquad);
      node = biquad;
    }
    node.connect(env);
    env.connect(bus ?? this.sfxBus);

    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Filtered noise burst: the percussive half of most of these sounds. */
  private noise(options: {
    duration: number;
    gain?: number;
    delay?: number;
    filterFreq?: number;
    endFilterFreq?: number;
    type?: BiquadFilterType;
    q?: number;
  }): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    const { duration, gain = 0.2, delay = 0, filterFreq = 1200, endFilterFreq, type = 'bandpass', q = 1 } = options;
    const t0 = this.now() + delay;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const biquad = this.ctx.createBiquadFilter();
    biquad.type = type;
    biquad.frequency.setValueAtTime(filterFreq, t0);
    if (endFilterFreq !== undefined) {
      biquad.frequency.exponentialRampToValueAtTime(Math.max(1, endFilterFreq), t0 + duration);
    }
    biquad.Q.value = q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(biquad);
    biquad.connect(env);
    env.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  /**
   * @param value For 'place', the number being played (1-10). The pitch climbs
   * with it, so the board sounds like it is filling up as the stakes rise.
   */
  play(name: SfxName, value = 0): void {
    if (!this.unlocked) this.unlock();
    if (!this.ctx || this.settings.muted) return;
    void this.ctx.resume();

    switch (name) {
      case 'place': {
        const step = PENTATONIC[Math.min(PENTATONIC.length - 1, Math.max(0, value - 1))];
        const freq = 220 * Math.pow(2, step / 12);
        this.tone({ freq, endFreq: freq * 1.5, type: 'triangle', duration: 0.18, gain: 0.28 });
        this.tone({ freq: freq * 2, type: 'sine', duration: 0.1, gain: 0.12, delay: 0.01 });
        this.noise({ duration: 0.07, gain: 0.1, filterFreq: 2600, endFilterFreq: 700 });
        break;
      }
      case 'hover':
        this.tone({ freq: 880, type: 'sine', duration: 0.05, gain: 0.05 });
        break;
      case 'click':
        this.tone({ freq: 520, endFreq: 700, type: 'square', duration: 0.06, gain: 0.09 });
        break;
      case 'reject':
        this.tone({ freq: 180, endFreq: 90, type: 'sawtooth', duration: 0.18, gain: 0.16 });
        this.noise({ duration: 0.12, gain: 0.09, filterFreq: 400, type: 'lowpass' });
        break;
      case 'charge':
        this.tone({ freq: 160, endFreq: 900, type: 'sawtooth', duration: 0.4, gain: 0.16, filter: { type: 'lowpass', freq: 400, endFreq: 4000, q: 6 } });
        this.tone({ freq: 1320, type: 'sine', duration: 0.25, gain: 0.1, delay: 0.28 });
        break;
      case 'warn':
        this.tone({ freq: 660, type: 'square', duration: 0.08, gain: 0.1 });
        this.tone({ freq: 660, type: 'square', duration: 0.08, gain: 0.1, delay: 0.14 });
        break;
      case 'tick':
        this.tone({ freq: 1200, type: 'sine', duration: 0.03, gain: 0.06 });
        break;
      case 'blackhole':
        // Deep descending sweep plus rising noise: collapse, then event horizon.
        this.tone({ freq: 220, endFreq: 28, type: 'sawtooth', duration: 1.6, gain: 0.3, filter: { type: 'lowpass', freq: 1800, endFreq: 120, q: 8 } });
        this.tone({ freq: 110, endFreq: 20, type: 'sine', duration: 1.8, gain: 0.34 });
        this.noise({ duration: 1.4, gain: 0.16, filterFreq: 200, endFilterFreq: 3800, type: 'bandpass', q: 2 });
        break;
      case 'devour':
        this.tone({ freq: 400 + value * 40, endFreq: 60, type: 'triangle', duration: 0.3, gain: 0.16 });
        break;
      case 'win':
        [0, 4, 7, 12].forEach((semi, i) => {
          this.tone({ freq: 330 * Math.pow(2, semi / 12), type: 'triangle', duration: 0.5, gain: 0.2, delay: i * 0.085 });
        });
        break;
      case 'lose':
        [0, -3, -7].forEach((semi, i) => {
          this.tone({ freq: 300 * Math.pow(2, semi / 12), type: 'sine', duration: 0.6, gain: 0.18, delay: i * 0.13 });
        });
        break;
      case 'draw':
        [0, 5].forEach((semi, i) => {
          this.tone({ freq: 320 * Math.pow(2, semi / 12), type: 'triangle', duration: 0.45, gain: 0.16, delay: i * 0.12 });
        });
        break;
      case 'levelup':
        [0, 4, 7, 11, 14].forEach((semi, i) => {
          this.tone({ freq: 440 * Math.pow(2, semi / 12), type: 'sine', duration: 0.4, gain: 0.16, delay: i * 0.06 });
        });
        break;
      case 'unlock':
        this.tone({ freq: 700, endFreq: 1400, type: 'sine', duration: 0.3, gain: 0.16 });
        this.noise({ duration: 0.3, gain: 0.06, filterFreq: 3000, endFilterFreq: 6000 });
        break;
    }
  }

  /**
   * Generative ambient bed: a slow drone plus sparse pentatonic pings, so it
   * never loops audibly and costs nothing to ship.
   */
  startMusic(): void {
    if (!this.ctx || !this.musicBus || this.musicTimer !== null) return;

    const drone = (freq: number, gain: number) => {
      if (!this.ctx || !this.musicBus) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.05;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = gain * 0.5;
      const env = this.ctx.createGain();
      env.gain.value = gain;
      lfo.connect(lfoGain);
      lfoGain.connect(env.gain);
      osc.connect(env);
      env.connect(this.musicBus);
      osc.start();
      lfo.start();
    };

    drone(55, 0.06);
    drone(82.5, 0.04);
    drone(110, 0.03);

    const ping = () => {
      if (!this.ctx || !this.musicBus) return;
      const semi = PENTATONIC[(Math.random() * PENTATONIC.length) | 0];
      this.tone({
        freq: 220 * Math.pow(2, semi / 12) * (Math.random() < 0.3 ? 2 : 1),
        type: 'sine',
        duration: 2.2,
        attack: 0.4,
        gain: 0.05,
        bus: this.musicBus,
      });
      this.musicTimer = window.setTimeout(ping, 1800 + Math.random() * 4200);
    };
    this.musicTimer = window.setTimeout(ping, 1200);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }
}

export const audio = new AudioEngine();
