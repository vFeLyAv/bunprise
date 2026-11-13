// «Парад» (the Profil easter egg, approved by Felix 26.10, docs/design/2026-10-26-parade.md): 5 taps on the version
// line within 2.5 s start the bunnies' tower over the "Abmelden" card — no hint anywhere (it is a secret), and not more
// often than once per 30 s. Tab memory only: no storage, no account data.

export const PARADE_TAPS = 5;
export const PARADE_WINDOW_MS = 2500;
export const PARADE_COOLDOWN_MS = 30_000;

export interface ParadeTaps {
  /** One tap on the version line; true = the show starts now (the 5th tap in the window, the pause is over). */
  tap(): boolean;
  /** Tests only. */
  reset(): void;
}

export function createParadeTaps(now: () => number = Date.now): ParadeTaps {
  let taps: number[] = [];
  let lastShow = -Infinity;
  return {
    tap() {
      const t = now();
      taps = [...taps.filter((at) => t - at < PARADE_WINDOW_MS), t];
      if (taps.length < PARADE_TAPS) return false;
      taps = [];
      if (t - lastShow < PARADE_COOLDOWN_MS) return false;
      lastShow = t;
      return true;
    },
    reset() {
      taps = [];
      lastShow = -Infinity;
    },
  };
}

/** One counter for the tab: leaving Profil and coming back keeps the 30 s pause. */
export const paradeTaps = createParadeTaps();
