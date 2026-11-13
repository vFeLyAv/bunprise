// Tiny validators for route search params and path params (route files only).
//
// Why not zod/mini: `validateSearch` and `params.parse` stay in the shared entry chunk, so zod
// cost ~4.7 KB gz on EVERY route's first load, including the invite landing /i with its hard
// 150 KB budget (docs/contract.md §10). These helpers do the same checks in a few hundred bytes.
//
// Search values are lenient on purpose: an unknown or malformed value is dropped (the screen
// falls back to its default) instead of an error page. `?next` is only typed here; every
// redirect still goes through safeNext()/signInTarget(), which allow relative paths only.
// Path ids are strict: a malformed UUID throws, exactly like the old z.uuid() did.

/** a string search value; anything else (number, object, missing) → undefined */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** one of the allowed literal values; anything else → undefined */
export function optionalEnum<const T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

/** drops undefined entries, so a validated search object has the same keys zod's would have */
export function compact<T extends Record<string, unknown>>(search: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(search)) if (value !== undefined) out[key] = value
  return out as T
}

// Same pattern as zod 4's z.uuid(): RFC 9562 versions 1–8, variant 10xx, plus the nil/max UUIDs.
const UUID = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** `params` option for a route with one UUID path param, e.g. `params: uuidParam('occasionId')` */
export function uuidParam<const K extends string>(key: K) {
  return {
    parse: (raw: Record<K, string>): Record<K, string> => {
      const value = raw[key]
      if (!isUuid(value)) throw new Error(`invalid ${key}`)
      return { [key]: value } as Record<K, string>
    },
    stringify: (value: Record<K, string>): Record<K, string> => ({ [key]: value[key] }) as Record<K, string>,
  }
}

export type Lang = 'de' | 'en'
const LANGS: readonly Lang[] = ['de', 'en']

/** `?version=&lang=` of the legal pages (archived exact versions, pilot-decisions §0.12) */
export function legalSearch(search: Record<string, unknown>): { version?: string; lang?: Lang } {
  return compact({ version: optionalString(search.version), lang: optionalEnum(search.lang, LANGS) })
}
