// Single place for TanStack Query keys, so the persistence allow-list (query.ts)
// and invalidations in the features refer to the same values.
//
// The FIRST element is the "root" that the persistence allow-list looks at
// (pilot-decisions v1.1 §0.16: only exact ['feed'], after explicit opt-in).

export const queryKeys = {
  /** get_me(): profile + consents_ok + legal versions — memory only */
  me: () => ['me'] as const,
  /** feed "Soon" — disk persistence only after explicit offline-feed opt-in */
  feed: () => ['feed'] as const,
  /** one occasion screen — get_occasion_screen(id) — memory only (reservation state inside) */
  occasion: (occasionId: string) => ['occasion', occasionId] as const,
  /** my_reservations() — SECRET, guest-only, memory only */
  myReservations: () => ['myReservations'] as const,
} as const

export type QueryKeyRoot = ReturnType<(typeof queryKeys)[keyof typeof queryKeys]>[0]

/** shorthand used in feature code: qk.feed(), qk.occasion(id), … */
export const qk = queryKeys
