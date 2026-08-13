/**
 * Haptics.
 *
 * Uses the Capacitor Haptics plugin when running inside the native shell and
 * falls back to the Vibration API on the web. Both are optional: everything
 * degrades to a no-op rather than throwing on platforms without either.
 */

export type HapticStrength = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

interface CapacitorHaptics {
  impact(options: { style: string }): Promise<void>;
  notification(options: { type: string }): Promise<void>;
}

interface CapacitorGlobal {
  Plugins?: { Haptics?: CapacitorHaptics };
  isNativePlatform?: () => boolean;
}

const PATTERNS: Record<HapticStrength, number | number[]> = {
  light: 8,
  medium: 18,
  heavy: 32,
  success: [12, 40, 24],
  warning: [18, 60, 18],
  error: [30, 50, 30],
};

class Haptics {
  enabled = true;

  private get plugin(): CapacitorHaptics | null {
    const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return cap.Plugins?.Haptics ?? null;
  }

  fire(strength: HapticStrength = 'light'): void {
    if (!this.enabled) return;

    const plugin = this.plugin;
    if (plugin) {
      const notify = strength === 'success' || strength === 'warning' || strength === 'error';
      const call = notify
        ? plugin.notification({ type: strength.toUpperCase() })
        : plugin.impact({ style: strength.toUpperCase() });
      void call.catch(() => undefined);
      return;
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(PATTERNS[strength]);
      } catch {
        /* vibration blocked by the platform; not worth surfacing */
      }
    }
  }
}

export const haptics = new Haptics();
