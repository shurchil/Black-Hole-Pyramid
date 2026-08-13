/// <reference lib="webworker" />
/**
 * AI worker entry point.
 *
 * `GameState` is plain data, so it structured-clones across the boundary with
 * no serialisation layer of its own. Running search here means even the
 * heaviest tier cannot drop a frame of the board animation.
 */

import { considerCharge, DIFFICULTIES, searchRoot } from './search';
import type { Difficulty, SearchResult } from './search';
import type { GameState, Move } from '../core/types';

export interface AiRequest {
  id: number;
  state: GameState;
  difficulty: Difficulty;
  /** Ask for a charge decision instead of a placement. */
  wantCharge?: boolean;
}

export interface AiResponse {
  id: number;
  move: Move | null;
  score: number;
  stats: SearchResult['stats'] | null;
  rootScores: SearchResult['rootScores'];
  error?: string;
}

self.onmessage = (event: MessageEvent<AiRequest>) => {
  const { id, state, difficulty, wantCharge } = event.data;
  const config = DIFFICULTIES[difficulty];

  try {
    if (wantCharge) {
      const charge = considerCharge(state, config);
      const response: AiResponse = {
        id,
        move: charge,
        score: 0,
        stats: null,
        rootScores: [],
      };
      (self as unknown as Worker).postMessage(response);
      return;
    }

    const result = searchRoot(state, config);
    const response: AiResponse = {
      id,
      move: result.move,
      score: result.score,
      stats: result.stats,
      rootScores: result.rootScores,
    };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: AiResponse = {
      id,
      move: null,
      score: 0,
      stats: null,
      rootScores: [],
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
