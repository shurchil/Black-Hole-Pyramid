import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_COSMETICS, getCosmetic, priceOf } from '../src/meta/cosmetics';
import { MAX_LEVEL, computeRewards, levelFromXp, totalXpForLevel, xpToNext } from '../src/meta/progression';
import type { MatchSummary } from '../src/meta/progression';
import {
  defaultProfile,
  equip,
  finishMatch,
  isUnlocked,
  purchase,
  resetProfile,
  rollDaily,
  setLoadout,
  shopCatalog,
  startGauntlet,
  advanceGauntlet,
  type Profile,
} from '../src/meta/profile';
import { GAUNTLET_GATES, buildMatch, gauntletDifficulty, isoToday } from '../src/meta/modes';
import { ACHIEVEMENTS, applyMatchToStats, emptyStats, evaluateAchievements } from '../src/meta/achievements';
import { QUESTS, applyMatchToQuests, questsForDate } from '../src/meta/quests';
import { maxNumberFor } from '../src/core/modifiers';
import { CELL_COUNT } from '../src/core/board';
import { createGame, assertInvariant } from '../src/core/rules';

const TODAY = '2026-08-13';

function summary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    mode: 'classic',
    difficulty: 'pilot',
    result: 'win',
    playerScore: 4,
    opponentScore: 11,
    modifierCount: 0,
    untouched: false,
    firstWinOfDay: false,
    ...overrides,
  };
}

describe('level curve', () => {
  it('is strictly increasing and terminates at the cap', () => {
    for (let l = 1; l < MAX_LEVEL - 1; l++) {
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    }
    expect(xpToNext(MAX_LEVEL)).toBe(Infinity);
  });

  it('round-trips xp to level', () => {
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const at = levelFromXp(totalXpForLevel(l));
      expect(at.level).toBe(l);
      if (l < MAX_LEVEL) expect(at.xpIntoLevel).toBe(0);
    }
  });

  it('reports partial progress inside a level', () => {
    const half = totalXpForLevel(3) + Math.floor(xpToNext(3) / 2);
    const at = levelFromXp(half);
    expect(at.level).toBe(3);
    expect(at.progress).toBeGreaterThan(0.4);
    expect(at.progress).toBeLessThan(0.6);
  });

  it('clamps at max level rather than overflowing', () => {
    const at = levelFromXp(totalXpForLevel(MAX_LEVEL) * 10);
    expect(at.level).toBe(MAX_LEVEL);
    expect(at.isMax).toBe(true);
    expect(at.progress).toBe(1);
  });
});

describe('match rewards', () => {
  it('pays more for a win than a loss, and scales with difficulty', () => {
    const loss = computeRewards(summary({ result: 'loss' })).xp;
    const win = computeRewards(summary()).xp;
    const hardWin = computeRewards(summary({ difficulty: 'singularity' })).xp;
    expect(win).toBeGreaterThan(loss);
    expect(hardWin).toBeGreaterThan(win);
  });

  it('rewards a flawless match and modifier risk', () => {
    const plain = computeRewards(summary()).xp;
    expect(computeRewards(summary({ untouched: true })).xp).toBeGreaterThan(plain);
    expect(computeRewards(summary({ modifierCount: 3 })).xp).toBeGreaterThan(plain);
  });

  it('never pays negative or fractional xp', () => {
    for (const result of ['win', 'loss', 'draw'] as const) {
      const r = computeRewards(summary({ result, playerScore: 30, opponentScore: 0 }));
      expect(r.xp).toBeGreaterThan(0);
      expect(Number.isInteger(r.xp)).toBe(true);
      expect(Number.isInteger(r.stardust)).toBe(true);
    }
  });
});

describe('profile lifecycle', () => {
  let profile: Profile;

  beforeEach(() => {
    profile = defaultProfile(TODAY);
  });

  it('starts with exactly the default cosmetics equipped and unlocked', () => {
    for (const id of Object.values(profile.equipped)) {
      const cosmetic = getCosmetic(id)!;
      expect(cosmetic, `equipped ${id} must exist`).toBeDefined();
      expect(isUnlocked(cosmetic, profile), `${id} must be unlocked at start`).toBe(true);
    }
  });

  it('grants xp, stardust and levels on a finished match', () => {
    const report = finishMatch(profile, {
      mode: 'classic',
      difficulty: 'captain',
      result: 'win',
      playerScore: 3,
      opponentScore: 14,
      modifierCount: 0,
      untouched: false,
      chargesUsed: 0,
      today: TODAY,
    });
    expect(report.rewards.xp).toBeGreaterThan(0);
    expect(report.profile.totalXp).toBe(report.rewards.xp);
    expect(report.profile.stardust).toBeGreaterThan(profile.stardust);
    expect(report.profile.stats.wins).toBe(1);
    expect(report.profile.stats.currentStreak).toBe(1);
  });

  it('pays the first-win-of-day bonus exactly once per day', () => {
    const play = (p: Profile, today: string) =>
      finishMatch(p, {
        mode: 'classic', difficulty: 'pilot', result: 'win',
        playerScore: 2, opponentScore: 9, modifierCount: 0, untouched: false, chargesUsed: 0, today,
      });
    const labels = (r: ReturnType<typeof finishMatch>) => r.rewards.breakdown.map((b) => b.label);

    // Asserted on the breakdown rather than the total, because quest payouts
    // ride along in the same total and would mask the bonus.
    const first = play(profile, TODAY);
    expect(labels(first)).toContain('First win of the day');

    const second = play(first.profile, TODAY);
    expect(labels(second)).not.toContain('First win of the day');

    const tomorrow = play(second.profile, '2026-08-14');
    expect(labels(tomorrow)).toContain('First win of the day');
  });

  it('reports a reward breakdown that sums to the total paid out', () => {
    let p = profile;
    for (let i = 0; i < 6; i++) {
      const report = finishMatch(p, {
        mode: 'cosmic', difficulty: 'captain', result: i % 3 === 0 ? 'loss' : 'win',
        playerScore: 3, opponentScore: 15, modifierCount: 2, untouched: false, chargesUsed: 1, today: TODAY,
      });
      const summed = report.rewards.breakdown.reduce((total, row) => total + row.xp, 0);
      expect(summed, 'breakdown rows must account for every point of xp').toBe(report.rewards.xp);
      p = report.profile;
    }
  });

  it('unlocks cosmetics as levels are reached and reports them once', () => {
    let p = profile;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const report = finishMatch(p, {
        mode: 'cosmic', difficulty: 'singularity', result: 'win',
        playerScore: 0, opponentScore: 20, modifierCount: 2, untouched: true, chargesUsed: 1, today: TODAY,
      });
      p = report.profile;
      for (const c of report.newlyUnlocked) {
        expect(seen.has(c.id), `${c.id} reported as newly unlocked twice`).toBe(false);
        seen.add(c.id);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    // Everything reported must genuinely be unlocked now.
    for (const id of seen) expect(isUnlocked(getCosmetic(id)!, p)).toBe(true);
  });

  it('breaks a streak on a loss but not on a draw', () => {
    let stats = emptyStats();
    stats = applyMatchToStats(stats, summary({ result: 'win' }));
    stats = applyMatchToStats(stats, summary({ result: 'win' }));
    expect(stats.currentStreak).toBe(2);
    stats = applyMatchToStats(stats, summary({ result: 'draw' }));
    expect(stats.currentStreak).toBe(2);
    stats = applyMatchToStats(stats, summary({ result: 'loss' }));
    expect(stats.currentStreak).toBe(0);
    expect(stats.bestStreak).toBe(2);
  });
});

describe('shop', () => {
  it('rejects a purchase the player cannot afford, and succeeds once rich', () => {
    const profile = defaultProfile(TODAY);
    const item = shopCatalog(profile)[0];
    expect(item).toBeDefined();

    const broke = purchase({ ...profile, stardust: 0 }, item.id);
    expect(broke.ok).toBe(false);

    const rich = purchase({ ...profile, stardust: priceOf(item) }, item.id);
    expect(rich.ok).toBe(true);
    if (rich.ok) {
      expect(rich.profile.stardust).toBe(0);
      expect(isUnlocked(item, rich.profile)).toBe(true);
      // Buying twice must not be possible.
      expect(purchase(rich.profile, item.id).ok).toBe(false);
      expect(shopCatalog(rich.profile).map((c) => c.id)).not.toContain(item.id);
    }
  });

  it('refuses to equip something that is not unlocked', () => {
    const profile = defaultProfile(TODAY);
    const locked = ALL_COSMETICS.find((c) => !isUnlocked(c, profile))!;
    expect(equip(profile, locked.id).equipped[locked.kind]).not.toBe(locked.id);
  });

  it('equips an unlocked cosmetic into the right slot', () => {
    const profile = defaultProfile(TODAY);
    const owned = ALL_COSMETICS.find((c) => c.kind === 'token' && isUnlocked(c, profile))!;
    expect(equip(profile, owned.id).equipped.token).toBe(owned.id);
  });

  it('prices every cosmetic at a positive amount', () => {
    for (const c of ALL_COSMETICS) expect(priceOf(c)).toBeGreaterThan(0);
  });
});

describe('daily quests', () => {
  it('are deterministic for a date and rotate when the date changes', () => {
    expect(questsForDate(TODAY).quests.map((q) => q.id)).toEqual(
      questsForDate(TODAY).quests.map((q) => q.id),
    );
    const profile = defaultProfile(TODAY);
    const rolled = rollDaily(profile, '2026-08-14');
    expect(rolled.quests.date).toBe('2026-08-14');
    expect(rolled.daily.played).toBe(false);
  });

  it('advance on matching matches and complete exactly once', () => {
    let quests = questsForDate(TODAY);
    // Force a known quest so the assertion does not depend on the roll.
    quests = { date: TODAY, quests: [{ id: 'quest.win2', progress: 0, claimed: false }] };

    const first = applyMatchToQuests(quests, summary({ result: 'win' }));
    expect(first.quests.quests[0].progress).toBe(1);
    expect(first.completed).toHaveLength(0);

    const second = applyMatchToQuests(first.quests, summary({ result: 'win' }));
    expect(second.completed.map((q) => q.id)).toEqual(['quest.win2']);

    const third = applyMatchToQuests(second.quests, summary({ result: 'win' }));
    expect(third.completed).toHaveLength(0); // never completes twice
    expect(third.quests.quests[0].progress).toBe(QUESTS['quest.win2'].target);
  });

  it('does not advance on a non-matching match', () => {
    const quests = { date: TODAY, quests: [{ id: 'quest.win2' as const, progress: 0, claimed: false }] };
    expect(applyMatchToQuests(quests, summary({ result: 'loss' })).quests.quests[0].progress).toBe(0);
  });
});

describe('achievements', () => {
  it('every cosmetic gated on an achievement points at a real one', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const c of ALL_COSMETICS) {
      if (c.unlock.kind === 'achievement') {
        expect(ids.has(c.unlock.id), `${c.id} refers to unknown achievement ${c.unlock.id}`).toBe(true);
      }
    }
  });

  it('uses unique ids and unique Steam api names', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(new Set(ACHIEVEMENTS.map((a) => a.steamId)).size).toBe(ACHIEVEMENTS.length);
    expect(new Set(ALL_COSMETICS.map((c) => c.id)).size).toBe(ALL_COSMETICS.length);
  });

  it('fires once and is not re-reported afterwards', () => {
    const stats = { ...emptyStats(), wins: 1 };
    const first = evaluateAchievements(summary(), stats, []);
    expect(first.map((a) => a.id)).toContain('ach.firstwin');
    const second = evaluateAchievements(summary(), stats, first.map((a) => a.id));
    expect(second.map((a) => a.id)).not.toContain('ach.firstwin');
  });

  it('awards the flawless-match achievement only on an untouched win', () => {
    const stats = emptyStats();
    expect(evaluateAchievements(summary({ untouched: true }), stats, []).map((a) => a.id))
      .toContain('ach.perfectgame');
    expect(evaluateAchievements(summary({ untouched: false }), stats, []).map((a) => a.id))
      .not.toContain('ach.perfectgame');
  });
});

describe('gauntlet run', () => {
  it('advances through the gates and records a clear', () => {
    let p = startGauntlet(defaultProfile(TODAY), 42);
    expect(p.gauntlet?.depth).toBe(1);
    for (let gate = 1; gate < GAUNTLET_GATES; gate++) {
      p = advanceGauntlet(p, GAUNTLET_GATES);
      expect(p.gauntlet?.depth).toBe(gate + 1);
    }
    p = advanceGauntlet(p, GAUNTLET_GATES);
    expect(p.gauntlet).toBeNull(); // run complete
    expect(p.stats.gauntletRunsCleared).toBe(1);
    expect(p.stats.gauntletBestDepth).toBe(GAUNTLET_GATES);
  });

  it('gets harder as it goes and never exceeds the ladder', () => {
    const seen = new Set<string>();
    for (let depth = 1; depth <= GAUNTLET_GATES; depth++) seen.add(gauntletDifficulty(depth));
    expect(gauntletDifficulty(1)).toBe('rookie');
    expect(gauntletDifficulty(GAUNTLET_GATES)).toBe('singularity');
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe('mode setup', () => {
  it('produces a legal, invariant-respecting board for every mode', () => {
    for (const mode of ['classic', 'blitz', 'cosmic', 'gauntlet', 'daily', 'local', 'tutorial'] as const) {
      for (let i = 0; i < 12; i++) {
        const setup = buildMatch({
          mode,
          difficulty: 'captain',
          loadout: ['singularityShift', 'stasisField'],
          gauntletDepth: (i % GAUNTLET_GATES) + 1,
          seed: i * 104729 + 7,
          today: TODAY,
        });
        const game = createGame(setup.options);
        assertInvariant(game);
        expect(game.rules.maxNumber).toBe(maxNumberFor(setup.options.modifiers ?? []));
        expect(game.board).toHaveLength(CELL_COUNT);
      }
    }
  });

  it('gives everyone the same Daily Challenge on a given date', () => {
    const a = buildMatch({ mode: 'daily', difficulty: 'rookie', loadout: [], today: TODAY });
    const b = buildMatch({ mode: 'daily', difficulty: 'singularity', loadout: [], today: TODAY });
    expect(a.options.seed).toBe(b.options.seed);
    expect(a.modifiers).toEqual(b.modifiers);
    expect(a.difficulty).toBe(b.difficulty); // the rival is fixed too
  });

  it('gives a different board on a different date', () => {
    const a = buildMatch({ mode: 'daily', difficulty: 'pilot', loadout: [], today: '2026-08-13' });
    const b = buildMatch({ mode: 'daily', difficulty: 'pilot', loadout: [], today: '2026-09-01' });
    expect(a.options.seed).not.toBe(b.options.seed);
  });

  it('formats today as an ISO date', () => {
    expect(isoToday(new Date(2026, 7, 3))).toBe('2026-08-03');
  });
});

describe('loadout', () => {
  it('caps the loadout and drops duplicates', () => {
    const p = setLoadout(defaultProfile(TODAY), [
      'singularityShift',
      'singularityShift',
      'stasisField',
      'dampener',
    ]);
    expect(p.loadout).toEqual(['singularityShift', 'stasisField']);
  });

  it('ignores an empty loadout rather than leaving the player with none', () => {
    const base = defaultProfile(TODAY);
    expect(setLoadout(base, []).loadout).toEqual(base.loadout);
  });
});

describe('save robustness', () => {
  it('resets cleanly', () => {
    const fresh = resetProfile(TODAY);
    expect(fresh.totalXp).toBe(0);
    expect(fresh.stats.matchesPlayed).toBe(0);
  });
});
