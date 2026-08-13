# Black Hole Pyramid

A fast, tactical abstract duel. Fill a 21-cell pyramid with the numbers 1–10,
and whichever cell you *fail* to fill collapses into a black hole. Only the
numbers touching it score, and **the lowest score wins**.

One codebase ships to **Android, iOS and Steam**.

---

## The game

### Core rules

- A pyramid of **21 cells** in 6 rows.
- Two players each hold the numbers **1 to 10**.
- Each round both players place the same number: both place their 1, then both
  their 2, and so on up to 10.
- That is 20 placements into 21 cells, so **exactly one cell is left empty** —
  it becomes the **black hole**.
- Every number in a cell *touching* the hole is added to its owner's score.
- **Lowest total wins.** Shield your big numbers; steer the hole toward theirs.

### Two rule changes from the classic game

Both are deliberate and both are covered by tests.

**Fair Start (on by default).** In the classic rules P1 always places first,
every round, which is a measurable edge. Here the first placement alternates
each round (P1, P2 / P2, P1 / …). Both players still place identical numbers,
so it costs nothing in purity and removes a coin-flip from the result. It can be
turned off per match via `alternatingStart: false`.

**Layered tiebreaks instead of instant draws.** Equal scores fall through to the
lower single worst number, then the fewer cells caught in the pull, and only
then a genuine draw. Draws became rare instead of common, without inventing an
arbitrary winner.

### Beyond the base game

**Board modifiers** roll per match in Cosmic, Daily and Gauntlet. Every one of
them preserves the arithmetic that makes the game work — `playable cells −
placements = 1` — so the black hole always exists:

| Modifier | Effect |
| --- | --- |
| **Supernovae** | Two cells count **double** if the hole touches them. |
| **Wormhole** | Two distant cells are linked and count as neighbours. |
| **Inverter** | One cell's number **subtracts** from your score. |
| **Collapsed Star** | Two cells are destroyed; the ladder shortens to 1–9. |
| **Reverse Flow** | The ladder runs backwards — your 10 goes down first. |
| **Deep Gravity** | The pull reaches two cells out at half value. |

**Cosmic Charges** are once-per-match abilities, chosen as a loadout of two.
They are *free actions* — using one never costs you a placement, so the cell
arithmetic is untouched:

- **Singularity Shift** — swap one of your numbers with one of theirs.
- **Stasis Field** — freeze an empty cell for your opponent's next turn.
- **Dampener** — permanently halve one of your own placed numbers.
- **Foresight** — read the board: see which cells favour you as the hole.

### Modes

| Mode | Unlocks | What it is |
| --- | --- | --- |
| **Classic** | — | The pure duel against a chosen difficulty. |
| **Blitz** | Lv 2 | Seven seconds a move; the board places for you if you stall. |
| **Cosmic** | Lv 3 | Rolled modifiers plus charges. |
| **Daily Challenge** | Lv 4 | The same board and rival for everyone, once a day. |
| **Gauntlet** | Lv 5 | Seven gates, escalating rivals and modifiers, one life. |
| **Pass & Play** | — | Two players on one device. |
| **How to Play** | — | A real match, narrated as it happens. |

### Long-term progression

30 levels, a stardust economy, and 31 unlockable cosmetics across five slots
(board themes, token skins, black-hole styles, placement trails, titles) earned
by levelling, achievements, Gauntlet depth or purchase. Three daily quests
rotate deterministically by date, and 12 achievements map one-to-one onto Steam
achievement API names.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run verify     # typecheck + 80 unit tests + browser smoke test
```

### Mobile (Capacitor)

```bash
npm run setup:mobile   # installs the Capacitor packages
npm run mobile:add     # creates the android/ and ios/ projects
npm run mobile:android # build, sync, open Android Studio
npm run mobile:ios     # build, sync, open Xcode
```

### Desktop / Steam (Electron)

```bash
npm run setup:desktop  # installs electron, electron-builder, steamworks.js
npm run desktop:dev    # run the packaged build locally
npm run desktop:dist   # produce release/ artifacts
```

Set `STEAM_APP_ID` before launching to point at your real appid; without it the
build runs standalone and every Steam call becomes a no-op, so the game is fully
playable outside Steam.

---

## Architecture

```
src/
  core/       Pure rules engine — no DOM, no timers, no hidden randomness
  ai/         Alpha-beta search, evaluation, Web Worker + main-thread fallback
  engine/     Canvas renderer, tweens, particles, camera, WebAudio, haptics
  meta/       Progression, cosmetics, quests, achievements, modes, profile
  game/       App shell and scenes (menu, match, results, collection, settings)
  platform/   Storage and the Steam bridge
  ui/         Small DOM helpers
```

**Why TypeScript + Canvas rather than a game engine.** The whole build is 35 KB
gzipped and starts instantly, which matters far more on a phone than anything an
engine would have provided. The core is engine-agnostic anyway: `src/core` is
pure data and functions, so it could be lifted into a different renderer without
edits.

**No binary assets, anywhere.** Every visual is drawn procedurally from theme
data and every sound is synthesised at runtime with WebAudio. That is why a new
skin costs a few dozen bytes instead of a texture download, and why the
placement sound can rise in pitch with the number being played.

**The AI runs in a Web Worker** so search can never drop a frame, with a
synchronous fallback for environments where workers are unavailable.

---

## The AI, and what measurement changed

The difficulty ladder is tuned by self-play, not by intuition — and the
measurements overturned the design.

The first implementation scaled difficulty by search depth, topping out at depth
14 with a 900 ms budget. Benchmarking showed `captain` **losing 5–1 to the
weaker `pilot`**: extra depth was making play *worse*.

Two experiments found why. First, comparing weight sets produced degenerate
0%/50%/100% results — with no modifiers every match starts from the identical
board, so two deterministic engines replayed one single game. Adding randomised
shared openings (`scripts/probe-eval.ts`) fixed the harness. Then, measured
against a baseline that plays **randomly until the endgame and perfectly after
it**:

| Search depth | Score vs random-midgame baseline |
| --- | --- |
| 1 | 68.8% |
| 2 | **82.8%** |
| 3 | 79.7% |
| 5 | 75.0% |
| 8 | 76.6% |

The heuristic carries real signal, but **depth saturates at two plies**. Strength
in this game lives in the *exact endgame*, not in deep midgame search. The ladder
was rebuilt around that: shallow depth, aggressive exact-solve thresholds.

| Matchup | Before | After | ms/move |
| --- | --- | --- | --- |
| pilot vs rookie | 83% | 80.0% ±11 | 0.2 |
| captain vs pilot | **16.7%** | **83.1%** ±11 | 4.0 |
| singularity vs captain | 50% | 61.3% ±11 | 42.0 |

The ladder is now monotonic **and** the top tier answers in 42 ms instead of
900 ms — stronger and roughly 20× snappier, which is exactly what a phone game
needs. Reproduce with `npm run bench:ai`.

Difficulty below the top tier is shaped by blunder rate and score noise rather
than by crippling the search, so a beatable opponent still plays like an
opponent instead of like a shallow one.

---

## Testing

| Suite | Covers |
| --- | --- |
| `tests/board.test.ts` | Adjacency generated by the engine is pinned to the design document's table, plus symmetry and layout. |
| `tests/rules.test.ts` | Turn order, the number ladder, the one-cell-left invariant across 10 modifier combinations × 25 seeds, scoring, tiebreaks, charge semantics, immutability. |
| `tests/ai.test.ts` | The search position is verified against the real rules engine, make/unmake round-trips, exact endgame play, and the difficulty ladder over seat-swapped series. |
| `tests/meta.test.ts` | Level curve round-trips, reward maths, unlock/purchase/equip rules, deterministic daily quests, achievement firing, and that every mode produces an invariant-respecting board. |
| `scripts/smoke.mjs` | Drives the **real production bundle** in Chromium: boots, plays a full match by tapping canvas pixels, checks the result and reward breakdown, verifies persistence across reload, walks every collection tab, confirms level gating, and asserts zero runtime errors. |

```bash
npm run verify
```

---

## Accessibility

- **Reduced motion** is a first-class setting (and honours the OS preference).
  It removes shake, overshoot and particles while keeping every piece of
  *information* the animation conveyed.
- Full **keyboard play**: arrows cycle legal cells, Enter places.
- All menus are real DOM with labels and roles, not canvas-drawn text.
- Touch targets are 46 px minimum with a forgiving hit radius on the board.
- Safe-area insets are respected throughout for notched phones.

---

## Shipping checklist

Before a store submission:

1. Replace `STEAM_APP_ID` in `electron/main.cjs` with the real appid, and create
   the 12 achievements in the Steamworks backend using the `steamId` values in
   `src/meta/achievements.ts`.
2. Set the bundle id in `capacitor.config.ts` if `com.blackholepyramid.game` is
   not yours, then generate icons and splash screens into the native projects.
3. Sign and notarise the macOS build; `build/entitlements.mac.plist` already
   carries the entitlements the Steam overlay needs.
4. Run `npm run verify` — it must be green.
