/**
 * Settings, including the accessibility options.
 *
 * Reduced motion is a first-class setting rather than an afterthought: this
 * game leans hard on shake, overshoot and particles, all of which can be
 * genuinely unpleasant for motion-sensitive players. Turning it on keeps every
 * piece of *information* (where a token landed, what the hole ate) and removes
 * only the motion used to dramatise it.
 */

import { audio } from '../../engine/audio';
import { haptics } from '../../engine/haptics';
import { steam } from '../../platform/steam';
import { resetProfile, updateSettings, type Settings } from '../../meta/profile';
import { button, el } from '../../ui/dom';
import type { App, Scene } from '../app';
import { MenuScene } from './menu';

export class SettingsScene implements Scene {
  readonly name = 'settings';
  private app!: App;

  mount(app: App): void {
    this.app = app;
    this.build();
  }

  unmount(): void {
    /* overlay cleared by the app */
  }

  private set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.app.saveProfile(updateSettings(this.app.profile, { [key]: value } as Partial<Settings>));
    this.app.applySettings();
  }

  private build(): void {
    const s = () => this.app.profile.settings;

    const slider = (
      label: string,
      key: 'sfxVolume' | 'musicVolume',
      onInput?: () => void,
    ): HTMLElement => {
      const input = el('input', {
        class: 'slider',
        attrs: {
          type: 'range',
          min: 0,
          max: 100,
          value: Math.round(s()[key] * 100),
          'aria-label': label,
        },
        on: {
          input: (event) => {
            const value = Number((event.target as HTMLInputElement).value) / 100;
            this.set(key, value);
            onInput?.();
          },
        },
      });
      return el('label', { class: 'setting-row' }, el('span', { text: label }), input);
    };

    const toggle = (label: string, key: keyof Settings, hint?: string): HTMLElement => {
      const input = el('input', {
        attrs: { type: 'checkbox', checked: Boolean(s()[key]), 'aria-label': label },
        on: {
          change: (event) => {
            const checked = (event.target as HTMLInputElement).checked;
            this.set(key, checked as never);
            audio.play('click');
            if (key === 'haptics' && checked) haptics.fire('light');
          },
        },
      });
      return el(
        'label',
        { class: 'setting-row' },
        el('span', {}, label, hint ? el('small', { class: 'setting-hint', text: hint }) : null),
        el('span', { class: 'switch' }, input, el('span', { class: 'switch-track' })),
      );
    };

    const panel = el(
      'div',
      { class: 'settings panel' },
      el(
        'header',
        { class: 'collection-header' },
        button('‹', () => this.back(), { class: 'btn-icon' }),
        el('h1', { text: 'Settings' }),
      ),

      el('h2', { class: 'section-title', text: 'Audio' }),
      slider('Sound effects', 'sfxVolume', () => audio.play('click')),
      slider('Music', 'musicVolume'),
      toggle('Mute everything', 'muted'),

      el('h2', { class: 'section-title', text: 'Feel' }),
      toggle('Haptics', 'haptics', 'Vibration on placement and impact'),
      toggle('Reduced motion', 'reducedMotion', 'Removes shake, overshoot and particles'),
      toggle('Show hints', 'showHints', 'Highlights the cells you can play'),

      el('h2', { class: 'section-title', text: 'Data' }),
      el('p', {
        class: 'section-note',
        text: 'Progress is stored on this device. Resetting cannot be undone.',
      }),
      button('Reset all progress', () => this.confirmReset(), { class: 'btn-danger' }),

      el('p', {
        class: 'about',
        text: steam.available
          ? `Black Hole Pyramid · Steam build${steam.playerName() ? ` · ${steam.playerName()}` : ''}`
          : 'Black Hole Pyramid',
      }),
    );

    this.app.overlay.appendChild(panel);
  }

  private confirmReset(): void {
    audio.play('warn');
    const panel = el(
      'div',
      { class: 'modal' },
      el(
        'div',
        { class: 'modal-card' },
        el('h2', { text: 'Reset everything?' }),
        el('p', {
          text: 'Your level, stardust, unlocked cosmetics, achievements and stats will all be erased.',
        }),
        el(
          'div',
          { class: 'modal-actions' },
          button('Cancel', () => panel.remove()),
          button('Reset', () => {
            this.app.profile = resetProfile();
            this.app.applySettings();
            panel.remove();
            this.app.notify('Progress reset', 'info');
            void this.app.go(new MenuScene());
          }, { class: 'btn-danger' }),
        ),
      ),
    );
    this.app.overlay.appendChild(panel);
  }

  private back(): void {
    audio.play('click');
    void this.app.go(new MenuScene());
  }

  render(): void {
    // Keep the starfield alive behind the settings panel.
    const { renderer, width, height, dpr } = this.app;
    const ctx = renderer.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderer.drawBackground(this.app.theme(), width, height, performance.now() / 1000, this.app.motion);
  }
}
