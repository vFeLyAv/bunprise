/**
 * «Встряхнуть телефон» (approved 31.10) — a deliberate shake, read from `devicemotion`: three hard peaks (≈ 1.4 g of
 * the phone's own acceleration, gravity left out) within 0.7 s; at most one shake every 10 s. Moved here from the
 * gallery page (demo/listplay/gallery.ts). Pure: the host listens to the event and feeds it in (one listener for the
 * whole app); the detector has no timers and no DOM.
 */

export interface MotionSample {
  acceleration?: { x: number | null; y: number | null; z: number | null } | null;
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null;
}

export interface ShakeRule {
  /** m/s² of the phone's own acceleration that count as one peak (≈ 1.4 g) */
  peak: number;
  /** peaks needed … */
  peaks: number;
  /** … within this many ms */
  windowMs: number;
  /** two peaks closer than this are one (ms) */
  gapMs: number;
  /** at most one shake per this many ms */
  cooldownMs: number;
}

export const SHAKE: Readonly<ShakeRule> = { peak: 14, peaks: 3, windowMs: 700, gapMs: 90, cooldownMs: 10_000 };

const G = 9.81;

/** The phone's own acceleration (m/s²) of one event: without gravity where the device tells it, else |a + g| − g. */
export function motionOf(e: MotionSample): number | null {
  const a = e.acceleration;
  if (a && typeof a.x === 'number') return Math.hypot(a.x, a.y ?? 0, a.z ?? 0);
  const g = e.accelerationIncludingGravity;
  if (!g || typeof g.x !== 'number') return null;
  return Math.abs(Math.hypot(g.x, g.y ?? 0, g.z ?? 0) - G);
}

export interface ShakeDetector {
  /** one devicemotion event at `now` (ms): true = this one completes a shake */
  feed(e: MotionSample, now: number): boolean;
  reset(): void;
}

export function createShakeDetector(rule: Partial<ShakeRule> = {}): ShakeDetector {
  const r: ShakeRule = { ...SHAKE, ...rule };
  let peaks: number[] = [];
  let last = -Infinity;
  return {
    feed(e, now) {
      const m = motionOf(e);
      if (m === null) return false;
      if (m > r.peak) {
        peaks = peaks.filter((t) => now - t < r.windowMs);
        const prev = peaks[peaks.length - 1];
        if (prev === undefined || now - prev > r.gapMs) peaks.push(now);
      }
      if (peaks.length >= r.peaks && now - last > r.cooldownMs) {
        last = now;
        peaks = [];
        return true;
      }
      return false;
    },
    reset() {
      peaks = [];
      last = -Infinity;
    },
  };
}
