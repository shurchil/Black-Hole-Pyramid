/**
 * The rules engine.
 *
 * Invariant that every code path here must preserve:
 *
 *     playableCells - totalPlacements === 1
 *
 * That single leftover cell is the black hole. Charges are free actions and
 * modifiers adjust the number ladder, so the invariant survives all of them.
 */

import { CELL_COUNT, CORNERS, NEIGHBORS } from './board';
import { CHARGE_LOADOUT_SIZE, DEFAULT_LOADOUT } from './charges';
import { collapsedCellCount, maxNumberFor, wormholeCandidates } from './modifiers';
import { Rng, randomSeed } from './rng';
import type {
  Cell,
  ChargeKind,
  ChargeMove,
  GameState,
  MatchOutcome,
  ModifierId,
  Move,
  PlaceMove,
  PlayerId,
  RuleSet,
  ScoreBreakdown,
} from './types';
import { otherPlayer } from './types';

export interface CreateGameOptions {
  modifiers?: ModifierId[];
  alternatingStart?: boolean;
  chargesEnabled?: boolean;
  moveTimeLimit?: number;
  seed?: number;
  loadouts?: Partial<Record<PlayerId, readonly ChargeKind[]>>;
}

export function defaultRules(overrides: Partial<RuleSet> = {}): RuleSet {
  const modifiers = overrides.modifiers ?? [];
  return {
    maxNumber: overrides.maxNumber ?? maxNumberFor(modifiers),
    alternatingStart: overrides.alternatingStart ?? true,
    modifiers,
    chargesEnabled: overrides.chargesEnabled ?? false,
    moveTimeLimit: overrides.moveTimeLimit ?? 0,
  };
}

function emptyCell(id: number): Cell {
  return {
    id,
    player: null,
    value: null,
    traits: [],
    link: null,
    lockedUntilTurn: -1,
    lockedBy: null,
  };
}

export function createGame(options: CreateGameOptions = {}): GameState {
  const seed = options.seed ?? randomSeed();
  const rng = new Rng(seed);
  const modifiers = options.modifiers ?? [];

  const rules: RuleSet = {
    maxNumber: maxNumberFor(modifiers),
    alternatingStart: options.alternatingStart ?? true,
    modifiers,
    chargesEnabled: options.chargesEnabled ?? false,
    moveTimeLimit: options.moveTimeLimit ?? 0,
  };

  const board: Cell[] = Array.from({ length: CELL_COUNT }, (_, id) => emptyCell(id));
  applyModifiersToBoard(board, rules, rng);

  const loadout = (p: PlayerId): ChargeKind[] => {
    const requested = options.loadouts?.[p] ?? DEFAULT_LOADOUT;
    return requested.slice(0, CHARGE_LOADOUT_SIZE) as ChargeKind[];
  };

  const state: GameState = {
    board,
    rules,
    turnIndex: 0,
    totalTurns: rules.maxNumber * 2,
    activePlayer: 'P1',
    currentNumber: 0,
    isFinished: false,
    blackHoleIndex: null,
    scores: { P1: 0, P2: 0 },
    breakdown: null,
    winner: null,
    charges: {
      P1: rules.chargesEnabled ? loadout('P1').map((kind) => ({ kind, used: false })) : [],
      P2: rules.chargesEnabled ? loadout('P2').map((kind) => ({ kind, used: false })) : [],
    },
    chargeUsedThisTurn: false,
    history: [],
    seed,
  };

  state.activePlayer = playerForTurn(rules, 0);
  state.currentNumber = numberForTurn(rules, 0);
  return state;
}

function applyModifiersToBoard(board: Cell[], rules: RuleSet, rng: Rng): void {
  const ids = board.map((c) => c.id);

  if (rules.modifiers.includes('collapsedStar')) {
    // Never destroy the apex or the two bottom corners: those are the most
    // interesting cells to fight over, and removing them flattens the board.
    const protectedCells = new Set<number>(CORNERS);
    const pool = ids.filter((id) => !protectedCells.has(id));
    for (const id of rng.sample(pool, collapsedCellCount(rules.modifiers))) {
      board[id].traits.push('collapsed');
    }
  }

  const free = () => ids.filter((id) => !board[id].traits.includes('collapsed'));

  if (rules.modifiers.includes('supernovae')) {
    for (const id of rng.sample(free(), 2)) board[id].traits.push('supernova');
  }

  if (rules.modifiers.includes('inverters')) {
    const pool = free().filter((id) => !board[id].traits.includes('supernova'));
    for (const id of rng.sample(pool, 1)) board[id].traits.push('inverter');
  }

  if (rules.modifiers.includes('wormholes')) {
    const usable = new Set(free());
    const pairs = wormholeCandidates().filter(([a, b]) => usable.has(a) && usable.has(b));
    if (pairs.length > 0) {
      const [a, b] = rng.pick(pairs);
      board[a].traits.push('wormhole');
      board[b].traits.push('wormhole');
      board[a].link = b;
      board[b].link = a;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Turn order and the number ladder
 * ------------------------------------------------------------------ */

export function numberForTurn(rules: RuleSet, turnIndex: number): number {
  const round = Math.floor(turnIndex / 2);
  return rules.modifiers.includes('reversedFlow') ? rules.maxNumber - round : round + 1;
}

export function playerForTurn(rules: RuleSet, turnIndex: number): PlayerId {
  const round = Math.floor(turnIndex / 2);
  const first: PlayerId = rules.alternatingStart && round % 2 === 1 ? 'P2' : 'P1';
  return turnIndex % 2 === 0 ? first : otherPlayer(first);
}

/* ------------------------------------------------------------------ *
 * Adjacency (wormholes make it dynamic)
 * ------------------------------------------------------------------ */

export function neighborsOf(state: GameState, id: number): number[] {
  const cell = state.board[id];
  if (cell.link === null) return NEIGHBORS[id];
  const linked = NEIGHBORS[id].slice();
  if (!linked.includes(cell.link)) linked.push(cell.link);
  return linked;
}

/** Cells exactly two steps from `id`, used by the Deep Gravity modifier. */
export function ringTwoOf(state: GameState, id: number): number[] {
  const inner = new Set(neighborsOf(state, id));
  const out = new Set<number>();
  for (const n of inner) {
    for (const nn of neighborsOf(state, n)) {
      if (nn !== id && !inner.has(nn)) out.add(nn);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Legality
 * ------------------------------------------------------------------ */

export function isPlayable(cell: Cell): boolean {
  return !cell.traits.includes('collapsed');
}

export function isCellFrozenFor(state: GameState, cell: Cell, player: PlayerId): boolean {
  return cell.lockedBy !== null && cell.lockedBy !== player && state.turnIndex <= cell.lockedUntilTurn;
}

export function legalPlacements(state: GameState): number[] {
  if (state.isFinished) return [];
  const open = state.board.filter((c) => c.player === null && isPlayable(c));
  const allowed = open.filter((c) => !isCellFrozenFor(state, c, state.activePlayer));
  // Defensive: a stasis lock must never be able to stall the match.
  return (allowed.length > 0 ? allowed : open).map((c) => c.id);
}

export function isLegalPlace(state: GameState, cellId: number): boolean {
  return legalPlacements(state).includes(cellId);
}

export function availableCharges(state: GameState, player: PlayerId): ChargeKind[] {
  if (!state.rules.chargesEnabled || state.chargeUsedThisTurn) return [];
  return state.charges[player].filter((c) => !c.used).map((c) => c.kind);
}

/** Every legal charge activation for the player to move, fully targeted. */
export function legalCharges(state: GameState): ChargeMove[] {
  if (state.isFinished) return [];
  const player = state.activePlayer;
  const kinds = availableCharges(state, player);
  if (kinds.length === 0) return [];

  const own = state.board.filter((c) => c.player === player).map((c) => c.id);
  const enemy = state.board.filter((c) => c.player === otherPlayer(player)).map((c) => c.id);
  const empty = state.board.filter((c) => c.player === null && isPlayable(c)).map((c) => c.id);

  const moves: ChargeMove[] = [];
  for (const kind of kinds) {
    switch (kind) {
      case 'singularityShift':
        for (const a of own) {
          for (const b of enemy) moves.push({ kind: 'charge', charge: kind, target: a, target2: b });
        }
        break;
      case 'stasisField':
        // Freezing the last remaining cell would decide nothing and risks a stall.
        if (empty.length > 1) {
          for (const a of empty) moves.push({ kind: 'charge', charge: kind, target: a });
        }
        break;
      case 'dampener':
        for (const a of own) {
          if ((state.board[a].value ?? 0) > 1) moves.push({ kind: 'charge', charge: kind, target: a });
        }
        break;
      case 'foresight':
        moves.push({ kind: 'charge', charge: kind, target: -1 });
        break;
    }
  }
  return moves;
}

export function isLegalMove(state: GameState, move: Move): boolean {
  if (state.isFinished) return false;
  if (move.kind === 'place') return isLegalPlace(state, move.cell);
  return legalCharges(state).some(
    (c) => c.charge === move.charge && c.target === move.target && c.target2 === move.target2,
  );
}

/* ------------------------------------------------------------------ *
 * State transitions
 * ------------------------------------------------------------------ */

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    board: state.board.map((c) => ({ ...c, traits: c.traits.slice() })),
    rules: { ...state.rules, modifiers: state.rules.modifiers.slice() },
    scores: { ...state.scores },
    charges: {
      P1: state.charges.P1.map((c) => ({ ...c })),
      P2: state.charges.P2.map((c) => ({ ...c })),
    },
    history: state.history.slice(),
    breakdown: state.breakdown
      ? {
          contributions: state.breakdown.contributions.map((c) => ({ ...c })),
          totals: { ...state.breakdown.totals },
          touching: { ...state.breakdown.touching },
          peak: { ...state.breakdown.peak },
        }
      : null,
  };
}

/** Applies any legal move and returns the resulting state. Never mutates input. */
export function applyMove(state: GameState, move: Move): GameState {
  if (!isLegalMove(state, move)) {
    throw new Error(`Illegal move: ${JSON.stringify(move)}`);
  }
  return move.kind === 'place' ? applyPlace(state, move) : applyCharge(state, move);
}

function applyPlace(state: GameState, move: PlaceMove): GameState {
  const next = cloneState(state);
  const cell = next.board[move.cell];
  cell.player = next.activePlayer;
  cell.value = next.currentNumber;

  next.history.push({
    move,
    player: next.activePlayer,
    value: next.currentNumber,
    turnIndex: next.turnIndex,
  });

  next.turnIndex += 1;
  next.chargeUsedThisTurn = false;

  if (next.turnIndex >= next.totalTurns) {
    return evaluateGame(next);
  }

  next.activePlayer = playerForTurn(next.rules, next.turnIndex);
  next.currentNumber = numberForTurn(next.rules, next.turnIndex);
  return next;
}

function applyCharge(state: GameState, move: ChargeMove): GameState {
  const next = cloneState(state);
  const player = next.activePlayer;

  switch (move.charge) {
    case 'singularityShift': {
      const a = next.board[move.target];
      const b = next.board[move.target2!];
      const tmpPlayer = a.player;
      const tmpValue = a.value;
      a.player = b.player;
      a.value = b.value;
      b.player = tmpPlayer;
      b.value = tmpValue;
      break;
    }
    case 'stasisField': {
      const cell = next.board[move.target];
      cell.lockedBy = player;
      // Locks through the opponent's very next placement, then expires.
      cell.lockedUntilTurn = next.turnIndex + 1;
      break;
    }
    case 'dampener': {
      const cell = next.board[move.target];
      if (cell.value !== null) cell.value = Math.max(1, Math.floor(cell.value / 2));
      break;
    }
    case 'foresight':
      // Purely informational: the scene reveals the projected hole.
      break;
  }

  const charge = next.charges[player].find((c) => c.kind === move.charge && !c.used);
  if (charge) charge.used = true;
  next.chargeUsedThisTurn = true;
  next.history.push({ move, player, value: null, turnIndex: next.turnIndex });
  return next;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/** Where the black hole will form, or null while more than one cell is open. */
export function findBlackHole(state: GameState): number | null {
  const open = state.board.filter((c) => c.player === null && isPlayable(c));
  return open.length === 1 ? open[0].id : null;
}

/**
 * Effective value of a cell if the black hole sits at `hole`.
 * Order of effects: supernova doubling, then inverter sign flip, then the
 * Deep Gravity halving for the outer ring (truncated toward zero).
 */
export function effectiveValue(state: GameState, cellId: number, ring: 1 | 2): { value: number; note?: string } {
  const cell = state.board[cellId];
  if (cell.value === null) return { value: 0 };
  let value = cell.value;
  let note: string | undefined;

  if (cell.traits.includes('supernova')) {
    value *= 2;
    note = 'supernova';
  }
  if (cell.traits.includes('inverter')) {
    value = -value;
    note = note ? `${note}+inverter` : 'inverter';
  }
  if (ring === 2) {
    value = Math.trunc(value / 2);
    note = note ? `${note}+deep` : 'deep';
  }
  return { value, note };
}

export function scoreForHole(state: GameState, hole: number): ScoreBreakdown {
  const breakdown: ScoreBreakdown = {
    contributions: [],
    totals: { P1: 0, P2: 0 },
    touching: { P1: 0, P2: 0 },
    peak: { P1: 0, P2: 0 },
  };

  const rings: Array<[number[], 1 | 2]> = [[neighborsOf(state, hole), 1]];
  if (state.rules.modifiers.includes('doubleGravity')) {
    rings.push([ringTwoOf(state, hole), 2]);
  }

  for (const [cells, ring] of rings) {
    for (const id of cells) {
      const cell = state.board[id];
      if (cell.player === null || cell.value === null) continue;
      const { value, note } = effectiveValue(state, id, ring);
      breakdown.contributions.push({
        cell: id,
        player: cell.player,
        base: cell.value,
        effective: value,
        note,
      });
      breakdown.totals[cell.player] += value;
      breakdown.touching[cell.player] += 1;
      breakdown.peak[cell.player] = Math.max(breakdown.peak[cell.player], value);
    }
  }

  breakdown.contributions.sort((a, b) => a.cell - b.cell);
  return breakdown;
}

/**
 * Lowest score wins. Ties fall through to two readable tiebreaks before a draw:
 * first the lower single worst number (you shielded your big values better),
 * then the smaller number of cells caught in the pull.
 */
export function decideWinner(breakdown: ScoreBreakdown): MatchOutcome {
  const { totals, peak, touching } = breakdown;
  if (totals.P1 !== totals.P2) return totals.P1 < totals.P2 ? 'P1' : 'P2';
  if (peak.P1 !== peak.P2) return peak.P1 < peak.P2 ? 'P1' : 'P2';
  if (touching.P1 !== touching.P2) return touching.P1 < touching.P2 ? 'P1' : 'P2';
  return 'DRAW';
}

export function evaluateGame(state: GameState): GameState {
  const next = cloneState(state);
  const hole = findBlackHole(next);
  if (hole === null) {
    throw new Error('evaluateGame called before exactly one cell remained open');
  }
  const breakdown = scoreForHole(next, hole);
  next.isFinished = true;
  next.blackHoleIndex = hole;
  next.breakdown = breakdown;
  next.scores = { ...breakdown.totals };
  next.winner = decideWinner(breakdown);
  return next;
}

/* ------------------------------------------------------------------ *
 * Convenience helpers used by the UI and the AI
 * ------------------------------------------------------------------ */

/** Numbers a player still has in hand, in the order they will be placed. */
export function remainingNumbers(state: GameState, player: PlayerId): number[] {
  const numbers: number[] = [];
  for (let t = state.turnIndex; t < state.totalTurns; t++) {
    if (playerForTurn(state.rules, t) === player) numbers.push(numberForTurn(state.rules, t));
  }
  return numbers;
}

/** Sanity check on the "exactly one cell is left over" invariant. */
export function assertInvariant(state: GameState): void {
  const playable = state.board.filter(isPlayable).length;
  if (playable - state.totalTurns !== 1) {
    throw new Error(
      `Board invariant violated: ${playable} playable cells for ${state.totalTurns} placements`,
    );
  }
}
