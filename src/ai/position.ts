/**
 * A flattened, mutable mirror of `GameState` built purely for search speed.
 *
 * `applyMove` in the rules engine returns a fresh immutable state, which is
 * exactly what the UI wants and exactly what a search visiting hundreds of
 * thousands of nodes cannot afford. This class does make/unmake on typed
 * arrays instead, and is validated against the real engine in the tests.
 */

import { CELL_COUNT, NEIGHBORS } from '../core/board';
import { numberForTurn, playerForTurn } from '../core/rules';
import type { GameState, PlayerId, RuleSet } from '../core/types';

export const EMPTY = 0;
export const P1 = 1;
export const P2 = 2;
export const COLLAPSED = 3;

export type Side = typeof P1 | typeof P2;

export function sideOf(player: PlayerId): Side {
  return player === 'P1' ? P1 : P2;
}

export function playerOf(side: Side): PlayerId {
  return side === P1 ? 'P1' : 'P2';
}

export class Position {
  readonly owner: Int8Array;
  readonly val: Int8Array;
  readonly adj: number[][];
  readonly ring2: number[][];
  readonly supernova: Uint8Array;
  readonly inverter: Uint8Array;
  readonly deepGravity: boolean;
  readonly rules: RuleSet;
  readonly totalTurns: number;

  /** Empty playable cells, partitioned so `empties[0..emptyCount)` is live. */
  private readonly empties: Int32Array;
  private readonly emptyPos: Int32Array;
  emptyCount: number;

  turnIndex: number;

  /** Stasis locks, honoured for the one turn they last. */
  private readonly lockedBy: Int8Array;
  private readonly lockedUntil: Int32Array;

  constructor(state: GameState) {
    this.owner = new Int8Array(CELL_COUNT);
    this.val = new Int8Array(CELL_COUNT);
    this.supernova = new Uint8Array(CELL_COUNT);
    this.inverter = new Uint8Array(CELL_COUNT);
    this.lockedBy = new Int8Array(CELL_COUNT);
    this.lockedUntil = new Int32Array(CELL_COUNT).fill(-1);
    this.empties = new Int32Array(CELL_COUNT);
    this.emptyPos = new Int32Array(CELL_COUNT).fill(-1);
    this.rules = state.rules;
    this.totalTurns = state.totalTurns;
    this.turnIndex = state.turnIndex;
    this.deepGravity = state.rules.modifiers.includes('doubleGravity');

    // Adjacency, including any wormhole link.
    this.adj = NEIGHBORS.map((list, id) => {
      const cell = state.board[id];
      if (cell.link === null) return list.slice();
      const extended = list.slice();
      if (!extended.includes(cell.link)) extended.push(cell.link);
      return extended;
    });

    this.ring2 = this.adj.map((_, id) => {
      const inner = new Set(this.adj[id]);
      const out = new Set<number>();
      for (const n of inner) {
        for (const nn of this.adj[n]) {
          if (nn !== id && !inner.has(nn)) out.add(nn);
        }
      }
      return [...out];
    });

    let count = 0;
    for (let id = 0; id < CELL_COUNT; id++) {
      const cell = state.board[id];
      if (cell.traits.includes('supernova')) this.supernova[id] = 1;
      if (cell.traits.includes('inverter')) this.inverter[id] = 1;
      if (cell.lockedBy !== null) {
        this.lockedBy[id] = sideOf(cell.lockedBy);
        this.lockedUntil[id] = cell.lockedUntilTurn;
      }

      if (cell.traits.includes('collapsed')) {
        this.owner[id] = COLLAPSED;
      } else if (cell.player === null) {
        this.owner[id] = EMPTY;
        this.empties[count] = id;
        this.emptyPos[id] = count;
        count++;
      } else {
        this.owner[id] = sideOf(cell.player);
        this.val[id] = cell.value ?? 0;
      }
    }
    this.emptyCount = count;
  }

  get sideToMove(): Side {
    return sideOf(playerForTurn(this.rules, this.turnIndex));
  }

  get numberToPlace(): number {
    return numberForTurn(this.rules, this.turnIndex);
  }

  get isTerminal(): boolean {
    return this.turnIndex >= this.totalTurns;
  }

  /** Live empty cells. The returned view is only valid until the next move. */
  emptyCells(): number[] {
    const out: number[] = new Array(this.emptyCount);
    for (let i = 0; i < this.emptyCount; i++) out[i] = this.empties[i];
    return out;
  }

  /** Placements the side to move may legally make, honouring stasis locks. */
  legalMoves(): number[] {
    const side = this.sideToMove;
    const all = this.emptyCells();
    const allowed = all.filter(
      (id) => this.lockedBy[id] === 0 || this.lockedBy[id] === side || this.turnIndex > this.lockedUntil[id],
    );
    return allowed.length > 0 ? allowed : all;
  }

  make(cell: number): void {
    this.owner[cell] = this.sideToMove;
    this.val[cell] = this.numberToPlace;

    // Swap-remove from the live empty set; the cell parks at the boundary so
    // `unmake` can restore it by simply growing the count back.
    const pos = this.emptyPos[cell];
    const last = this.empties[this.emptyCount - 1];
    this.empties[pos] = last;
    this.emptyPos[last] = pos;
    this.empties[this.emptyCount - 1] = cell;
    this.emptyPos[cell] = this.emptyCount - 1;
    this.emptyCount--;

    this.turnIndex++;
  }

  unmake(cell: number): void {
    this.turnIndex--;
    this.emptyCount++;
    this.owner[cell] = EMPTY;
    this.val[cell] = 0;
  }

  /** Effective contribution of a placed cell when the hole sits `ring` steps away. */
  effective(cell: number, ring: 1 | 2): number {
    let v = this.val[cell];
    if (this.supernova[cell]) v *= 2;
    if (this.inverter[cell]) v = -v;
    if (ring === 2) v = Math.trunc(v / 2);
    return v;
  }

  /**
   * Score both sides would take if the black hole formed at `hole`.
   * Returns `[p1, p2]`.
   */
  scoreAt(hole: number): [number, number] {
    let p1 = 0;
    let p2 = 0;
    const inner = this.adj[hole];
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      const o = this.owner[c];
      if (o !== P1 && o !== P2) continue;
      const v = this.effective(c, 1);
      if (o === P1) p1 += v;
      else p2 += v;
    }
    if (this.deepGravity) {
      const outer = this.ring2[hole];
      for (let i = 0; i < outer.length; i++) {
        const c = outer[i];
        const o = this.owner[c];
        if (o !== P1 && o !== P2) continue;
        const v = this.effective(c, 2);
        if (o === P1) p1 += v;
        else p2 += v;
      }
    }
    return [p1, p2];
  }

  /** The cell that is about to become the black hole, once only one is left. */
  get holeCell(): number {
    return this.empties[0];
  }
}
