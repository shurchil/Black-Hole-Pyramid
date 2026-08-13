/**
 * Where does strength actually come from: midgame depth, or endgame exactness?
 *
 * Each candidate plays a seat-swapped series against a fixed reference
 * (depth 3 / exact 9). Run: npx vite-node scripts/probe-endgame.ts [openings]
 */
import { applyMove, createGame, legalPlacements } from '../src/core/rules';
import { Rng } from '../src/core/rng';
import type { GameState, PlayerId } from '../src/core/types';
import { searchRoot, type DifficultyConfig } from '../src/ai/search';
import { DEFAULT_WEIGHTS } from '../src/ai/evaluate';

const OPENING_PLIES = 6;

function cfg(maxDepth: number, exactThreshold: number): DifficultyConfig {
  return {
    id: 'captain',
    name: `d${maxDepth}/x${exactThreshold}`,
    blurb: '',
    budgetMs: 20000, // untimed: depth and threshold are the variables under test
    exactThreshold,
    maxDepth,
    blunderChance: 0,
    noise: 0,
    weights: DEFAULT_WEIGHTS,
  };
}

function openingFrom(seed: number): GameState {
  const rng = new Rng(seed);
  let g = createGame({ seed });
  for (let i = 0; i < OPENING_PLIES; i++) {
    g = applyMove(g, { kind: 'place', cell: rng.pick(legalPlacements(g)) });
  }
  return g;
}

function series(a: DifficultyConfig, b: DifficultyConfig, openings: number, seedBase = 1) {
  let score = 0;
  let played = 0;
  let nodes = 0;
  let ms = 0;
  let moves = 0;
  for (let i = 0; i < openings; i++) {
    const opening = openingFrom(seedBase + i * 7919);
    for (const side of ['P1', 'P2'] as PlayerId[]) {
      let g = opening;
      while (!g.isFinished) {
        const isA = g.activePlayer === side;
        const r = searchRoot(g, isA ? a : b);
        if (isA) { nodes += r.stats.nodes; ms += r.stats.elapsedMs; moves++; }
        g = applyMove(g, r.move);
      }
      played++;
      if (g.winner === side) score += 1;
      else if (g.winner === 'DRAW') score += 0.5;
    }
  }
  return {
    pct: (score / played) * 100,
    avgNodes: Math.round(nodes / moves),
    avgMs: (ms / moves).toFixed(1),
  };
}

const N = Number(process.argv[2] ?? 16);
const reference = cfg(3, 9);
console.log(`reference = ${reference.name}, ${N * 2} games per row\n`);
console.log('candidate     score    avgNodes/move  avgMs/move');

for (const [depth, exact] of [
  [3, 6],
  [3, 9],
  [3, 11],
  [3, 12],
  [2, 12],
  [6, 12],
] as Array<[number, number]>) {
  const c = cfg(depth, exact);
  const r = series(c, reference, N);
  console.log(
    `${c.name.padEnd(12)} ${r.pct.toFixed(1).padStart(6)}%  ${String(r.avgNodes).padStart(11)}  ${r.avgMs.padStart(10)}`,
  );
}
