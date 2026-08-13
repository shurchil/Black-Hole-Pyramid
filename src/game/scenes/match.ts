/**
 * The match scene: input, animation orchestration and the AI turn pump.
 *
 * The animation contract that makes the game feel "snappy" rather than slow:
 *  - A placement is *committed to state immediately*; the animation is
 *    decoration that plays out afterwards. Input is never waiting on a tween.
 *  - Every beat is short (under 300ms) and overshoots slightly on the way in.
 *  - The one deliberately long moment is the black hole finale, because it is
 *    the payoff the whole match has been building toward.
 */

import { Effects } from '../../engine/particles';
import { audio } from '../../engine/audio';
import { haptics } from '../../engine/haptics';
import { defaultVisual, type CellVisual } from '../../engine/renderer';
import { Easing, clamp01 } from '../../engine/tween';
import {
  applyMove,
  createGame,
  isLegalPlace,
  legalCharges,
  legalPlacements,
  neighborsOf,
  scoreForHole,
} from '../../core/rules';
import { CHARGES } from '../../core/charges';
import type { ChargeKind, ChargeMove, GameState, PlayerId } from '../../core/types';
import { otherPlayer } from '../../core/types';
import { MODIFIERS } from '../../core/modifiers';
import { OPPONENT_SKIN, type TokenSkin } from '../../meta/cosmetics';
import { MODES, type MatchSetup } from '../../meta/modes';
import { button, clear, el } from '../../ui/dom';
import type { App, Scene } from '../app';
import { ResultsScene } from './results';
import { MenuScene } from './menu';
import { TutorialCoach } from './tutorial';

type ChargeTargeting = {
  kind: ChargeKind;
  picked: number[];
};

export class MatchScene implements Scene {
  readonly name = 'match';

  private app!: App;
  private state!: GameState;
  private visuals = new Map<number, CellVisual>();
  private hoverCell: number | null = null;
  private time = 0;

  /** Blocks input while an animation beat or the AI is mid-turn. */
  private busy = false;
  private finished = false;

  private timeLeft = 0;
  private timerWarned = false;

  private foresight: Map<number, number> | null = null;
  private targeting: ChargeTargeting | null = null;
  private chargesSpent = 0;

  private hud!: HTMLElement;
  private turnLabel!: HTMLElement;
  private numberLabel!: HTMLElement;
  private scoreLabel!: HTMLElement;
  private timerLabel!: HTMLElement;
  private chargeRow!: HTMLElement;
  private hintBar!: HTMLElement;

  private holeReveal = 0;
  private revealedHole: number | null = null;

  /** Only present in tutorial mode; narrates the match as it is played. */
  private coach: TutorialCoach | null = null;

  private detachInput: Array<() => void> = [];

  constructor(private readonly setup: MatchSetup) {}

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  mount(app: App): void {
    this.app = app;
    this.state = createGame(this.setup.options);
    for (let i = 0; i < this.state.board.length; i++) this.visuals.set(i, defaultVisual());
    this.timeLeft = this.state.rules.moveTimeLimit;

    if (this.setup.mode === 'tutorial') this.coach = new TutorialCoach();

    this.buildHud();
    this.attachInput();
    this.refreshHud();
    this.updateCoach();

    audio.unlock();
    audio.startMusic();

    // If the AI opens, give the player a beat to read the board first.
    this.maybeRunAiTurn(600);
  }

  unmount(): void {
    for (const detach of this.detachInput) detach();
    this.detachInput = [];
    audio.stopMusic();
  }

  resize(): void {
    /* layout is recomputed by the renderer; nothing scene-specific to do */
  }

  /* ---------------------------------------------------------------- *
   * HUD
   * ---------------------------------------------------------------- */

  private buildHud(): void {
    const modeDef = MODES[this.setup.mode];

    this.turnLabel = el('span', { class: 'turn-label' });
    this.numberLabel = el('span', { class: 'number-chip' });
    this.scoreLabel = el('span', { class: 'score-preview' });
    this.timerLabel = el('span', { class: 'timer' });
    this.chargeRow = el('div', { class: 'charge-row' });
    this.hintBar = el('div', { class: 'hint-bar' });

    const modifierChips = el(
      'div',
      { class: 'modifier-chips' },
      ...this.setup.modifiers.map((id) =>
        el('span', {
          class: 'chip',
          text: MODIFIERS[id].name,
          attrs: { title: MODIFIERS[id].blurb },
        }),
      ),
    );

    this.hud = el(
      'div',
      { class: 'hud' },
      el(
        'header',
        { class: 'hud-top' },
        button('‹', () => this.confirmQuit(), { class: 'btn-icon' }),
        el(
          'div',
          { class: 'hud-title' },
          el('span', { class: 'mode-name', text: modeDef.name }),
          el('span', { class: 'opponent-name', text: `vs ${this.setup.opponentName}` }),
        ),
        this.timerLabel,
      ),
      modifierChips,
      el('div', { class: 'hud-turn' }, this.turnLabel, this.numberLabel),
      el('div', { class: 'hud-bottom' }, this.scoreLabel, this.chargeRow),
      this.hintBar,
    );

    this.app.overlay.appendChild(this.hud);
  }

  private refreshHud(): void {
    const isLocal = this.setup.mode === 'local';
    const active = this.state.activePlayer;
    const you = active === 'P1';

    this.turnLabel.textContent = this.finished
      ? 'Black hole forming'
      : isLocal
        ? `${active === 'P1' ? 'Player 1' : 'Player 2'} — place`
        : you
          ? 'Your turn — place'
          : `${this.setup.opponentName} is thinking`;

    this.turnLabel.classList.toggle('is-waiting', !you && !isLocal && !this.finished);
    this.numberLabel.textContent = this.finished ? '' : String(this.state.currentNumber);
    this.numberLabel.classList.toggle('hidden', this.finished);

    // Live "if the hole formed at the worst remaining cell" read-out. It turns
    // an abstract position into a number the player can act on.
    this.scoreLabel.textContent = this.livePreview();

    if (this.state.rules.moveTimeLimit > 0 && !this.finished) {
      this.timerLabel.textContent = `${Math.ceil(Math.max(0, this.timeLeft))}s`;
      this.timerLabel.classList.toggle('is-urgent', this.timeLeft <= 3);
    } else {
      this.timerLabel.textContent = '';
    }

    this.refreshCharges();
  }

  /**
   * "If the hole formed in the worst place still open, what would it cost
   * me?" — the single number that turns an abstract position into something
   * the player can act on, updated every turn.
   */
  private livePreview(): string {
    if (this.finished || legalPlacements(this.state).length === 0) return '';
    let worstP1 = 0;
    let worstP2 = 0;
    for (const cell of this.state.board) {
      if (cell.player !== null || cell.traits.includes('collapsed')) continue;
      const totals = scoreForHole(this.state, cell.id).totals;
      worstP1 = Math.max(worstP1, totals.P1);
      worstP2 = Math.max(worstP2, totals.P2);
    }
    const labels = this.setup.mode === 'local' ? ['P1', 'P2'] : ['you', 'them'];
    return `worst case — ${labels[0]} ${worstP1} · ${labels[1]} ${worstP2}`;
  }

  private refreshCharges(): void {
    clear(this.chargeRow);
    if (!this.state.rules.chargesEnabled || this.finished) return;

    const human: PlayerId = 'P1';
    const isHumanTurn = this.state.activePlayer === human || this.setup.mode === 'local';
    const owner = this.setup.mode === 'local' ? this.state.activePlayer : human;

    for (const charge of this.state.charges[owner]) {
      const def = CHARGES[charge.kind];
      const legal = legalCharges(this.state).some((c) => c.charge === charge.kind);
      const usable = !charge.used && isHumanTurn && legal && !this.busy;
      const active = this.targeting?.kind === charge.kind;

      this.chargeRow.appendChild(
        el(
          'button',
          {
            class: `charge ${charge.used ? 'is-used' : ''} ${active ? 'is-active' : ''}`.trim(),
            attrs: {
              type: 'button',
              disabled: !usable,
              title: `${def.name} — ${def.blurb}`,
              'aria-label': `${def.name}. ${def.blurb}`,
            },
            on: { click: () => this.beginCharge(charge.kind) },
          },
          el('span', { class: `charge-glyph glyph-${def.glyph}` }),
          el('span', { class: 'charge-name', text: def.name }),
        ),
      );
    }
  }

  private setHint(text: string | null): void {
    this.hintBar.textContent = text ?? '';
    this.hintBar.classList.toggle('visible', Boolean(text));
  }

  /**
   * Tutorial narration. Lessons are sticky — they stay up until the next one
   * is due, because a hint that vanishes while the player is still reading it
   * teaches nothing.
   */
  private updateCoach(): void {
    if (!this.coach) return;
    const lesson = this.coach.hintFor(this.state);
    if (lesson) this.setHint(lesson);
  }

  /* ---------------------------------------------------------------- *
   * Input
   * ---------------------------------------------------------------- */

  private attachInput(): void {
    const canvas = this.app.canvas;

    const toLocal = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return; // no hover state on touch
      const { x, y } = toLocal(event);
      const cell = this.app.renderer.hitTest(x, y);
      const next = cell !== null && this.canInteractWith(cell) ? cell : null;
      if (next !== this.hoverCell) {
        this.hoverCell = next;
        if (next !== null) audio.play('hover');
      }
    };

    const onDown = (event: PointerEvent) => {
      audio.unlock();
      const { x, y } = toLocal(event);
      const cell = this.app.renderer.hitTest(x, y);
      if (cell === null) return;
      event.preventDefault();
      void this.onCellTapped(cell);
    };

    const onLeave = () => {
      this.hoverCell = null;
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerleave', onLeave);
    this.detachInput.push(
      () => canvas.removeEventListener('pointermove', onMove),
      () => canvas.removeEventListener('pointerdown', onDown),
      () => canvas.removeEventListener('pointerleave', onLeave),
    );

    // Keyboard access: cycle the target with arrows, place with Enter/Space.
    const onKey = (event: KeyboardEvent) => {
      if (this.finished || this.busy) return;
      const options = legalPlacements(this.state);
      if (options.length === 0) return;

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (this.hoverCell !== null) void this.onCellTapped(this.hoverCell);
        return;
      }
      const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const current = this.hoverCell === null ? -1 : options.indexOf(this.hoverCell);
      const next = (current + step + options.length) % options.length;
      this.hoverCell = options[next];
      audio.play('hover');
    };
    window.addEventListener('keydown', onKey);
    this.detachInput.push(() => window.removeEventListener('keydown', onKey));
  }

  private canInteractWith(cell: number): boolean {
    if (this.finished || this.busy) return false;
    if (this.targeting) return this.isValidChargeTarget(cell);
    if (this.setup.mode !== 'local' && this.state.activePlayer !== 'P1') return false;
    return isLegalPlace(this.state, cell);
  }

  private async onCellTapped(cell: number): Promise<void> {
    if (this.finished || this.busy) return;

    if (this.targeting) {
      this.pickChargeTarget(cell);
      return;
    }

    const humanTurn = this.setup.mode === 'local' || this.state.activePlayer === 'P1';
    if (!humanTurn) return;

    if (!isLegalPlace(this.state, cell)) {
      const pos = this.app.renderer.positionOf(cell);
      Effects.reject(this.app.particles, pos.x, pos.y);
      audio.play('reject');
      haptics.fire('warning');
      const locked = this.state.board[cell].lockedBy !== null;
      this.setHint(locked ? 'That cell is frozen by a Stasis Field this turn.' : null);
      return;
    }

    await this.commitPlacement(cell);
  }

  /* ---------------------------------------------------------------- *
   * Placement
   * ---------------------------------------------------------------- */

  private async commitPlacement(cell: number): Promise<void> {
    const player = this.state.activePlayer;
    const value = this.state.currentNumber;
    const skin = this.skinFor(player);

    // State first, animation second: input is never blocked on a tween.
    this.state = applyMove(this.state, { kind: 'place', cell });
    this.foresight = null;
    this.hoverCell = null;
    this.timeLeft = this.state.rules.moveTimeLimit;
    this.timerWarned = false;
    if (!this.coach) this.setHint(null);

    this.playDropAnimation(cell, value, skin);
    this.refreshHud();
    this.updateCoach();

    if (this.state.isFinished) {
      await this.runFinale();
      return;
    }
    this.maybeRunAiTurn();
  }

  private playDropAnimation(cell: number, value: number, skin: TokenSkin): void {
    const visual = this.visuals.get(cell)!;
    const pos = this.app.renderer.positionOf(cell);
    const motion = this.app.motion;

    visual.drop = motion === 0 ? 1 : 0;
    visual.squash = 1;
    visual.scale = 1;

    if (motion === 0) {
      audio.play('place', value);
      return;
    }

    // Fall in with a small overshoot.
    this.app.tweens.add({
      from: 0,
      to: 1,
      duration: 0.26,
      easing: Easing.backOut,
      onUpdate: (v) => {
        visual.drop = v;
      },
      onComplete: () => {
        // Land: squash, then spring back. Bigger numbers hit harder.
        const weight = 0.12 + (value / 10) * 0.16;
        visual.squash = 1 + weight;
        this.app.tweens.add({
          from: 1 + weight,
          to: 1,
          duration: 0.34,
          easing: Easing.elasticOut,
          onUpdate: (v) => {
            visual.squash = v;
          },
        });

        audio.play('place', value);
        haptics.fire(value >= 8 ? 'medium' : 'light');
        Effects.impact(this.app.particles, pos.x, pos.y, skin.glow);

        const trail = this.app.trailSkin();
        this.app.particles.emit({
          x: pos.x,
          y: pos.y,
          count: 8 + value,
          color: trail.colors,
          shape: trail.shape,
          speed: [60, 160 + value * 12],
          life: [0.3, 0.6],
          size: [2, 4],
        });

        // The board recoils in proportion to the number's weight.
        this.app.camera.addTrauma(0.1 + (value / 10) * 0.16);
        this.app.camera.kick(0, 2 + value * 0.5);
      },
    });
  }

  /* ---------------------------------------------------------------- *
   * AI
   * ---------------------------------------------------------------- */

  private maybeRunAiTurn(extraDelay = 0): void {
    if (this.finished || this.setup.mode === 'local') return;
    if (this.state.activePlayer !== 'P2') return;
    void this.runAiTurn(extraDelay);
  }

  private async runAiTurn(extraDelay: number): Promise<void> {
    this.busy = true;
    this.refreshHud();

    try {
      if (extraDelay > 0) await wait(extraDelay);

      // Charges first: they are free actions, so the AI may fire one and then
      // still place in the same turn.
      if (this.state.rules.chargesEnabled) {
        const charge = await this.app.ai.thinkCharge(this.state, this.setup.difficulty);
        if (charge) {
          this.state = applyMove(this.state, charge);
          this.announceCharge(charge, 'P2');
          this.refreshHud();
          await wait(520);
        }
      }

      const move = await this.app.ai.think(this.state, this.setup.difficulty, {
        // A perfect reply in 4ms reads as a glitch, not as an opponent.
        minThinkMs: 420,
      });
      if (!move || move.kind !== 'place') return;

      const value = this.state.currentNumber;
      this.state = applyMove(this.state, move);
      this.playDropAnimation(move.cell, value, OPPONENT_SKIN);
      this.timeLeft = this.state.rules.moveTimeLimit;
      this.refreshHud();
      this.updateCoach();

      if (this.state.isFinished) {
        this.busy = false;
        await this.runFinale();
        return;
      }
      await wait(180);
      // Fair Start means the AI can legitimately move twice in a row.
      if (this.state.activePlayer === 'P2') {
        void this.runAiTurn(200);
        return;
      }
    } finally {
      if (!this.finished) {
        this.busy = false;
        this.refreshHud();
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Charges
   * ---------------------------------------------------------------- */

  private beginCharge(kind: ChargeKind): void {
    if (this.busy || this.finished) return;

    if (kind === 'foresight') {
      this.state = applyMove(this.state, { kind: 'charge', charge: 'foresight', target: -1 });
      this.chargesSpent++;
      this.showForesight();
      audio.play('charge');
      this.refreshHud();
      return;
    }

    this.targeting = this.targeting?.kind === kind ? null : { kind, picked: [] };
    this.setHint(this.targeting ? targetingHint(kind, 0) : null);
    this.refreshCharges();
  }

  private isValidChargeTarget(cell: number): boolean {
    if (!this.targeting) return false;
    const owner = this.setup.mode === 'local' ? this.state.activePlayer : 'P1';
    const target = this.state.board[cell];

    switch (this.targeting.kind) {
      case 'stasisField':
        return target.player === null && !target.traits.includes('collapsed');
      case 'dampener':
        return target.player === owner && (target.value ?? 0) > 1;
      case 'singularityShift':
        return this.targeting.picked.length === 0
          ? target.player === owner
          : target.player === otherPlayer(owner);
      default:
        return false;
    }
  }

  private pickChargeTarget(cell: number): void {
    if (!this.targeting) return;
    if (!this.isValidChargeTarget(cell)) {
      const pos = this.app.renderer.positionOf(cell);
      Effects.reject(this.app.particles, pos.x, pos.y);
      audio.play('reject');
      return;
    }

    this.targeting.picked.push(cell);
    const needed = this.targeting.kind === 'singularityShift' ? 2 : 1;
    if (this.targeting.picked.length < needed) {
      this.setHint(targetingHint(this.targeting.kind, this.targeting.picked.length));
      audio.play('click');
      return;
    }

    const move: ChargeMove = {
      kind: 'charge',
      charge: this.targeting.kind,
      target: this.targeting.picked[0],
      target2: this.targeting.picked[1],
    };
    this.targeting = null;
    this.setHint(null);

    try {
      this.state = applyMove(this.state, move);
    } catch {
      audio.play('reject');
      this.refreshCharges();
      return;
    }

    this.chargesSpent++;
    this.announceCharge(move, this.setup.mode === 'local' ? this.state.activePlayer : 'P1');
    this.refreshHud();
  }

  private announceCharge(move: ChargeMove, by: PlayerId): void {
    const def = CHARGES[move.charge];
    audio.play('charge');
    haptics.fire('medium');
    this.app.camera.addTrauma(0.22);
    this.app.camera.punchZoom(0.04);

    for (const cell of [move.target, move.target2]) {
      if (cell === undefined || cell < 0) continue;
      const pos = this.app.renderer.positionOf(cell);
      Effects.pulse(this.app.particles, pos.x, pos.y, '#7fe3ff');
    }

    const who = by === 'P1' && this.setup.mode !== 'local' ? 'You' : this.setup.opponentName;
    this.app.notify(`${who} used ${def.name}`, by === 'P1' ? 'good' : 'bad');
  }

  /**
   * Foresight highlights each open cell by how good it would be as the hole,
   * computed exactly from the rules rather than from the AI, so the numbers it
   * shows are the true ones.
   */
  private showForesight(): void {
    const map = new Map<number, number>();
    const me: PlayerId = this.setup.mode === 'local' ? this.state.activePlayer : 'P1';
    const deltas: Array<[number, number]> = [];

    for (const cell of this.state.board) {
      if (cell.player !== null || cell.traits.includes('collapsed')) continue;
      const totals = scoreForHole(this.state, cell.id).totals;
      deltas.push([cell.id, totals[otherPlayer(me)] - totals[me]]);
    }
    const span = Math.max(1, ...deltas.map(([, d]) => Math.abs(d)));
    for (const [id, d] of deltas) map.set(id, d / span);

    this.foresight = map;
    this.setHint('Foresight: green cells favour you as the hole, red cells hurt.');
    // The reading is for this turn only.
    setTimeout(() => {
      if (this.foresight === map) {
        this.foresight = null;
        this.setHint(null);
      }
    }, 6000);
  }

  /* ---------------------------------------------------------------- *
   * Finale
   * ---------------------------------------------------------------- */

  private async runFinale(): Promise<void> {
    this.finished = true;
    this.busy = true;
    this.hoverCell = null;
    this.foresight = null;
    this.targeting = null;
    this.refreshHud();

    const hole = this.state.blackHoleIndex!;
    const holePos = this.app.renderer.positionOf(hole);
    const motion = this.app.motion;

    await wait(motion === 0 ? 100 : 420);

    // 1. The collapse.
    this.revealedHole = hole;
    audio.play('blackhole');
    haptics.fire('heavy');
    this.app.camera.addTrauma(motion === 0 ? 0 : 0.75);
    this.app.camera.punchZoom(motion === 0 ? 0 : 0.09);

    await this.app.tweens.run({
      from: 0,
      to: 1,
      duration: motion === 0 ? 0.05 : 0.85,
      easing: Easing.expoOut,
      onUpdate: (v) => {
        this.holeReveal = v;
      },
    });

    if (motion !== 0) {
      Effects.implode(
        this.app.particles,
        holePos.x,
        holePos.y,
        this.app.renderer.layout.radius,
        [this.app.holeSkin().ringA, this.app.holeSkin().ringB],
      );
    }

    // 2. Everything the hole touches gets dragged in, one beat at a time.
    const contributions = this.state.breakdown?.contributions ?? [];
    const touching = new Set(neighborsOf(this.state, hole));

    for (const contribution of contributions) {
      const visual = this.visuals.get(contribution.cell)!;
      const from = this.app.renderer.positionOf(contribution.cell);
      const skin = this.skinFor(contribution.player);
      const isInner = touching.has(contribution.cell);

      if (motion === 0) {
        visual.pull = 1;
        visual.scale = 0;
        continue;
      }

      audio.play('devour', Math.abs(contribution.effective));
      Effects.devour(this.app.particles, from.x, from.y, holePos.x, holePos.y, skin.glow);
      this.app.camera.addTrauma(0.08);

      this.app.tweens.add({
        from: 0,
        to: 1,
        duration: 0.55,
        easing: Easing.cubicIn,
        onUpdate: (v) => {
          visual.pull = v;
          visual.scale = 1 - v;
          visual.spin = v * Math.PI * 1.5;
        },
      });

      await wait(isInner ? 150 : 110);
    }

    await wait(motion === 0 ? 60 : 480);
    this.busy = false;
    await this.showResults();
  }

  private async showResults(): Promise<void> {
    const winner = this.state.winner!;
    const playerWon = winner === 'P1';

    if (this.setup.mode !== 'local') {
      audio.play(winner === 'DRAW' ? 'draw' : playerWon ? 'win' : 'lose');
      haptics.fire(playerWon ? 'success' : 'error');
      if (playerWon && this.app.motion !== 0) {
        const { cx, cy } = this.app.renderer.layout;
        Effects.celebrate(this.app.particles, cx, cy * 0.7, [
          this.app.tokenSkin().core,
          this.app.tokenSkin().edge,
          '#ffd75c',
        ]);
      }
    } else {
      audio.play(winner === 'DRAW' ? 'draw' : 'win');
    }

    await wait(500);
    void this.app.go(new ResultsScene(this.setup, this.state, this.chargesSpent));
  }

  private confirmQuit(): void {
    audio.play('click');
    void this.app.go(new MenuScene());
  }

  /** P1 is always the local player (or Player 1 in pass & play). */
  private skinFor = (player: PlayerId): TokenSkin =>
    player === 'P1' ? this.app.tokenSkin() : OPPONENT_SKIN;

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  update(dt: number): void {
    this.time += dt;

    // Hover highlight eases in and out rather than snapping.
    for (const [id, visual] of this.visuals) {
      const target = this.hoverCell === id ? 1 : 0;
      visual.highlight += (target - visual.highlight) * Math.min(1, dt * 14);
    }

    if (this.state.rules.moveTimeLimit > 0 && !this.finished && !this.busy) {
      const humanTurn = this.setup.mode === 'local' || this.state.activePlayer === 'P1';
      if (humanTurn) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 3 && !this.timerWarned) {
          this.timerWarned = true;
          audio.play('warn');
        }
        if (this.timeLeft <= 0) {
          this.timeLeft = this.state.rules.moveTimeLimit;
          this.autoPlace();
        }
        this.refreshTimerOnly();
      }
    }
  }

  private refreshTimerOnly(): void {
    this.timerLabel.textContent = `${Math.ceil(Math.max(0, this.timeLeft))}s`;
    this.timerLabel.classList.toggle('is-urgent', this.timeLeft <= 3);
  }

  /** Blitz timeout: the board places for you, at random. */
  private autoPlace(): void {
    const options = legalPlacements(this.state);
    if (options.length === 0) return;
    const cell = options[Math.floor(Math.random() * options.length)];
    this.app.notify('Out of time — the board chose for you', 'bad');
    void this.commitPlacement(cell);
  }

  render(): void {
    const { renderer, camera, particles, width, height, dpr } = this.app;
    const ctx = renderer.ctx;

    const options = {
      state: this.state,
      theme: this.app.theme(),
      holeSkin: this.app.holeSkin(),
      skinFor: this.skinFor,
      visuals: this.visuals,
      hoverCell: this.hoverCell,
      legalCells: this.playerCanAct() ? legalPlacements(this.state) : [],
      foresight: this.foresight,
      revealedHole: this.revealedHole,
      holeReveal: clamp01(this.holeReveal),
      time: this.time,
      motion: this.app.motion,
    };

    // Everything below works in CSS pixels; the DPR scale is set once here.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderer.drawBackground(options.theme, width, height, this.time, options.motion);

    // Camera shake applies to the board and its particles, but not the sky.
    camera.apply(ctx, width / 2, height / 2);
    renderer.drawBoard(options);
    particles.render(ctx);
    ctx.restore(); // matches the save() inside camera.apply
  }

  private playerCanAct(): boolean {
    if (this.finished || this.busy) return false;
    if (!this.app.profile.settings.showHints) return false;
    return this.setup.mode === 'local' || this.state.activePlayer === 'P1';
  }
}

function targetingHint(kind: ChargeKind, step: number): string {
  switch (kind) {
    case 'singularityShift':
      return step === 0 ? 'Pick one of YOUR numbers to swap.' : 'Now pick an OPPONENT number to swap it with.';
    case 'stasisField':
      return 'Pick an empty cell to freeze for your opponent’s next turn.';
    case 'dampener':
      return 'Pick one of your own numbers to halve.';
    default:
      return '';
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
