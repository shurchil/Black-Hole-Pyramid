/**
 * Board modifiers — the main source of match-to-match variety.
 *
 * Every modifier is chosen so the fundamental arithmetic of the game still
 * works out: `playableCells - totalPlacements === 1`, so exactly one cell is
 * left over to become the black hole. Modifiers that remove cells therefore
 * also shorten the number ladder.
 */

import { CELL_COUNT, NEIGHBORS } from './board';
import type { ModifierId } from './types';

export interface ModifierDef {
  id: ModifierId;
  name: string;
  /** Short blurb shown on the pre-match card. */
  blurb: string;
  /** How strongly this warps the match, used to balance random rolls. */
  intensity: 1 | 2 | 3;
}

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  supernovae: {
    id: 'supernovae',
    name: 'Supernovae',
    blurb: 'Two cells burn hot: a number placed there counts DOUBLE if the black hole touches it.',
    intensity: 2,
  },
  wormholes: {
    id: 'wormholes',
    name: 'Wormhole',
    blurb: 'Two distant cells are linked. They count as neighbours of each other.',
    intensity: 2,
  },
  inverters: {
    id: 'inverters',
    name: 'Inverter',
    blurb: 'One cell flips its sign. Its number SUBTRACTS from your score at the hole.',
    intensity: 3,
  },
  collapsedStar: {
    id: 'collapsedStar',
    name: 'Collapsed Star',
    blurb: 'Two cells are destroyed. The number ladder only runs 1 to 9.',
    intensity: 2,
  },
  reversedFlow: {
    id: 'reversedFlow',
    name: 'Reverse Flow',
    blurb: 'The ladder runs backwards: you place your 10 first and your 1 last.',
    intensity: 3,
  },
  doubleGravity: {
    id: 'doubleGravity',
    name: 'Deep Gravity',
    blurb: 'The pull reaches further. Cells two steps away count at half value.',
    intensity: 3,
  },
};

export const ALL_MODIFIERS: readonly ModifierId[] = Object.keys(MODIFIERS) as ModifierId[];

/** Modifiers that shorten the ladder must not stack with each other. */
const LADDER_MODIFIERS: readonly ModifierId[] = ['collapsedStar'];

/** How many cells a modifier set removes from play. */
export function collapsedCellCount(modifiers: readonly ModifierId[]): number {
  return modifiers.includes('collapsedStar') ? 2 : 0;
}

/**
 * The highest number in the ladder for a modifier set. Derived from the cell
 * budget so the "exactly one cell left" invariant can never drift.
 */
export function maxNumberFor(modifiers: readonly ModifierId[]): number {
  const playable = CELL_COUNT - collapsedCellCount(modifiers);
  return (playable - 1) / 2;
}

/** True if these modifiers can legally be active at the same time. */
export function areCompatible(modifiers: readonly ModifierId[]): boolean {
  const ladderCount = modifiers.filter((m) => LADDER_MODIFIERS.includes(m)).length;
  if (ladderCount > 1) return false;
  return new Set(modifiers).size === modifiers.length;
}

/**
 * Pick `count` modifiers whose combined intensity stays inside `maxIntensity`,
 * so a random roll can't produce an unreadable soup of five stacked rules.
 */
export function rollModifiers(
  pickIndex: (max: number) => number,
  count: number,
  maxIntensity = 5,
): ModifierId[] {
  const pool = ALL_MODIFIERS.slice();
  const chosen: ModifierId[] = [];
  let intensity = 0;

  while (chosen.length < count && pool.length > 0) {
    const idx = pickIndex(pool.length);
    const candidate = pool.splice(idx, 1)[0];
    const next = [...chosen, candidate];
    const nextIntensity = intensity + MODIFIERS[candidate].intensity;
    if (!areCompatible(next) || nextIntensity > maxIntensity) continue;
    chosen.push(candidate);
    intensity = nextIntensity;
  }
  return chosen;
}

/**
 * Candidate wormhole pairs: cells that are not already touching and sit at
 * least three steps apart, so the link actually changes the topology.
 */
export function wormholeCandidates(): Array<[number, number]> {
  const dist = allPairsDistance();
  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < CELL_COUNT; a++) {
    for (let b = a + 1; b < CELL_COUNT; b++) {
      if (dist[a][b] >= 3) pairs.push([a, b]);
    }
  }
  return pairs;
}

function allPairsDistance(): number[][] {
  const dist: number[][] = Array.from({ length: CELL_COUNT }, () =>
    new Array<number>(CELL_COUNT).fill(Infinity),
  );
  for (let start = 0; start < CELL_COUNT; start++) {
    dist[start][start] = 0;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      for (const next of NEIGHBORS[node]) {
        if (dist[start][next] === Infinity) {
          dist[start][next] = dist[start][node] + 1;
          queue.push(next);
        }
      }
    }
  }
  return dist;
}
