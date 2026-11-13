import { delay, http, HttpResponse } from 'msw'
import mapTile from './assets/map-tile.png?inline'
import { decodeBase64 } from './photos'

// Demo answers of GET /api/places (the Worker's place search, wave 1 — built in workers/edge, NOT here):
// deterministic, invented places in an invented town ("Beispielstadt", postcode 12345). Never real
// businesses' or people's addresses. Same envelope, limits and error codes as the Worker contract.
// Each place also has a point (the Worker sends one while its map switch MAP_TILES is on): invented spots around
// 51.16 N / 10.45 E (the middle of Germany, the Worker's search focus), so the form's small map has something to
// centre on. The map itself is ONE fictional placeholder tile drawn for this repo (assets/map-tile.png: streets, a
// park, a pond — no OpenStreetMap data): GET /api/map-tile answers it for every valid tile, so the demo never
// contacts OpenStreetMap, and its streets join without seams.

type Kind = 'cafe' | 'restaurant' | 'bar' | 'park' | 'venue' | 'address' | 'city' | 'other'

interface FixturePlace {
  id: string
  name: string
  /** street part of the line ('' for the town itself) */
  street: string
  kind: Kind
  /** extra words the search matches (lower case, without accents) */
  tags: readonly string[]
  /** invented point (5 decimals, like the Worker) */
  lat: number
  lon: number
}

const TOWN = '12345 Beispielstadt'

export const DEMO_PLACES: readonly FixturePlace[] = [
  { id: 'demo-place-01', name: 'Café Morgenrot', street: 'Lindenweg 4', kind: 'cafe', tags: ['cafe', 'kaffee', 'coffee', 'fruhstuck', 'breakfast'], lat: 51.16212, lon: 10.45231 },
  { id: 'demo-place-02', name: 'Café Wolke sieben', street: 'Mühlengasse 9', kind: 'cafe', tags: ['cafe', 'kuchen', 'cake'], lat: 51.16388, lon: 10.44817 },
  { id: 'demo-place-03', name: 'Rosengarten am Fluss', street: 'Uferpromenade 1', kind: 'park', tags: ['park', 'garten', 'garden', 'picknick', 'picnic'], lat: 51.15874, lon: 10.45562 },
  { id: 'demo-place-04', name: 'Stadtpark Beispielstadt', street: 'Parkring', kind: 'park', tags: ['park', 'spielplatz', 'playground', 'grill'], lat: 51.16655, lon: 10.44302 },
  { id: 'demo-place-05', name: 'Kulturhaus Lichtblick', street: 'Am Marktplatz 7', kind: 'venue', tags: ['kultur', 'saal', 'hall', 'feier', 'party'], lat: 51.16031, lon: 10.44955 },
  { id: 'demo-place-06', name: 'Kletterhalle Gipfelglück', street: 'Werkstraße 30', kind: 'venue', tags: ['klettern', 'climbing', 'sport'], lat: 51.15602, lon: 10.46108 },
  { id: 'demo-place-07', name: 'Trattoria Sonnenhang', street: 'Bergstraße 12', kind: 'restaurant', tags: ['restaurant', 'pizza', 'pasta', 'essen', 'dinner'], lat: 51.16843, lon: 10.45694 },
  { id: 'demo-place-08', name: 'Biergarten am See', street: 'Seeweg 3', kind: 'restaurant', tags: ['biergarten', 'see', 'lake', 'grill'], lat: 51.15391, lon: 10.44478 },
  { id: 'demo-place-09', name: 'Bar Abendstern', street: 'Kastanienallee 21', kind: 'bar', tags: ['bar', 'cocktail', 'drinks'], lat: 51.16127, lon: 10.45826 },
  { id: 'demo-place-10', name: 'Marktplatz', street: 'Marktplatz', kind: 'address', tags: ['markt', 'market', 'platz', 'square'], lat: 51.16049, lon: 10.45002 },
  { id: 'demo-place-11', name: 'Beispielstadt', street: '', kind: 'city', tags: ['stadt', 'town', 'city'], lat: 51.16, lon: 10.45 },
  { id: 'demo-place-12', name: 'Bootshaus Blaue Welle', street: 'Seeweg 11', kind: 'other', tags: ['boot', 'boat', 'see', 'lake'], lat: 51.15452, lon: 10.44721 },
]

/** The Worker's answer delay, give or take (so the skeleton rows are seen for a moment). */
export const DEMO_PLACES_DELAY_MS = 320
const MAX_RESULTS = 6

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function lineOf(place: FixturePlace): string {
  return place.street ? `${place.street}, ${TOWN}` : TOWN
}

/** Name prefix first, then a word of the name, then tags / street; at most six. */
export function searchDemoPlaces(query: string): FixturePlace[] {
  const q = fold(query.trim())
  const scored: { place: FixturePlace; score: number }[] = []
  for (const place of DEMO_PLACES) {
    const name = fold(place.name)
    let score = 0
    if (name.startsWith(q)) score = 4
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 3
    else if (name.includes(q)) score = 2
    else if (place.tags.some((tag) => tag.startsWith(q)) || fold(place.street).includes(q)) score = 1
    if (score > 0) scored.push({ place, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name, 'de'))
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.place)
}

export interface PlacesHandlerOptions {
  /** profile id of the request's valid demo session, or null */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delay for the map tiles */
  tileDelayMs?: number
}

/** The demo map tile's answer delay (so the thumbnail's skeleton is seen for a moment). */
export const DEMO_MAP_TILE_DELAY_MS = 260

/** `?z=&x=&y=` exactly like the Worker (workers/edge/src/mapTile.ts): z 11–16, x and y inside the grid. */
export function demoTileRequestValid(url: URL): boolean {
  const params = url.searchParams
  if ([...params.keys()].length !== 3 || !['z', 'x', 'y'].every((name) => params.getAll(name).length === 1)) return false
  const values = ['z', 'x', 'y'].map((name) => params.get(name) ?? '')
  if (!values.every((value) => /^(?:0|[1-9]\d{0,6})$/.test(value))) return false
  const [z = 0, x = 0, y = 0] = values.map(Number)
  return z >= 11 && z <= 16 && x < 2 ** z && y < 2 ** z
}

export function createPlacesHandlers({ viewerOf, tileDelayMs = DEMO_MAP_TILE_DELAY_MS }: PlacesHandlerOptions) {
  const tile = decodeBase64(mapTile.slice(mapTile.indexOf(',') + 1))
  return [
    // the small map's tiles: the one fictional placeholder for every valid tile (never OpenStreetMap)
    http.get('*/api/map-tile', async ({ request }) => {
      const fail = (error: string, status: number) => HttpResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
      if (!viewerOf(request)) return fail('unauthorized', 401)
      if (!demoTileRequestValid(new URL(request.url))) return fail('invalid_request', 400)
      if (!tile) return fail('upstream_unavailable', 502)
      if (tileDelayMs > 0) await delay(tileDelayMs)
      return new HttpResponse(tile.slice().buffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(tile.byteLength),
          'Cache-Control': 'private, max-age=604800',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }),
    http.get('*/api/places', async ({ request }) => {
      if (!viewerOf(request)) return HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      const url = new URL(request.url)
      const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim()
      const lang = url.searchParams.get('lang')
      const length = Array.from(q).length
      if (length < 2 || length > 100 || (lang !== 'de' && lang !== 'en')) {
        return HttpResponse.json({ error: 'invalid_request' }, { status: 400 })
      }
      await delay(DEMO_PLACES_DELAY_MS)
      const results = searchDemoPlaces(q).map((place) => ({
        id: place.id,
        name: place.name,
        line: lineOf(place),
        kind: place.kind,
        text: place.street ? `${place.name}, ${lineOf(place)}` : TOWN,
        lat: place.lat,
        lon: place.lon,
      }))
      return HttpResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
    }),
  ]
}
