// The one wish order for every viewer (pilot-decisions §1, §3): priority desc, created_at asc,
// id as the last tie-breaker — exactly what get_occasion_screen() does. The owner and the guest
// branch both use it, so the order can never hint at reservations.

interface Sortable {
  id: string
  priority: number
  created_at: string
}

export function compareWishes(a: Sortable, b: Sortable): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  const ta = Date.parse(a.created_at)
  const tb = Date.parse(b.created_at)
  if (ta !== tb && !Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Sorted copy; never mutates the cached array. */
export function sortWishes<T extends Sortable>(wishes: readonly T[]): T[] {
  return [...wishes].sort(compareWishes)
}
