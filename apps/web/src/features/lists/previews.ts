import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getListScreen } from '../../lib/api/lists'
import type { ListScreen } from '../../lib/api/lists.types'
import type { WishPhotoMeta } from '../../lib/api/types'
import { domainOf } from '../../lib/format'
import { isListUnavailable, listsKeys } from './queries'

// The little picture of a list card (Felix 22.10: "kein Text wie ‚1 Wunsch‘ – grafisch"): its first three wishes as
// round thumbnails. get_lists_overview carries only the count, so a card that is (nearly) on screen asks for its
// list's screen once — lazily, at most PARALLEL at a time, never for an empty list — and keeps only what the
// thumbnails need (id, photo meta, shop, host). The answer also lands in the list screen's own cache when that is still
// empty, so opening the list right after shows it at once (and the cover glides into a ready header).
// Memory only (never persisted, the account boundary clears it). Never anything about reservations: the preview
// keeps four plain keys per wish.

export interface PreviewWish {
  id: string
  photo: WishPhotoMeta | null
  /** the shop's name (from the link) or its domain; null = a wish without a link */
  shop: string | null
  /** the link's domain (the shop icon is asked for by it, through our Worker); null/absent = no link */
  host?: string | null
}

const PREVIEW_SIZE = 3
/** A list screen younger than this is used as it is (no request of its own). */
const FRESH_MS = 30_000

export const previewKey = (listId: string) => ['listPreview', listId] as const

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? domainOf(url) : null
  } catch {
    return null
  }
}

/** The first three wishes (the open ones first, in the screen's order), four plain keys each. */
export function previewOf(screen: Pick<ListScreen, 'wishes' | 'received'>): PreviewWish[] {
  return [...screen.wishes, ...(screen.received ?? [])].slice(0, PREVIEW_SIZE).map((wish) => {
    const host = hostOf(wish.url)
    return { id: wish.id, photo: wish.photo ?? null, shop: wish.shop_name?.trim() || host, host }
  })
}

// at most PARALLEL preview requests at the same time (a long "Meine" never fires all of them at once)
const PARALLEL = 2
let running = 0
const waiting: Array<() => void> = []

function queued<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running += 1
      task().then(resolve, reject).finally(() => {
        running -= 1
        waiting.shift()?.()
      })
    }
    if (running < PARALLEL) start()
    else waiting.push(start)
  })
}

async function loadPreview(queryClient: QueryClient, listId: string, userId: string): Promise<PreviewWish[]> {
  const key = listsKeys.list(listId)
  const state = queryClient.getQueryState<ListScreen>(key)
  if (state?.data && !state.isInvalidated && Date.now() - state.dataUpdatedAt < FRESH_MS) return previewOf(state.data)
  const screen = await queued(() => getListScreen(listId, userId))
  // the list's own screen gets it too, but never over data it already has (that one may be fresher)
  if (queryClient.getQueryData(key) === undefined) queryClient.setQueryData(key, screen)
  return previewOf(screen)
}

/**
 * The thumbnails of a card once `enabled` (the card is near the screen and has wishes). null while unknown —
 * the card shows soft placeholder dots then, never a spinner.
 */
export function useListPreview(listId: string, userId: string | undefined, enabled: boolean): PreviewWish[] | null {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: previewKey(listId),
    queryFn: () => loadPreview(queryClient, listId, userId ?? ''),
    enabled: enabled && Boolean(userId),
    staleTime: FRESH_MS,
    gcTime: 10 * 60_000,
    retry: (failures: number, error: unknown) => !isListUnavailable(error) && failures < 1,
    refetchOnWindowFocus: false,
  })
  return query.data ?? null
}

/** Tests only. */
export function resetPreviewQueueForTests(): void {
  running = 0
  waiting.length = 0
}
