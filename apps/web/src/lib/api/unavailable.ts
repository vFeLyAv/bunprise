import { AppError } from '../errors'

// A server WITHOUT a newer migration (the hosted project gets migrations only after Felix's OK): the call cannot
// work there at all. Instead of a scary generic error, the wrappers throw FeatureUnavailableError — a calm, typed
// error the UI can show as "noch nicht verfügbar" (and hide the action). Codes:
//   PGRST202  PostgREST: function not in the schema cache     42883  Postgres: undefined function
//   PGRST204  PostgREST: column not in the schema cache       42703  Postgres: undefined column
// Never matched on the message text: the codes alone say "this server does not know it" (no server text reaches a
// screen, lib/errors.ts).

/** The features of 20261022160000_list_photos_received_move.sql (and later ones: 20261024120000 profile photos). */
/** + shared_wishes: 20261027200000 (add_wishes_to_list & co.; also the database switch being off, lib/api/wishPlaces.ts). */
/** + wish_quantity / wish_together: 20261030120000 ("Anzahl", "Passt zusammen"; also their database switches being off). */
export type ServerFeature = 'list_photos' | 'wish_received' | 'move_wish' | 'profile_photos' | 'shared_wishes' | 'wish_quantity' | 'wish_together'

const MISSING_CODES: ReadonlySet<string> = new Set(['PGRST202', 'PGRST204', '42703', '42883'])

/** Is this raw PostgREST / Postgres error "the server does not have this function / column yet"? */
export function isMissingServerFeature(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && MISSING_CODES.has(code)
}

/** The server does not have the feature yet. Code `generic` for code that reads errors generically. */
export class FeatureUnavailableError extends AppError {
  readonly feature: ServerFeature

  constructor(feature: ServerFeature, cause?: unknown) {
    super('generic', { cause })
    this.name = 'FeatureUnavailableError'
    this.feature = feature
  }
}

export function isFeatureUnavailableError(err: unknown, feature?: ServerFeature): err is FeatureUnavailableError {
  return err instanceof FeatureUnavailableError && (feature === undefined || err.feature === feature)
}

/** Throws FeatureUnavailableError when `error` says the server lacks the feature; otherwise does nothing. */
export function throwIfUnavailable(feature: ServerFeature, error: unknown): void {
  if (isMissingServerFeature(error)) throw new FeatureUnavailableError(feature, error)
}
