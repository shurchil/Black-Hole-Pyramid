/**
 * Ladder benchmark: each tier plays a seat-swapped series against the tier
 * below it, from shared random openings so the games are actually distinct.
 *
 * Run: npx vite-node scripts/bench-ai.ts [openings]
 */
import { applyMove, createGame, legalPlacements } from '../src/core/rules';
import { Rng } from '../src/core/rng';
import type { GameState, PlayerId } from '../src/core/types';
import { DIFFICULTIES, DIFFICULTY_ORDER, searchRoot, type Difficulty } from '../src/ai/search';

const OPENING_PLIES = 6;

function openingFrom(seed: number): GameState {
  const rng = new Rng(seed);
  let g = createGame({ seed });
  for (let i = 0; i < OPENING_PLIES; i++) {
    g = applyMove(g, { kind: 'place', cell: rng.pick(legalPlacements(g)) });
  }
  return g;
}

function series(strong: Difficulty, weak: Difficulty, openings: number) {
  let w = 0;
  let l = 0;
  let d = 0;
  let ms = 0;
  let nodes = 0;
  let moves = 0;

  for (let i = 0; i < openings; i++) {
    const opening = openingFrom(i * 7919 + 11);
    for (const side of ['P1', 'P2'] as PlayerId[]) {
      let g = opening;
      while (!g.isFinished) {
        const isStrong = g.activePlayer === side;
        const r = searchRoot(g, DIFFICULTIES[isStrong ? strong : weak]);
        if (isStrong) {
          ms += r.stats.elapsedMs;
          nodes += r.stats.nodes;
          moves++;
        }
        g = applyMove(g, r.move);
      }
      if (g.winner === side) w++;
      else if (g.winner === 'DRAW') d++;
      else l++;
    }
  }

  const games = w + l + d;
  const score = ((w + d * 0.5) / games) * 100;
  // 95% confidence interval on the score share, so a reader can tell a real
  // gap from sampling noise.
  const se = Math.sqrt(0.25 / games) * 100;
  return { w, l, d, games, score, ci: 1.96 * se, avgMs: ms / moves, avgNodes: nodes / moves };
}

const N = Number(process.argv[2] ?? 25);
console.log(`${N * 2} games per pairing, ${OPENING_PLIES}-ply random openings\n`);
console.log('matchup                       W/L/D      score          ms/move  nodes/move');

for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
  const strong = DIFFICULTY_ORDER[i];
  const weak = DIFFICULTY_ORDER[i - 1];
  const r = series(strong, weak, N);
  const label = `${strong} vs ${weak}`;
  console.log(
    `${label.padEnd(28)} ${`${r.w}/${r.l}/${r.d}`.padEnd(10)} ` +
      `${r.score.toFixed(1).padStart(5)}% ±${r.ci.toFixed(1).padStart(4)}  ` +
      `${r.avgMs.toFixed(1).padStart(7)}  ${r.avgNodes.toFixed(0).padStart(10)}`,
  );
}
