/**
 * Pyramid board geometry and adjacency.
 *
 * The classic board is 6 rows / 21 cells:
 *
 *              [0]
 *            [1] [2]
 *          [3] [4] [5]
 *        [6] [7] [8] [9]
 *     [10][11][12][13][14]
 *   [15][16][17][18][19][20]
 *
 * Index of (row, col) is `row * (row + 1) / 2 + col`. Neighbours are the six
 * touching circles: left, right, upper-left, upper-right, lower-left,
 * lower-right. The table is generated rather than hand-written so the same
 * code can serve a different row count without a second source of truth.
 */

export const ROWS = 6;
export const CELL_COUNT = (ROWS * (ROWS + 1)) / 2; // 21

export interface CellCoord {
  row: number;
  col: number;
}

function buildCoords(rows: number): CellCoord[] {
  const coords: CellCoord[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col <= row; col++) {
      coords.push({ row, col });
    }
  }
  return coords;
}

export function indexOf(row: number, col: number): number {
  return (row * (row + 1)) / 2 + col;
}

function buildNeighbors(rows: number): number[][] {
  const total = (rows * (rows + 1)) / 2;
  const table: number[][] = Array.from({ length: total }, () => []);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col <= row; col++) {
      const id = indexOf(row, col);
      const candidates: Array<[number, number]> = [
        [row, col - 1],
        [row, col + 1],
        [row - 1, col - 1],
        [row - 1, col],
        [row + 1, col],
        [row + 1, col + 1],
      ];
      for (const [r, c] of candidates) {
        if (r < 0 || r >= rows) continue;
        if (c < 0 || c > r) continue;
        table[id].push(indexOf(r, c));
      }
      table[id].sort((a, b) => a - b);
    }
  }
  return table;
}

export const COORDS: readonly CellCoord[] = buildCoords(ROWS);

/** Static adjacency list: `NEIGHBORS[id]` is the sorted list of touching cells. */
export const NEIGHBORS: readonly number[][] = buildNeighbors(ROWS);

/** Cells on the outer edge of the pyramid — they have the fewest neighbours. */
export const CORNERS: readonly number[] = [0, indexOf(ROWS - 1, 0), indexOf(ROWS - 1, ROWS - 1)];

/**
 * Number of touching cells per position. Low-degree cells are strategically
 * valuable (a black hole there drains fewer numbers) and the AI eval uses this.
 */
export const DEGREE: readonly number[] = NEIGHBORS.map((n) => n.length);

/** Row/column for a cell id. */
export function coordOf(id: number): CellCoord {
  return COORDS[id];
}

/**
 * Layout positions in a normalised unit space where the pyramid is centred
 * horizontally in [0,1] and stacked in [0,1] vertically. The renderer scales
 * this to whatever canvas it has, which keeps layout resolution-independent.
 */
export interface LayoutPoint {
  x: number;
  y: number;
}

export function unitLayout(rows: number = ROWS): LayoutPoint[] {
  const points: LayoutPoint[] = [];
  const stepX = 1 / rows;
  const stepY = 1 / rows;
  for (let row = 0; row < rows; row++) {
    const rowWidth = row * stepX;
    const startX = 0.5 - rowWidth / 2;
    for (let col = 0; col <= row; col++) {
      points.push({
        x: startX + col * stepX,
        y: stepY * 0.5 + row * stepY,
      });
    }
  }
  return points;
}

export const UNIT_LAYOUT: readonly LayoutPoint[] = unitLayout(ROWS);
