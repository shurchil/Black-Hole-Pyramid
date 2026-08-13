/**
 * The tutorial coach.
 *
 * Rather than scripting a fake match (which teaches players the script instead
 * of the game), this narrates a *real* match as it happens. Each lesson fires
 * once, at the turn where the thing it describes is about to matter — the
 * black hole is explained while cells are still visibly running out, not in a
 * wall of text before the first move.
 */

import type { GameState } from '../../core/types';
import { scoreForHole } from '../../core/rules';

export interface Lesson {
  /** Fires when this many placements have been made. */
  atTurn: number;
  text: (state: GameState) => string;
}

const LESSONS: Lesson[] = [
  {
    atTurn: 0,
    text: () => 'Tap any circle to place your 1. Twenty-one cells, and you each hold the numbers 1 to 10.',
  },
  {
    atTurn: 2,
    text: (s) => `Both of you place the same number each round — this round it is ${s.currentNumber}. They climb to 10.`,
  },
  {
    atTurn: 6,
    text: () => 'Do the arithmetic now: 21 cells, 20 numbers. Exactly one cell will be left empty.',
  },
  {
    atTurn: 10,
    text: () => 'That last empty cell collapses into the black hole. Only the numbers TOUCHING it will score.',
  },
  {
    atTurn: 14,
    text: () => 'Lowest score wins. So bury your big numbers where they are already surrounded — a 10 with open space beside it is a liability.',
  },
  {
    atTurn: 17,
    text: (s) => {
      const open = s.board.filter((c) => c.player === null && !c.traits.includes('collapsed'));
      const worst = open.reduce(
        (acc, cell) => Math.max(acc, scoreForHole(s, cell.id).totals.P1),
        0,
      );
      return `Nearly there. If the hole opened in the worst cell still free, it would cost you ${worst}. Steer it somewhere cheaper.`;
    },
  },
  {
    atTurn: 19,
    text: () => 'Last placement. Whichever cell you leave empty is the one that collapses — choose carefully.',
  },
];

export class TutorialCoach {
  private fired = new Set<number>();

  /**
   * The lesson to show for the current state, or null if none is due.
   * Each lesson is returned at most once per match.
   */
  hintFor(state: GameState): string | null {
    if (state.isFinished) return null;
    for (const lesson of LESSONS) {
      if (lesson.atTurn === state.turnIndex && !this.fired.has(lesson.atTurn)) {
        this.fired.add(lesson.atTurn);
        return lesson.text(state);
      }
    }
    return null;
  }

  /** Closing line on the results screen. */
  static outro(won: boolean): string {
    return won
      ? 'That is the whole game. Every mode from here adds a twist on top of it.'
      : 'The hole found your numbers this time. Shield the big ones earlier and try Classic next.';
  }
}
