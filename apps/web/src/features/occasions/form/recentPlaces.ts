import type { QueryClient } from '@tanstack/react-query'
import type { FeedScreen, OccasionScreen } from '../../../lib/api/types'
import { qk } from '../../../lib/queryKeys'

// "Zuletzt verwendet" in the place sheet: the places of the person's OWN hosted occasions that are
// already in the query cache (the feed and opened occasion screens). Nothing is fetched or stored for
// this; guests' and other hosts' places never appear (role === 'host' only).

export const RECENT_PLACES_MAX = 5

interface Candidate {
  text: string
  startsAt: string
}

function addCandidate(list: Candidate[], text: string | null | undefined, startsAt: string): void {
  const value = text?.replace(/\s+/g, ' ').trim()
  if (value) list.push({ text: value, startsAt })
}

/** Distinct places (case-insensitive), the latest occasion first, at most five. */
export function recentPlaces(queryClient: QueryClient, userId: string): string[] {
  const candidates: Candidate[] = []
  const feed = queryClient.getQueryData<FeedScreen>(qk.feed())
  for (const occasion of [...(feed?.upcoming ?? []), ...(feed?.past ?? [])]) {
    if (occasion.role === 'host') addCandidate(candidates, occasion.place_text, occasion.starts_at)
  }
  for (const [, screen] of queryClient.getQueriesData<OccasionScreen>({ queryKey: ['occasion'] })) {
    if (screen?.viewer.role === 'host' && screen.occasion.host.id === userId) {
      addCandidate(candidates, screen.occasion.place_text, screen.occasion.starts_at)
    }
  }
  candidates.sort((a, b) => (a.startsAt < b.startsAt ? 1 : a.startsAt > b.startsAt ? -1 : 0))
  const seen = new Set<string>()
  const out: string[] = []
  for (const { text } of candidates) {
    const key = text.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length === RECENT_PLACES_MAX) break
  }
  return out
}
