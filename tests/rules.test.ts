import { describe, expect, it } from 'vitest';
import { CELL_COUNT } from '../src/core/board';
import { Rng } from '../src/core/rng';
import {
  applyMove,
  assertInvariant,
  createGame,
  decideWinner,
  findBlackHole,
  isPlayable,
  legalCharges,
  legalPlacements,
  neighborsOf,
  numberForTurn,
  playerForTurn,
  remainingNumbers,
  ringTwoOf,
  scoreForHole,
} from '../src/core/rules';
import type { GameState, ModifierId } from '../src/core/types';

function playOut(state: GameState, rng: Rng): GameState {
  let s = state;
  while (!s.isFinished) {
    const moves = legalPlacements(s);
    expect(moves.length).toBeGreaterThan(0);
    s = applyMove(s, { kind: 'place', cell: rng.pick(moves) });
  }
  return s;
}

describe('turn order and number ladder', () => {
  it('classic order: P1 then P2 place the same number each round', () => {
    const g = createGame({ alternatingStart: false });
    expect(g.totalTurns).toBe(20);
    for (let t = 0; t < 20; t++) {
      expect(numberForTurn(g.rules, t)).toBe(Math.floor(t / 2) + 1);
      expect(playerForTurn(g.rules, t)).toBe(t % 2 === 0 ? 'P1' : 'P2');
    }
  });

  it('alternating start hands the first placement to each player equally often', () => {
    const g = createGame({ alternatingStart: true });
    let p1First = 0;
    for (let round = 0; round < g.rules.maxNumber; round++) {
      if (playerForTurn(g.rules, round * 2) === 'P1') p1First++;
    }
    expect(p1First).toBe(g.rules.maxNumber / 2);
  });

  it('both players place every number exactly once', () => {
    const g = createGame();
    for (const p of ['P1', 'P2'] as const) {
      const numbers = remainingNumbers(g, p).slice().sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  it('reverse flow runs the ladder from 10 down to 1', () => {
    const g = createGame({ modifiers: ['reversedFlow'] });
    expect(numberForTurn(g.rules, 0)).toBe(10);
    expect(numberForTurn(g.rules, 19)).toBe(1);
    expect(remainingNumbers(g, 'P1')).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

describe('the one-cell-left invariant', () => {
  const combos: ModifierId[][] = [
    [],
    ['supernovae'],
    ['wormholes'],
    ['inverters'],
    ['collapsedStar'],
    ['reversedFlow'],
    ['doubleGravity'],
    ['collapsedStar', 'doubleGravity'],
    ['supernovae', 'wormholes', 'inverters'],
    ['collapsedStar', 'reversedFlow', 'wormholes'],
  ];

  for (const modifiers of combos) {
    it(`holds for [${modifiers.join(', ') || 'classic'}]`, () => {
      for (let seed = 0; seed < 25; seed++) {
        const g = createGame({ modifiers, seed });
        assertInvariant(g);
        const done = playOut(g, new Rng(seed * 7919 + 1));
        expect(done.isFinished).toBe(true);
        expect(done.blackHoleIndex).not.toBeNull();
        const open = done.board.filter((c) => c.player === null && isPlayable(c));
        expect(open).toHaveLength(1);
        expect(open[0].id).toBe(done.blackHoleIndex);
      }
    });
  }

  it('collapsed star removes exactly two cells and shortens the ladder', () => {
    const g = createGame({ modifiers: ['collapsedStar'], seed: 42 });
    expect(g.board.filter((c) => c.traits.includes('collapsed'))).toHaveLength(2);
    expect(g.rules.maxNumber).toBe(9);
    expect(g.totalTurns).toBe(18);
  });
});

describe('scoring', () => {
  it('sums only the numbers touching the hole, lowest total wins', () => {
    // Hand-built position: hole at 0, whose neighbours are 1 and 2.
    const g = createGame({ alternatingStart: false, seed: 1 });
    g.board[1].player = 'P1';
    g.board[1].value = 3;
    g.board[2].player = 'P2';
    g.board[2].value = 9;
    // A big number far away must not count.
    g.board[20].player = 'P1';
    g.board[20].value = 10;

    const breakdown = scoreForHole(g, 0);
    expect(breakdown.totals).toEqual({ P1: 3, P2: 9 });
    expect(decideWinner(breakdown)).toBe('P1');
  });

  it('supernova doubles, inverter subtracts', () => {
    const g = createGame({ seed: 1 });
    g.board[1].traits.push('supernova');
    g.board[1].player = 'P1';
    g.board[1].value = 4;
    g.board[2].traits.push('inverter');
    g.board[2].player = 'P2';
    g.board[2].value = 6;

    const breakdown = scoreForHole(g, 0);
    expect(breakdown.totals.P1).toBe(8);
    expect(breakdown.totals.P2).toBe(-6);
    expect(decideWinner(breakdown)).toBe('P2');
  });

  it('deep gravity adds a half-value outer ring', () => {
    const g = createGame({ modifiers: ['doubleGravity'], seed: 1 });
    // Cell 3 is two steps from cell 0 (0-1-3).
    expect(ringTwoOf(g, 0)).toContain(3);
    g.board[1].player = 'P1';
    g.board[1].value = 2;
    g.board[3].player = 'P2';
    g.board[3].value = 7;

    const breakdown = scoreForHole(g, 0);
    expect(breakdown.totals.P1).toBe(2);
    expect(breakdown.totals.P2).toBe(3); // trunc(7 / 2)
  });

  it('a wormhole makes two distant cells neighbours for scoring', () => {
    const g = createGame({ seed: 1 });
    g.board[0].link = 20;
    g.board[20].link = 0;
    g.board[0].traits.push('wormhole');
    g.board[20].traits.push('wormhole');
    expect(neighborsOf(g, 0)).toContain(20);
    expect(neighborsOf(g, 20)).toContain(0);
  });

  it('breaks ties on the worst single number, then on cells touched', () => {
    const base = { contributions: [], totals: { P1: 8, P2: 8 } };
    expect(
      decideWinner({ ...base, touching: { P1: 2, P2: 2 }, peak: { P1: 5, P2: 6 } } as never),
    ).toBe('P1');
    expect(
      decideWinner({ ...base, touching: { P1: 3, P2: 2 }, peak: { P1: 4, P2: 4 } } as never),
    ).toBe('P2');
    expect(
      decideWinner({ ...base, touching: { P1: 2, P2: 2 }, peak: { P1: 4, P2: 4 } } as never),
    ).toBe('DRAW');
  });
});

describe('cosmic charges', () => {
  it('are free actions: they never consume a placement', () => {
    // Fixed order (P1, P2, P1, P2, ...) so the acting player is unambiguous.
    let g = createGame({
      chargesEnabled: true,
      alternatingStart: false,
      loadouts: { P1: ['dampener', 'stasisField'] },
      seed: 3,
    });
    g = applyMove(g, { kind: 'place', cell: 12 }); // P1's 1
    g = applyMove(g, { kind: 'place', cell: 0 }); // P2's 1
    g = applyMove(g, { kind: 'place', cell: 13 }); // P1's 2
    g = applyMove(g, { kind: 'place', cell: 1 }); // P2's 2
    expect(g.activePlayer).toBe('P1');

    const before = g.turnIndex;
    g = applyMove(g, { kind: 'charge', charge: 'dampener', target: 13 });
    expect(g.board[13].value).toBe(1); // floor(2 / 2)
    expect(g.turnIndex).toBe(before); // no placement was consumed
    expect(g.activePlayer).toBe('P1'); // still P1's turn to place
    expect(g.chargeUsedThisTurn).toBe(true);
  });

  it('allows at most one charge per turn and one use per match', () => {
    let g = createGame({
      chargesEnabled: true,
      alternatingStart: false,
      loadouts: { P1: ['stasisField', 'dampener'], P2: ['foresight', 'dampener'] },
      seed: 5,
    });
    g = applyMove(g, { kind: 'charge', charge: 'stasisField', target: 7 });
    expect(legalCharges(g)).toHaveLength(0); // already spent a charge this turn
    g = applyMove(g, { kind: 'place', cell: 12 });
    g = applyMove(g, { kind: 'place', cell: 0 });
    expect(g.activePlayer).toBe('P1');
    expect(g.charges.P1.find((c) => c.kind === 'stasisField')!.used).toBe(true);
    expect(legalCharges(g).some((c) => c.charge === 'stasisField')).toBe(false); // spent for good
  });

  it('stasis blocks the opponent for exactly one turn', () => {
    let g = createGame({
      chargesEnabled: true,
      alternatingStart: false,
      loadouts: { P1: ['stasisField', 'dampener'] },
      seed: 9,
    });
    expect(g.activePlayer).toBe('P1');
    g = applyMove(g, { kind: 'charge', charge: 'stasisField', target: 7 });
    g = applyMove(g, { kind: 'place', cell: 12 });
    expect(g.activePlayer).toBe('P2');
    expect(legalPlacements(g)).not.toContain(7);
    g = applyMove(g, { kind: 'place', cell: 0 });
    expect(legalPlacements(g)).toContain(7); // lock has expired
  });

  it('singularity shift swaps ownership of two placed numbers', () => {
    let g = createGame({
      chargesEnabled: true,
      alternatingStart: false,
      loadouts: { P2: ['singularityShift', 'dampener'] },
      seed: 11,
    });
    g = applyMove(g, { kind: 'place', cell: 5 }); // P1's 1
    g = applyMove(g, { kind: 'place', cell: 6 }); // P2's 1
    g = applyMove(g, { kind: 'place', cell: 7 }); // P1's 2
    expect(g.activePlayer).toBe('P2');

    // Swap P2's 1 at cell 6 with P1's 2 at cell 7.
    g = applyMove(g, { kind: 'charge', charge: 'singularityShift', target: 6, target2: 7 });
    expect(g.board[6].player).toBe('P1');
    expect(g.board[6].value).toBe(2);
    expect(g.board[7].player).toBe('P2');
    expect(g.board[7].value).toBe(1);
  });

  it('never offers to dampen a number that is already 1', () => {
    let g = createGame({
      chargesEnabled: true,
      alternatingStart: false,
      loadouts: { P1: ['dampener', 'foresight'] },
      seed: 13,
    });
    g = applyMove(g, { kind: 'place', cell: 4 }); // P1's only number so far is a 1
    g = applyMove(g, { kind: 'place', cell: 5 });
    expect(g.activePlayer).toBe('P1');
    expect(legalCharges(g).some((c) => c.charge === 'dampener')).toBe(false);
  });
});

describe('move legality', () => {
  it('rejects occupied, collapsed and out-of-range cells', () => {
    let g = createGame({ modifiers: ['collapsedStar'], seed: 21 });
    const collapsed = g.board.filter((c) => c.traits.includes('collapsed')).map((c) => c.id);
    for (const id of collapsed) {
      expect(legalPlacements(g)).not.toContain(id);
      expect(() => applyMove(g, { kind: 'place', cell: id })).toThrow();
    }
    const free = legalPlacements(g)[0];
    g = applyMove(g, { kind: 'place', cell: free });
    expect(() => applyMove(g, { kind: 'place', cell: free })).toThrow();
  });

  it('does not mutate the state it was given', () => {
    const g = createGame({ seed: 77 });
    const snapshot = JSON.stringify(g);
    applyMove(g, { kind: 'place', cell: 10 });
    expect(JSON.stringify(g)).toBe(snapshot);
  });

  it('finishes after exactly totalTurns placements', () => {
    const g = createGame({ seed: 99 });
    const done = playOut(g, new Rng(1234));
    expect(done.history.filter((h) => h.move.kind === 'place')).toHaveLength(20);
    expect(done.winner).not.toBeNull();
    expect(findBlackHole(done)).toBe(done.blackHoleIndex);
    expect(done.board.filter((c) => c.player !== null)).toHaveLength(CELL_COUNT - 1);
  });
});
