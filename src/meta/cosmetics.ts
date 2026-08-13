/**
 * The cosmetics catalogue.
 *
 * Everything here is *data*, and everything is drawn procedurally from that
 * data — there are no image assets anywhere in this project. A new skin is a
 * few dozen bytes rather than a texture download, which is what makes it
 * reasonable to ship this many of them to a mobile build.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type Unlock =
  | { kind: 'default' }
  | { kind: 'level'; level: number }
  | { kind: 'shop'; cost: number }
  | { kind: 'achievement'; id: string }
  | { kind: 'gauntlet'; depth: number };

export interface CosmeticBase {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  unlock: Unlock;
}

export interface BoardTheme extends CosmeticBase {
  kind: 'board';
  /** Vertical background gradient. */
  bgTop: string;
  bgBottom: string;
  /** Soft nebula blooms painted behind the pyramid. */
  nebula: string[];
  starColor: string;
  /** Empty cell body and rim. */
  cellFill: string;
  cellStroke: string;
  /** Highlight used for the active target and legal-move hints. */
  accent: string;
  /** Colour of the connective lines between neighbouring cells. */
  linkColor: string;
}

export type TokenShape = 'disc' | 'hex' | 'gem' | 'ring' | 'star' | 'chip';

export interface TokenSkin extends CosmeticBase {
  kind: 'token';
  shape: TokenShape;
  core: string;
  edge: string;
  glow: string;
  text: string;
  /** Extra sheen sweep across the token face. */
  sheen: boolean;
}

export type HoleStyle = 'classic' | 'vortex' | 'shard' | 'prism' | 'maw';

export interface HoleSkin extends CosmeticBase {
  kind: 'hole';
  style: HoleStyle;
  ringA: string;
  ringB: string;
  core: string;
}

export interface TrailSkin extends CosmeticBase {
  kind: 'trail';
  colors: string[];
  shape: 'dot' | 'spark' | 'ring' | 'shard';
}

export interface TitleSkin extends CosmeticBase {
  kind: 'title';
  text: string;
}

export type Cosmetic = BoardTheme | TokenSkin | HoleSkin | TrailSkin | TitleSkin;
export type CosmeticKind = Cosmetic['kind'];

/* ------------------------------------------------------------------ *
 * Board themes
 * ------------------------------------------------------------------ */

export const BOARD_THEMES: BoardTheme[] = [
  {
    kind: 'board', id: 'board.deepfield', name: 'Deep Field', rarity: 'common',
    description: 'The default night. Cold, quiet, and very far from home.',
    unlock: { kind: 'default' },
    bgTop: '#0a0e1f', bgBottom: '#05060f',
    nebula: ['#1b2a6b', '#3b1a5c'], starColor: '#cfe0ff',
    cellFill: '#131a33', cellStroke: '#2b3a6b', accent: '#5cc8ff', linkColor: '#1c2647',
  },
  {
    kind: 'board', id: 'board.emberfall', name: 'Emberfall', rarity: 'common',
    description: 'A dying star throws its last light across the field.',
    unlock: { kind: 'level', level: 3 },
    bgTop: '#25100a', bgBottom: '#0b0503',
    nebula: ['#7a2410', '#b3480f'], starColor: '#ffd8a8',
    cellFill: '#2a1510', cellStroke: '#6b3320', accent: '#ff9d4d', linkColor: '#3d1e14',
  },
  {
    kind: 'board', id: 'board.aurora', name: 'Aurora Veil', rarity: 'rare',
    description: 'Charged particles paint the sky in slow green fire.',
    unlock: { kind: 'level', level: 7 },
    bgTop: '#04201c', bgBottom: '#02090c',
    nebula: ['#0d6b52', '#12857a'], starColor: '#c8fff0',
    cellFill: '#0c2a26', cellStroke: '#1c6b5a', accent: '#4dffc3', linkColor: '#0f3b33',
  },
  {
    kind: 'board', id: 'board.violet', name: 'Violet Drift', rarity: 'rare',
    description: 'Where the dust is thick enough to taste.',
    unlock: { kind: 'shop', cost: 900 },
    bgTop: '#1b0a2e', bgBottom: '#08040f',
    nebula: ['#5b1a8f', '#9b2fa8'], starColor: '#f0d4ff',
    cellFill: '#1f1035', cellStroke: '#5a2b8a', accent: '#c77dff', linkColor: '#2c1548',
  },
  {
    kind: 'board', id: 'board.blueprint', name: 'Blueprint', rarity: 'rare',
    description: 'Someone solved this game on paper once. They were wrong.',
    unlock: { kind: 'shop', cost: 1200 },
    bgTop: '#062033', bgBottom: '#02121f',
    nebula: ['#0b4f7a', '#0a6e8f'], starColor: '#dff4ff',
    cellFill: '#0a2740', cellStroke: '#2f7fb3', accent: '#7fe3ff', linkColor: '#124463',
  },
  {
    kind: 'board', id: 'board.crimson', name: 'Crimson Horizon', rarity: 'epic',
    description: 'The accretion disc, seen from far too close.',
    unlock: { kind: 'level', level: 14 },
    bgTop: '#2b0512', bgBottom: '#0d0207',
    nebula: ['#8f0f36', '#c41e4f'], starColor: '#ffd0dd',
    cellFill: '#2c0a16', cellStroke: '#7d1f3c', accent: '#ff5c8a', linkColor: '#3f0f1f',
  },
  {
    kind: 'board', id: 'board.goldleaf', name: 'Gold Leaf', rarity: 'epic',
    description: 'Awarded for surviving a Gauntlet run to its final gate.',
    unlock: { kind: 'gauntlet', depth: 5 },
    bgTop: '#2a2206', bgBottom: '#0f0c02',
    nebula: ['#8a6d12', '#c9a227'], starColor: '#fff3c4',
    cellFill: '#2b2409', cellStroke: '#7d6520', accent: '#ffd75c', linkColor: '#3b3110',
  },
  {
    kind: 'board', id: 'board.singularity', name: 'Event Horizon', rarity: 'legendary',
    description: 'Pure void with a rim of light. Nothing here reflects.',
    unlock: { kind: 'achievement', id: 'ach.perfectgame' },
    bgTop: '#000000', bgBottom: '#050505',
    nebula: ['#1a1a2e', '#2d2d4a'], starColor: '#ffffff',
    cellFill: '#0b0b12', cellStroke: '#3a3a55', accent: '#ffffff', linkColor: '#16161f',
  },
];

/* ------------------------------------------------------------------ *
 * Token skins
 * ------------------------------------------------------------------ */

export const TOKEN_SKINS: TokenSkin[] = [
  {
    kind: 'token', id: 'token.cobalt', name: 'Cobalt', rarity: 'common',
    description: 'Standard issue. Reliable.',
    unlock: { kind: 'default' },
    shape: 'disc', core: '#2f6bff', edge: '#8fb6ff', glow: '#4d8cff', text: '#ffffff', sheen: true,
  },
  {
    kind: 'token', id: 'token.magma', name: 'Magma', rarity: 'common',
    description: 'Still cooling.',
    unlock: { kind: 'default' },
    shape: 'disc', core: '#ff5a3c', edge: '#ffb08f', glow: '#ff7a4d', text: '#2a0a03', sheen: true,
  },
  {
    kind: 'token', id: 'token.hexsteel', name: 'Hexsteel', rarity: 'common',
    description: 'Machined flat, six sides, no nonsense.',
    unlock: { kind: 'level', level: 2 },
    shape: 'hex', core: '#8a94a8', edge: '#dfe6f2', glow: '#aab6cc', text: '#0d1119', sheen: false,
  },
  {
    kind: 'token', id: 'token.jade', name: 'Jade Cut', rarity: 'rare',
    description: 'Faceted, and heavier than it looks.',
    unlock: { kind: 'level', level: 5 },
    shape: 'gem', core: '#12b886', edge: '#7ff0cb', glow: '#2fd9a4', text: '#02231a', sheen: true,
  },
  {
    kind: 'token', id: 'token.halo', name: 'Halo', rarity: 'rare',
    description: 'A number with nothing inside it.',
    unlock: { kind: 'shop', cost: 650 },
    shape: 'ring', core: '#ffd75c', edge: '#fff3c4', glow: '#ffc93c', text: '#ffffff', sheen: false,
  },
  {
    kind: 'token', id: 'token.pulsar', name: 'Pulsar', rarity: 'epic',
    description: 'Spins fast enough to bend the light around it.',
    unlock: { kind: 'level', level: 10 },
    shape: 'star', core: '#c77dff', edge: '#f0d4ff', glow: '#b14dff', text: '#1a0526', sheen: true,
  },
  {
    kind: 'token', id: 'token.obsidian', name: 'Obsidian', rarity: 'epic',
    description: 'Volcanic glass. Reads as a hole until you look twice.',
    unlock: { kind: 'shop', cost: 1500 },
    shape: 'chip', core: '#14141c', edge: '#6b6b8f', glow: '#3a3a5c', text: '#e8e8ff', sheen: true,
  },
  {
    kind: 'token', id: 'token.quasar', name: 'Quasar', rarity: 'legendary',
    description: 'The brightest thing anyone has ever measured.',
    unlock: { kind: 'achievement', id: 'ach.shutout' },
    shape: 'gem', core: '#ffffff', edge: '#7fe3ff', glow: '#5cc8ff', text: '#04121a', sheen: true,
  },
];

/** The AI always plays this, so the player's own skin is never ambiguous. */
export const OPPONENT_SKIN: TokenSkin = {
  kind: 'token', id: 'token.opponent', name: 'Rival', rarity: 'common',
  description: 'Your opponent.',
  unlock: { kind: 'default' },
  shape: 'disc', core: '#ff3d71', edge: '#ffb3c9', glow: '#ff5c8a', text: '#ffffff', sheen: true,
};

/* ------------------------------------------------------------------ *
 * Black hole skins
 * ------------------------------------------------------------------ */

export const HOLE_SKINS: HoleSkin[] = [
  {
    kind: 'hole', id: 'hole.classic', name: 'Schwarzschild', rarity: 'common',
    description: 'A clean sphere of nothing.',
    unlock: { kind: 'default' },
    style: 'classic', ringA: '#5cc8ff', ringB: '#2f6bff', core: '#000000',
  },
  {
    kind: 'hole', id: 'hole.vortex', name: 'Maelstrom', rarity: 'rare',
    description: 'Spiral arms that drag the whole board inward.',
    unlock: { kind: 'level', level: 4 },
    style: 'vortex', ringA: '#4dffc3', ringB: '#12857a', core: '#001410',
  },
  {
    kind: 'hole', id: 'hole.shard', name: 'Fracture', rarity: 'rare',
    description: 'Space did not tear cleanly.',
    unlock: { kind: 'shop', cost: 800 },
    style: 'shard', ringA: '#ff9d4d', ringB: '#b3480f', core: '#160600',
  },
  {
    kind: 'hole', id: 'hole.prism', name: 'Prism Well', rarity: 'epic',
    description: 'Lensing splits everything that falls in.',
    unlock: { kind: 'level', level: 12 },
    style: 'prism', ringA: '#c77dff', ringB: '#5cc8ff', core: '#0a0018',
  },
  {
    kind: 'hole', id: 'hole.maw', name: 'The Maw', rarity: 'legendary',
    description: 'It is definitely looking back.',
    unlock: { kind: 'gauntlet', depth: 7 },
    style: 'maw', ringA: '#ff3d71', ringB: '#8f0f36', core: '#12000a',
  },
];

/* ------------------------------------------------------------------ *
 * Placement trails
 * ------------------------------------------------------------------ */

export const TRAIL_SKINS: TrailSkin[] = [
  {
    kind: 'trail', id: 'trail.spark', name: 'Sparks', rarity: 'common',
    description: 'A clean burst on landing.',
    unlock: { kind: 'default' },
    colors: ['#ffffff', '#9fd0ff'], shape: 'spark',
  },
  {
    kind: 'trail', id: 'trail.ember', name: 'Embers', rarity: 'common',
    description: 'Warm cinders that hang for a moment.',
    unlock: { kind: 'level', level: 2 },
    colors: ['#ff9d4d', '#ffd75c', '#ff5a3c'], shape: 'dot',
  },
  {
    kind: 'trail', id: 'trail.ripple', name: 'Ripples', rarity: 'rare',
    description: 'Concentric rings across the fabric.',
    unlock: { kind: 'level', level: 6 },
    colors: ['#5cc8ff', '#ffffff'], shape: 'ring',
  },
  {
    kind: 'trail', id: 'trail.glass', name: 'Glasswork', rarity: 'rare',
    description: 'Shards that catch the light on the way down.',
    unlock: { kind: 'shop', cost: 700 },
    colors: ['#7ff0cb', '#ffffff', '#2fd9a4'], shape: 'shard',
  },
  {
    kind: 'trail', id: 'trail.void', name: 'Void Bloom', rarity: 'epic',
    description: 'Darkness that briefly outshines the board.',
    unlock: { kind: 'shop', cost: 1800 },
    colors: ['#c77dff', '#1a0526', '#f0d4ff'], shape: 'shard',
  },
];

/* ------------------------------------------------------------------ *
 * Titles
 * ------------------------------------------------------------------ */

export const TITLE_SKINS: TitleSkin[] = [
  { kind: 'title', id: 'title.cadet', name: 'Cadet', text: 'Cadet', rarity: 'common', description: 'Everyone starts here.', unlock: { kind: 'default' } },
  { kind: 'title', id: 'title.navigator', name: 'Navigator', text: 'Navigator', rarity: 'common', description: 'Reach level 4.', unlock: { kind: 'level', level: 4 } },
  { kind: 'title', id: 'title.tactician', name: 'Tactician', text: 'Tactician', rarity: 'rare', description: 'Reach level 8.', unlock: { kind: 'level', level: 8 } },
  { kind: 'title', id: 'title.eventwalker', name: 'Event Walker', text: 'Event Walker', rarity: 'rare', description: 'Reach level 15.', unlock: { kind: 'level', level: 15 } },
  { kind: 'title', id: 'title.holekeeper', name: 'Holekeeper', text: 'Holekeeper', rarity: 'epic', description: 'Reach level 22.', unlock: { kind: 'level', level: 22 } },
  { kind: 'title', id: 'title.unbeaten', name: 'Unbeaten', text: 'Unbeaten', rarity: 'epic', description: 'Win 10 matches in a row.', unlock: { kind: 'achievement', id: 'ach.streak10' } },
  { kind: 'title', id: 'title.voidborn', name: 'Voidborn', text: 'Voidborn', rarity: 'legendary', description: 'Clear a full Gauntlet run.', unlock: { kind: 'gauntlet', depth: 7 } },
  { kind: 'title', id: 'title.singularity', name: 'Singularity', text: 'Singularity', rarity: 'legendary', description: 'Beat the Singularity difficulty.', unlock: { kind: 'achievement', id: 'ach.beatsingularity' } },
];

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

export const ALL_COSMETICS: Cosmetic[] = [
  ...BOARD_THEMES,
  ...TOKEN_SKINS,
  ...HOLE_SKINS,
  ...TRAIL_SKINS,
  ...TITLE_SKINS,
];

const BY_ID = new Map<string, Cosmetic>(ALL_COSMETICS.map((c) => [c.id, c]));

export function getCosmetic(id: string): Cosmetic | undefined {
  return BY_ID.get(id);
}

export function cosmeticsOfKind<K extends CosmeticKind>(kind: K): Extract<Cosmetic, { kind: K }>[] {
  return ALL_COSMETICS.filter((c) => c.kind === kind) as Extract<Cosmetic, { kind: K }>[];
}

/** Ids granted to a brand-new profile. */
export const DEFAULT_EQUIPPED = {
  board: 'board.deepfield',
  token: 'token.cobalt',
  hole: 'hole.classic',
  trail: 'trail.spark',
  title: 'title.cadet',
} as const;

export type EquippedSet = Record<CosmeticKind, string>;

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#8a94a8',
  rare: '#5cc8ff',
  epic: '#c77dff',
  legendary: '#ffd75c',
};

/** Shop price, derived from rarity when an item has no explicit cost. */
export const RARITY_PRICE: Record<Rarity, number> = {
  common: 250,
  rare: 750,
  epic: 1600,
  legendary: 3200,
};

export function priceOf(cosmetic: Cosmetic): number {
  return cosmetic.unlock.kind === 'shop' ? cosmetic.unlock.cost : RARITY_PRICE[cosmetic.rarity];
}
