/**
 * Daily quests.
 *
 * Three per day, drawn deterministically from the date so every player on a
 * given day gets the same set (and so a reinstall cannot reroll them). They
 * are the short-loop reason to come back; achievements are the long loop.
 */

import { Rng, hashSeed } from '../core/rng';
import type { MatchSummary } from './progression';

export type QuestId =
  | 'quest.play3'
  | 'quest.win2'
  | 'quest.winCosmic'
  | 'quest.untouched'
  | 'quest.margin10'
  | 'quest.useCharges'
  | 'quest.gauntlet2'
  | 'quest.winCaptain'
  | 'quest.daily';

export interface QuestDef {
  id: QuestId;
  name: string;
  description: string;
  target: number;
  reward: { xp: number; stardust: number };
  /** How much a finished match advances this quest. */
  advance: (summary: MatchSummary) => number;
}

export const QUESTS: Record<QuestId, QuestDef> = {
  'quest.play3': {
    id: 'quest.play3',
    name: 'Clock In',
    description: 'Play 3 matches.',
    target: 3,
    reward: { xp: 150, stardust: 60 },
    advance: () => 1,
  },
  'quest.win2': {
    id: 'quest.win2',
    name: 'Double Down',
    description: 'Win 2 matches.',
    target: 2,
    reward: { xp: 200, stardust: 80 },
    advance: (s) => (s.result === 'win' ? 1 : 0),
  },
  'quest.winCosmic': {
    id: 'quest.winCosmic',
    name: 'Bend the Rules',
    description: 'Win a Cosmic match.',
    target: 1,
    reward: { xp: 220, stardust: 90 },
    advance: (s) => (s.result === 'win' && s.mode === 'cosmic' ? 1 : 0),
  },
  'quest.untouched': {
    id: 'quest.untouched',
    name: 'Out of Reach',
    description: 'Win without a single number touching the hole.',
    target: 1,
    reward: { xp: 300, stardust: 130 },
    advance: (s) => (s.result === 'win' && s.untouched ? 1 : 0),
  },
  'quest.margin10': {
    id: 'quest.margin10',
    name: 'Comfortable',
    description: 'Win a match by 10 points or more.',
    target: 1,
    reward: { xp: 240, stardust: 95 },
    advance: (s) => (s.result === 'win' && s.opponentScore - s.playerScore >= 10 ? 1 : 0),
  },
  'quest.useCharges': {
    id: 'quest.useCharges',
    name: 'Fully Charged',
    description: 'Win a match in a mode with Cosmic Charges enabled.',
    target: 1,
    reward: { xp: 210, stardust: 85 },
    advance: (s) =>
      s.result === 'win' && (s.mode === 'cosmic' || s.mode === 'daily' || s.mode === 'gauntlet') ? 1 : 0,
  },
  'quest.gauntlet2': {
    id: 'quest.gauntlet2',
    name: 'Second Gate',
    description: 'Reach gate 2 of a Gauntlet run.',
    target: 1,
    reward: { xp: 260, stardust: 110 },
    advance: (s) => ((s.gauntletDepth ?? 0) >= 2 ? 1 : 0),
  },
  'quest.winCaptain': {
    id: 'quest.winCaptain',
    name: 'Outrank',
    description: 'Beat a Captain or tougher opponent.',
    target: 1,
    reward: { xp: 280, stardust: 115 },
    advance: (s) =>
      s.result === 'win' && (s.difficulty === 'captain' || s.difficulty === 'singularity') ? 1 : 0,
  },
  'quest.daily': {
    id: 'quest.daily',
    name: 'Same Board, Everyone',
    description: 'Play the Daily Challenge.',
    target: 1,
    reward: { xp: 200, stardust: 100 },
    advance: (s) => (s.mode === 'daily' ? 1 : 0),
  },
};

const ALL_QUEST_IDS = Object.keys(QUESTS) as QuestId[];

export interface QuestProgress {
  id: QuestId;
  progress: number;
  claimed: boolean;
}

export interface DailyQuests {
  date: string;
  quests: QuestProgress[];
}

export const QUESTS_PER_DAY = 3;

/** The quest set for a given date. Deterministic, so it survives a reinstall. */
export function questsForDate(date: string): DailyQuests {
  const rng = new Rng(hashSeed(`quests:${date}`));
  const picked = rng.sample(ALL_QUEST_IDS, QUESTS_PER_DAY);
  return {
    date,
    quests: picked.map((id) => ({ id, progress: 0, claimed: false })),
  };
}

export interface QuestUpdate {
  quests: DailyQuests;
  /** Quests that crossed their target as a result of this match. */
  completed: QuestDef[];
}

export function applyMatchToQuests(quests: DailyQuests, summary: MatchSummary): QuestUpdate {
  const completed: QuestDef[] = [];
  const next: DailyQuests = {
    date: quests.date,
    quests: quests.quests.map((entry) => {
      const def = QUESTS[entry.id];
      const wasDone = entry.progress >= def.target;
      const progress = Math.min(def.target, entry.progress + def.advance(summary));
      if (!wasDone && progress >= def.target) completed.push(def);
      return { ...entry, progress };
    }),
  };
  return { quests: next, completed };
}

export function isQuestComplete(entry: QuestProgress): boolean {
  return entry.progress >= QUESTS[entry.id].target;
}
