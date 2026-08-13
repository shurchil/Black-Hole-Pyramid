/**
 * Tweening and easing.
 *
 * The feel of this game lives almost entirely in these curves. The rule of
 * thumb used throughout: motion *into* the board overshoots (backOut,
 * elasticOut) so it reads as physical and punchy, motion *out* of the board
 * accelerates away (backIn, cubicIn) so it never lingers. Nothing uses linear.
 */

export type EasingFn = (t: number) => number;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

export const Easing = {
  linear: (t: number): number => t,

  quadIn: (t: number): number => t * t,
  quadOut: (t: number): number => 1 - (1 - t) * (1 - t),
  quadInOut: (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),

  cubicIn: (t: number): number => t * t * t,
  cubicOut: (t: number): number => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  quartOut: (t: number): number => 1 - Math.pow(1 - t, 4),
  quintOut: (t: number): number => 1 - Math.pow(1 - t, 5),

  expoOut: (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  expoIn: (t: number): number => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),

  sineInOut: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,

  /** Overshoots then settles. The workhorse for tokens landing on the board. */
  backOut: (t: number): number => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  backIn: (t: number): number => c3 * t * t * t - c1 * t * t,
  backInOut: (t: number): number =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,

  /** Springy. Reserved for celebration moments so it stays special. */
  elasticOut: (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  elasticInOut: (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
  },

  bounceOut: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
} as const;

export type EasingName = keyof typeof Easing;

export interface TweenOptions {
  from: number;
  to: number;
  duration: number;
  delay?: number;
  easing?: EasingFn;
  onUpdate?: (value: number, progress: number) => void;
  onComplete?: () => void;
}

export class Tween {
  private elapsed = 0;
  private started = false;
  done = false;

  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly delay: number;
  readonly easing: EasingFn;

  constructor(private readonly options: TweenOptions) {
    this.from = options.from;
    this.to = options.to;
    this.duration = Math.max(0.0001, options.duration);
    this.delay = options.delay ?? 0;
    this.easing = options.easing ?? Easing.cubicOut;
  }

  /** Advances by `dt` seconds. Returns the current value. */
  update(dt: number): number {
    this.elapsed += dt;
    const active = this.elapsed - this.delay;
    if (active < 0) return this.from;

    if (!this.started) {
      this.started = true;
    }

    const progress = Math.min(1, active / this.duration);
    const eased = this.easing(progress);
    const value = this.from + (this.to - this.from) * eased;
    this.options.onUpdate?.(value, progress);

    if (progress >= 1 && !this.done) {
      this.done = true;
      this.options.onComplete?.();
    }
    return value;
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    this.options.onUpdate?.(this.to, 1);
    this.options.onComplete?.();
  }
}

/** Drives a set of tweens and drops them as they complete. */
export class TweenManager {
  private tweens: Tween[] = [];

  add(options: TweenOptions): Tween {
    const tween = new Tween(options);
    this.tweens.push(tween);
    return tween;
  }

  /** Promise-friendly variant for sequencing animation beats. */
  run(options: TweenOptions): Promise<void> {
    return new Promise((resolve) => {
      this.add({
        ...options,
        onComplete: () => {
          options.onComplete?.();
          resolve();
        },
      });
    });
  }

  update(dt: number): void {
    if (this.tweens.length === 0) return;
    for (const tween of this.tweens) tween.update(dt);
    this.tweens = this.tweens.filter((t) => !t.done);
  }

  /** Snap everything to its end state, e.g. when the player skips ahead. */
  finishAll(): void {
    for (const tween of this.tweens) tween.finish();
    this.tweens = [];
  }

  clear(): void {
    this.tweens = [];
  }

  get active(): number {
    return this.tweens.length;
  }
}

/** Frame-rate independent exponential smoothing toward a target. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Maps `v` from one range to another, clamped. */
export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + (outMax - outMin) * clamp01((v - inMin) / (inMax - inMin));
}
