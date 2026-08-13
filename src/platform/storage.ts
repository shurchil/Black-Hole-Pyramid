/**
 * Persistence abstraction.
 *
 * The game saves the same JSON blob everywhere; only the sink differs. On the
 * web that is localStorage, in the native shells it is whatever Capacitor
 * Preferences maps to, and in Electron it is localStorage inside the renderer
 * (which is persisted per-app, so it behaves the same).
 *
 * Writes are debounced because progression updates fire several times at the
 * end of a match and localStorage writes are synchronous.
 */

export interface StorageDriver {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

class MemoryDriver implements StorageDriver {
  private map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

class LocalStorageDriver implements StorageDriver {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* quota or private mode; the in-memory copy still works this session */
    }
  }
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function pickDriver(): StorageDriver {
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    try {
      const probe = '__bhp_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return new LocalStorageDriver();
    } catch {
      return new MemoryDriver();
    }
  }
  return new MemoryDriver();
}

export class Storage {
  private driver: StorageDriver;
  private pending = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(driver?: StorageDriver) {
    this.driver = driver ?? pickDriver();
  }

  readJson<T>(key: string, fallback: T): T {
    const raw = this.pending.get(key) ?? this.driver.get(key);
    if (raw === null || raw === undefined) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupt save must never brick the game; start fresh instead.
      return fallback;
    }
  }

  writeJson(key: string, value: unknown): void {
    this.pending.set(key, JSON.stringify(value));
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    for (const [key, value] of this.pending) this.driver.set(key, value);
    this.pending.clear();
  }

  remove(key: string): void {
    this.pending.delete(key);
    this.driver.remove(key);
  }
}

export const storage = new Storage();

// Never lose the last few seconds of progress when the app is backgrounded.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => storage.flush());
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') storage.flush();
  });
}
