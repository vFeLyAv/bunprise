import { useEffect, useRef, useState } from 'react'
import {
  PLACE_QUERY_MAX,
  PLACE_QUERY_MIN,
  PlacesError,
  searchPlaces,
  type PlaceSuggestion,
  type PlacesErrorCode,
} from '../../../lib/api/places'

// Debounced, abortable place search for the place sheet. Rules (wave 1, K4):
// - nothing is sent below 2 or above 100 characters, or while offline;
// - one request per pause in typing (~250 ms); a newer keystroke aborts the older request;
// - answers live in this hook's memory only (back-spacing to an earlier query shows it again at once),
//   nothing is written to any storage;
// - after a 429 the hook waits Retry-After (default 10 s) before it asks again.

export type PlaceSearchState =
  | { status: 'idle' }
  | { status: 'too_long' }
  | { status: 'offline' }
  /** `results`: the previous answer, kept on screen while the next one loads (no flicker) */
  | { status: 'loading'; query: string; results: PlaceSuggestion[] | null }
  | { status: 'done'; query: string; results: PlaceSuggestion[] }
  | { status: 'error'; query: string; code: PlacesErrorCode }

export interface PlaceSearchOptions {
  lang: 'de' | 'en'
  online: boolean
  /** the screen's account (lib/api/identity.ts) */
  userId?: string
  /** debounce in ms */
  delay?: number
}

const DEFAULT_COOLDOWN_S = 10

export function normaliseQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function usePlaceSearch(raw: string, { lang, online, userId, delay = 250 }: PlaceSearchOptions): PlaceSearchState {
  const query = normaliseQuery(raw)
  // UTF-16 units, as the Worker counts them
  const length = query.length
  // answers of this sheet, by language + query (memory only)
  const [cache] = useState(() => new Map<string, PlaceSuggestion[]>())
  // read and written in effects only: until when the Worker asked us to wait (429)
  const coolDownUntil = useRef(0)
  // the latest settled answer (any query): its results stay visible while the next query loads
  const [answer, setAnswer] = useState<{ key: string; state: PlaceSearchState } | null>(null)
  const key = `${lang}|${query.toLocaleLowerCase()}`
  const searchable = length >= PLACE_QUERY_MIN && length <= PLACE_QUERY_MAX && online

  useEffect(() => {
    if (!searchable || cache.has(key)) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (Date.now() < coolDownUntil.current) {
        setAnswer({ key, state: { status: 'error', query, code: 'rate_limited' } })
        return
      }
      searchPlaces(query, { lang, signal: controller.signal, expectedUserId: userId }).then(
        (results) => {
          if (controller.signal.aborted) return
          cache.set(key, results)
          setAnswer({ key, state: { status: 'done', query, results } })
        },
        (err: unknown) => {
          if (controller.signal.aborted) return
          const code: PlacesErrorCode = err instanceof PlacesError ? err.code : 'network'
          if (code === 'rate_limited') {
            const wait = err instanceof PlacesError && err.retryAfter !== undefined ? err.retryAfter : DEFAULT_COOLDOWN_S
            coolDownUntil.current = Date.now() + wait * 1000
          }
          setAnswer({ key, state: { status: 'error', query, code } })
        },
      )
    }, delay)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [cache, key, query, lang, userId, delay, searchable])

  if (length < PLACE_QUERY_MIN) return { status: 'idle' }
  if (length > PLACE_QUERY_MAX) return { status: 'too_long' }
  if (!online) return { status: 'offline' }
  const cached = cache.get(key)
  if (cached) return { status: 'done', query, results: cached }
  if (answer?.key === key) return answer.state
  return { status: 'loading', query, results: answer?.state.status === 'done' ? answer.state.results : null }
}
