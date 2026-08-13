/**
 * Post-match results: the payoff screen.
 *
 * Rewards are staged rather than dumped — the score lands, then XP counts up,
 * then unlocks pop one at a time. A single combined number would be read as
 * "some points"; a sequence is read as "I earned these specific things".
 */

import { audio } from '../../engine/audio';
import { haptics } from '../../engine/haptics';
import { Effects } from '../../engine/particles';
import { GAUNTLET_GATES, MODES, buildMatch, type MatchSetup } from '../../meta/modes';
import {
  advanceGauntlet,
  endGauntlet,
  finishMatch,
  levelOf,
  type MatchReport,
} from '../../meta/profile';
import { levelFromXp } from '../../meta/progression';
import { steam } from '../../platform/steam';
import { button, counter, el, fmt, progressBar } from '../../ui/dom';
import type { GameState } from '../../core/types';
import type { App, Scene } from '../app';
import { MatchScene } from './match';
import { MenuScene } from './menu';
import { TutorialCoach } from './tutorial';

export class ResultsScene implements Scene {
  readonly name = 'results';
  private app!: App;
  private report!: MatchReport;

  constructor(
    private readonly setup: MatchSetup,
    private readonly state: GameState,
    private readonly chargesSpent: number,
  ) {}

  mount(app: App): void {
    this.app = app;

    const winner = this.state.winner!;
    const result = winner === 'DRAW' ? 'draw' : winner === 'P1' ? 'win' : 'loss';
    const playerScore = this.state.scores.P1;
    const opponentScore = this.state.scores.P2;
    const untouched = (this.state.breakdown?.touching.P1 ?? 0) === 0;

    // Pass & play is a shared-device social mode; it does not feed progression.
    const scoresProgress = this.setup.mode !== 'local';

    this.report = finishMatch(this.app.profile, {
      mode: this.setup.mode,
      difficulty: this.setup.difficulty,
      result,
      playerScore,
      opponentScore,
      modifierCount: this.setup.modifiers.length,
      untouched,
      chargesUsed: this.chargesSpent,
      gauntletDepth: this.setup.gauntletDepth,
    });

    let profile = scoresProgress ? this.report.profile : this.app.profile;

    // Gauntlet bookkeeping: a win opens the next gate, a loss ends the run.
    if (this.setup.mode === 'gauntlet') {
      profile = result === 'win' ? advanceGauntlet(profile, GAUNTLET_GATES) : endGauntlet(profile);
    }

    this.app.saveProfile(profile);

    if (scoresProgress) {
      for (const achievement of this.report.newAchievements) {
        steam.unlockAchievement(achievement.steamId);
      }
      steam.setStat('wins', profile.stats.wins);
      steam.setStat('level', levelOf(profile).level);
      steam.store();
    }

    this.build(result, playerScore, opponentScore, scoresProgress);
  }

  unmount(): void {
    /* the overlay is cleared by the app */
  }

  private build(
    result: 'win' | 'loss' | 'draw',
    playerScore: number,
    opponentScore: number,
    scoresProgress: boolean,
  ): void {
    const isLocal = this.setup.mode === 'local';
    const heading = isLocal
      ? result === 'draw'
        ? 'Dead heat'
        : `${this.state.winner === 'P1' ? 'Player 1' : 'Player 2'} wins`
      : result === 'win'
        ? 'Victory'
        : result === 'draw'
          ? 'Dead heat'
          : 'Defeat';

    const panel = el(
      'div',
      { class: `panel results results-${result}` },
      el('h1', { class: 'results-title', text: heading }),
      el('p', {
        class: 'results-sub',
        text: `${MODES[this.setup.mode].name} · ${this.setup.opponentName}`,
      }),
      this.buildScoreboard(playerScore, opponentScore, isLocal),
      this.setup.mode === 'tutorial'
        ? el('p', { class: 'tutorial-outro', text: TutorialCoach.outro(result === 'win') })
        : null,
      this.buildBreakdown(),
    );

    if (scoresProgress) {
      panel.appendChild(this.buildRewards());
    }

    panel.appendChild(this.buildActions(result));
    this.app.overlay.appendChild(panel);

    // Stagger the panel's own entrance so it does not slam in over the finale.
    requestAnimationFrame(() => panel.classList.add('is-in'));
  }

  private buildScoreboard(playerScore: number, opponentScore: number, isLocal: boolean): HTMLElement {
    const lower = (a: number, b: number) => (a < b ? 'is-winner' : '');
    return el(
      'div',
      { class: 'scoreboard' },
      el(
        'div',
        { class: `score-cell ${lower(playerScore, opponentScore)}` },
        el('span', { class: 'score-name', text: isLocal ? 'Player 1' : 'You' }),
        el('span', { class: 'score-value', text: String(playerScore) }),
      ),
      el('span', { class: 'score-vs', text: 'lowest wins' }),
      el(
        'div',
        { class: `score-cell ${lower(opponentScore, playerScore)}` },
        el('span', { class: 'score-name', text: isLocal ? 'Player 2' : this.setup.opponentName }),
        el('span', { class: 'score-value', text: String(opponentScore) }),
      ),
    );
  }

  /** Which numbers the hole actually ate, so the loss is never a mystery. */
  private buildBreakdown(): HTMLElement {
    const contributions = this.state.breakdown?.contributions ?? [];
    if (contributions.length === 0) {
      return el('p', { class: 'breakdown-empty', text: 'The hole opened on empty space. Nobody scored.' });
    }
    return el(
      'div',
      { class: 'breakdown' },
      el('h2', { class: 'breakdown-title', text: 'Caught in the pull' }),
      el(
        'ul',
        { class: 'breakdown-list' },
        ...contributions.map((c) =>
          el(
            'li',
            { class: `breakdown-row ${c.player === 'P1' ? 'is-you' : 'is-them'}` },
            el('span', { class: 'breakdown-owner', text: c.player === 'P1' ? 'You' : 'Them' }),
            el('span', { class: 'breakdown-base', text: String(c.base) }),
            c.note ? el('span', { class: 'breakdown-note', text: c.note }) : null,
            el('span', { class: 'breakdown-eff', text: signed(c.effective) }),
          ),
        ),
      ),
    );
  }

  private buildRewards(): HTMLElement {
    const before = levelFromXp(this.report.profile.totalXp - this.report.rewards.xp);
    const after = levelOf(this.report.profile);

    const xpCounter = counter(0, (n) => `+${Math.round(n)} XP`);
    const dustCounter = counter(0, (n) => `+${Math.round(n)}`);
    const bar = progressBar(before.progress);

    const rewards = el(
      'div',
      { class: 'rewards' },
      el(
        'div',
        { class: 'reward-totals' },
        el('div', { class: 'reward-xp' }, xpCounter.node),
        el('div', { class: 'reward-dust' }, el('span', { class: 'dust-icon' }), dustCounter.node),
      ),
      el(
        'div',
        { class: 'level-row' },
        el('span', { class: 'level-badge', text: `Lv ${before.level}` }),
        bar.root,
        el('span', {
          class: 'level-next',
          text: after.isMax ? 'MAX' : `${fmt(after.xpForLevel - after.xpIntoLevel)} to go`,
        }),
      ),
      el(
        'ul',
        { class: 'reward-list' },
        ...this.report.rewards.breakdown.map((row) =>
          el(
            'li',
            { class: 'reward-row' },
            el('span', { text: row.label }),
            el('span', { class: 'reward-row-xp', text: `+${row.xp}` }),
          ),
        ),
      ),
    );

    // Count the numbers up on the next frame so the entrance reads as motion.
    setTimeout(() => {
      xpCounter.set(this.report.rewards.xp);
      dustCounter.set(this.report.rewards.stardust);
      bar.set(after.level > before.level ? 1 : after.progress);
    }, 260);

    if (this.report.levelUps > 0) {
      setTimeout(() => this.celebrateLevelUp(rewards, bar, after), 900);
    }
    if (this.report.completedQuests.length > 0 || this.report.newAchievements.length > 0 || this.report.newlyUnlocked.length > 0) {
      setTimeout(() => this.announceUnlocks(rewards), this.report.levelUps > 0 ? 1500 : 1000);
    }

    return rewards;
  }

  private celebrateLevelUp(
    container: HTMLElement,
    bar: { set(p: number): void },
    after: ReturnType<typeof levelFromXp>,
  ): void {
    audio.play('levelup');
    haptics.fire('success');
    const { cx, cy } = this.app.renderer.layout;
    Effects.pulse(this.app.particles, cx, cy * 0.6, '#ffd75c');
    this.app.camera.punchZoom(0.05);

    bar.set(after.progress);
    const badge = container.querySelector('.level-badge');
    if (badge) {
      badge.textContent = `Lv ${after.level}`;
      badge.classList.add('is-levelup');
    }
    this.app.notify(
      `Level ${after.level}! +${fmt(this.report.levelUpStardust)} stardust`,
      'good',
    );
  }

  private announceUnlocks(container: HTMLElement): void {
    const items: HTMLElement[] = [];

    for (const quest of this.report.completedQuests) {
      items.push(el('li', { class: 'unlock-row is-quest' }, `Quest complete — ${quest.name}`));
    }
    for (const achievement of this.report.newAchievements) {
      items.push(el('li', { class: 'unlock-row is-achievement' }, `Achievement — ${achievement.name}`));
    }
    for (const cosmetic of this.report.newlyUnlocked) {
      items.push(el('li', { class: `unlock-row is-cosmetic rarity-${cosmetic.rarity}` }, `Unlocked — ${cosmetic.name}`));
    }
    if (items.length === 0) return;

    audio.play('unlock');
    haptics.fire('success');
    container.appendChild(el('ul', { class: 'unlock-list' }, ...items));
  }

  private buildActions(result: 'win' | 'loss' | 'draw'): HTMLElement {
    const actions = el('div', { class: 'results-actions' });
    const profile = this.app.profile;

    if (this.setup.mode === 'gauntlet') {
      if (result === 'win' && profile.gauntlet) {
        actions.appendChild(
          button(`Next gate (${profile.gauntlet.depth}/${GAUNTLET_GATES})`, () => this.nextGauntletGate(), {
            class: 'btn-primary',
          }),
        );
      } else if (result === 'win') {
        actions.appendChild(
          el('p', { class: 'run-complete', text: 'Gauntlet cleared. The void remembers.' }),
        );
      } else {
        actions.appendChild(el('p', { class: 'run-over', text: 'Run over. The gates reset.' }));
      }
    } else if (this.setup.mode !== 'daily') {
      actions.appendChild(button('Play again', () => this.rematch(), { class: 'btn-primary' }));
    } else {
      actions.appendChild(
        el('p', { class: 'daily-done', text: 'That was today’s challenge. A new board arrives tomorrow.' }),
      );
    }

    actions.appendChild(button('Menu', () => this.toMenu()));
    return actions;
  }

  private rematch(): void {
    audio.play('click');
    const setup = buildMatch({
      mode: this.setup.mode,
      difficulty: this.setup.difficulty,
      loadout: this.app.profile.loadout,
    });
    void this.app.go(new MatchScene(setup));
  }

  private nextGauntletGate(): void {
    audio.play('click');
    const run = this.app.profile.gauntlet;
    if (!run) {
      this.toMenu();
      return;
    }
    const setup = buildMatch({
      mode: 'gauntlet',
      difficulty: this.setup.difficulty,
      loadout: this.app.profile.loadout,
      gauntletDepth: run.depth,
      seed: run.seed + run.depth * 7919,
    });
    void this.app.go(new MatchScene(setup));
  }

  private toMenu(): void {
    audio.play('click');
    void this.app.go(new MenuScene());
  }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
