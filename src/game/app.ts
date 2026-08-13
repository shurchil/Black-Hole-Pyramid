/**
 * Application shell: owns the persistent services (profile, audio, AI) and
 * runs a single requestAnimationFrame loop that the active scene ticks off.
 *
 * There is exactly one loop and one canvas for the whole app. Scenes come and
 * go; the loop does not, which avoids the classic bug where two scenes overlap
 * for a frame and both drive the same canvas.
 */

import { AiClient } from '../ai/api';
import { audio } from '../engine/audio';
import { haptics } from '../engine/haptics';
import { BoardRenderer } from '../engine/renderer';
import { ParticleSystem } from '../engine/particles';
import { Camera } from '../engine/camera';
import { TweenManager } from '../engine/tween';
import { getCosmetic, type BoardTheme, type HoleSkin, type TokenSkin, type TrailSkin } from '../meta/cosmetics';
import { BOARD_THEMES, HOLE_SKINS, TOKEN_SKINS, TRAIL_SKINS } from '../meta/cosmetics';
import { loadProfile, saveProfile, type Profile } from '../meta/profile';
import { storage } from '../platform/storage';
import { clear, el, toast } from '../ui/dom';

export interface Scene {
  readonly name: string;
  mount(app: App): void | Promise<void>;
  unmount(): void;
  /** Called once per frame with the delta in seconds. */
  update?(dt: number): void;
  /** Called after update; scenes that do not draw can omit it. */
  render?(): void;
  /** Viewport changed. */
  resize?(width: number, height: number): void;
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLElement;
  readonly toasts: HTMLElement;
  readonly renderer: BoardRenderer;
  readonly particles = new ParticleSystem(700);
  readonly camera = new Camera();
  readonly tweens = new TweenManager();
  readonly ai = new AiClient();

  profile: Profile;

  private scene: Scene | null = null;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  width = 0;
  height = 0;
  dpr = 1;

  constructor(private readonly root: HTMLElement) {
    this.canvas = el('canvas', { class: 'board-canvas', attrs: { 'aria-hidden': 'true' } });
    this.overlay = el('div', { class: 'overlay' });
    this.toasts = el('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });

    this.root.appendChild(this.canvas);
    this.root.appendChild(this.overlay);
    this.root.appendChild(this.toasts);

    this.renderer = new BoardRenderer(this.canvas);
    this.profile = loadProfile();
    this.applySettings();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    this.resize();
  }

  /* ---------------------------------------------------------------- *
   * Settings and cosmetics
   * ---------------------------------------------------------------- */

  applySettings(): void {
    const s = this.profile.settings;
    audio.applySettings({ sfxVolume: s.sfxVolume, musicVolume: s.musicVolume, muted: s.muted });
    haptics.enabled = s.haptics;
    // Reduced motion scales every animation to a still, readable minimum
    // rather than disabling feedback entirely.
    this.camera.intensity = s.reducedMotion ? 0 : 1;
    document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
  }

  get motion(): number {
    return this.profile.settings.reducedMotion ? 0 : 1;
  }

  saveProfile(next?: Profile): void {
    if (next) this.profile = next;
    saveProfile(this.profile);
  }

  theme(): BoardTheme {
    return (getCosmetic(this.profile.equipped.board) as BoardTheme) ?? BOARD_THEMES[0];
  }

  tokenSkin(): TokenSkin {
    return (getCosmetic(this.profile.equipped.token) as TokenSkin) ?? TOKEN_SKINS[0];
  }

  holeSkin(): HoleSkin {
    return (getCosmetic(this.profile.equipped.hole) as HoleSkin) ?? HOLE_SKINS[0];
  }

  trailSkin(): TrailSkin {
    return (getCosmetic(this.profile.equipped.trail) as TrailSkin) ?? TRAIL_SKINS[0];
  }

  /* ---------------------------------------------------------------- *
   * Scene management
   * ---------------------------------------------------------------- */

  async go(scene: Scene): Promise<void> {
    if (this.scene) {
      this.scene.unmount();
      clear(this.overlay);
    }
    // A scene inherits a clean stage: no leftover tweens, particles or shake.
    this.tweens.clear();
    this.particles.clear();
    this.camera.reset();

    this.scene = scene;
    await scene.mount(this);
    scene.resize?.(this.width, this.height);
    this.start();
  }

  notify(message: string, variant: 'info' | 'good' | 'bad' = 'info'): void {
    toast(this.toasts, message, variant);
  }

  /* ---------------------------------------------------------------- *
   * The loop
   * ---------------------------------------------------------------- */

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      // Clamped so a backgrounded tab does not resume with a huge dt that
      // teleports every animation to its end state.
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;

      this.tweens.update(dt);
      this.particles.update(dt);
      this.camera.update(dt);
      this.scene?.update?.(dt);
      this.scene?.render?.();

      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  resize(): void {
    const rect = this.root.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    // Cap DPR: beyond 2x the extra pixels cost real frame time on phones and
    // buy nothing the eye can see at arm's length.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(this.width, this.height, this.dpr);
    this.scene?.resize?.(this.width, this.height);
  }

  dispose(): void {
    this.stop();
    this.ai.dispose();
    storage.flush();
  }
}
