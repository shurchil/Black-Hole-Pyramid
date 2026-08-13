/**
 * Cosmic Charges — once-per-match abilities that turn the pure placement game
 * into something with comeback potential.
 *
 * Design constraints:
 *  - A charge is a *free action*: it never replaces a placement, so the
 *    "one cell left over" invariant survives untouched.
 *  - At most one charge per turn, so a player cannot chain two abilities into
 *    an unanswerable swing.
 *  - Every charge is fully visible to both sides. No hidden information.
 */

import type { ChargeKind } from './types';

export interface ChargeDef {
  kind: ChargeKind;
  name: string;
  blurb: string;
  /** Icon glyph drawn procedurally by the renderer. */
  glyph: string;
  /** How the UI should collect targets before submitting the move. */
  targeting: 'ownCell+enemyCell' | 'emptyCell' | 'ownCell' | 'none';
}

export const CHARGES: Record<ChargeKind, ChargeDef> = {
  singularityShift: {
    kind: 'singularityShift',
    name: 'Singularity Shift',
    blurb: 'Swap one of your placed numbers with one of your opponent’s.',
    glyph: 'shift',
    targeting: 'ownCell+enemyCell',
  },
  stasisField: {
    kind: 'stasisField',
    name: 'Stasis Field',
    blurb: 'Freeze an empty cell. Your opponent cannot play there on their next turn.',
    glyph: 'freeze',
    targeting: 'emptyCell',
  },
  dampener: {
    kind: 'dampener',
    name: 'Dampener',
    blurb: 'Halve one of your own placed numbers, permanently.',
    glyph: 'damp',
    targeting: 'ownCell',
  },
  foresight: {
    kind: 'foresight',
    name: 'Foresight',
    blurb: 'Read the field: see where the black hole is heading and how bad it would be.',
    glyph: 'eye',
    targeting: 'none',
  },
};

export const ALL_CHARGES: readonly ChargeKind[] = Object.keys(CHARGES) as ChargeKind[];

/** How many charges each player brings into a Cosmic match. */
export const CHARGE_LOADOUT_SIZE = 2;

export const DEFAULT_LOADOUT: readonly ChargeKind[] = ['singularityShift', 'stasisField'];
