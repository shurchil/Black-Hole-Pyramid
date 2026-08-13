/**
 * The player profile: the single saved object, and every operation that
 * mutates it.
 *
 * Design rules:
 *  - Nothing here touches the DOM, so it is fully unit-testable.
 *  - Every mutation returns a report of what changed, because the UI needs to
 *    celebrate exactly those things (level ups, unlocks, quest completions).
 *  - Unlock state is *derived* wherever possible rather than stored, so raising
 *    a level threshold in the catalogue retroactively does the right thing.
 */

import type { Difficulty } from '../ai/search';
import { CHARGE_LOADOUT_SIZE, DEFAULT_LOADOUT } from '../core/charges';
import type { ChargeKind } from '../core/types';
import { storage } from '../platform/storage';
import {
  applyMatchToStats,
  emptyStats,
  evaluateAchievements,
  type AchievementDef,
  type PlayerStats,
} from './achievements';
import {
  ALL_COSMETICS,
  DEFAULT_EQUIPPED,
  getCosmetic,
  priceOf,
  type Cosmetic,
  type CosmeticKind,
} from './cosmetics';
import { isoToday, type GameMode } from './modes';
import {
  computeRewards,
  levelFromXp,
  levelUpStardust,
  type MatchSummary,
  type Rewards,
} from './progression';
import {
  applyMatchToQuests,
  questsForDate,
  type DailyQuests,
  type QuestDef,
} from './quests';

const SAVE_KEY = 'bhp.profile.v1';
const SAVE_VERSION = 1;

export interface Settings {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  haptics: boolean;
  /** Scales every animation; 0 is a still board for motion-sensitive players. */
  reducedMotion: boolean;
  preferredDifficulty: Difficulty;
  /** Shows the legal-move hints and the number ladder. */
  showHints: boolean;
}

export interface GauntletRun {
  depth: number;
  seed: number;
  livesUsed: number;
}

export interface DailyRecord {
  date: string;
  played: boolean;
  result: 'win' | 'loss' | 'draw' | null;
  margin: number;
}

export interface Profile {
  version: number;
  totalXp: number;
  stardust: number;
  stats: PlayerStats;
  /** Explicitly granted cosmetics: shop purchases and one-off rewards. */
  purchased: string[];
  equipped: Record<CosmeticKind, string>;
  achievements: string[];
  quests: DailyQuests;
  loadout: ChargeKind[];
  gauntlet: GauntletRun | null;
  daily: DailyRecord;
  lastWinDate: string | null;
  settings: Settings;
  tutorialDone: boolean;
}

export function defaultProfile(today = isoToday()): Profile {
  return {
    version: SAVE_VERSION,
    totalXp: 0,
    stardust: 300,
    stats: emptyStats(),
    purchased: [],
    equipped: { ...DEFAULT_EQUIPPED },
    achievements: [],
    quests: questsForDate(today),
    loadout: [...DEFAULT_LOADOUT],
    gauntlet: null,
    daily: { date: today, played: false, result: null, margin: 0 },
    lastWinDate: null,
    settings: {
      sfxVolume: 0.7,
      musicVolume: 0.35,
      muted: false,
      haptics: true,
      reducedMotion: false,
      preferredDifficulty: 'pilot',
      showHints: true,
    },
    tutorialDone: false,
  };
}

/* ------------------------------------------------------------------ *
 * Load / save
 * ------------------------------------------------------------------ */

export function loadProfile(today = isoToday()): Profile {
  const raw = storage.readJson<Partial<Profile> | null>(SAVE_KEY, null);
  const base = defaultProfile(today);
  if (!raw || typeof raw !== 'object') return base;

  // Merge field by field so a save written by an older build keeps working
  // and any field added since simply takes its default.
  const profile: Profile = {
    ...base,
    ...raw,
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    equipped: { ...base.equipped, ...(raw.equipped ?? {}) },
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    purchased: Array.isArray(raw.purchased) ? raw.purchased : [],
    achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
    loadout: Array.isArray(raw.loadout) && raw.loadout.length > 0 ? raw.loadout : [...DEFAULT_LOADOUT],
    quests: raw.quests ?? base.quests,
    daily: raw.daily ?? base.daily,
    version: SAVE_VERSION,
  };

  return rollDaily(profile, today);
}

export function saveProfile(profile: Profile): void {
  storage.writeJson(SAVE_KEY, profile);
}

export function resetProfile(today = isoToday()): Profile {
  const fresh = defaultProfile(today);
  saveProfile(fresh);
  return fresh;
}

/** Rotates the daily quests and the daily challenge slot when the date turns. */
export function rollDaily(profile: Profile, today = isoToday()): Profile {
  let next = profile;
  if (profile.quests.date !== today) {
    next = { ...next, quests: questsForDate(today) };
  }
  if (profile.daily.date !== today) {
    next = { ...next, daily: { date: today, played: false, result: null, margin: 0 } };
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Unlocks
 * ------------------------------------------------------------------ */

export function isUnlocked(cosmetic: Cosmetic, profile: Profile): boolean {
  if (profile.purchased.includes(cosmetic.id)) return true;
  const level = levelFromXp(profile.totalXp).level;

  switch (cosmetic.unlock.kind) {
    case 'default':
      return true;
    case 'level':
      return level >= cosmetic.unlock.level;
    case 'achievement':
      return profile.achievements.includes(cosmetic.unlock.id);
    case 'gauntlet':
      return profile.stats.gauntletBestDepth >= cosmetic.unlock.depth;
    case 'shop':
      return false; // must be bought
  }
}

export function unlockedCosmetics(profile: Profile): Cosmetic[] {
  return ALL_COSMETICS.filter((c) => isUnlocked(c, profile));
}

/** Shop items: purchasable, not yet owned. */
export function shopCatalog(profile: Profile): Cosmetic[] {
  return ALL_COSMETICS.filter(
    (c) => c.unlock.kind === 'shop' && !profile.purchased.includes(c.id),
  );
}

export type PurchaseResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: 'owned' | 'not-for-sale' | 'insufficient' };

export function purchase(profile: Profile, cosmeticId: string): PurchaseResult {
  const cosmetic = getCosmetic(cosmeticId);
  if (!cosmetic) return { ok: false, reason: 'not-for-sale' };
  if (profile.purchased.includes(cosmeticId)) return { ok: false, reason: 'owned' };
  if (cosmetic.unlock.kind !== 'shop') return { ok: false, reason: 'not-for-sale' };

  const cost = priceOf(cosmetic);
  if (profile.stardust < cost) return { ok: false, reason: 'insufficient' };

  return {
    ok: true,
    profile: {
      ...profile,
      stardust: profile.stardust - cost,
      purchased: [...profile.purchased, cosmeticId],
    },
  };
}

export function equip(profile: Profile, cosmeticId: string): Profile {
  const cosmetic = getCosmetic(cosmeticId);
  if (!cosmetic || !isUnlocked(cosmetic, profile)) return profile;
  return {
    ...profile,
    equipped: { ...profile.equipped, [cosmetic.kind]: cosmetic.id },
  };
}

export function setLoadout(profile: Profile, loadout: ChargeKind[]): Profile {
  const trimmed = [...new Set(loadout)].slice(0, CHARGE_LOADOUT_SIZE);
  if (trimmed.length === 0) return profile;
  return { ...profile, loadout: trimmed };
}

export function updateSettings(profile: Profile, patch: Partial<Settings>): Profile {
  return { ...profile, settings: { ...profile.settings, ...patch } };
}

/* ------------------------------------------------------------------ *
 * Finishing a match
 * ------------------------------------------------------------------ */

export interface MatchReport {
  profile: Profile;
  rewards: Rewards;
  levelBefore: number;
  levelAfter: number;
  levelUps: number;
  levelUpStardust: number;
  newAchievements: AchievementDef[];
  completedQuests: QuestDef[];
  /** Cosmetics that became available as a result of this match. */
  newlyUnlocked: Cosmetic[];
}

export interface FinishMatchArgs {
  mode: GameMode;
  difficulty: Difficulty;
  result: 'win' | 'loss' | 'draw';
  playerScore: number;
  opponentScore: number;
  modifierCount: number;
  untouched: boolean;
  chargesUsed: number;
  gauntletDepth?: number;
  today?: string;
}

export function finishMatch(profile: Profile, args: FinishMatchArgs): MatchReport {
  const today = args.today ?? isoToday();
  const rolled = rollDaily(profile, today);

  const summary: MatchSummary = {
    mode: args.mode,
    difficulty: args.difficulty,
    result: args.result,
    playerScore: args.playerScore,
    opponentScore: args.opponentScore,
    modifierCount: args.modifierCount,
    untouched: args.untouched,
    gauntletDepth: args.gauntletDepth,
    firstWinOfDay: args.result === 'win' && rolled.lastWinDate !== today,
  };

  const unlockedBefore = new Set(unlockedCosmetics(rolled).map((c) => c.id));
  const levelBefore = levelFromXp(rolled.totalXp).level;

  const rewards = computeRewards(summary);
  const questUpdate = applyMatchToQuests(rolled.quests, summary);

  // Quest rewards land in the same payout as the match itself.
  const questXp = questUpdate.completed.reduce((sum, q) => sum + q.reward.xp, 0);
  const questStardust = questUpdate.completed.reduce((sum, q) => sum + q.reward.stardust, 0);

  let stats = applyMatchToStats(rolled.stats, summary);
  stats = { ...stats, chargesUsed: stats.chargesUsed + args.chargesUsed };

  const totalXp = rolled.totalXp + rewards.xp + questXp;
  const levelAfter = levelFromXp(totalXp).level;

  let bonusStardust = 0;
  for (let level = levelBefore + 1; level <= levelAfter; level++) {
    bonusStardust += levelUpStardust(level);
  }

  const earnedStardust = rewards.stardust + questStardust + bonusStardust;
  stats = { ...stats, totalStardustEarned: stats.totalStardustEarned + earnedStardust };

  let next: Profile = {
    ...rolled,
    totalXp,
    stardust: rolled.stardust + earnedStardust,
    stats,
    quests: questUpdate.quests,
    lastWinDate: args.result === 'win' ? today : rolled.lastWinDate,
  };

  if (args.mode === 'daily') {
    next = {
      ...next,
      daily: {
        date: today,
        played: true,
        result: args.result,
        margin: args.opponentScore - args.playerScore,
      },
    };
  }

  // Achievements are evaluated against the *updated* stats so that
  // "win 25 matches" can fire on the match that reaches 25.
  const newAchievements = evaluateAchievements(summary, next.stats, next.achievements);
  if (newAchievements.length > 0) {
    next = { ...next, achievements: [...next.achievements, ...newAchievements.map((a) => a.id)] };
  }

  const newlyUnlocked = unlockedCosmetics(next).filter((c) => !unlockedBefore.has(c.id));

  // Quest and level-up payouts are appended to the breakdown as well as the
  // total, so the results screen can list rows that actually sum to what the
  // player was given.
  const breakdown = [...rewards.breakdown];
  for (const quest of questUpdate.completed) {
    breakdown.push({ label: `Quest: ${quest.name}`, xp: quest.reward.xp });
  }

  return {
    profile: next,
    rewards: { xp: rewards.xp + questXp, stardust: earnedStardust, breakdown },
    levelBefore,
    levelAfter,
    levelUps: Math.max(0, levelAfter - levelBefore),
    levelUpStardust: bonusStardust,
    newAchievements,
    completedQuests: questUpdate.completed,
    newlyUnlocked,
  };
}

/* ------------------------------------------------------------------ *
 * Gauntlet run state
 * ------------------------------------------------------------------ */

export function startGauntlet(profile: Profile, seed: number): Profile {
  return { ...profile, gauntlet: { depth: 1, seed, livesUsed: 0 } };
}

export function advanceGauntlet(profile: Profile, gates: number): Profile {
  if (!profile.gauntlet) return profile;
  const depth = profile.gauntlet.depth + 1;
  if (depth > gates) {
    return {
      ...profile,
      gauntlet: null,
      stats: {
        ...profile.stats,
        gauntletRunsCleared: profile.stats.gauntletRunsCleared + 1,
        gauntletBestDepth: Math.max(profile.stats.gauntletBestDepth, gates),
      },
    };
  }
  return { ...profile, gauntlet: { ...profile.gauntlet, depth } };
}

export function endGauntlet(profile: Profile): Profile {
  return { ...profile, gauntlet: null };
}

/** Convenience for the HUD. */
export function levelOf(profile: Profile) {
  return levelFromXp(profile.totalXp);
}
