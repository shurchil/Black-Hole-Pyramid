/**
 * Game modes.
 *
 * The pure rules engine does not know what a "mode" is — a mode is just a
 * recipe for a `CreateGameOptions` plus a bit of framing around the match.
 * Keeping it that way means new modes cost almost nothing and can never
 * introduce a rules fork.
 */

import type { Difficulty } from '../ai/search';
import { DIFFICULTY_ORDER } from '../ai/search';
import { rollModifiers } from '../core/modifiers';
import { Rng, hashSeed } from '../core/rng';
import type { CreateGameOptions } from '../core/rules';
import type { ChargeKind, ModifierId } from '../core/types';

export type GameMode = 'classic' | 'blitz' | 'cosmic' | 'gauntlet' | 'daily' | 'local' | 'tutorial';

export interface ModeDef {
  id: GameMode;
  name: string;
  tagline: string;
  description: string;
  /** Shown on the mode card; drawn procedurally. */
  glyph: string;
  /** Locked until the player reaches this level. */
  requiredLevel: number;
  /** Two humans on one device. */
  local: boolean;
}

export const MODES: Record<GameMode, ModeDef> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    tagline: 'The pure duel',
    description: 'Twenty-one cells, ten numbers each, one hole left over. Lowest score wins.',
    glyph: 'pyramid',
    requiredLevel: 1,
    local: false,
  },
  blitz: {
    id: 'blitz',
    name: 'Blitz',
    tagline: 'Seven seconds a move',
    description: 'Same rules, a clock on every turn. Run out and the board places for you.',
    glyph: 'bolt',
    requiredLevel: 2,
    local: false,
  },
  cosmic: {
    id: 'cosmic',
    name: 'Cosmic',
    tagline: 'Modifiers and charges',
    description: 'Rolled board modifiers plus two once-per-match abilities each. Never the same twice.',
    glyph: 'atom',
    requiredLevel: 3,
    local: false,
  },
  gauntlet: {
    id: 'gauntlet',
    name: 'Gauntlet',
    tagline: 'Seven gates, one life',
    description: 'Beat seven opponents in a row. Each gate adds a modifier and a smarter rival. One loss ends the run.',
    glyph: 'ladder',
    requiredLevel: 5,
    local: false,
  },
  daily: {
    id: 'daily',
    name: 'Daily Challenge',
    tagline: 'One board, one shot',
    description: 'Everyone gets the same board and the same rival today. One attempt.',
    glyph: 'calendar',
    requiredLevel: 4,
    local: false,
  },
  local: {
    id: 'local',
    name: 'Pass & Play',
    tagline: 'Two players, one device',
    description: 'Hand the device back and forth. No AI, no clock, just the two of you.',
    glyph: 'people',
    requiredLevel: 1,
    local: true,
  },
  tutorial: {
    id: 'tutorial',
    name: 'How to Play',
    tagline: 'Learn the pull',
    description: 'A guided match that teaches shielding, steering and the black hole.',
    glyph: 'book',
    requiredLevel: 1,
    local: false,
  },
};

export const MODE_ORDER: readonly GameMode[] = [
  'classic',
  'blitz',
  'cosmic',
  'gauntlet',
  'daily',
  'local',
  'tutorial',
];

export interface MatchSetup {
  mode: GameMode;
  difficulty: Difficulty;
  options: CreateGameOptions;
  /** Human-readable modifiers for the pre-match card. */
  modifiers: ModifierId[];
  /** Label shown as the opponent's name. */
  opponentName: string;
  gauntletDepth?: number;
}

export interface BuildMatchArgs {
  mode: GameMode;
  difficulty: Difficulty;
  loadout: readonly ChargeKind[];
  /** Current gauntlet stage, 1-based. */
  gauntletDepth?: number;
  /** Overrides the seed; the Daily Challenge pins this to the date. */
  seed?: number;
  /** ISO date (YYYY-MM-DD) used to seed the Daily Challenge. */
  today?: string;
}

export function buildMatch(args: BuildMatchArgs): MatchSetup {
  const { mode, loadout } = args;

  switch (mode) {
    case 'blitz':
      return {
        mode,
        difficulty: args.difficulty,
        modifiers: [],
        opponentName: opponentNameFor(args.difficulty),
        options: {
          seed: args.seed,
          moveTimeLimit: 7,
          alternatingStart: true,
        },
      };

    case 'cosmic': {
      const seed = args.seed ?? Math.floor(Math.random() * 0xffffffff);
      const rng = new Rng(seed);
      const modifiers = rollModifiers((max) => rng.int(max), 2);
      return {
        mode,
        difficulty: args.difficulty,
        modifiers,
        opponentName: opponentNameFor(args.difficulty),
        options: {
          seed,
          modifiers,
          chargesEnabled: true,
          alternatingStart: true,
          loadouts: { P1: loadout, P2: aiLoadout(rng) },
        },
      };
    }

    case 'gauntlet': {
      const depth = args.gauntletDepth ?? 1;
      const seed = args.seed ?? Math.floor(Math.random() * 0xffffffff);
      const rng = new Rng(seed);
      // Each gate turns the screws: more modifiers, a smarter rival.
      const modifierCount = Math.min(3, Math.floor((depth - 1) / 2));
      const modifiers = rollModifiers((max) => rng.int(max), modifierCount);
      const difficulty = gauntletDifficulty(depth);
      return {
        mode,
        difficulty,
        modifiers,
        gauntletDepth: depth,
        opponentName: `Gate ${depth} — ${opponentNameFor(difficulty)}`,
        options: {
          seed,
          modifiers,
          chargesEnabled: depth >= 3,
          alternatingStart: true,
          loadouts: { P1: loadout, P2: aiLoadout(rng) },
        },
      };
    }

    case 'daily': {
      const date = args.today ?? isoToday();
      const seed = hashSeed(`black-hole-pyramid:${date}`);
      const rng = new Rng(seed);
      const modifiers = rollModifiers((max) => rng.int(max), rng.range(1, 2));
      // The daily rival is fixed for everyone, so scores are comparable.
      const difficulty = DIFFICULTY_ORDER[rng.range(1, 3)];
      return {
        mode,
        difficulty,
        modifiers,
        opponentName: `Daily Rival — ${opponentNameFor(difficulty)}`,
        options: {
          seed,
          modifiers,
          chargesEnabled: true,
          alternatingStart: true,
          loadouts: { P1: loadout, P2: aiLoadout(rng) },
        },
      };
    }

    case 'local':
      return {
        mode,
        difficulty: 'pilot',
        modifiers: [],
        opponentName: 'Player 2',
        options: { seed: args.seed, alternatingStart: true },
      };

    case 'tutorial':
      return {
        mode,
        difficulty: 'rookie',
        modifiers: [],
        opponentName: 'Trainer',
        options: { seed: args.seed ?? 1337, alternatingStart: false },
      };

    case 'classic':
    default:
      return {
        mode: 'classic',
        difficulty: args.difficulty,
        modifiers: [],
        opponentName: opponentNameFor(args.difficulty),
        options: { seed: args.seed, alternatingStart: true },
      };
  }
}

export const GAUNTLET_GATES = 7;

export function gauntletDifficulty(depth: number): Difficulty {
  if (depth <= 1) return 'rookie';
  if (depth <= 3) return 'pilot';
  if (depth <= 5) return 'captain';
  return 'singularity';
}

const OPPONENT_NAMES: Record<Difficulty, string> = {
  rookie: 'Rookie',
  pilot: 'Pilot',
  captain: 'Captain',
  singularity: 'Singularity',
};

export function opponentNameFor(difficulty: Difficulty): string {
  return OPPONENT_NAMES[difficulty];
}

function aiLoadout(rng: Rng): ChargeKind[] {
  // Foresight is a UI-only ability, so the AI never brings it.
  const pool: ChargeKind[] = ['singularityShift', 'stasisField', 'dampener'];
  return rng.sample(pool, 2);
}

export function isoToday(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
