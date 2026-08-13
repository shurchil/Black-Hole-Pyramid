/**
 * XP, levels and rewards.
 *
 * Curve design: a match is worth roughly 120-350 XP depending on mode,
 * difficulty and margin. Early levels arrive within a couple of matches so the
 * first session feels generous, and the quadratic term stretches the later
 * ones out into a long tail without ever becoming a wall.
 */

import type { Difficulty } from '../ai/search';
import type { GameMode } from './modes';

export const MAX_LEVEL = 30;

/** XP required to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  const n = level - 1;
  return 200 + 90 * n + 6 * n * n;
}

/** Total XP required to reach `level` from scratch. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  progress: number;
  isMax: boolean;
}

export function levelFromXp(totalXp: number): LevelProgress {
  let level = 1;
  let remaining = Math.max(0, totalXp);
  while (level < MAX_LEVEL && remaining >= xpToNext(level)) {
    remaining -= xpToNext(level);
    level++;
  }
  const need = xpToNext(level);
  return {
    level,
    xpIntoLevel: level >= MAX_LEVEL ? 0 : remaining,
    xpForLevel: level >= MAX_LEVEL ? 0 : need,
    progress: level >= MAX_LEVEL ? 1 : remaining / need,
    isMax: level >= MAX_LEVEL,
  };
}

/* ------------------------------------------------------------------ *
 * Match rewards
 * ------------------------------------------------------------------ */

export const MODE_XP: Record<GameMode, number> = {
  classic: 100,
  blitz: 120,
  cosmic: 140,
  gauntlet: 150,
  daily: 200,
  local: 60,
  tutorial: 40,
};

export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  rookie: 0.7,
  pilot: 1,
  captain: 1.35,
  singularity: 1.8,
};

export interface MatchSummary {
  mode: GameMode;
  difficulty: Difficulty;
  /** Outcome from the human player's point of view. */
  result: 'win' | 'loss' | 'draw';
  playerScore: number;
  opponentScore: number;
  /** How many modifiers were active. */
  modifierCount: number;
  /** True when the player took zero points from the black hole. */
  untouched: boolean;
  /** Gauntlet only: which stage was cleared. */
  gauntletDepth?: number;
  /** Whether this is the player's first win today. */
  firstWinOfDay: boolean;
}

export interface Rewards {
  xp: number;
  stardust: number;
  breakdown: Array<{ label: string; xp: number }>;
}

export function computeRewards(summary: MatchSummary): Rewards {
  const breakdown: Array<{ label: string; xp: number }> = [];
  const multiplier = DIFFICULTY_MULTIPLIER[summary.difficulty];

  const base = Math.round(MODE_XP[summary.mode] * multiplier);
  breakdown.push({ label: 'Match played', xp: base });
  let xp = base;

  if (summary.result === 'win') {
    const winBonus = Math.round(80 * multiplier);
    breakdown.push({ label: 'Victory', xp: winBonus });
    xp += winBonus;

    const margin = summary.opponentScore - summary.playerScore;
    if (margin > 0) {
      const marginBonus = Math.min(60, margin * 6);
      breakdown.push({ label: `Margin +${margin}`, xp: marginBonus });
      xp += marginBonus;
    }
  } else if (summary.result === 'draw') {
    breakdown.push({ label: 'Draw', xp: 30 });
    xp += 30;
  }

  if (summary.untouched) {
    breakdown.push({ label: 'Untouched by the hole', xp: 120 });
    xp += 120;
  }

  if (summary.modifierCount > 0) {
    const bonus = summary.modifierCount * 25;
    breakdown.push({ label: `${summary.modifierCount} modifier(s)`, xp: bonus });
    xp += bonus;
  }

  if (summary.gauntletDepth) {
    const bonus = summary.gauntletDepth * 40;
    breakdown.push({ label: `Gauntlet stage ${summary.gauntletDepth}`, xp: bonus });
    xp += bonus;
  }

  if (summary.firstWinOfDay && summary.result === 'win') {
    breakdown.push({ label: 'First win of the day', xp: 150 });
    xp += 150;
  }

  return {
    xp,
    stardust: Math.round(xp / 3),
    breakdown,
  };
}

/** Stardust granted for reaching a level, on top of any cosmetic unlock. */
export function levelUpStardust(level: number): number {
  return 100 + level * 25;
}
