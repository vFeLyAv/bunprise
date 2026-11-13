import type { ThemeId } from '../themes'

// The pictures of the cover motifs, one lazy chunk per motif (+ the shared ./kit.ts): a Start card, the occasion's
// hero or the picker loads only the motifs it shows. The markup is a pure drawing — built once per motif and tab.
// The service worker precaches every JS chunk, so the motifs also show offline once the app is installed.

type ArtModule = { default: () => string }

const LOADERS: Readonly<Record<ThemeId, () => Promise<ArtModule>>> = {
  birthday: () => import('./birthday'),
  party: () => import('./party'),
  gamenight: () => import('./gamenight'),
  dinner: () => import('./dinner'),
  bbq: () => import('./bbq'),
  movie: () => import('./movie'),
  sport: () => import('./sport'),
  picnic: () => import('./picnic'),
  concert: () => import('./concert'),
  housewarming: () => import('./housewarming'),
  wedding: () => import('./wedding'),
  baby: () => import('./baby'),
  christmas: () => import('./christmas'),
  newyear: () => import('./newyear'),
  halloween: () => import('./halloween'),
  easter: () => import('./easter'),
}

/**
 * The window of the 480 × 320 canvas a box shows: `cover` = all of it (cut by the box's own shape: the Start card
 * 16 : 7, the hero 1 : 1.08); `thumb` = the motif's middle, zoomed in, for the picker's small squares.
 */
export const CROPS = { cover: '0 0 480 320', thumb: '130 44 220 180' } as const
export type CoverCrop = keyof typeof CROPS

const markups = new Map<ThemeId, string>()
const pending = new Map<ThemeId, Promise<string>>()

/** The inner SVG markup of a motif when it was drawn already in this tab. */
export function cachedCoverMarkup(id: ThemeId): string | undefined {
  return markups.get(id)
}

/** Loads (once) and draws (once) a motif. A failed chunk (offline) is asked for again the next time. */
export function loadCoverMarkup(id: ThemeId): Promise<string> {
  const done = markups.get(id)
  if (done !== undefined) return Promise.resolve(done)
  let promise = pending.get(id)
  if (!promise) {
    promise = LOADERS[id]().then(
      (module) => {
        const markup = module.default()
        markups.set(id, markup)
        pending.delete(id)
        return markup
      },
      (err: unknown) => {
        pending.delete(id)
        throw err
      },
    )
    pending.set(id, promise)
  }
  return promise
}
