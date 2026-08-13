/**
 * Main-thread client for the AI.
 *
 * Uses a Web Worker when one is available and transparently falls back to a
 * synchronous search otherwise (Node tests, and any host where worker
 * construction is blocked). Callers just await a promise either way.
 */

import { considerCharge, DIFFICULTIES, searchRoot, type Difficulty, type SearchResult } from './search';
import type { ChargeMove, GameState, Move } from '../core/types';
import type { AiRequest, AiResponse } from './worker';

export interface ThinkOptions {
  /**
   * Keep the answer on screen for at least this long. A perfect opponent that
   * replies in 4ms reads as a glitch rather than as an opponent, so the scene
   * asks for a deliberate minimum beat.
   */
  minThinkMs?: number;
  signal?: AbortSignal;
}

export class AiClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (value: AiResponse) => void>();
  private workerFailed = false;

  constructor(private readonly useWorker = true) {}

  private ensureWorker(): Worker | null {
    if (!this.useWorker || this.workerFailed) return null;
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      this.workerFailed = true;
      return null;
    }
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<AiResponse>) => {
        const resolve = this.pending.get(event.data.id);
        if (resolve) {
          this.pending.delete(event.data.id);
          resolve(event.data);
        }
      };
      this.worker.onerror = () => {
        // Fall back to synchronous search for the rest of the session.
        this.workerFailed = true;
        for (const [id, resolve] of this.pending) {
          resolve({ id, move: null, score: 0, stats: null, rootScores: [], error: 'worker failed' });
        }
        this.pending.clear();
      };
      return this.worker;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }

  private post(request: AiRequest): Promise<AiResponse> {
    const worker = this.ensureWorker();
    if (!worker) {
      // Synchronous fallback, wrapped so the caller's shape never changes.
      return Promise.resolve(runLocally(request));
    }
    return new Promise((resolve) => {
      this.pending.set(request.id, resolve);
      worker.postMessage(request);
    });
  }

  /** Pick a placement. Resolves to null only if the position has no moves. */
  async think(state: GameState, difficulty: Difficulty, options: ThinkOptions = {}): Promise<Move | null> {
    const started = performance.now();
    const response = await this.post({ id: this.nextId++, state, difficulty });

    if (response.error || !response.move) {
      // Last-ditch: search on this thread rather than stalling the match.
      const local = searchRoot(state, DIFFICULTIES[difficulty]);
      await pace(started, options.minThinkMs);
      return local.move;
    }

    this.lastResult = {
      move: response.move,
      score: response.score,
      stats: response.stats ?? { nodes: 0, depthReached: 0, exact: false, elapsedMs: 0 },
      rootScores: response.rootScores,
    };

    await pace(started, options.minThinkMs);
    return options.signal?.aborted ? null : response.move;
  }

  /** Decide whether to spend a Cosmic Charge before placing. */
  async thinkCharge(state: GameState, difficulty: Difficulty): Promise<ChargeMove | null> {
    const response = await this.post({
      id: this.nextId++,
      state,
      difficulty,
      wantCharge: true,
    });
    if (response.error) return considerCharge(state, DIFFICULTIES[difficulty]);
    return (response.move as ChargeMove | null) ?? null;
  }

  /** Root evaluations from the most recent `think`, for Foresight and hints. */
  lastResult: SearchResult | null = null;

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

function runLocally(request: AiRequest): AiResponse {
  const config = DIFFICULTIES[request.difficulty];
  try {
    if (request.wantCharge) {
      return {
        id: request.id,
        move: considerCharge(request.state, config),
        score: 0,
        stats: null,
        rootScores: [],
      };
    }
    const result = searchRoot(request.state, config);
    return {
      id: request.id,
      move: result.move,
      score: result.score,
      stats: result.stats,
      rootScores: result.rootScores,
    };
  } catch (err) {
    return {
      id: request.id,
      move: null,
      score: 0,
      stats: null,
      rootScores: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function pace(startedAt: number, minThinkMs?: number): Promise<void> {
  if (!minThinkMs) return Promise.resolve();
  const remaining = minThinkMs - (performance.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}
