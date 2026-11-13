import { ApiError, isRecord, readBytes, withDeadline } from './http'
import type { Clock, Fetch } from './http'
import { LruCache } from './lru'
import { cut, sanitize } from './text'

export type PlaceKind = 'cafe' | 'restaurant' | 'bar' | 'park' | 'venue' | 'address' | 'city' | 'other'
export interface Place {
  id: string
  name: string
  line: string
  kind: PlaceKind
  text: string
  /** The place's point (5 decimals ≈ 1 m), only for the map thumbnail; index.ts drops both unless MAP_TILES is on. */
  lat?: number
  lon?: number
}
export interface PlaceQuery { q: string; lang: 'de' | 'en' }
export interface PlacesResult { results: Place[] }

function text(value: unknown): string {
  if (typeof value !== 'string') return ''
  return cut(sanitize(value), 200)
}

function join(parts: string[], separator: string): string {
  return parts.filter(Boolean).join(separator)
}

function kindOf(p: Record<string, unknown>): PlaceKind {
  const key = p.osm_key
  const value = p.osm_value
  if (key === 'amenity') {
    if (value === 'cafe') return 'cafe'
    if (value === 'restaurant' || value === 'fast_food' || value === 'food_court') return 'restaurant'
    if (value === 'bar' || value === 'pub' || value === 'biergarten') return 'bar'
    if (['theatre', 'cinema', 'community_centre', 'events_venue', 'arts_centre', 'nightclub'].includes(String(value))) return 'venue'
  }
  if (key === 'leisure') {
    if (value === 'park' || value === 'garden') return 'park'
    if (['stadium', 'sports_centre', 'dance', 'water_park'].includes(String(value))) return 'venue'
  }
  if (key === 'tourism' && ['museum', 'attraction', 'gallery', 'hotel'].includes(String(value))) return 'venue'
  if ((key === 'place' && ['city', 'town', 'village', 'hamlet'].includes(String(value))) || p.type === 'city') return 'city'
  if (p.type === 'house' || p.type === 'street' || key === 'building' || key === 'highway') return 'address'
  return 'other'
}

/** Web Mercator's latitude limit (the map tiles end there). */
const MAX_LATITUDE = 85.0511

/** A GeoJSON Point's [lon, lat], rounded to 5 decimals; anything else (lines, areas, junk) → undefined. */
function pointOf(geometry: unknown): { lat: number; lon: number } | undefined {
  if (!isRecord(geometry) || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return undefined
  const [lon, lat] = geometry.coordinates as unknown[]
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > MAX_LATITUDE || Math.abs(lon) > 180) return undefined
  const round = (value: number) => Math.round(value * 1e5) / 1e5 || 0
  return { lat: round(lat), lon: round(lon) }
}

/** The answer without points: what /api/places sends while the map thumbnail is switched off. */
export function withoutPoints(result: PlacesResult): PlacesResult {
  return { results: result.results.map(({ id, name, line, kind, text }) => ({ id, name, line, kind, text })) }
}

export function mapPlaces(payload: unknown): PlacesResult {
  if (!isRecord(payload) || !Array.isArray(payload.features)
    || (payload.type !== undefined && payload.type !== 'FeatureCollection')) {
    throw new ApiError('upstream_unavailable')
  }
  const results: Place[] = []
  const seen = new Set<string>()
  for (const feature of payload.features) {
    if (results.length === 6) break
    if (!isRecord(feature) || !isRecord(feature.properties)) continue
    const p = feature.properties
    const osmType = text(p.osm_type).toUpperCase()
    const osmId = typeof p.osm_id === 'number' && Number.isSafeInteger(p.osm_id) && p.osm_id > 0
      ? String(p.osm_id)
      : typeof p.osm_id === 'string' && /^[1-9]\d{0,19}$/.test(p.osm_id) ? p.osm_id : ''
    if (!['N', 'W', 'R'].includes(osmType) || !osmId) continue
    const id = `osm:${osmType}${osmId}`
    if (seen.has(id)) continue
    const name = text(p.name)
    const kind = kindOf(p)
    const city = text(p.city)
    const line = cut(
      kind === 'city'
        ? join([name || city, text(p.country)], ', ')
        : join([join([text(p.street), text(p.housenumber)], ' '), join([text(p.postcode), city], ' ')], ', '),
      200,
    )
    const combined = name === line ? name : join([name, line], ', ')
    if (!combined) continue
    // Only allow-listed display fields and one rounded point leave the proxy; the raw geometry and extent never do.
    results.push({ id, name, line, kind, text: cut(combined, 200), ...pointOf(feature.geometry) })
    seen.add(id)
  }
  return { results }
}

export function parsePlaceQuery(url: URL): PlaceQuery {
  const params = url.searchParams
  const q = params.get('q')?.trim()
  const lang = params.get('lang') ?? 'de'
  // eslint-disable-next-line no-control-regex -- Search input must not contain control bytes.
  if (!q || q.length < 2 || q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)
    || (lang !== 'de' && lang !== 'en')
    || params.getAll('q').length !== 1 || params.getAll('lang').length > 1) {
    throw new ApiError('invalid_request')
  }
  return { q: q.normalize('NFC').replace(/\s+/g, ' '), lang }
}

export function createPlaces({ fetch: fetcher, now = Date.now }: { fetch: Fetch; now?: Clock }) {
  const cache = new LruCache<string, PlacesResult>(500, 24 * 60 * 60 * 1000, now)
  const pending = new Map<string, Promise<PlacesResult>>()
  return async ({ q, lang }: PlaceQuery, subject: string): Promise<PlacesResult> => {
    const key = JSON.stringify([subject, lang, q.toLocaleLowerCase(lang)])
    const cached = cache.get(key)
    if (cached) return cached
    const inFlight = pending.get(key)
    if (inFlight) return inFlight
    if (pending.size >= 500) throw new ApiError('upstream_unavailable')
    const task = withDeadline(3000, async (signal) => {
      const url = new URL('https://photon.komoot.io/api/')
      url.search = new URLSearchParams({
        q, lang, limit: '6', lat: '51.16', lon: '10.45', zoom: '6', location_bias_scale: '0.4',
      }).toString()
      const response = await fetcher(url.toString(), {
        method: 'GET',
        headers: { 'User-Agent': 'Bunprise/0.1 (place search; pilot)', Accept: 'application/json' },
        redirect: 'manual',
        signal,
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        throw new ApiError('upstream_unavailable')
      }
      const bytes = await readBytes(response, 256 * 1024, signal)
      const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
      const result = mapPlaces(payload)
      cache.set(key, result)
      return result
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'timeout') throw error
      throw new ApiError('upstream_unavailable')
    }).finally(() => { pending.delete(key) })
    pending.set(key, task)
    return task
  }
}
