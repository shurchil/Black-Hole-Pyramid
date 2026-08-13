/**
 * Decisive diagnostic: is the mid-game heuristic better than nothing?
 *
 * Baseline agent plays RANDOMLY until few enough cells remain to solve the
 * endgame exactly, then plays perfectly. If the heuristic agent cannot beat
 * that, the heuristic is actively harmful and needs replacing, not tuning.
 *
 * Run: npx vite-node scripts/probe-eval.ts [openings]
 */
import { applyMove, createGame, legalPlacements } from '../src/core/rules';
import { Rng } from '../src/core/rng';
import type { GameState, Move, PlayerId } from '../src/core/types';
import { Position } from '../src/ai/position';
import { searchRoot, type DifficultyConfig } from '../src/ai/search';
import { DEFAULT_WEIGHTS, type EvalWeights } from '../src/ai/evaluate';

const OPENING_PLIES = 6;
const EXACT = 9;

type Agent = { name: string; pick: (g: GameState, rng: Rng) => Move };

function probeConfig(weights: EvalWeights, maxDepth: number): DifficultyConfig {
  return {
    id: 'captain',
    name: 'probe',
    blurb: '',
    budgetMs: 10000,
    exactThreshold: EXACT,
    maxDepth,
    blunderChance: 0,
    noise: 0,
    weights,
  };
}

function searchAgent(name: string, weights: EvalWeights, maxDepth: number): Agent {
  const cfg = probeConfig(weights, maxDepth);
  return { name, pick: (g) => searchRoot(g, cfg).move };
}

/** Random in the midgame, perfect once the endgame is small enough to solve. */
function randomThenExact(name: string): Agent {
  const cfg = probeConfig(DEFAULT_WEIGHTS, 1);
  return {
    name,
    pick: (g, rng) => {
      const pos = new Position(g);
      if (pos.emptyCount <= EXACT) return searchRoot(g, cfg).move;
      return { kind: 'place', cell: rng.pick(legalPlacements(g)) };
    },
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

function series(a: Agent, b: Agent, openings: number, seedBase = 1): string {
  let score = 0;
  let played = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (let i = 0; i < openings; i++) {
    const opening = openingFrom(seedBase + i * 7919);
    for (const side of ['P1', 'P2'] as PlayerId[]) {
      // Shared RNG stream per game keeps the random agent reproducible.
      const rng = new Rng(seedBase + i * 31 + (side === 'P1' ? 0 : 1));
      let g = opening;
      while (!g.isFinished) {
        const agent = g.activePlayer === side ? a : b;
        g = applyMove(g, agent.pick(g, rng));
      }
      played++;
      if (g.winner === side) { score += 1; wins++; }
      else if (g.winner === 'DRAW') { score += 0.5; draws++; }
      else losses++;
    }
  }
  return `${(score / played * 100).toFixed(1)}%  (${wins}W/${losses}L/${draws}D of ${played})`;
}

const N = Number(process.argv[2] ?? 20);
const baseline = randomThenExact('random+exact');

console.log(`openings=${N}, games per pairing=${N * 2}, exact endgame at <=${EXACT} cells\n`);
for (const depth of [1, 2, 3, 5, 8]) {
  const agent = searchAgent(`heuristic d${depth}`, DEFAULT_WEIGHTS, depth);
  console.log(`${agent.name.padEnd(16)} vs ${baseline.name}: ${series(agent, baseline, N)}`);
}
