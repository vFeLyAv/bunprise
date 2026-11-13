import { delay, http, HttpResponse, type JsonBodyType } from 'msw'
import type { OccasionPhotoMeta } from '../lib/api/types'
import demoCoverDataUrl from './demo-cover.webp?inline'
import { DEMO_OCCASIONS, DEMO_PEOPLE } from './fixtures'
import { DEMO_SUPABASE_URL, DemoDbError, guarded, invalidBody, invalidInput, raise, readJson, sessionExpiredError } from './rest'
import type { DemoWorld, OccasionRow } from './world'

// Occasion cover photos of the demo server (docs/demo-mode.md): the four RPCs of
// supabase/migrations/20261020160000_occasion_photos.sql, re-implemented on the in-memory world like
// src/mocks/world.ts does for the rest (an independent copy of the rules, so tests compare the two):
//   set_occasion_photo / remove_occasion_photo — the host only (anyone else: not_found);
//   get_occasion_photo — host or active member (anyone else, and "no photo": the same not_found);
//   export_my_occasion_photos — the caller's own hosted covers;
//   limits: mime webp|jpeg, 1 … 2048 px, base64 → 1 … 409600 bytes, magic bytes, 20 covers per host.
// Cascade: a photo is served only while its occasion exists with the same host (a deleted occasion or
// account leaves nothing readable; stale entries are dropped on the next access). The demo has no blocks
// and every demo account has its consents, so those two checks of the database are not repeated here.
// Memory only: a reload resets the photos with the world. "Annas Einweihung" starts with a generated,
// fictional cover (demo-cover.webp: a window at dusk, lights, two glasses, a cake — no people).
// Uploads take a moment (PHOTO_UPLOAD_DELAY_MS) so the "uploading" state is visible in the demo.

export const PHOTO_UPLOAD_DELAY_MS = 1600
export const PHOTO_READ_DELAY_MS = 450
/** The pauses in use (read at request time; screenshot scripts may lengthen them in the page). */
export const demoPhotoDelays = { upload: PHOTO_UPLOAD_DELAY_MS, read: PHOTO_READ_DELAY_MS }
/** The fixture occasion that has a cover from the start. */
export const DEMO_COVER_OCCASION = DEMO_OCCASIONS.housewarming
export const DEMO_COVER_SIZE = { width: 1200, height: 800 } as const

const MAX_BYTES = 409_600
const MAX_BASE64 = 546_136
const MAX_SIDE = 2048
const PER_HOST = 20
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

interface StoredPhoto {
  occasionId: string
  hostId: string
  mime: 'image/webp' | 'image/jpeg'
  data: string
  size: number
  width: number
  height: number
  updated_at: string
}

/** The database's private.photo_bytes_match, on the decoded bytes. */
export function bytesMatch(mime: string, bytes: Uint8Array): boolean {
  const n = bytes.length
  const at = (i: number) => bytes[i] as number
  const text = (from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length))
  if (mime === 'image/jpeg') return n >= 6 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff && at(n - 2) === 0xff && at(n - 1) === 0xd9
  if (mime !== 'image/webp' || n < 20) return false
  const riff = (at(4) | (at(5) << 8) | (at(6) << 16) | (at(7) << 24)) >>> 0
  return text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(text(12, 4)) && riff === n - 8
}

export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !BASE64.test(text)) return null
  try {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

const isSide = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE

export function createDemoPhotos(world: DemoWorld, clock: () => number = Date.now) {
  const photos = new Map<string, StoredPhoto>()
  let lastStamp = 0

  /** clock_timestamp(), strictly increasing: two uploads always get two versions */
  function stamp(): string {
    lastStamp = Math.max(clock(), lastStamp + 1)
    return new Date(lastStamp).toISOString()
  }

  /** The occasion as the viewer may see it (host or active member — the world's occasions_select). */
  function visibleOccasion(viewer: string, occasionId: string): OccasionRow | undefined {
    return world.occasionRows(viewer).find((occasion) => occasion.id === occasionId)
  }

  /** A photo only while its occasion still exists with the same host (cascade); else it is dropped. */
  function live(occasionId: string): StoredPhoto | undefined {
    const photo = photos.get(occasionId)
    if (!photo) return undefined
    if (world.occasionRows(photo.hostId).some((occasion) => occasion.id === occasionId && occasion.host_id === photo.hostId)) return photo
    photos.delete(occasionId)
    return undefined
  }

  function ownOccasion(viewer: string, occasionId: string | null): OccasionRow {
    const occasion = occasionId === null ? undefined : visibleOccasion(viewer, occasionId)
    if (!occasion || occasion.host_id !== viewer) throw raise('not_found') // foreign / unknown: one answer
    return occasion
  }

  function set(viewer: string, args: { occasionId: string | null; mime: unknown; data: unknown; width: unknown; height: unknown }): JsonBodyType {
    const { occasionId, mime, data, width, height } = args
    if ((mime !== 'image/webp' && mime !== 'image/jpeg') || !isSide(width) || !isSide(height)
      || typeof data !== 'string' || data.length < 4 || data.length > MAX_BASE64) {
      throw raise('validation')
    }
    const bytes = decodeBase64(data)
    if (!bytes || bytes.length < 1 || bytes.length > MAX_BYTES || !bytesMatch(mime, bytes)) throw raise('validation')
    const occasion = ownOccasion(viewer, occasionId)
    const hosted = [...photos.keys()].filter((id) => live(id)?.hostId === viewer)
    if (!photos.has(occasion.id) && hosted.length >= PER_HOST) throw new DemoDbError('P0001', 'photo_limit', 400)
    const updated_at = stamp()
    photos.set(occasion.id, { occasionId: occasion.id, hostId: viewer, mime, data, size: bytes.length, width, height, updated_at })
    return { ok: true, updated_at }
  }

  function remove(viewer: string, occasionId: string | null): JsonBodyType {
    const occasion = ownOccasion(viewer, occasionId)
    photos.delete(occasion.id)
    return { ok: true }
  }

  function get(viewer: string, occasionId: string | null): JsonBodyType {
    const occasion = occasionId === null ? undefined : visibleOccasion(viewer, occasionId)
    const photo = occasion ? live(occasion.id) : undefined
    if (!photo) throw raise('not_found') // no access and no photo: one answer
    return { mime: photo.mime, data: photo.data, width: photo.width, height: photo.height, updated_at: photo.updated_at }
  }

  /** get_occasion_screen's occasion.photo (the world asks for it, src/mocks/world.ts). */
  function metaOf(occasionId: string): OccasionPhotoMeta | null {
    const photo = live(occasionId)
    return photo ? { width: photo.width, height: photo.height, updated_at: photo.updated_at } : null
  }

  function exportFor(viewer: string): JsonBodyType {
    return world.occasionRows(viewer)
      .filter((occasion) => occasion.host_id === viewer)
      .sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : a.id < b.id ? -1 : 1))
      .flatMap((occasion) => {
        const photo = live(occasion.id)
        return photo
          ? [{ occasion_id: occasion.id, occasion_title: occasion.title, mime: photo.mime, width: photo.width, height: photo.height,
              size_bytes: photo.size, updated_at: photo.updated_at, data_base64: photo.data }]
          : []
      })
  }

  /** The fixture cover (service role): a generated, fictional image on "Annas Einweihung". */
  function seedDemoCover(): void {
    const data = demoCoverDataUrl.slice(demoCoverDataUrl.indexOf(',') + 1)
    const bytes = decodeBase64(data)
    if (!bytes || !bytesMatch('image/webp', bytes)) return
    photos.set(DEMO_COVER_OCCASION, {
      occasionId: DEMO_COVER_OCCASION, hostId: DEMO_PEOPLE.anna.id, mime: 'image/webp', data, size: bytes.length,
      ...DEMO_COVER_SIZE, updated_at: stamp(),
    })
  }

  return { set, remove, get, metaOf, exportFor, seedDemoCover }
}

export type DemoPhotos = ReturnType<typeof createDemoPhotos>

export interface PhotoHandlerOptions {
  photos: DemoPhotos
  /** profile id of the request's valid demo session, or null (→ 401) */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delays */
  delays?: { upload: number; read: number }
}

export type PhotoArgType = 'uuid' | 'text' | 'int'

function isPayload(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * POST /rest/v1/rpc/<name> of a photo RPC (occasion covers here, wish photos in src/mocks/wishPhotos.ts): PostgREST
 * finds the function by its exact argument names; the session is checked before and after the artificial pause.
 */
export function photoRpcHandler(
  viewerOf: (request: Request) => string | null,
  name: string,
  params: Readonly<Record<string, PhotoArgType>>,
  wait: () => number,
  run: (me: string, args: Record<string, unknown>) => JsonBodyType,
) {
  return http.post(`${DEMO_SUPABASE_URL}/rest/v1/rpc/${name}`, ({ request }) => guarded(async () => {
      const input = (await readJson(request)) ?? {}
      if (!isPayload(input)) throw invalidBody()
      const given = Object.keys(input)
      const expected = Object.keys(params)
      if (given.length !== expected.length || given.some((key) => !expected.includes(key))) {
        throw new DemoDbError('PGRST202', `Could not find the function public.${name}(${given.join(', ')}) in the schema cache`, 404)
      }
      const args: Record<string, unknown> = {}
      for (const [key, type] of Object.entries(params)) {
        const value = input[key]
        if (value === null || value === undefined) args[key] = null
        else if (type === 'uuid') {
          if (typeof value !== 'string' || !UUID.test(value)) throw invalidInput('uuid')
          args[key] = value.toLowerCase()
        } else if (type === 'int') {
          if (typeof value !== 'number' || !Number.isInteger(value)) throw invalidInput('integer')
          args[key] = value
        } else args[key] = typeof value === 'string' ? value : JSON.stringify(value)
      }
      if (viewerOf(request) === null) throw sessionExpiredError()
      const ms = wait()
      if (ms > 0) await delay(ms)
      // the session is checked again after the pause: an answer never outlives its account
      const me = viewerOf(request)
      if (me === null) throw sessionExpiredError()
      return HttpResponse.json(run(me, args))
    }))
}

export function createPhotoHandlers({ photos, viewerOf, delays = demoPhotoDelays }: PhotoHandlerOptions) {
  const rpc = (name: string, params: Readonly<Record<string, PhotoArgType>>, wait: () => number, run: (me: string, args: Record<string, unknown>) => JsonBodyType) =>
    photoRpcHandler(viewerOf, name, params, wait, run)

  const id = (args: Record<string, unknown>) => (typeof args.p_occasion_id === 'string' ? args.p_occasion_id : null)

  return [
    rpc('set_occasion_photo', { p_occasion_id: 'uuid', p_mime: 'text', p_data_base64: 'text', p_width: 'int', p_height: 'int' }, () => delays.upload,
      (me, args) => photos.set(me, { occasionId: id(args), mime: args.p_mime, data: args.p_data_base64, width: args.p_width, height: args.p_height })),
    rpc('remove_occasion_photo', { p_occasion_id: 'uuid' }, () => delays.upload / 2, (me, args) => photos.remove(me, id(args))),
    rpc('get_occasion_photo', { p_occasion_id: 'uuid' }, () => delays.read, (me, args) => photos.get(me, id(args))),
    rpc('export_my_occasion_photos', {}, () => 0, (me) => photos.exportFor(me)),
  ]
}
