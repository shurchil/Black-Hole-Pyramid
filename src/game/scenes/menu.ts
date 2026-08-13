/**
 * Main menu: mode selection, difficulty, and the doorway to everything meta.
 *
 * The board keeps rendering behind the menu as a slow idle demo, which is what
 * makes the menu feel like part of the game rather than a settings dialog.
 */

import { audio } from '../../engine/audio';
import { defaultVisual, type CellVisual } from '../../engine/renderer';
import { Easing } from '../../engine/tween';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../../ai/search';
import { createGame, legalPlacements, applyMove } from '../../core/rules';
import type { GameState } from '../../core/types';
import { getCosmetic } from '../../meta/cosmetics';
import { GAUNTLET_GATES, MODE_ORDER, MODES, buildMatch, isoToday, type GameMode } from '../../meta/modes';
import { levelOf, startGauntlet } from '../../meta/profile';
import { button, el, fmt, progressBar } from '../../ui/dom';
import type { App, Scene } from '../app';
import { MatchScene } from './match';
import { CollectionScene } from './collection';
import { SettingsScene } from './settings';

export class MenuScene implements Scene {
  readonly name = 'menu';
  private app!: App;

  /** A self-playing demo board behind the menu. */
  private demo!: GameState;
  private visuals = new Map<number, CellVisual>();
  private time = 0;
  private nextDemoMove = 1.2;

  mount(app: App): void {
    this.app = app;
    this.resetDemo();
    this.build();
    audio.startMusic();
  }

  unmount(): void {
    audio.stopMusic();
  }

  private resetDemo(): void {
    this.demo = createGame({ alternatingStart: true });
    this.visuals = new Map();
    for (let i = 0; i < this.demo.board.length; i++) this.visuals.set(i, defaultVisual());
    this.nextDemoMove = 1.2;
  }

  /* ---------------------------------------------------------------- *
   * Layout
   * ---------------------------------------------------------------- */

  private build(): void {
    const profile = this.app.profile;
    const level = levelOf(profile);
    const bar = progressBar(level.progress);

    const header = el(
      'header',
      { class: 'menu-header' },
      el(
        'div',
        { class: 'identity' },
        el('span', { class: 'level-badge', text: `Lv ${level.level}` }),
        el(
          'div',
          { class: 'identity-text' },
          el('span', { class: 'player-title', text: titleOf(profile.equipped.title) }),
          bar.root,
        ),
      ),
      el(
        'div',
        { class: 'currency' },
        el('span', { class: 'dust-icon' }),
        el('span', { text: fmt(profile.stardust) }),
      ),
    );

    const title = el(
      'div',
      { class: 'brand' },
      el('h1', { class: 'brand-title', text: 'BLACK HOLE' }),
      el('h2', { class: 'brand-sub', text: 'PYRAMID' }),
    );

    const modes = el('div', { class: 'mode-grid' });
    for (const mode of MODE_ORDER) {
      modes.appendChild(this.modeCard(mode));
    }

    const footer = el(
      'nav',
      { class: 'menu-footer' },
      button('Collection', () => this.open(new CollectionScene())),
      button('Settings', () => this.open(new SettingsScene())),
    );

    this.app.overlay.appendChild(
      el('div', { class: 'menu' }, header, title, this.difficultyRow(), modes, footer),
    );
  }

  private difficultyRow(): HTMLElement {
    const row = el('div', { class: 'difficulty-row', attrs: { role: 'radiogroup', 'aria-label': 'Opponent difficulty' } });

    const render = () => {
      row.replaceChildren(
        el('span', { class: 'difficulty-label', text: 'Opponent' }),
        ...DIFFICULTY_ORDER.map((id) => {
          const config = DIFFICULTIES[id];
          const selected = this.app.profile.settings.preferredDifficulty === id;
          return el('button', {
            class: `difficulty-pill ${selected ? 'is-selected' : ''}`.trim(),
            text: config.name,
            attrs: {
              type: 'button',
              role: 'radio',
              'aria-checked': selected,
              title: config.blurb,
            },
            on: {
              click: () => {
                audio.play('click');
                this.app.saveProfile({
                  ...this.app.profile,
                  settings: { ...this.app.profile.settings, preferredDifficulty: id },
                });
                render();
              },
            },
          });
        }),
      );
    };
    render();
    return row;
  }

  private modeCard(mode: GameMode): HTMLElement {
    const def = MODES[mode];
    const profile = this.app.profile;
    const level = levelOf(profile).level;
    const locked = level < def.requiredLevel;

    const dailyDone = mode === 'daily' && profile.daily.date === isoToday() && profile.daily.played;
    const gauntletActive = mode === 'gauntlet' && profile.gauntlet !== null;

    let status = '';
    if (locked) status = `Unlocks at level ${def.requiredLevel}`;
    else if (dailyDone) status = `Played today — ${profile.daily.result ?? ''}`;
    else if (gauntletActive) status = `Run in progress — gate ${profile.gauntlet!.depth}/${GAUNTLET_GATES}`;

    const disabled = locked || dailyDone;

    return el(
      'button',
      {
        class: `mode-card ${locked ? 'is-locked' : ''} ${disabled ? 'is-disabled' : ''}`.trim(),
        attrs: {
          type: 'button',
          disabled,
          'aria-label': `${def.name}. ${def.description}${status ? ` ${status}` : ''}`,
        },
        on: { click: () => this.startMode(mode) },
      },
      el('span', { class: `mode-glyph glyph-${def.glyph}` }),
      el(
        'span',
        { class: 'mode-text' },
        el('span', { class: 'mode-name', text: def.name }),
        el('span', { class: 'mode-tagline', text: def.tagline }),
        status ? el('span', { class: 'mode-status', text: status }) : null,
      ),
    );
  }

  /* ---------------------------------------------------------------- *
   * Navigation
   * ---------------------------------------------------------------- */

  private open(scene: Scene): void {
    audio.play('click');
    void this.app.go(scene);
  }

  private startMode(mode: GameMode): void {
    audio.play('click');
    audio.unlock();

    let profile = this.app.profile;
    let gauntletDepth: number | undefined;
    let seed: number | undefined;

    if (mode === 'gauntlet') {
      if (!profile.gauntlet) {
        profile = startGauntlet(profile, Math.floor(Math.random() * 0xffffffff));
        this.app.saveProfile(profile);
      }
      gauntletDepth = profile.gauntlet!.depth;
      seed = profile.gauntlet!.seed + gauntletDepth * 7919;
    }

    const setup = buildMatch({
      mode,
      difficulty: this.difficultyFor(mode),
      loadout: profile.loadout,
      gauntletDepth,
      seed,
    });

    void this.app.go(new MatchScene(setup));
  }

  private difficultyFor(mode: GameMode): Difficulty {
    // Gauntlet and Daily set their own opponent; everything else follows the
    // player's chosen difficulty.
    if (mode === 'gauntlet' || mode === 'daily') return this.app.profile.settings.preferredDifficulty;
    if (mode === 'tutorial') return 'rookie';
    return this.app.profile.settings.preferredDifficulty;
  }

  /* ---------------------------------------------------------------- *
   * Idle demo
   * ---------------------------------------------------------------- */

  update(dt: number): void {
    this.time += dt;
    this.nextDemoMove -= dt;

    if (this.nextDemoMove <= 0) {
      this.nextDemoMove = 0.85;
      if (this.demo.isFinished) {
        this.resetDemo();
      } else {
        const options = legalPlacements(this.demo);
        const cell = options[Math.floor(Math.random() * options.length)];
        const visual = this.visuals.get(cell)!;
        this.demo = applyMove(this.demo, { kind: 'place', cell });
        if (this.app.motion === 0) {
          visual.drop = 1;
        } else {
          this.app.tweens.add({
            from: 0,
            to: 1,
            duration: 0.3,
            easing: Easing.backOut,
            onUpdate: (v) => {
              visual.drop = v;
            },
          });
        }
      }
    }
  }

  render(): void {
    const { renderer, width, height, dpr } = this.app;
    const ctx = renderer.ctx;

    const options = {
      state: this.demo,
      theme: this.app.theme(),
      holeSkin: this.app.holeSkin(),
      skinFor: (player: 'P1' | 'P2') =>
        player === 'P1' ? this.app.tokenSkin() : { ...this.app.tokenSkin(), core: '#ff3d71', edge: '#ffb3c9', glow: '#ff5c8a' },
      visuals: this.visuals,
      hoverCell: null,
      legalCells: [],
      foresight: null,
      revealedHole: null,
      holeReveal: 0,
      time: this.time,
      motion: this.app.motion,
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderer.drawBackground(options.theme, width, height, this.time, options.motion);

    // The demo board sits behind the menu, dimmed so text stays readable.
    ctx.save();
    ctx.globalAlpha = 0.2;
    renderer.drawBoard(options);
    ctx.restore();

    this.app.particles.render(ctx);
  }
}

function titleOf(id: string): string {
  const cosmetic = getCosmetic(id);
  return cosmetic?.kind === 'title' ? cosmetic.text : 'Cadet';
}
