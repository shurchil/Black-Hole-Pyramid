/**
 * Steam integration bridge.
 *
 * The renderer never talks to Steamworks directly. Electron's preload exposes
 * a minimal, allow-listed surface on `window.steamBridge`, and this module
 * wraps it so that every other call site can stay platform-agnostic: on web
 * and mobile every method here is a no-op.
 *
 * Achievement API names come from `ACHIEVEMENTS[].steamId`, so the in-game
 * list and the Steam partner backend cannot drift apart.
 */

export interface SteamBridge {
  isAvailable(): boolean;
  unlockAchievement(apiName: string): void;
  setStat(name: string, value: number): void;
  store(): void;
  getPlayerName(): string | null;
  openOverlay(page: string): void;
}

declare global {
  interface Window {
    steamBridge?: SteamBridge;
  }
}

class SteamClient {
  private get bridge(): SteamBridge | null {
    if (typeof window === 'undefined') return null;
    const bridge = window.steamBridge;
    return bridge?.isAvailable() ? bridge : null;
  }

  get available(): boolean {
    return this.bridge !== null;
  }

  unlockAchievement(apiName: string): void {
    try {
      this.bridge?.unlockAchievement(apiName);
    } catch {
      /* never let a storefront integration break the game */
    }
  }

  setStat(name: string, value: number): void {
    try {
      this.bridge?.setStat(name, value);
    } catch {
      /* ignore */
    }
  }

  /** Flushes stats and achievements to Steam. Cheap to call at match end. */
  store(): void {
    try {
      this.bridge?.store();
    } catch {
      /* ignore */
    }
  }

  playerName(): string | null {
    try {
      return this.bridge?.getPlayerName() ?? null;
    } catch {
      return null;
    }
  }
}

export const steam = new SteamClient();
