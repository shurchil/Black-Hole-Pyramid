/**
 * The board renderer.
 *
 * Everything is drawn procedurally from theme data — no sprites, no atlases.
 * Layout is computed in normalised space and scaled to whatever viewport the
 * device has, so the same code serves a narrow phone and a Steam Deck.
 *
 * Performance notes that matter on mid-range phones:
 *  - The starfield and nebula are rendered once into an offscreen canvas and
 *    blitted, because they never change within a match.
 *  - `shadowBlur` is expensive; it is used only on the few elements that
 *    genuinely need bloom, never per-particle in bulk.
 */

import { CELL_COUNT, NEIGHBORS, UNIT_LAYOUT } from '../core/board';
import { isPlayable } from '../core/rules';
import type { Cell, GameState, PlayerId } from '../core/types';
import type { BoardTheme, HoleSkin, TokenSkin } from '../meta/cosmetics';
import { clamp01, lerp, remap } from './tween';

const TAU = Math.PI * 2;

export interface CellVisual {
  /** 0 while empty, 1 when the token has fully landed. */
  drop: number;
  /** Squash factor on landing; 1 is neutral. */
  squash: number;
  /** Hover / press highlight. */
  highlight: number;
  /** 0..1 pull toward the black hole during the finale. */
  pull: number;
  /** Scales the token; the devour animation shrinks it to 0. */
  scale: number;
  /** Extra spin, used by the finale and by star-shaped tokens. */
  spin: number;
}

export interface RenderOptions {
  state: GameState;
  theme: BoardTheme;
  holeSkin: HoleSkin;
  skinFor: (player: PlayerId) => TokenSkin;
  visuals: Map<number, CellVisual>;
  /** Cell under the cursor / finger, if any. */
  hoverCell: number | null;
  /** Cells to flag as legal targets this turn. */
  legalCells: number[];
  /** Highlights shown by the Foresight charge: cell -> favourability -1..1. */
  foresight: Map<number, number> | null;
  /** Cell the black hole occupies once revealed. */
  revealedHole: number | null;
  /** 0..1 progress of the black hole reveal sequence. */
  holeReveal: number;
  /** Seconds elapsed, for idle motion. */
  time: number;
  /** Global animation scale for the reduced-motion accessibility option. */
  motion: number;
}

export interface BoardLayout {
  cx: number;
  cy: number;
  radius: number;
  positions: Array<{ x: number; y: number }>;
}

export function defaultVisual(): CellVisual {
  return { drop: 0, squash: 1, highlight: 0, pull: 0, scale: 1, spin: 0 };
}

export class BoardRenderer {
  private background: HTMLCanvasElement | null = null;
  private backgroundKey = '';
  private context: CanvasRenderingContext2D | null = null;
  layout: BoardLayout = { cx: 0, cy: 0, radius: 20, positions: [] };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get ctx(): CanvasRenderingContext2D {
    if (!this.context) {
      this.context = this.canvas.getContext('2d', { alpha: false });
      if (!this.context) throw new Error('2D canvas context unavailable');
    }
    return this.context;
  }

  /**
   * Recomputes the pyramid layout for the current viewport.
   * The board is fitted to the smaller axis and biased slightly upward so the
   * HUD along the bottom never crowds the lowest row.
   */
  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    const usableW = width * 0.92;
    const usableH = height * 0.66;
    const size = Math.min(usableW, usableH);

    const cellRadius = (size / 6) * 0.42;
    const cx = width / 2;
    const cy = height * 0.44;

    const positions = UNIT_LAYOUT.map((p) => ({
      x: cx + (p.x - 0.5) * size,
      y: cy + (p.y - 0.5) * size * 0.94,
    }));

    this.layout = { cx, cy, radius: cellRadius, positions };
    this.background = null; // force a repaint of the static backdrop
  }

  /** Cell under a point, or null. Uses a forgiving radius for touch. */
  hitTest(x: number, y: number, slack = 1.35): number | null {
    const r = this.layout.radius * slack;
    let best: number | null = null;
    let bestDist = r * r;
    for (let id = 0; id < this.layout.positions.length; id++) {
      const p = this.layout.positions[id];
      const dx = x - p.x;
      const dy = y - p.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDist) {
        bestDist = distSq;
        best = id;
      }
    }
    return best;
  }

  positionOf(cell: number): { x: number; y: number } {
    return this.layout.positions[cell] ?? { x: this.layout.cx, y: this.layout.cy };
  }

  /* ---------------------------------------------------------------- *
   * Background
   * ---------------------------------------------------------------- */

  private ensureBackground(theme: BoardTheme, width: number, height: number): HTMLCanvasElement {
    const key = `${theme.id}:${width}x${height}`;
    if (this.background && this.backgroundKey === key) return this.background;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, theme.bgTop);
    gradient.addColorStop(1, theme.bgBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Nebula blooms: a few very large, very soft radial gradients.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < theme.nebula.length * 2; i++) {
      const color = theme.nebula[i % theme.nebula.length];
      const nx = (Math.sin(i * 12.9898) * 0.5 + 0.5) * width;
      const ny = (Math.sin(i * 78.233) * 0.5 + 0.5) * height;
      const nr = Math.max(width, height) * (0.28 + (i % 3) * 0.12);
      const bloom = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
      bloom.addColorStop(0, `${color}55`);
      bloom.addColorStop(0.5, `${color}1e`);
      bloom.addColorStop(1, `${color}00`);
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Starfield. Deterministic so it does not swim between repaints.
    const starCount = Math.floor((width * height) / 5200);
    for (let i = 0; i < starCount; i++) {
      const sx = pseudoRandom(i * 2 + 1) * width;
      const sy = pseudoRandom(i * 2 + 2) * height;
      const size = pseudoRandom(i * 3 + 7) * 1.6 + 0.3;
      const alpha = 0.25 + pseudoRandom(i * 5 + 3) * 0.75;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = theme.starColor;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.background = canvas;
    this.backgroundKey = key;
    return canvas;
  }

  /* ---------------------------------------------------------------- *
   * Main draw
   * ---------------------------------------------------------------- */

  /**
   * Backdrop only. Drawn *outside* the camera transform on purpose: the
   * starfield staying put while the board shakes reads as parallax depth, and
   * it also guarantees the shake can never expose unpainted canvas at the edges.
   *
   * Deliberately takes only what a backdrop needs, so menu screens with no
   * match in progress can paint the sky without inventing a fake game state.
   * The caller is responsible for having set the device-pixel-ratio transform.
   */
  drawBackground(theme: BoardTheme, width: number, height: number, time: number, motion: number): void {
    const ctx = this.ctx;
    ctx.drawImage(this.ensureBackground(theme, width, height), 0, 0);
    this.drawTwinkle(ctx, theme, width, height, time, motion);
  }

  /**
   * The pyramid, its tokens and the black hole. Expects the caller to have
   * applied both the DPR transform and any camera transform first.
   */
  drawBoard(options: RenderOptions): void {
    const ctx = this.ctx;
    this.drawLinks(ctx, options);

    for (let id = 0; id < CELL_COUNT; id++) {
      this.drawCellBase(ctx, id, options);
    }

    if (options.revealedHole !== null && options.holeReveal > 0) {
      this.drawBlackHole(ctx, options);
    }

    for (let id = 0; id < CELL_COUNT; id++) {
      this.drawToken(ctx, id, options);
    }
  }

  /** A few stars breathe, which stops the backdrop feeling like a static image. */
  private drawTwinkle(
    ctx: CanvasRenderingContext2D,
    theme: BoardTheme,
    width: number,
    height: number,
    t: number,
    motion: number,
  ): void {
    ctx.save();
    ctx.fillStyle = theme.starColor;
    for (let i = 0; i < 26; i++) {
      const sx = pseudoRandom(i * 11 + 5) * width;
      const sy = pseudoRandom(i * 13 + 9) * height;
      const phase = pseudoRandom(i * 17 + 2) * TAU;
      const pulse = (Math.sin(t * 1.6 + phase) * 0.5 + 0.5) * motion;
      ctx.globalAlpha = 0.15 + pulse * 0.65;
      const size = 0.8 + pulse * 1.6;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Faint lines between neighbouring cells: the adjacency the game is about. */
  private drawLinks(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
    const { state, theme } = options;
    ctx.save();
    ctx.strokeStyle = theme.linkColor;
    ctx.lineWidth = Math.max(1, this.layout.radius * 0.09);
    ctx.beginPath();
    for (let id = 0; id < CELL_COUNT; id++) {
      if (!isPlayable(state.board[id])) continue;
      const a = this.positionOf(id);
      // Static grid only; wormhole links get their own emphasised pass below.
      for (const n of NEIGHBORS[id]) {
        if (n < id || !isPlayable(state.board[n])) continue;
        const b = this.positionOf(n);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();

    // Wormhole pairs get a bright, animated tie so the link is unmissable.
    ctx.lineWidth = Math.max(1.5, this.layout.radius * 0.12);
    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = 0.35 + Math.sin(options.time * 3) * 0.15 * options.motion;
    ctx.setLineDash([this.layout.radius * 0.5, this.layout.radius * 0.4]);
    ctx.lineDashOffset = -options.time * 30 * options.motion;
    ctx.beginPath();
    for (let id = 0; id < CELL_COUNT; id++) {
      const link = state.board[id].link;
      if (link === null || link < id) continue;
      const a = this.positionOf(id);
      const b = this.positionOf(link);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawCellBase(ctx: CanvasRenderingContext2D, id: number, options: RenderOptions): void {
    const { state, theme, visuals, hoverCell, legalCells, foresight } = options;
    const cell = state.board[id];
    const pos = this.positionOf(id);
    const visual = visuals.get(id) ?? defaultVisual();
    const r = this.layout.radius;

    if (!isPlayable(cell)) {
      this.drawCollapsed(ctx, pos.x, pos.y, r, theme, options.time);
      return;
    }

    // Hidden while the hole is being revealed at this cell.
    if (options.revealedHole === id && options.holeReveal > 0.15) return;

    const isLegal = legalCells.includes(id);
    const isHover = hoverCell === id;
    const highlight = Math.max(visual.highlight, isHover ? 1 : 0);

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Socket
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = theme.cellFill;
    ctx.fill();

    // Rim, brightened for legal targets and further for the hovered cell.
    const rimAlpha = cell.player === null ? (isLegal ? 0.55 : 0.25) + highlight * 0.45 : 0.18;
    ctx.globalAlpha = clamp01(rimAlpha);
    ctx.strokeStyle = isLegal || isHover ? theme.accent : theme.cellStroke;
    ctx.lineWidth = Math.max(1.2, r * (isHover ? 0.13 : 0.08));
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.97, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // A slow breathing ring on legal empty cells draws the eye to where the
    // player can act without shouting over the tokens.
    if (cell.player === null && isLegal) {
      const pulse = (Math.sin(options.time * 2.4 + id * 0.7) * 0.5 + 0.5) * options.motion;
      ctx.globalAlpha = 0.1 + pulse * 0.22 + highlight * 0.3;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.62 + pulse * 0.12), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Foresight overlay: green where the hole would favour the player, red
    // where it would hurt. Only ever shown while the charge is active.
    const hint = foresight?.get(id);
    if (hint !== undefined && cell.player === null) {
      const good = hint > 0;
      ctx.globalAlpha = 0.1 + Math.abs(hint) * 0.35;
      ctx.fillStyle = good ? '#4dffc3' : '#ff5470';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.drawTraits(ctx, cell, r, theme, options.time, options.motion);
    ctx.restore();
  }

  /** Supernova / inverter markings, drawn inside the empty socket. */
  private drawTraits(
    ctx: CanvasRenderingContext2D,
    cell: Cell,
    r: number,
    theme: BoardTheme,
    time: number,
    motion: number,
  ): void {
    if (cell.traits.includes('supernova')) {
      const pulse = (Math.sin(time * 3.2) * 0.5 + 0.5) * motion;
      ctx.save();
      ctx.globalAlpha = 0.5 + pulse * 0.4;
      ctx.strokeStyle = '#ffd75c';
      ctx.lineWidth = Math.max(1, r * 0.09);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + time * 0.6 * motion;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
        ctx.lineTo(Math.cos(a) * r * (0.66 + pulse * 0.1), Math.sin(a) * r * (0.66 + pulse * 0.1));
        ctx.stroke();
      }
      ctx.restore();
    }

    if (cell.traits.includes('inverter')) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#4dffc3';
      ctx.lineWidth = Math.max(1.4, r * 0.11);
      ctx.beginPath();
      ctx.moveTo(-r * 0.34, 0);
      ctx.lineTo(r * 0.34, 0);
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (cell.lockedBy !== null) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#7fe3ff';
      ctx.lineWidth = Math.max(1.2, r * 0.09);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + time * 0.4 * motion;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
        ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawCollapsed(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    theme: BoardTheme,
    time: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = theme.cellStroke;
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.setLineDash([r * 0.28, r * 0.24]);
    ctx.lineDashOffset = time * 6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // Debris where the cell used to be.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = theme.cellStroke;
    for (let i = 0; i < 5; i++) {
      const a = pseudoRandom(i * 3 + 1) * TAU;
      const d = r * (0.15 + pseudoRandom(i * 7 + 2) * 0.4);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.07, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- *
   * Tokens
   * ---------------------------------------------------------------- */

  private drawToken(ctx: CanvasRenderingContext2D, id: number, options: RenderOptions): void {
    const { state, visuals, skinFor } = options;
    const cell = state.board[id];
    if (cell.player === null || cell.value === null) return;

    const visual = visuals.get(id) ?? defaultVisual();
    if (visual.scale <= 0.01) return;

    const skin = skinFor(cell.player);
    const base = this.positionOf(id);
    const r = this.layout.radius;

    // Drop-in: the token falls from above and overshoots slightly.
    const dropOffset = (1 - visual.drop) * -r * 3.2;

    // During the finale, tokens adjacent to the hole are dragged toward it.
    let x = base.x;
    let y = base.y + dropOffset;
    if (visual.pull > 0 && options.revealedHole !== null) {
      const hole = this.positionOf(options.revealedHole);
      x = lerp(base.x, hole.x, visual.pull);
      y = lerp(base.y, hole.y, visual.pull);
    }

    ctx.save();
    ctx.translate(x, y);
    if (visual.spin !== 0) ctx.rotate(visual.spin);

    // Squash and stretch: volume-preserving, so it reads as weight.
    const squash = visual.squash;
    ctx.scale(visual.scale * squash, (visual.scale / squash) * (1 - visual.pull * 0.35));

    const tokenR = r * 0.82;
    this.drawTokenBody(ctx, skin, tokenR, options.time, id, options.motion);

    // The number itself.
    ctx.fillStyle = skin.text;
    ctx.font = `700 ${tokenR * 1.05}px "Rajdhani", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(cell.value), 0, tokenR * 0.06);

    ctx.restore();
  }

  private drawTokenBody(
    ctx: CanvasRenderingContext2D,
    skin: TokenSkin,
    r: number,
    time: number,
    seed: number,
    motion: number,
  ): void {
    ctx.save();
    ctx.shadowBlur = r * 0.7;
    ctx.shadowColor = skin.glow;

    const body = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    body.addColorStop(0, skin.edge);
    body.addColorStop(0.55, skin.core);
    body.addColorStop(1, shade(skin.core, -0.35));
    ctx.fillStyle = body;

    tokenPath(ctx, skin.shape, r, time, seed, motion);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = skin.edge;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.globalAlpha = 0.85;
    tokenPath(ctx, skin.shape, r * 0.94, time, seed, motion);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (skin.sheen) {
      // A soft highlight arc across the upper-left, sold as a curved surface.
      ctx.save();
      ctx.clip();
      const sheen = ctx.createLinearGradient(-r, -r, r * 0.4, r * 0.2);
      sheen.addColorStop(0, 'rgba(255,255,255,0.42)');
      sheen.addColorStop(0.6, 'rgba(255,255,255,0.05)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- *
   * The black hole
   * ---------------------------------------------------------------- */

  private drawBlackHole(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
    const id = options.revealedHole!;
    const pos = this.positionOf(id);
    const skin = options.holeSkin;
    const t = clamp01(options.holeReveal);
    const time = options.time;
    const r = this.layout.radius;

    // Grows past its final size then settles: the collapse "lands".
    const overshoot = Math.sin(clamp01(t * 1.4) * Math.PI) * 0.35 * options.motion;
    const radius = r * (0.15 + t * 0.95 + overshoot);

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Lensing halo behind everything.
    const halo = ctx.createRadialGradient(0, 0, radius * 0.6, 0, 0, radius * 3.4);
    halo.addColorStop(0, `${skin.ringA}66`);
    halo.addColorStop(0.35, `${skin.ringB}33`);
    halo.addColorStop(1, `${skin.ringB}00`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 3.4, 0, TAU);
    ctx.fill();

    switch (skin.style) {
      case 'vortex':
        this.drawVortexArms(ctx, radius, time, skin, options.motion);
        break;
      case 'shard':
        this.drawShardRing(ctx, radius, time, skin, options.motion);
        break;
      case 'prism':
        this.drawPrismRings(ctx, radius, time, skin, options.motion);
        break;
      case 'maw':
        this.drawMaw(ctx, radius, time, skin, options.motion);
        break;
      default:
        this.drawAccretionRing(ctx, radius, time, skin, options.motion);
    }

    // Event horizon: pure void with a hard rim.
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fillStyle = skin.core;
    ctx.fill();
    ctx.strokeStyle = skin.ringA;
    ctx.lineWidth = Math.max(1.5, radius * 0.07);
    ctx.globalAlpha = 0.9;
    ctx.stroke();

    ctx.restore();
  }

  private drawAccretionRing(
    ctx: CanvasRenderingContext2D,
    radius: number,
    time: number,
    skin: HoleSkin,
    motion: number,
  ): void {
    ctx.save();
    ctx.rotate(time * 0.8 * motion);
    for (let i = 0; i < 3; i++) {
      const rr = radius * (1.25 + i * 0.28);
      ctx.globalAlpha = 0.5 - i * 0.13;
      ctx.strokeStyle = i % 2 === 0 ? skin.ringA : skin.ringB;
      ctx.lineWidth = Math.max(1.5, radius * (0.16 - i * 0.035));
      ctx.beginPath();
      ctx.ellipse(0, 0, rr, rr * 0.36, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawVortexArms(
    ctx: CanvasRenderingContext2D,
    radius: number,
    time: number,
    skin: HoleSkin,
    motion: number,
  ): void {
    ctx.save();
    ctx.rotate(time * 1.6 * motion);
    ctx.lineCap = 'round';
    for (let arm = 0; arm < 5; arm++) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = arm % 2 === 0 ? skin.ringA : skin.ringB;
      ctx.lineWidth = Math.max(1.5, radius * 0.13);
      ctx.beginPath();
      for (let s = 0; s <= 22; s++) {
        const k = s / 22;
        const a = (arm / 5) * TAU + k * 2.6;
        const rr = radius * (1.05 + k * 1.9);
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr * 0.55;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawShardRing(
    ctx: CanvasRenderingContext2D,
    radius: number,
    time: number,
    skin: HoleSkin,
    motion: number,
  ): void {
    ctx.save();
    ctx.rotate(-time * 0.5 * motion);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const len = radius * (1.3 + pseudoRandom(i * 5 + 1) * 1.1);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = i % 2 === 0 ? skin.ringA : skin.ringB;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * radius * 1.05, Math.sin(a) * radius * 1.05);
      ctx.lineTo(Math.cos(a + 0.12) * len, Math.sin(a + 0.12) * len);
      ctx.lineTo(Math.cos(a - 0.12) * len, Math.sin(a - 0.12) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPrismRings(
    ctx: CanvasRenderingContext2D,
    radius: number,
    time: number,
    skin: HoleSkin,
    motion: number,
  ): void {
    const colors = [skin.ringA, skin.ringB, '#ffd75c', '#4dffc3'];
    ctx.save();
    for (let i = 0; i < colors.length; i++) {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = Math.max(1.2, radius * 0.09);
      const wobble = Math.sin(time * 2 + i) * radius * 0.08 * motion;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * (1.2 + i * 0.22) + wobble, radius * (1.2 + i * 0.22) * 0.5, (i / colors.length) * Math.PI + time * 0.3 * motion, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMaw(
    ctx: CanvasRenderingContext2D,
    radius: number,
    time: number,
    skin: HoleSkin,
    motion: number,
  ): void {
    ctx.save();
    ctx.rotate(time * 0.35 * motion);
    const teeth = 16;
    ctx.fillStyle = skin.ringB;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * TAU;
      const bite = i % 2 === 0 ? 1.05 : 1.55 + Math.sin(time * 4 + i) * 0.12 * motion;
      const px = Math.cos(a) * radius * bite;
      const py = Math.sin(a) * radius * bite;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = skin.ringA;
    ctx.lineWidth = Math.max(1, radius * 0.05);
    ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function tokenPath(
  ctx: CanvasRenderingContext2D,
  shape: TokenSkin['shape'],
  r: number,
  time: number,
  seed: number,
  motion: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case 'hex':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    case 'gem':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const rr = i % 2 === 0 ? r : r * 0.86;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    case 'star': {
      const spin = time * 0.5 * motion + seed;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + spin;
        const rr = i % 2 === 0 ? r : r * 0.72;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'chip':
      roundedRect(ctx, -r * 0.86, -r * 0.86, r * 1.72, r * 1.72, r * 0.28);
      break;
    case 'ring':
      ctx.arc(0, 0, r, 0, TAU);
      ctx.arc(0, 0, r * 0.52, 0, TAU, true);
      break;
    default:
      ctx.arc(0, 0, r, 0, TAU);
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Deterministic hash-based noise in [0,1). Stable across frames. */
function pseudoRandom(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Lightens (positive) or darkens (negative) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const parsed = hex.replace('#', '');
  const full = parsed.length === 3 ? parsed.split('').map((c) => c + c).join('') : parsed;
  const num = parseInt(full, 16);
  const r = clampByte(((num >> 16) & 0xff) * (1 + amount));
  const g = clampByte(((num >> 8) & 0xff) * (1 + amount));
  const b = clampByte((num & 0xff) * (1 + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export { remap };
