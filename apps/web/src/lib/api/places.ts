import { LIMITS } from '../app'
import { asAccount, bearer } from './identity'

// Place suggestions for the occasion form (wave 1, K4): GET /api/places on OUR Worker (workers/edge,
// Photon / OpenStreetMap behind it) — the browser never talks to a third party. The request carries the
// signed-in account's bearer token (lib/api/identity.ts: an answer that arrives after the account changed
// is discarded). Every failure becomes a PlacesError with a code; the form then offers free text only.

export const PLACE_KINDS = ['cafe', 'restaurant', 'bar', 'park', 'venue', 'address', 'city', 'other'] as const
export type PlaceKind = (typeof PLACE_KINDS)[number]

export interface PlaceSuggestion {
  id: string
  /** "Café Morgenrot" */
  name: string
  /** "Lindenweg 4, 12345 Beispielstadt" */
  line: string
  kind: PlaceKind
  /** what goes into occasions.place_text (≤ 200 code points) */
  text: string
  /** where it is (only while the Worker's map switch is on): for the small map in the form, never stored */
  point?: PlacePoint
}

export interface PlacePoint {
  lat: number
  lon: number
}

/** Web Mercator's latitude limit (the map tiles end there). */
const MAX_LATITUDE = 85.0511

function pointOf(lat: unknown, lon: unknown): PlacePoint | null {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return Math.abs(lat) <= MAX_LATITUDE && Math.abs(lon) <= 180 ? { lat, lon } : null
}

/** Query length the Worker accepts (UTF-16 units after trim, like the Worker counts them). */
export const PLACE_QUERY_MIN = 2
export const PLACE_QUERY_MAX = 100
export const PLACE_RESULTS_MAX = 6

export type PlacesErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'offline'
  | 'network'
  | 'bad_response'

export class PlacesError extends Error {
  readonly code: PlacesErrorCode
  /** seconds until another try makes sense (429 Retry-After) */
  readonly retryAfter: number | undefined

  constructor(code: PlacesErrorCode, retryAfter?: number) {
    super(`places.${code}`)
    this.name = 'PlacesError'
    this.code = code
    this.retryAfter = retryAfter
  }
}

const codePoints = (value: string) => Array.from(value).length

const STATUS_CODES: Record<number, PlacesErrorCode> = {
  400: 'invalid_request',
  401: 'unauthorized',
  429: 'rate_limited',
  502: 'upstream_unavailable',
  504: 'timeout',
}

function retryAfterSeconds(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text !== '' && codePoints(text) <= max ? text : null
}

/** Strict reading of the Worker's answer: anything unexpected is dropped, never shown or stored. */
export function parsePlacesResponse(payload: unknown): PlaceSuggestion[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw new PlacesError('bad_response')
  const out: PlaceSuggestion[] = []
  const seen = new Set<string>()
  for (const item of payload.results) {
    if (!isRecord(item)) continue
    const id = cleanText(item.id, 200)
    const text = cleanText(item.text, LIMITS.placeText)
    if (!id || !text || seen.has(id)) continue
    // a bare address has no name of its own: its line (or the text) is the name then, shown once
    const rawLine = cleanText(item.line, 200) ?? ''
    const name = cleanText(item.name, 200) ?? (rawLine || text)
    const line = rawLine === name ? '' : rawLine
    const kind = (PLACE_KINDS as readonly string[]).includes(item.kind as string) ? (item.kind as PlaceKind) : 'other'
    seen.add(id)
    const point = pointOf(item.lat, item.lon)
    out.push(point ? { id, name, line, kind, text, point } : { id, name, line, kind, text })
    if (out.length === PLACE_RESULTS_MAX) break
  }
  return out
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : isRecord(err) && err.name === 'AbortError'
}

export interface SearchPlacesOptions {
  lang: 'de' | 'en'
  signal?: AbortSignal
  /** the account of the screen that asks (its answer is dropped once another account is current) */
  expectedUserId?: string
}

/**
 * Suggestions for a typed place. Throws PlacesError (offline, invalid_request, unauthorized,
 * rate_limited + retryAfter, upstream_unavailable, timeout, network, bad_response) or an AbortError when
 * `signal` aborted (a newer keystroke) — callers ignore that one.
 */
export async function searchPlaces(query: string, { lang, signal, expectedUserId }: SearchPlacesOptions): Promise<PlaceSuggestion[]> {
  const q = query.replace(/\s+/g, ' ').trim()
  // the Worker counts UTF-16 units (String#length), so do we
  if (q.length < PLACE_QUERY_MIN || q.length > PLACE_QUERY_MAX) throw new PlacesError('invalid_request')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new PlacesError('offline')

  const url = new URL('/api/places', window.location.origin)
  url.searchParams.set('q', q)
  url.searchParams.set('lang', lang)

  let response: Response
  try {
    response = await asAccount(expectedUserId, (account) =>
      fetch(url, {
        method: 'GET',
        headers: { Authorization: bearer(account), Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal,
      }),
    )
  } catch (err) {
    if (isAbort(err) || signal?.aborted) throw err
    if (err instanceof PlacesError) throw err
    if (isRecord(err) && (err.code === 'session_expired' || err.code === 'not_authenticated')) throw new PlacesError('unauthorized')
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new PlacesError('offline')
    throw new PlacesError('network')
  }

  if (!response.ok) {
    const code = STATUS_CODES[response.status] ?? 'upstream_unavailable'
    throw new PlacesError(code, code === 'rate_limited' ? retryAfterSeconds(response.headers.get('Retry-After')) : undefined)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch (err) {
    if (isAbort(err) || signal?.aborted) throw err
    throw new PlacesError('bad_response')
  }
  return parsePlacesResponse(payload)
}
