/**
 * Achievements.
 *
 * Each one is a pure predicate over (match summary, lifetime stats), which
 * keeps them testable and lets the same definitions drive the in-game list and
 * the Steam achievement mapping in `src/platform/steam.ts`.
 */

import type { MatchSummary } from './progression';

export interface PlayerStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
  untouchedWins: number;
  gauntletBestDepth: number;
  gauntletRunsCleared: number;
  dailiesPlayed: number;
  dailiesWon: number;
  winsByDifficulty: Record<string, number>;
  chargesUsed: number;
  totalStardustEarned: number;
}

export function emptyStats(): PlayerStats {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    currentStreak: 0,
    bestStreak: 0,
    untouchedWins: 0,
    gauntletBestDepth: 0,
    gauntletRunsCleared: 0,
    dailiesPlayed: 0,
    dailiesWon: 0,
    winsByDifficulty: {},
    chargesUsed: 0,
    totalStardustEarned: 0,
  };
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Steam API name; kept alongside the definition so they cannot drift. */
  steamId: string;
  secret?: boolean;
  /** Progress target for the UI bar; omit for one-shot achievements. */
  target?: (stats: PlayerStats) => number;
  progress?: (stats: PlayerStats) => number;
  test: (summary: MatchSummary | null, stats: PlayerStats) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'ach.firstwin',
    name: 'First Light',
    description: 'Win your first match.',
    steamId: 'ACH_FIRST_WIN',
    test: (_, stats) => stats.wins >= 1,
  },
  {
    id: 'ach.win25',
    name: 'Gravity Well',
    description: 'Win 25 matches.',
    steamId: 'ACH_WIN_25',
    target: () => 25,
    progress: (stats) => stats.wins,
    test: (_, stats) => stats.wins >= 25,
  },
  {
    id: 'ach.win100',
    name: 'Orbital Mechanic',
    description: 'Win 100 matches.',
    steamId: 'ACH_WIN_100',
    target: () => 100,
    progress: (stats) => stats.wins,
    test: (_, stats) => stats.wins >= 100,
  },
  {
    id: 'ach.streak10',
    name: 'Unbeaten',
    description: 'Win 10 matches in a row.',
    steamId: 'ACH_STREAK_10',
    target: () => 10,
    progress: (stats) => stats.bestStreak,
    test: (_, stats) => stats.bestStreak >= 10,
  },
  {
    id: 'ach.perfectgame',
    name: 'Untouched',
    description: 'Win a match without a single number touching the black hole.',
    steamId: 'ACH_PERFECT',
    test: (summary) => summary?.result === 'win' && summary.untouched,
  },
  {
    id: 'ach.shutout',
    name: 'Total Eclipse',
    description: 'Win a match by 25 points or more.',
    steamId: 'ACH_SHUTOUT',
    test: (summary) =>
      summary?.result === 'win' && summary.opponentScore - summary.playerScore >= 25,
  },
  {
    id: 'ach.beatsingularity',
    name: 'Event Horizon',
    description: 'Beat the Singularity difficulty.',
    steamId: 'ACH_BEAT_SINGULARITY',
    test: (summary) => summary?.result === 'win' && summary.difficulty === 'singularity',
  },
  {
    id: 'ach.gauntlet3',
    name: 'Third Gate',
    description: 'Reach gate 3 of a Gauntlet run.',
    steamId: 'ACH_GAUNTLET_3',
    target: () => 3,
    progress: (stats) => stats.gauntletBestDepth,
    test: (_, stats) => stats.gauntletBestDepth >= 3,
  },
  {
    id: 'ach.gauntletclear',
    name: 'Voidborn',
    description: 'Clear a full Gauntlet run.',
    steamId: 'ACH_GAUNTLET_CLEAR',
    test: (_, stats) => stats.gauntletRunsCleared >= 1,
  },
  {
    id: 'ach.daily7',
    name: 'Regular',
    description: 'Play seven Daily Challenges.',
    steamId: 'ACH_DAILY_7',
    target: () => 7,
    progress: (stats) => stats.dailiesPlayed,
    test: (_, stats) => stats.dailiesPlayed >= 7,
  },
  {
    id: 'ach.charges50',
    name: 'Power Broker',
    description: 'Spend 50 Cosmic Charges.',
    steamId: 'ACH_CHARGES_50',
    target: () => 50,
    progress: (stats) => stats.chargesUsed,
    test: (_, stats) => stats.chargesUsed >= 50,
  },
  {
    id: 'ach.comeback',
    name: 'Against the Pull',
    description: 'Win a Cosmic match with three or more modifiers active.',
    steamId: 'ACH_COMEBACK',
    secret: true,
    test: (summary) => summary?.result === 'win' && summary.modifierCount >= 3,
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

/** Achievements newly satisfied that the profile has not already unlocked. */
export function evaluateAchievements(
  summary: MatchSummary | null,
  stats: PlayerStats,
  alreadyUnlocked: readonly string[],
): AchievementDef[] {
  const owned = new Set(alreadyUnlocked);
  return ACHIEVEMENTS.filter((a) => !owned.has(a.id) && a.test(summary, stats));
}

/** Folds a finished match into the lifetime stats. Returns a new object. */
export function applyMatchToStats(stats: PlayerStats, summary: MatchSummary): PlayerStats {
  const next: PlayerStats = {
    ...stats,
    winsByDifficulty: { ...stats.winsByDifficulty },
  };

  next.matchesPlayed++;
  if (summary.result === 'win') {
    next.wins++;
    next.currentStreak++;
    next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
    next.winsByDifficulty[summary.difficulty] = (next.winsByDifficulty[summary.difficulty] ?? 0) + 1;
    if (summary.untouched) next.untouchedWins++;
  } else if (summary.result === 'loss') {
    next.losses++;
    next.currentStreak = 0;
  } else {
    next.draws++;
    // A draw preserves a streak rather than breaking it.
  }

  if (summary.mode === 'daily') {
    next.dailiesPlayed++;
    if (summary.result === 'win') next.dailiesWon++;
  }

  if (summary.gauntletDepth) {
    next.gauntletBestDepth = Math.max(next.gauntletBestDepth, summary.gauntletDepth);
  }

  return next;
}
