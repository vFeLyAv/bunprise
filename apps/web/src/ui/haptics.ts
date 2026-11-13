/**
 * Haptics bridge for the UI kit.
 *
 * The app owns the real wrapper (src/lib/haptics.ts, design-system-motion.md §2.7:
 * Android vibrates, iPhone browsers cannot, settings switch). The kit must not
 * depend on it existing, so:
 *   - if src/lib/haptics.ts exists at build time it is picked up automatically
 *     (import.meta.glob with eager: true turns into a static import, or into an
 *     empty object when the file is missing — no build error either way);
 *   - the app can also register a handler explicitly with setHaptics();
 *   - otherwise everything is a no-op. Visual feedback is always done by the
 *     component itself, never by this module.
 */
export type HapticKind = 'tap' | 'select' | 'success' | 'warning' | 'error';
export type HapticHandler = (kind: HapticKind) => void;

interface MaybeHapticsModule {
  haptic?: unknown;
  haptics?: unknown;
  default?: unknown;
}

const noop: HapticHandler = () => {};

function isFn(v: unknown): v is (...args: unknown[]) => unknown {
  return typeof v === 'function';
}

/** Accepts `haptic(kind)` or an object `haptics.tap()` / `haptics.success()`. */
function fromModule(mod: MaybeHapticsModule | undefined): HapticHandler {
  if (!mod) return noop;
  const direct = mod.haptic ?? mod.default;
  if (isFn(direct)) return (kind) => void direct(kind);
  const obj = mod.haptics;
  if (obj && typeof obj === 'object') {
    const table = obj as Record<string, unknown>;
    return (kind) => {
      const fn = table[kind];
      if (isFn(fn)) fn();
    };
  }
  return noop;
}

const found = import.meta.glob<MaybeHapticsModule>('../lib/haptics.ts', { eager: true });
let handler: HapticHandler = fromModule(found['../lib/haptics.ts']);

/** Lets the app plug in its haptics wrapper (overrides auto-detection). */
export function setHaptics(fn: HapticHandler | null): void {
  handler = fn ?? noop;
}

/** Fire-and-forget; never throws (iPhone browsers have no vibration). */
export function haptic(kind: HapticKind): void {
  try {
    handler(kind);
  } catch {
    /* ignore: feedback is optional */
  }
}
