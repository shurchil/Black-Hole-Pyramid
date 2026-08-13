import { describe, expect, it } from 'vitest';
import { CELL_COUNT, DEGREE, NEIGHBORS, UNIT_LAYOUT, coordOf, indexOf } from '../src/core/board';

/**
 * The adjacency table shipped in the game design document. The engine
 * generates its own table from the triangular coordinates; this test pins the
 * generated one to the spec so a refactor can never silently reshape the board.
 */
const SPEC_NEIGHBORS: Record<number, number[]> = {
  0: [1, 2],
  1: [0, 2, 3, 4],
  2: [0, 1, 4, 5],
  3: [1, 4, 6, 7],
  4: [1, 2, 3, 5, 7, 8],
  5: [2, 4, 8, 9],
  6: [3, 7, 10, 11],
  7: [3, 4, 6, 8, 11, 12],
  8: [4, 5, 7, 9, 12, 13],
  9: [5, 8, 13, 14],
  10: [6, 11, 15, 16],
  11: [6, 7, 10, 12, 16, 17],
  12: [7, 8, 11, 13, 17, 18],
  13: [8, 9, 12, 14, 18, 19],
  14: [9, 13, 19, 20],
  15: [10, 16],
  16: [10, 11, 15, 17],
  17: [11, 12, 16, 18],
  18: [12, 13, 17, 19],
  19: [13, 14, 18, 20],
  20: [14, 19],
};

describe('board geometry', () => {
  it('has 21 cells in 6 rows', () => {
    expect(CELL_COUNT).toBe(21);
  });

  it('matches the design document adjacency table exactly', () => {
    for (let id = 0; id < CELL_COUNT; id++) {
      expect(NEIGHBORS[id], `neighbours of ${id}`).toEqual(SPEC_NEIGHBORS[id]);
    }
  });

  it('adjacency is symmetric', () => {
    for (let id = 0; id < CELL_COUNT; id++) {
      for (const n of NEIGHBORS[id]) {
        expect(NEIGHBORS[n]).toContain(id);
      }
    }
  });

  it('never lists a cell as its own neighbour or repeats one', () => {
    for (let id = 0; id < CELL_COUNT; id++) {
      expect(NEIGHBORS[id]).not.toContain(id);
      expect(new Set(NEIGHBORS[id]).size).toBe(NEIGHBORS[id].length);
    }
  });

  it('degrees run from 2 at the corners to 6 in the interior', () => {
    expect(Math.min(...DEGREE)).toBe(2);
    expect(Math.max(...DEGREE)).toBe(6);
    expect(DEGREE[0]).toBe(2);
    expect(DEGREE[15]).toBe(2);
    expect(DEGREE[20]).toBe(2);
    expect(DEGREE[12]).toBe(6);
  });

  it('round-trips coordinates through indexOf', () => {
    for (let id = 0; id < CELL_COUNT; id++) {
      const { row, col } = coordOf(id);
      expect(indexOf(row, col)).toBe(id);
    }
  });

  it('lays the pyramid out centred and top-down', () => {
    expect(UNIT_LAYOUT).toHaveLength(CELL_COUNT);
    expect(UNIT_LAYOUT[0].x).toBeCloseTo(0.5);
    // Bottom row spans symmetrically around the centre.
    expect(UNIT_LAYOUT[15].x + UNIT_LAYOUT[20].x).toBeCloseTo(1);
    expect(UNIT_LAYOUT[0].y).toBeLessThan(UNIT_LAYOUT[20].y);
  });
});
