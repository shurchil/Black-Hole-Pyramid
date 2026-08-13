/**
 * Evaluation diagnostics.
 *
 * Two questions, answered empirically:
 *   1. Is the heuristic *stable* under deeper search? A sound evaluation means
 *      searching deeper wins more. If depth 8 loses to depth 4, the leaf
 *      evaluation is fighting the search rather than guiding it.
 *   2. Which weight set is actually strongest head to head?
 *
 * Run: npx vite-node scripts/tune-eval.ts
 */
import { applyMove, createGame, legalPlacements } from '../src/core/rules';
import { Rng } from '../src/core/rng';
import type { GameState, PlayerId } from '../src/core/types';
import type { EvalWeights } from '../src/ai/evaluate';
import { searchRoot, type DifficultyConfig } from '../src/ai/search';

/**
 * Without modifiers every match starts from the identical empty board, so two
 * deterministic engines would replay one single game forever. Each pairing
 * therefore starts from a random but *shared* opening, and both engines play
 * each opening from both seats.
 */
const OPENING_PLIES = 6;

function openingFrom(seed: number): GameState {
  const rng = new Rng(seed);
  let g = createGame({ seed });
  for (let i = 0; i < OPENING_PLIES; i++) {
    g = applyMove(g, { kind: 'place', cell: rng.pick(legalPlacements(g)) });
  }
  return g;
}

function cfg(weights: EvalWeights, maxDepth: number, exactThreshold = 8): DifficultyConfig {
  return {
    id: 'captain',
    name: 'probe',
    blurb: '',
    budgetMs: 5000, // effectively untimed: we want depth, not wall-clock, as the variable
    exactThreshold,
    maxDepth,
    blunderChance: 0,
    noise: 0,
    weights,
  };
}

function duel(a: DifficultyConfig, b: DifficultyConfig, aSide: PlayerId, opening: GameState) {
  let g = opening;
  while (!g.isFinished) {
    const config = g.activePlayer === aSide ? a : b;
    g = applyMove(g, searchRoot(g, config).move);
  }
  return g.winner!;
}

/** Plays each opening from both seats and returns A's score share in [0,1]. */
function series(a: DifficultyConfig, b: DifficultyConfig, openings: number, seedBase = 1): number {
  let score = 0;
  let played = 0;
  for (let i = 0; i < openings; i++) {
    const opening = openingFrom(seedBase + i * 7919);
    for (const side of ['P1', 'P2'] as PlayerId[]) {
      const winner = duel(a, b, side, opening);
      played++;
      if (winner === side) score += 1;
      else if (winner === 'DRAW') score += 0.5;
    }
  }
  return score / played;
}

const CANDIDATES: Record<string, EvalWeights> = {
  'current (tempo .3)': { expected: 1, control: 0.45, tempo: 0.3 },
  'no tempo': { expected: 1, control: 0.45, tempo: 0 },
  'no control': { expected: 1, control: 0, tempo: 0 },
  'control heavy': { expected: 1, control: 0.9, tempo: 0 },
  'control light': { expected: 1, control: 0.2, tempo: 0 },
};

const GAMES = Number(process.argv[2] ?? 12);

console.log('--- depth stability: deep vs shallow, same weights ---');
console.log('(a sound evaluation scores well above 50% when searching deeper)\n');
for (const [name, weights] of Object.entries(CANDIDATES)) {
  const deep = series(cfg(weights, 8), cfg(weights, 3), GAMES);
  console.log(`${name.padEnd(20)} depth8 vs depth3: ${(deep * 100).toFixed(1)}%`);
}

console.log('\n--- head to head at equal depth (vs "no tempo" baseline) ---\n');
const baseline = CANDIDATES['no tempo'];
for (const [name, weights] of Object.entries(CANDIDATES)) {
  if (weights === baseline) continue;
  const s = series(cfg(weights, 5), cfg(baseline, 5), GAMES);
  console.log(`${name.padEnd(20)} vs no-tempo @depth5: ${(s * 100).toFixed(1)}%`);
}
