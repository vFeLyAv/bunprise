import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'

// "Weiterlesen" for the comic (docs/storage-registry.md): where the reader stopped, on this device only — ONE key with
// two numbers and nothing else, "<episode> <panel>" (e.g. "1 7"); no account, no ids, no texts. Written while
// reading, removed when the last episode was read to its end; cleared on sign-out with every key of the prefix.

export interface ComicProgress {
  episode: 1 | 2
  /** index of the panel at the reading line */
  panel: number
}

const KEY = `${ACTIVE_STORAGE_PREFIX}comicProgress`
const listeners = new Set<() => void>()
let cached: { raw: string | null; value: ComicProgress | null } | null = null

function parse(raw: string | null): ComicProgress | null {
  const match = /^([12]) (\d{1,3})$/.exec(raw ?? '')
  if (!match) return null
  return { episode: match[1] === '2' ? 2 : 1, panel: Number(match[2]) }
}

/** Started and not finished: where to go on; null = nothing to go on with. */
export function readComicProgress(): ComicProgress | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    /* storage blocked: no "Weiterlesen" */
  }
  if (cached?.raw !== raw) cached = { raw, value: parse(raw) }
  return cached.value
}

/** Remembers the position (null: the comic was read to its end — nothing to go on with). */
export function writeComicProgress(progress: ComicProgress | null): void {
  const next = progress ? `${progress.episode} ${Math.max(0, Math.min(999, Math.round(progress.panel)))}` : null
  try {
    if (next === null) localStorage.removeItem(KEY)
    else if (localStorage.getItem(KEY) !== next) localStorage.setItem(KEY, next)
    else return
  } catch {
    return
  }
  for (const listener of listeners) listener()
}

export function subscribeComicProgress(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
