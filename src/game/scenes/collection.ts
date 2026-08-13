/**
 * Collection: cosmetics, the stardust shop, the charge loadout, quests,
 * achievements and lifetime stats — the whole long-term motivation surface.
 *
 * Every cosmetic card previews itself by drawing the real thing on a small
 * canvas using the same renderer primitives the board uses, so what you see in
 * the shop is exactly what you get in a match.
 */

import { audio } from '../../engine/audio';
import { haptics } from '../../engine/haptics';
import { shade } from '../../engine/renderer';
import { ALL_CHARGES, CHARGES, CHARGE_LOADOUT_SIZE } from '../../core/charges';
import type { ChargeKind } from '../../core/types';
import {
  RARITY_COLORS,
  cosmeticsOfKind,
  priceOf,
  type Cosmetic,
  type CosmeticKind,
  type HoleSkin,
  type TokenSkin,
} from '../../meta/cosmetics';
import { ACHIEVEMENTS } from '../../meta/achievements';
import { QUESTS, isQuestComplete } from '../../meta/quests';
import { equip, isUnlocked, levelOf, purchase, setLoadout } from '../../meta/profile';
import { button, clear, el, fmt, progressBar } from '../../ui/dom';
import type { App, Scene } from '../app';
import { MenuScene } from './menu';

type Tab = 'skins' | 'loadout' | 'quests' | 'achievements' | 'stats';

const COSMETIC_TABS: Array<{ kind: CosmeticKind; label: string }> = [
  { kind: 'board', label: 'Boards' },
  { kind: 'token', label: 'Tokens' },
  { kind: 'hole', label: 'Black holes' },
  { kind: 'trail', label: 'Trails' },
  { kind: 'title', label: 'Titles' },
];

export class CollectionScene implements Scene {
  readonly name = 'collection';
  private app!: App;
  private tab: Tab = 'skins';
  private cosmeticKind: CosmeticKind = 'board';
  private body!: HTMLElement;
  private dustLabel!: HTMLElement;

  mount(app: App): void {
    this.app = app;
    this.build();
  }

  unmount(): void {
    /* overlay cleared by the app */
  }

  private build(): void {
    this.body = el('div', { class: 'collection-body' });
    this.dustLabel = el('span', { text: fmt(this.app.profile.stardust) });

    const tabs = el(
      'nav',
      { class: 'tabs', attrs: { role: 'tablist' } },
      ...(
        [
          ['skins', 'Cosmetics'],
          ['loadout', 'Charges'],
          ['quests', 'Quests'],
          ['achievements', 'Achievements'],
          ['stats', 'Stats'],
        ] as Array<[Tab, string]>
      ).map(([id, label]) =>
        el('button', {
          class: `tab ${this.tab === id ? 'is-active' : ''}`.trim(),
          text: label,
          attrs: { type: 'button', role: 'tab', 'aria-selected': this.tab === id },
          on: {
            click: () => {
              audio.play('click');
              this.tab = id;
              this.refreshTabs(tabs);
              this.renderBody();
            },
          },
        }),
      ),
    );

    this.app.overlay.appendChild(
      el(
        'div',
        { class: 'collection' },
        el(
          'header',
          { class: 'collection-header' },
          button('‹', () => this.back(), { class: 'btn-icon' }),
          el('h1', { text: 'Collection' }),
          el('div', { class: 'currency' }, el('span', { class: 'dust-icon' }), this.dustLabel),
        ),
        tabs,
        this.body,
      ),
    );

    this.renderBody();
  }

  private refreshTabs(tabs: HTMLElement): void {
    const ids: Tab[] = ['skins', 'loadout', 'quests', 'achievements', 'stats'];
    tabs.querySelectorAll('.tab').forEach((node, index) => {
      const active = ids[index] === this.tab;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-selected', String(active));
    });
  }

  private back(): void {
    audio.play('click');
    void this.app.go(new MenuScene());
  }

  private renderBody(): void {
    clear(this.body);
    switch (this.tab) {
      case 'skins':
        this.renderCosmetics();
        break;
      case 'loadout':
        this.renderLoadout();
        break;
      case 'quests':
        this.renderQuests();
        break;
      case 'achievements':
        this.renderAchievements();
        break;
      case 'stats':
        this.renderStats();
        break;
    }
  }

  /* ---------------------------------------------------------------- *
   * Cosmetics
   * ---------------------------------------------------------------- */

  private renderCosmetics(): void {
    const kindRow = el(
      'div',
      { class: 'kind-row' },
      ...COSMETIC_TABS.map(({ kind, label }) =>
        el('button', {
          class: `kind-pill ${this.cosmeticKind === kind ? 'is-selected' : ''}`.trim(),
          text: label,
          attrs: { type: 'button' },
          on: {
            click: () => {
              audio.play('click');
              this.cosmeticKind = kind;
              this.renderBody();
            },
          },
        }),
      ),
    );

    const grid = el('div', { class: 'cosmetic-grid' });
    for (const cosmetic of cosmeticsOfKind(this.cosmeticKind)) {
      grid.appendChild(this.cosmeticCard(cosmetic));
    }

    this.body.append(kindRow, grid);
  }

  private cosmeticCard(cosmetic: Cosmetic): HTMLElement {
    const profile = this.app.profile;
    const owned = isUnlocked(cosmetic, profile);
    const equipped = profile.equipped[cosmetic.kind] === cosmetic.id;
    const buyable = !owned && cosmetic.unlock.kind === 'shop';
    const cost = priceOf(cosmetic);

    const action = owned
      ? equipped
        ? el('span', { class: 'card-action is-equipped', text: 'Equipped' })
        : button('Equip', () => this.equip(cosmetic), { class: 'btn-small' })
      : buyable
        ? button(`${fmt(cost)}`, () => this.buy(cosmetic), {
            class: `btn-small btn-buy ${profile.stardust < cost ? 'is-poor' : ''}`.trim(),
          })
        : el('span', { class: 'card-action is-locked', text: lockLabel(cosmetic) });

    return el(
      'div',
      {
        class: `cosmetic-card rarity-${cosmetic.rarity} ${owned ? '' : 'is-locked'} ${equipped ? 'is-equipped' : ''}`.trim(),
        style: { '--rarity': RARITY_COLORS[cosmetic.rarity] } as Partial<CSSStyleDeclaration>,
      },
      this.preview(cosmetic),
      el(
        'div',
        { class: 'card-text' },
        el('span', { class: 'card-name', text: cosmetic.name }),
        el('span', { class: 'card-rarity', text: cosmetic.rarity }),
        el('span', { class: 'card-desc', text: cosmetic.description }),
      ),
      action,
    );
  }

  /**
   * Draws a live preview using the same primitives as the board. Cards are
   * small, so this is a hand-rolled miniature rather than a full BoardRenderer.
   */
  private preview(cosmetic: Cosmetic): HTMLElement {
    const size = 72;
    const canvas = el('canvas', { class: 'card-preview' });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.scale(dpr, dpr);
    const c = size / 2;

    switch (cosmetic.kind) {
      case 'board': {
        const g = ctx.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, cosmetic.bgTop);
        g.addColorStop(1, cosmetic.bgBottom);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = cosmetic.nebula[0];
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(size * 0.68, size * 0.32, size * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        // A miniature three-row pyramid in the theme's own cell colours.
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col <= row; col++) {
            const x = c + (col - row / 2) * 15;
            const y = size * 0.32 + row * 14;
            ctx.beginPath();
            ctx.arc(x, y, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = cosmetic.cellFill;
            ctx.fill();
            ctx.strokeStyle = cosmetic.cellStroke;
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }
        break;
      }
      case 'token':
        drawTokenPreview(ctx, cosmetic, c, c, 22);
        break;
      case 'hole':
        drawHolePreview(ctx, cosmetic, c, c, 18);
        break;
      case 'trail':
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const r = 10 + (i % 4) * 6;
          ctx.fillStyle = cosmetic.colors[i % cosmetic.colors.length];
          ctx.beginPath();
          ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 3 - (i % 3) * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'title':
        ctx.fillStyle = RARITY_COLORS[cosmetic.rarity];
        ctx.font = '600 12px "Rajdhani", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        wrapText(ctx, cosmetic.text.toUpperCase(), c, c, size - 8, 14);
        break;
    }
    return canvas;
  }

  private equip(cosmetic: Cosmetic): void {
    audio.play('click');
    haptics.fire('light');
    this.app.saveProfile(equip(this.app.profile, cosmetic.id));
    this.renderBody();
  }

  private buy(cosmetic: Cosmetic): void {
    const result = purchase(this.app.profile, cosmetic.id);
    if (!result.ok) {
      audio.play('reject');
      haptics.fire('warning');
      this.app.notify(
        result.reason === 'insufficient' ? 'Not enough stardust' : 'Unavailable',
        'bad',
      );
      return;
    }
    audio.play('unlock');
    haptics.fire('success');
    // Buying equips immediately: nobody wants a second click to use the thing
    // they just paid for.
    this.app.saveProfile(equip(result.profile, cosmetic.id));
    this.dustLabel.textContent = fmt(this.app.profile.stardust);
    this.app.notify(`${cosmetic.name} unlocked`, 'good');
    this.renderBody();
  }

  /* ---------------------------------------------------------------- *
   * Loadout
   * ---------------------------------------------------------------- */

  private renderLoadout(): void {
    const profile = this.app.profile;
    const chosen = new Set(profile.loadout);

    const grid = el(
      'div',
      { class: 'charge-grid' },
      ...ALL_CHARGES.map((kind) => {
        const def = CHARGES[kind];
        const selected = chosen.has(kind);
        return el(
          'button',
          {
            class: `charge-card ${selected ? 'is-selected' : ''}`.trim(),
            attrs: { type: 'button', 'aria-pressed': selected },
            on: { click: () => this.toggleCharge(kind) },
          },
          el('span', { class: `charge-glyph glyph-${def.glyph}` }),
          el('span', { class: 'charge-name', text: def.name }),
          el('span', { class: 'charge-blurb', text: def.blurb }),
        );
      }),
    );

    this.body.append(
      el('p', {
        class: 'section-note',
        text: `Choose ${CHARGE_LOADOUT_SIZE} charges to carry into Cosmic, Daily and Gauntlet matches. Each can be used once per match, and using one does not cost you a placement.`,
      }),
      grid,
    );
  }

  private toggleCharge(kind: ChargeKind): void {
    const current = this.app.profile.loadout;
    let next: ChargeKind[];

    if (current.includes(kind)) {
      next = current.filter((c) => c !== kind);
      if (next.length === 0) {
        audio.play('reject');
        this.app.notify('You need at least one charge', 'bad');
        return;
      }
    } else {
      // Full loadout: replace the oldest pick so a tap always does something.
      next = current.length >= CHARGE_LOADOUT_SIZE ? [...current.slice(1), kind] : [...current, kind];
    }

    audio.play('click');
    haptics.fire('light');
    this.app.saveProfile(setLoadout(this.app.profile, next));
    this.renderBody();
  }

  /* ---------------------------------------------------------------- *
   * Quests, achievements, stats
   * ---------------------------------------------------------------- */

  private renderQuests(): void {
    const { quests } = this.app.profile;
    this.body.append(
      el('p', { class: 'section-note', text: `Daily quests for ${quests.date}. They refresh every day.` }),
      el(
        'ul',
        { class: 'quest-list' },
        ...quests.quests.map((entry) => {
          const def = QUESTS[entry.id];
          const done = isQuestComplete(entry);
          const bar = progressBar(entry.progress / def.target);
          return el(
            'li',
            { class: `quest-row ${done ? 'is-done' : ''}`.trim() },
            el(
              'div',
              { class: 'quest-text' },
              el('span', { class: 'quest-name', text: def.name }),
              el('span', { class: 'quest-desc', text: def.description }),
            ),
            bar.root,
            el('span', {
              class: 'quest-progress',
              text: done ? 'Complete' : `${entry.progress}/${def.target}`,
            }),
            el('span', { class: 'quest-reward', text: `+${def.reward.xp} XP` }),
          );
        }),
      ),
    );
  }

  private renderAchievements(): void {
    const profile = this.app.profile;
    const owned = new Set(profile.achievements);

    this.body.appendChild(
      el(
        'ul',
        { class: 'achievement-list' },
        ...ACHIEVEMENTS.map((achievement) => {
          const unlocked = owned.has(achievement.id);
          const hidden = achievement.secret && !unlocked;
          const target = achievement.target?.(profile.stats);
          const progress = achievement.progress?.(profile.stats);

          return el(
            'li',
            { class: `achievement-row ${unlocked ? 'is-unlocked' : ''}`.trim() },
            el('span', { class: 'achievement-mark', text: unlocked ? '✦' : '·' }),
            el(
              'div',
              { class: 'achievement-text' },
              el('span', { class: 'achievement-name', text: hidden ? 'Hidden' : achievement.name }),
              el('span', {
                class: 'achievement-desc',
                text: hidden ? 'Keep playing to reveal this one.' : achievement.description,
              }),
            ),
            !unlocked && target && progress !== undefined
              ? el('span', { class: 'achievement-progress', text: `${Math.min(progress, target)}/${target}` })
              : null,
          );
        }),
      ),
    );
  }

  private renderStats(): void {
    const { stats } = this.app.profile;
    const level = levelOf(this.app.profile);
    const winRate = stats.matchesPlayed > 0 ? Math.round((stats.wins / stats.matchesPlayed) * 100) : 0;

    const rows: Array<[string, string]> = [
      ['Level', `${level.level}${level.isMax ? ' (max)' : ''}`],
      ['Total XP', fmt(this.app.profile.totalXp)],
      ['Matches played', fmt(stats.matchesPlayed)],
      ['Wins', fmt(stats.wins)],
      ['Losses', fmt(stats.losses)],
      ['Draws', fmt(stats.draws)],
      ['Win rate', `${winRate}%`],
      ['Current streak', fmt(stats.currentStreak)],
      ['Best streak', fmt(stats.bestStreak)],
      ['Flawless wins', fmt(stats.untouchedWins)],
      ['Best Gauntlet gate', fmt(stats.gauntletBestDepth)],
      ['Gauntlets cleared', fmt(stats.gauntletRunsCleared)],
      ['Dailies played', fmt(stats.dailiesPlayed)],
      ['Charges spent', fmt(stats.chargesUsed)],
      ['Stardust earned', fmt(stats.totalStardustEarned)],
    ];

    this.body.appendChild(
      el(
        'dl',
        { class: 'stat-list' },
        ...rows.flatMap(([label, value]) => [
          el('dt', { text: label }),
          el('dd', { text: value }),
        ]),
      ),
    );
  }
}

/* ------------------------------------------------------------------ *
 * Preview drawing
 * ------------------------------------------------------------------ */

function drawTokenPreview(
  ctx: CanvasRenderingContext2D,
  skin: TokenSkin,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowBlur = r * 0.6;
  ctx.shadowColor = skin.glow;

  const body = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  body.addColorStop(0, skin.edge);
  body.addColorStop(0.55, skin.core);
  body.addColorStop(1, shade(skin.core, -0.35));
  ctx.fillStyle = body;

  ctx.beginPath();
  switch (skin.shape) {
    case 'hex':
    case 'gem':
    case 'star': {
      const points = skin.shape === 'hex' ? 6 : skin.shape === 'gem' ? 8 : 12;
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2 + Math.PI / points;
        const rr = skin.shape === 'hex' ? r : i % 2 === 0 ? r : r * (skin.shape === 'gem' ? 0.86 : 0.72);
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'ring':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2, true);
      break;
    case 'chip':
      ctx.rect(-r * 0.82, -r * 0.82, r * 1.64, r * 1.64);
      break;
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = skin.text;
  ctx.font = `700 ${r}px "Rajdhani", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('7', 0, r * 0.06);
  ctx.restore();
}

function drawHolePreview(
  ctx: CanvasRenderingContext2D,
  skin: HoleSkin,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.translate(x, y);

  const halo = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2);
  halo.addColorStop(0, `${skin.ringA}88`);
  halo.addColorStop(1, `${skin.ringB}00`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = skin.ringA;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.5, r * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = skin.ringB;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.8, r * 0.7, Math.PI / 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = skin.core;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = skin.ringA;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((entry, index) => ctx.fillText(entry, x, startY + index * lineHeight));
}

function lockLabel(cosmetic: Cosmetic): string {
  switch (cosmetic.unlock.kind) {
    case 'level':
      return `Level ${cosmetic.unlock.level}`;
    case 'achievement':
      return 'Achievement';
    case 'gauntlet':
      return `Gate ${cosmetic.unlock.depth}`;
    default:
      return 'Locked';
  }
}
