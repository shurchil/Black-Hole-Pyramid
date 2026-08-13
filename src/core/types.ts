/**
 * Core type definitions for Black Hole Pyramid.
 *
 * Everything in `src/core` is pure: no DOM, no timers, no randomness that
 * isn't threaded through an explicit seeded RNG. That keeps the rules
 * testable and lets the AI worker reuse the exact same engine the UI runs.
 */

export type PlayerId = 'P1' | 'P2';

export const PLAYERS: readonly PlayerId[] = ['P1', 'P2'] as const;

export function otherPlayer(p: PlayerId): PlayerId {
  return p === 'P1' ? 'P2' : 'P1';
}

/** Cell decorations placed by board modifiers before the match starts. */
export type CellTrait =
  /** Value placed here counts double when the cell touches the black hole. */
  | 'supernova'
  /** Value placed here counts as negative when the cell touches the black hole. */
  | 'inverter'
  /** Cell is destroyed at setup: nobody can play here, it can't be the black hole. */
  | 'collapsed'
  /** Half of a wormhole pair: linked to exactly one other wormhole cell. */
  | 'wormhole';

export interface Cell {
  id: number;
  player: PlayerId | null;
  value: number | null;
  /** Traits applied by modifiers. Usually empty. */
  traits: CellTrait[];
  /** For 'wormhole' cells: the id of the linked partner cell. */
  link: number | null;
  /**
   * Set when a Stasis Field charge locks this cell. The value is the
   * `turnIndex` up to (and including) which the cell stays locked.
   */
  lockedUntilTurn: number;
  /** Which player owns the stasis lock (they may still play the cell). */
  lockedBy: PlayerId | null;
}

/** Once-per-match abilities. Players bring two into a Cosmic match. */
export type ChargeKind =
  /** Swap one of your placed numbers with one of the opponent's. */
  | 'singularityShift'
  /** Lock an empty cell so the opponent cannot use it on their next turn. */
  | 'stasisField'
  /** Halve (rounded down) one of your own placed numbers, permanently. */
  | 'dampener'
  /** Reveal the AI's projected black hole and best replies for one turn. */
  | 'foresight';

export interface ChargeState {
  kind: ChargeKind;
  used: boolean;
}

/** Match-wide rule modifiers, rolled per match in Cosmic/Gauntlet/Daily. */
export type ModifierId =
  | 'supernovae'
  | 'wormholes'
  | 'inverters'
  | 'collapsedStar'
  | 'reversedFlow'
  | 'doubleGravity';

export interface RuleSet {
  /** Highest number each player places. Classic = 10. */
  maxNumber: number;
  /**
   * When true, the player who places first alternates every round, which
   * measurably flattens the first-player advantage of the classic rules.
   */
  alternatingStart: boolean;
  /** Active board/scoring modifiers for this match. */
  modifiers: ModifierId[];
  /** Cosmic charges are enabled for both players. */
  chargesEnabled: boolean;
  /** Seconds allowed per move; 0 disables the clock. */
  moveTimeLimit: number;
}

export type MoveKind = 'place' | 'charge';

export interface PlaceMove {
  kind: 'place';
  cell: number;
}

export interface ChargeMove {
  kind: 'charge';
  charge: ChargeKind;
  /** Primary target cell (meaning depends on the charge). */
  target: number;
  /** Secondary target cell, used by singularityShift. */
  target2?: number;
}

export type Move = PlaceMove | ChargeMove;

export interface MoveRecord {
  move: Move;
  player: PlayerId;
  /** Number that was placed, for 'place' moves. */
  value: number | null;
  turnIndex: number;
}

export type MatchOutcome = PlayerId | 'DRAW';

export interface ScoreBreakdown {
  /** Raw contribution per neighbouring cell, in board order. */
  contributions: Array<{ cell: number; player: PlayerId; base: number; effective: number; note?: string }>;
  totals: Record<PlayerId, number>;
  /** Count of own numbers touching the hole, used as first tiebreak. */
  touching: Record<PlayerId, number>;
  /** Highest single effective value touching the hole, second tiebreak. */
  peak: Record<PlayerId, number>;
}

export interface GameState {
  board: Cell[];
  rules: RuleSet;
  /** 0-based index of the next placement to happen. */
  turnIndex: number;
  /** Total number of placements this match will contain. */
  totalTurns: number;
  activePlayer: PlayerId;
  currentNumber: number;
  isFinished: boolean;
  blackHoleIndex: number | null;
  scores: Record<PlayerId, number>;
  breakdown: ScoreBreakdown | null;
  winner: MatchOutcome | null;
  charges: Record<PlayerId, ChargeState[]>;
  /** True once the active player has spent a charge this turn. */
  chargeUsedThisTurn: boolean;
  history: MoveRecord[];
  /** Seed used to roll modifiers; kept so matches are reproducible. */
  seed: number;
}
