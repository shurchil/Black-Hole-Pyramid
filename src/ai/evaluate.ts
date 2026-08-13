/**
 * Position evaluation.
 *
 * The only score that exists in this game is the one that materialises on the
 * final turn, so a mid-game heuristic has to answer: "if the music stopped
 * now, how badly would each side be hurt by wherever the hole ends up?"
 *
 * For every still-empty cell `h` we compute `delta(h)` — how much worse the
 * opponent's position is than ours if the hole formed at `h`. Positive is good
 * for us, because in this game the *lower* score wins.
 *
 * The mean of `delta` over all empty cells is exactly the exposure term you'd
 * derive by hand: each placed number contributes in proportion to how many
 * empty cells still touch it. A big number ringed by filled cells is safe; a
 * big number with open space around it is a liability. On top of that we add a
 * control term for the best and worst holes still reachable, weighted toward
 * whoever is on move.
 */

import { P1, Position, type Side } from './position';

export const WIN_BONUS = 1000;

export interface EvalWeights {
  /** Weight on the average outcome across all remaining holes. */
  expected: number;
  /** Weight on the reachable extremes (who can steer the hole where). */
  control: number;
  /** How much being on move tilts the control term. */
  tempo: number;
}

/**
 * Tuned by self-play (see `scripts/probe-eval.ts`). Against an opponent that
 * plays randomly until the endgame and perfectly after it, this evaluation
 * scores ~83% at only two plies of lookahead, so the exposure term is doing
 * the real work. A heavy `control` weight measurably destabilised the search,
 * so it stays deliberately small.
 */
export const DEFAULT_WEIGHTS: EvalWeights = {
  expected: 1,
  control: 0.2,
  tempo: 0.15,
};

/**
 * Final, exact value of a finished position from `me`'s point of view.
 * Any win outranks any non-win; the margin only orders wins among themselves.
 */
export function terminalValue(pos: Position, me: Side): number {
  const [p1, p2] = pos.scoreAt(pos.holeCell);
  const mine = me === P1 ? p1 : p2;
  const theirs = me === P1 ? p2 : p1;
  const margin = theirs - mine;
  if (margin > 0) return WIN_BONUS + margin * 10;
  if (margin < 0) return -WIN_BONUS + margin * 10;
  return 0;
}

/** Heuristic value of an unfinished position from `me`'s point of view. */
export function evaluate(pos: Position, me: Side, weights: EvalWeights = DEFAULT_WEIGHTS): number {
  const empties = pos.emptyCells();
  const n = empties.length;
  if (n === 0) return terminalValue(pos, me);

  let sum = 0;
  let best = -Infinity;
  let worst = Infinity;

  for (let i = 0; i < n; i++) {
    const [p1, p2] = pos.scoreAt(empties[i]);
    const mine = me === P1 ? p1 : p2;
    const theirs = me === P1 ? p2 : p1;
    const delta = theirs - mine;
    sum += delta;
    if (delta > best) best = delta;
    if (delta < worst) worst = delta;
  }

  const expected = sum / n;
  const onMove = pos.sideToMove === me;
  const tilt = onMove ? weights.tempo : -weights.tempo;
  const control = (0.5 + tilt) * best + (0.5 - tilt) * worst;

  return weights.expected * expected + weights.control * control;
}

/**
 * Cheap ordering key for a candidate placement: how good the position looks
 * immediately afterwards. Good ordering is what makes alpha-beta actually
 * prune, so this earns its cost many times over at depth.
 */
export function moveOrderKey(pos: Position, cell: number, me: Side): number {
  pos.make(cell);
  const v = pos.isTerminal ? terminalValue(pos, me) : evaluate(pos, me);
  pos.unmake(cell);
  return v;
}
