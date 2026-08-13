/**
 * Camera shake, kick and zoom.
 *
 * Shake is trauma-based (Squirrel Eiserloh's model): callers add "trauma",
 * which decays, and the offset scales with trauma squared. That makes small
 * impacts subtle and large ones violent without any per-call tuning, and it
 * composes correctly when several impacts land in the same frame.
 */

import { clamp01, damp } from './tween';

export class Camera {
  private trauma = 0;
  private time = 0;

  /** Current shake offset, refreshed every update. */
  offsetX = 0;
  offsetY = 0;
  rotation = 0;

  /** Multiplicative zoom, springs back to 1. */
  zoom = 1;
  private zoomTarget = 1;

  /** Directional kick, e.g. the board recoiling from a heavy landing. */
  private kickX = 0;
  private kickY = 0;

  /** Global scale on all motion, driven by the reduced-motion setting. */
  intensity = 1;

  maxOffset = 26;
  maxRotation = 0.035;

  addTrauma(amount: number): void {
    this.trauma = clamp01(this.trauma + amount * this.intensity);
  }

  kick(x: number, y: number): void {
    this.kickX += x * this.intensity;
    this.kickY += y * this.intensity;
  }

  punchZoom(amount: number): void {
    this.zoomTarget = 1 + amount * this.intensity;
  }

  update(dt: number): void {
    this.time += dt;

    // Trauma decays fast so shakes stay punchy rather than wobbly.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma;

    // Sampled sine noise at different frequencies reads smoother than random
    // per-frame jitter, which strobes at high frame rates.
    const t = this.time;
    this.offsetX = this.maxOffset * shake * (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 31.1) * 0.4);
    this.offsetY = this.maxOffset * shake * (Math.sin(t * 41.7) * 0.6 + Math.sin(t * 27.9) * 0.4);
    this.rotation = this.maxRotation * shake * Math.sin(t * 37.5);

    this.kickX = damp(this.kickX, 0, 9, dt);
    this.kickY = damp(this.kickY, 0, 9, dt);
    this.offsetX += this.kickX;
    this.offsetY += this.kickY;

    this.zoomTarget = damp(this.zoomTarget, 1, 6, dt);
    this.zoom = damp(this.zoom, this.zoomTarget, 14, dt);
  }

  /** Applies the camera transform around a pivot. Pair with ctx.restore(). */
  apply(ctx: CanvasRenderingContext2D, pivotX: number, pivotY: number): void {
    ctx.save();
    ctx.translate(pivotX + this.offsetX, pivotY + this.offsetY);
    if (this.rotation !== 0) ctx.rotate(this.rotation);
    if (this.zoom !== 1) ctx.scale(this.zoom, this.zoom);
    ctx.translate(-pivotX, -pivotY);
  }

  reset(): void {
    this.trauma = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.rotation = 0;
    this.kickX = 0;
    this.kickY = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
  }
}
