import { Suspense, lazy, startTransition, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { isFeatureUnavailableError } from '../../lib/api/unavailable'
import { asOwnerWishes, type OccasionScreenWish, type OccasionScreenWishlist, type OwnerWish, type WishPriority } from '../../lib/api/types'
import { moveWish, setWishReceived, updateWish } from '../../lib/api/wishes'
import { deleteWishEverywhere, removeWishFromList } from '../../lib/api/wishPlaces'
import { setWishLinks } from '../../lib/api/wishExtras'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import { BrandStamp, EmptyState, IconPlus, buttonClass, useBunniesShown, useReducedMotionPref } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { Mascot } from '../mascot-ui/Mascot'
import { useCarry } from '../mascot-ui/carry'
import { playsInApp } from '../mascot-ui/inGallery'
import { useMotionLevel } from '../../motion/useMotionLevel'
import { PressLink } from '../shell/MotionLink'
import { scheduleWishDelete, usePendingWishDeletes } from './pendingDeletes'
import { canPlayWishMoment, clearWishAdded, noteOwnerListLeft, noteWishMoment, ownWishAddCount, peekWishAdded } from './wishAdded'
import { invalidateSharedWishViews, invalidateWishViews, patchCachedWish } from './wishCache'
import { sortWishes } from './wishOrder'
import { WishDetails } from './WishDetails'
import { ReceivedBadge, ReceivedSection, WishGrid, WishTile, WishTileMenuButton, entranceDelay, entranceOrder, type WishExit } from './WishGrid'
import type { ListPompon as PomponHandle } from './listPlay'
import { WishMenu, type MoveTarget, type WishMenuStage } from './WishMenu'
import { placesText } from './wishPlaces'
import type { BulkOutcome, WishChange } from './selection/types'
import { useWishSelection } from './selection/useWishSelection'

// OWNER VIEW of the wishlist (S7-owner, S9-owner; Felix 22.10: square tiles, ⋯, "Erhalten"). Secrecy (CLAUDE.md,
// docs/contract.md §9):
// - this file never imports lib/api/reservations.ts, lib/queries (myReservationsQuery) or reserve.* strings;
// - wishes pass through asOwnerWishes() first: the reservation fields are gone before anything renders;
// - order, texts, dialogs and the mascot moments depend only on the owner's own data and actions.
// The owner's own changes from the ⋯ (move, received, how much) show at once (optimistic) and come back when the
// server says no — a server without today's migration says so calmly ("Das geht bald"); nothing about anybody else.

/**
 * Wave 2 (features/lists): a list WITHOUT an occasion. Its "+ Wunsch" opens its own new-wish screen, its
 * texts speak of followers (or of nobody: a "Nur ich" list), the "wish added" moment and the delete's cache
 * updates are keyed by the list (wishAdded.ts / wishCache.ts). Owner data only, like everything here.
 */
export interface StandaloneOwnerList {
  listId: string
  /** the static line under the title (null = none, e.g. a "Nur ich" list shows its own banner) */
  hint: string | null
  /** the empty list's line */
  emptyText: string
}

/**
 * «Помпон в открытом списке» (Felix 31.10: «Мне все анимации нравятся») — only the owner's OWN list screen
 * (lists/OwnerListScreen.tsx) gives him a place: its content (his layer) and the header's icon row (his seat, null
 * when the list has a cover photo). Everything he does answers the owner's own actions here (./listPlay.ts); the
 * occasion screen keeps the carried gift and the sleeping hamster.
 */
export interface OwnerPomponPlace {
  layer: RefObject<HTMLElement | null>
  seatRow: RefObject<HTMLElement | null> | null
}

interface OwnerWishlistBase {
  wishlist: OccasionScreenWishlist
  /** the screen's content just arrived after its skeleton: the tiles rise in one after another */
  entrance?: boolean
  /** the owner's own list screen: Pompon lives in its header */
  pompon?: OwnerPomponPlace
}

export type OwnerWishlistProps = OwnerWishlistBase & ({ occasionId: string; standalone?: undefined } | { occasionId?: undefined; standalone: StandaloneOwnerList })

/** How long a freshly added wish keeps its soft highlight. */
const HIGHLIGHT_MS = 1600
const MoveMoment = lazy(() => import('../mascot-ui/MoveMoment'))
// Felix 25.10: "Aus meinen Listen holen" — only the occasion's own list offers it (a lazy chunk, loaded on first use)
const loadBringSheet = () => import('../lists/BringFromListsSheet')
const BringFromListsSheet = lazy(loadBringSheet)
// "Was hast du bekommen?" after an occasion (20261027200000, Q19): its own lazy chunk, loaded when the banner shows
const ReceivedPromptSheet = lazy(() => import('./ReceivedPromptSheet'))
// Felix 30.10 (request #4): selection mode's bars and pickers — a lazy chunk, loaded with the first long press
const loadSelectionChrome = () => import('./selection/SelectionChrome')
// Felix 31.10 «Помпон в открытом списке»: the list Pompon — a lazy chunk with his own (the package's listplay entry)
const ListPompon = lazy(() => import('./ListPompon'))
/** The empty list's gift box slot (px; ./listPlay.ts BOX_SLOT) — the box keeps the hamster's place. */
const BOX_SLOT = { width: 196, height: 118 } as const
/** A long list: he is found again under its end (≥ 3 rows). */
const END_SPOT_MIN_WISHES = 6
/** The stamp moment holds the tile at most this long (it lets go itself when he is back on his seat). */
const STAMP_MAX_MS = 6000
const SelectionChrome = lazy(loadSelectionChrome)

/** An own change shown before the server confirmed it. */
type Change = WishChange

interface Pending {
  id: number
  wishId: string
  change: Change
  /**
   * null while the request travels (always shown); after the server's yes: the screen data of that moment — the
   * change shows until fresher data (the refetch, which already contains it) replaces it.
   */
  base: readonly OccasionScreenWish[] | null
}

/** Says calmly why an own change did not work (a server without today's migration: "Das geht bald"). */
function wishActionError(t: TFunction<'wishes'>, err: unknown): void {
  feedback('error')
  if (isFeatureUnavailableError(err)) {
    toast.info(t('wish.unavailable'))
    return
  }
  const error = toAppError(err)
  toast.error(t(error.key, error.params))
}

export function OwnerWishlist(props: OwnerWishlistProps) {
  const { wishlist, entrance = false, standalone } = props
  // the key of the moments and of the delete's cache update: the occasion, or (wave 2) the list itself
  const occasionId = standalone ? standalone.listId : (props.occasionId ?? '')
  const cacheOccasion = standalone ? null : occasionId
  const { t } = useTranslation('wishes')
  const queryClient = useQueryClient()
  const headingId = useId()
  const reduced = useReducedMotionPref()
  const pendingDeletes = usePendingWishDeletes()

  // ---- «Помпон в открытом списке» (31.10): only the owner's own list screen gives him a place ------------------
  // He only ever gets the owner's own actions on her own wishes (added, received, deleted, selected) — the same
  // OwnerWish data this view shows, nothing else (listPlay.secrecy.test.ts).
  const place = props.pompon
  const bunniesShown = useBunniesShown()
  const pomponRef = useRef<PomponHandle | null>(null)
  const boxSlotRef = useRef<HTMLDivElement>(null)
  const endSpotRef = useRef<HTMLDivElement>(null)
  // how selection mode ended (SelectionChrome onEnded) — read by the Pompon right when it ends
  const selectionEnd = useRef<{ kind: 'move' | 'bulk'; rects: readonly DOMRectReadOnly[] } | null>(null)
  // «Verschieben»: the moved tiles fly to the edge (WishGrid's exit)
  const [exit, setExit] = useState<WishExit | undefined>(undefined)
  // «Erhalten» from the ⋯ while he stamps it: the tile stays in the open grid until he is back on his seat
  const [stamping, setStamping] = useState<{ id: string; stamped: boolean } | null>(null)
  const stampingId = stamping?.id ?? null
  const stampFor = useRef<string | null>(null)
  useEffect(() => {
    if (!stampingId) return
    const timer = setTimeout(() => {
      stampFor.current = null
      setStamping(null)
    }, STAMP_MAX_MS)
    return () => clearTimeout(timer)
  }, [stampingId])

  // ---- the owner's changes on their way (optimistic, with rollback) ----------------------------------------
  const [pending, setPending] = useState<readonly Pending[]>([])
  const seq = useRef(0)
  const latestBase = useRef(wishlist.wishes)
  useEffect(() => {
    latestBase.current = wishlist.wishes
  })

  const { wishes, received } = useMemo(() => {
    const live = pending.filter((entry) => entry.base === null || entry.base === wishlist.wishes)
    const all = [...asOwnerWishes(wishlist.wishes), ...asOwnerWishes(wishlist.received ?? [])]
    const shown = all.flatMap((wish): OwnerWish[] => {
      if (pendingDeletes.has(wish.id)) return []
      let next = wish
      for (const entry of live) {
        if (entry.wishId !== wish.id) continue
        if (entry.change.kind === 'moved') return []
        if (entry.change.kind === 'received') next = { ...next, received_at: entry.change.at }
        else next = { ...next, priority: entry.change.priority }
      }
      // Pompon is stamping it «Erhalten»: it stays where it is until he is back on his seat (a moment, ≤ 6 s)
      if (stampingId === wish.id) next = { ...next, received_at: null }
      return [next]
    })
    return {
      wishes: sortWishes(shown.filter((wish) => !wish.received_at)),
      // newest first, like the server's `received`
      received: shown.filter((wish) => wish.received_at).sort((a, b) => ((b.received_at ?? '') > (a.received_at ?? '') ? 1 : (b.received_at ?? '') < (a.received_at ?? '') ? -1 : 0)),
    }
  }, [wishlist.wishes, wishlist.received, pendingDeletes, pending, stampingId])

  /** Shows `change` at once, sends the request, keeps the change after the server's yes, takes it back after a no. */
  async function run(wish: OwnerWish, change: Change, request: (userId: string | undefined) => Promise<unknown>, done: () => void) {
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    const id = (seq.current += 1)
    setPending((prev) => [...prev.filter((entry) => !(entry.wishId === wish.id && entry.change.kind === change.kind)), { id, wishId: wish.id, change, base: null }])
    try {
      await request(epoch.userId)
      if (!epoch.isCurrent()) return
      const base = latestBase.current
      setPending((prev) => prev.map((entry) => (entry.id === id ? { ...entry, base } : entry)))
      done()
    } catch (err) {
      if (!epoch.isCurrent()) return // a former account's answer: not a word about it
      setPending((prev) => prev.filter((entry) => entry.id !== id))
      wishActionError(t, err)
    }
  }

  /**
   * Selection mode (selection/bulk.ts): `change` shows for every wish at once, the existing per-wish requests go out
   * one after another; the accepted changes stay (like `run`), the refused ones come back. The caller reports.
   */
  async function runMany(list: readonly OwnerWish[], change: Change, request: (wish: OwnerWish, userId: string | undefined) => Promise<unknown>): Promise<BulkOutcome | null> {
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || list.length === 0) return null
    const ids = new Map(list.map((wish) => [wish.id, (seq.current += 1)]))
    setPending((prev) => [
      ...prev.filter((entry) => !(ids.has(entry.wishId) && entry.change.kind === change.kind)),
      ...list.map((wish) => ({ id: ids.get(wish.id) ?? 0, wishId: wish.id, change, base: null })),
    ])
    const outcome: BulkOutcome = { done: [], failed: [] }
    for (const wish of list) {
      try {
        await request(wish, epoch.userId)
        outcome.done.push(wish)
      } catch (error) {
        outcome.failed.push({ wish, error })
      }
      if (!epoch.isCurrent()) return null // a former account's answers: not a word about them
    }
    const refused = new Set(outcome.failed.map(({ wish }) => ids.get(wish.id)))
    const mine = new Set(ids.values())
    const base = latestBase.current
    setPending((prev) => prev.flatMap((entry) => (refused.has(entry.id) ? [] : mine.has(entry.id) ? [{ ...entry, base }] : [entry])))
    return outcome
  }

  function move(wish: OwnerWish, target: MoveTarget) {
    void run(wish, { kind: 'moved' }, (userId) => moveWish(wish.id, target.id, userId), () => {
      feedback('success')
      toast.success(t('wish.moved', { list: target.title }))
      // both lists, the tab's numbers and (an occasion's list) its screen and the feed
      void invalidateWishViews(queryClient, cacheOccasion).catch(() => undefined)
    })
  }

  function markReceived(wish: OwnerWish, value: boolean) {
    const at = value ? new Date().toISOString() : null
    void run(wish, { kind: 'received', at }, (userId) => setWishReceived(wish.id, value, userId), () => {
      // (while Pompon stamps it, his stamp plays this very success — at the moment the paw touches the tile)
      if (stampFor.current !== wish.id) feedback('success')
      // a wish of their own marked «Erhalten»: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
      if (value) void import('../sammlung/note').then((m) => m.noteMilestone('received'), () => undefined)
      toast.success(value ? t('wish.received_done', { title: wish.title }) : t('wish.unreceived_done', { title: wish.title }))
      // "Erhalten" belongs to the wish: a wish in several lists changes on every screen that shows it
      const invalidate = wish.also_in?.length ? invalidateSharedWishViews : invalidateWishViews
      void invalidate(queryClient, cacheOccasion).catch(() => undefined)
    })
  }

  // shared wishes (20261027200000): "Aus „…“ entfernen" — the wish leaves THIS list only (it lives on in the others)
  function removeHere(wish: OwnerWish) {
    void run(wish, { kind: 'moved' }, (userId) => removeWishFromList(wish.id, wishlist.id, userId), () => {
      feedback('success')
      toast.success(listTitle ? t('wish.removed_here', { list: listTitle }) : t('wish.removed_here_untitled'))
      void invalidateSharedWishViews(queryClient, cacheOccasion).catch(() => undefined)
    })
  }

  // "Überall löschen": server-confirmed (no undo — it is gone from every list), after the menu's confirmation
  function deleteEverywhere(wish: OwnerWish) {
    void run(wish, { kind: 'moved' }, (userId) => deleteWishEverywhere(wish.id, userId), () => {
      feedback('success')
      toast.success(t('wish.deleted_everywhere', { title: wish.title }))
      void invalidateSharedWishViews(queryClient, cacheOccasion).catch(() => undefined)
    })
  }

  // ---- the list Pompon's moments (the owner's own actions only) ---------------------------------------------
  /** «Erhalten» from the tile's ⋯: Pompon hops over and stamps it (if he can right now), then the tile leaves. */
  function receivedFromMenu(wish: OwnerWish, value: boolean) {
    const tile = value ? tileOf(wish.id) : undefined
    const p = pomponRef.current
    const stamps = !!tile && !!p && p.received(tile, {
      onStamp: () => setStamping((s) => (s?.id === wish.id ? { ...s, stamped: true } : s)),
      onBack: () => {
        if (stampFor.current === wish.id) stampFor.current = null
        setStamping((s) => (s?.id === wish.id ? null : s))
      },
    })
    if (stamps) {
      stampFor.current = wish.id
      setStamping({ id: wish.id, stamped: false })
    }
    markReceived(wish, value)
  }

  /** A tile leaves this list (deleted / removed here): he waves "bye" to it — its box before it goes. */
  function waveBye(wish: OwnerWish) {
    const rect = tileOf(wish.id)?.getBoundingClientRect()
    if (rect) pomponRef.current?.remove(rect)
  }

  /** Selection mode ends with an action: «Verschieben» lets the tiles fly to the edge, he hops after them. */
  function selectionEnded(kind: 'move' | 'received' | 'delete', leaving: readonly OwnerWish[]) {
    const rects = leaving.flatMap((wish) => {
      const r = tileOf(wish.id)?.getBoundingClientRect()
      return r ? [r] : []
    })
    if (kind === 'move' && leaving.length > 0) {
      // to the screen's right edge, never past it (a tile past the edge would let the page scroll sideways)
      const right = document.documentElement.clientWidth || window.innerWidth
      setExit({ fly: new Map(leaving.flatMap((wish, i) => (rects[i] ? [[wish.id, Math.max(0, right - rects[i].right + rects[i].width * 0.09 - 2)] as const] : []))) })
      selectionEnd.current = { kind: 'move', rects }
    } else selectionEnd.current = leaving.length > 0 ? { kind: 'bulk', rects } : null
  }

  // "Passt gut zu …" (20261030120000): server-confirmed — her own links, nothing else changes on the screen until then
  async function linkTogether(wish: OwnerWish, linkedIds: readonly string[]) {
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    try {
      await setWishLinks(wish.id, linkedIds, epoch.userId)
      if (!epoch.isCurrent()) return
      feedback('success')
      toast.success(linkedIds.length > 0 ? t('wish.together_saved') : t('wish.together_removed'))
      // the partners change too (maybe in other lists): every screen that shows my wishes
      void invalidateSharedWishViews(queryClient, cacheOccasion).catch(() => undefined)
    } catch (err) {
      if (!epoch.isCurrent()) return
      wishActionError(t, err)
    }
  }

  function changePriority(wish: OwnerWish, priority: WishPriority) {
    void run(
      wish,
      { kind: 'priority', priority },
      async (userId) => {
        const row = await updateWish(wish.id, { priority }, userId)
        patchCachedWish(queryClient, cacheOccasion, wish.id, { title: row.title, url: row.url, price_cents: row.price_cents, note: row.note, priority: row.priority })
      },
      () => feedback('success'),
    )
  }

  // first presentation only: later tiles (refetch, a new wish) come in without the cascade
  const [order] = useState(() => entranceOrder(entrance, wishes.map((wish) => wish.id)))

  // "Wish added" moment (K10): the new-wish screen left a flag; read it once per visit (pure reads in the
  // initializers, the side effects below). Pompon carries the new wish in as a little gift (at most once per
  // 10 s); the tile waits invisible in its place until the gift lies there, then it appears with a short
  // highlight. Only with full motion (K9): 'reduced' → no gift at all, the new tile simply fades in;
  // 'off' → it is just there. The carry never blocks input (any tap skips to the end).
  const motionLevel = useMotionLevel()
  const [added] = useState(() => peekWishAdded(occasionId))
  // the owner's own list screen (31.10): Pompon lives in its header — there he pats the new wish into place instead
  // (Felix: «поправляет лапками»; never both moments: never two Pompons)
  const [willCarry] = useState(() => added !== null && motionLevel === 'full' && canPlayWishMoment() && !place)
  const [willPat] = useState(() => added !== null && motionLevel === 'full' && canPlayWishMoment() && !!place && bunniesShown)
  const [carrying, setCarrying] = useState(willCarry)
  const [carryDone, setCarryDone] = useState(!willCarry)
  const [overfed] = useState(() => added !== null && ownWishAddCount() >= 5)
  useEffect(() => {
    if (added) clearWishAdded()
    if (willCarry || willPat) noteWishMoment()
  }, [added, willCarry, willPat])

  // The new wish slides into the grid (refetch), is scrolled into view, then carried in and highlighted.
  const listRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const carry = useCarry()
  const carryStarted = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // the new-wish screen opened from here comes back here after saving (wishAdded.ts)
      noteOwnerListLeft(occasionId)
    }
  }, [occasionId])
  const [highlightId, setHighlightId] = useState<string | null>(() => added?.wishId ?? null)
  const highlightVisible = highlightId !== null && wishes.some((wish) => wish.id === highlightId)
  const tileOf = (id: string) => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-wish-id]') ?? []).find((el) => el.dataset.wishId === id)
  useEffect(() => {
    if (!highlightVisible || !highlightId) return
    // instant when the gift is about to fly there or Pompon hops there (they read the tile's place right now)
    tileOf(highlightId)?.scrollIntoView?.({ block: 'nearest', behavior: reduced || willCarry || willPat ? 'auto' : 'smooth' })
  }, [highlightVisible, highlightId, reduced, willCarry, willPat])
  useEffect(() => {
    if (!carrying || carryStarted.current || !highlightVisible || !highlightId) return
    const tile = tileOf(highlightId)
    if (!tile) return
    carryStarted.current = true
    // from the list's "+ Wunsch" (where the person started), else from the section title
    const origin = sectionRef.current?.querySelector<HTMLElement>('[data-add-wish]') ?? sectionRef.current?.querySelector<HTMLElement>('h2')
    const from = origin?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, 0, 0, 0)
    // the gift lands exactly where the tile's picture pops up
    void carry({ from, to: tile.querySelector('[data-wish-tile]') ?? tile, item: 'gift', onDone: () => { if (alive.current) setCarryDone(true) } }).then(() => {
      if (alive.current) setCarrying(false)
    })
  }, [carrying, highlightVisible, highlightId, carry])
  useEffect(() => {
    if (!highlightVisible || carrying) return
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightVisible, carrying])

  // Sheet (S9-owner). The last opened wish stays rendered while the sheet slides out.
  const [sheetWish, setSheetWish] = useState<OwnerWish | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const findShown = (id: string) => wishes.find((wish) => wish.id === id) ?? received.find((wish) => wish.id === id)
  const shown = sheetWish ? (findShown(sheetWish.id) ?? sheetWish) : null

  // "Aus meinen Listen holen" (an occasion's list only): mounted on first use, then kept for the closing slide
  const [bringOpen, setBringOpen] = useState(false)
  const [bringMounted, setBringMounted] = useState(false)
  function openBring() {
    setBringMounted(true)
    setBringOpen(true)
  }

  // the ⋯ of a tile (or of the sheet): which wish, which step (menu · how much · move)
  const [menu, setMenu] = useState<{ wish: OwnerWish; stage: WishMenuStage } | null>(null)
  const menuWish = menu ? (findShown(menu.wish.id) ?? menu.wish) : null

  function openSheet(wish: OwnerWish) {
    // not urgent for the tap (INP): the tile's pressed state paints first, the sheet renders in a transition
    startTransition(() => {
      setSheetWish(wish)
      setSheetOpen(true)
    })
  }

  function remove(wish: OwnerWish) {
    setSheetOpen(false)
    waveBye(wish)
    scheduleWishDelete({
      wishId: wish.id,
      // a list without an occasion: no occasion screen to update (wishCache.ts updates the list's own)
      occasionId: cacheOccasion,
      queryClient,
      text: { deleted: t('wish.deleted', { title: wish.title }), undo: t('wish.undo') },
      onError: (error) => {
        toast.error(t(error.key, error.params))
      },
    })
  }

  /** "+ Wunsch": the occasion's new-wish screen, or (wave 2) the list's own one. */
  const addLink = (className: string, children: ReactNode, extra: { 'aria-label'?: string; 'data-add-wish'?: string } = {}) =>
    standalone ? (
      <PressLink to="/lists/$listId/wishes/new" params={{ listId: standalone.listId }} className={className} {...extra}>
        {children}
      </PressLink>
    ) : (
      <PressLink to="/occasions/$occasionId/wishes/new" params={{ occasionId }} className={className} {...extra}>
        {children}
      </PressLink>
    )
  const hint = standalone ? standalone.hint : t('wish.secret_hint')
  const listTitle = wishlist.title?.trim() ?? ''

  /**
   * The empty list's big "+": Pompon knocks the lid off and jumps out of his box, then the new-wish screen opens (≈ 1.4
   * s). Still poses, no Pompon, a modified click (new tab): the link as always.
   */
  const popped = useRef(false)
  function popThenAdd(event: MouseEvent<HTMLAnchorElement>) {
    // the click again after his jump: the link opens the new-wish screen as always
    if (popped.current) {
      popped.current = false
      return
    }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.currentTarget
    const go = () => {
      if (!alive.current || !link.isConnected) return
      popped.current = true
      link.click()
    }
    if (pomponRef.current?.pop(go)) event.preventDefault()
  }

  // "Was hast du bekommen?" (occasion lists only; the server decides when: day 1..7 after the end, not dismissed)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptMounted, setPromptMounted] = useState(false)
  const [promptGone, setPromptGone] = useState(false)
  const showPrompt = !standalone && wishlist.received_prompt === true && !promptGone && wishes.length > 0

  // Selection mode (Felix 30.10, request #4): a long press on an open wish selects it, every open tile wobbles and
  // shows its circle; a tap toggles. The received ones stay as they are (nothing of the four actions fits them).
  const selection = useWishSelection()
  const [chromeMounted, setChromeMounted] = useState(false)
  const selecting = selection.active
  const chosen = selecting ? wishes.filter((wish) => selection.ids.has(wish.id)) : []
  function startSelection(wish: OwnerWish) {
    selectionEnd.current = null
    setChromeMounted(true)
    selection.enter(wish.id)
  }

  const addedWish = added ? wishes.find((wish) => wish.id === added.wishId) : undefined
  const tile = (wish: OwnerWish, isReceived: boolean) => {
    const selectable = selecting && !isReceived
    // Pompon's stamp touched it: «✓ Erhalten» shows while it waits for him to be back on his seat
    const stamped = !isReceived && stamping?.id === wish.id && stamping.stamped
    return (
      <WishTile
        key={wish.id}
        wish={wish}
        muted={isReceived || wish.paused === true}
        badge={isReceived || stamped ? <ReceivedBadge /> : undefined}
        // shared wishes: where else it lives; an extra place hidden by the emergency switch says so instead
        places={wish.paused ? t('wish.places_paused') : placesText(t, wish.also_in)}
        highlight={!isReceived && wish.id === highlightId}
        concealed={!isReceived && carrying && wish.id === highlightId}
        enterDelay={isReceived ? 0 : entranceDelay(order, wish.id)}
        onPress={selectable ? () => selection.toggle(wish.id) : () => openSheet(wish)}
        onLongPress={isReceived ? undefined : () => startSelection(wish)}
        onLongPressArm={isReceived ? undefined : () => void loadSelectionChrome()}
        selectable={selectable}
        selected={selectable && selection.ids.has(wish.id)}
        menu={selectable ? undefined : <WishTileMenuButton title={wish.title} onPress={() => setMenu({ wish, stage: 'menu' })} />}
      />
    )
  }

  // the list Pompon (31.10): in the header (a seat there), or — the empty list — in his gift box; never without
  // mascots («Kaninchen zeigen» off, «Animationen: Aus»)
  const empty = wishes.length === 0 && received.length === 0
  const pomponOn = !!place && bunniesShown && motionLevel !== 'off'
  const pomponMode = empty ? 'empty' : 'list'
  // (any of his moments can go back to the mascot gallery: mascot-ui/inGallery.ts 'list-…' — the box too)
  const pomponLives = pomponOn && (empty ? playsInApp('list-empty') : !!place?.seatRow)

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id={headingId} className="t-title-2 text-text">
            {t('wish.section_title_own')}
          </h2>
          {wishes.length > 0 || received.length > 0
            ? addLink(
              buttonClass({ variant: 'secondary', size: 'sm' }),
              <>
                <IconPlus size={16} />
                {t('wish.add_short')}
              </>,
              { 'aria-label': t('wish.add'), 'data-add-wish': '' },
            )
            : null}
        </div>
        {hint ? <p className="t-footnote text-text-2">{hint}</p> : null}
        {showPrompt ? (
          <button type="button" className="wl-prompt glass-panel" data-received-prompt="" onClick={() => {
            setPromptMounted(true)
            setPromptOpen(true)
          }}>
            <span className="t-headline text-text">{t('wish.prompt_title')}</span>
            <span className="t-footnote text-text-2">{t('wish.prompt_text')}</span>
          </button>
        ) : null}
        {!standalone ? (
          <button
            type="button"
            className={`${buttonClass({ variant: 'ghost', size: 'sm' })} -ml-3 self-start`}
            data-bring-open=""
            onPointerEnter={() => void loadBringSheet()}
            onFocus={() => void loadBringSheet()}
            onClick={openBring}
          >
            {t('wish.bring_open')}
          </button>
        ) : null}
      </div>

      {wishes.length > 0 ? (
        <div ref={listRef}>
          <WishGrid entrance={order !== null} exit={exit}>{wishes.map((wish) => tile(wish, false))}</WishGrid>
        </div>
      ) : received.length > 0 ? (
        // everything is received: a calm line instead of "no wishes yet"
        <p className="wg-all-done glass-panel">{t('wish.all_received')}</p>
      ) : (
        <EmptyState
          // the owner's own list: Pompon waits in a closed gift box (31.10) instead of the sleeping hamster
          mascot={pomponLives ? <div ref={boxSlotRef} aria-hidden="true" data-pompon-box="" style={{ position: 'relative', width: BOX_SLOT.width, height: BOX_SLOT.height }} /> : <Mascot kind="hamster" size="m" scene="sleep" />}
          title={t('wish.empty_title')}
          text={standalone ? standalone.emptyText : t('wish.empty_owner')}
          action={
            // the owner's own list (only it gives Pompon a place): "+" lets him jump out of his box first
            pomponLives && standalone ? (
              <PressLink to="/lists/$listId/wishes/new" params={{ listId: standalone.listId }} className={buttonClass({ size: 'lg', fullWidth: true })} onClick={popThenAdd}>
                <IconPlus size={20} />
                {t('wish.add')}
              </PressLink>
            ) : (
              addLink(
                buttonClass({ size: 'lg', fullWidth: true }),
                <>
                  <IconPlus size={20} />
                  {t('wish.add')}
                </>,
              )
            )
          }
        />
      )}

      {received.length > 0 ? (
        <ReceivedSection label={t('wish.received_title')} a11yLabel={t('wish.received_label', { count: received.length })} count={received.length}>
          <WishGrid>{received.map((wish) => tile(wish, true))}</WishGrid>
        </ReceivedSection>
      ) : null}

      {/* a long list: under its end he is found again (an empty spot, decorative) */}
      {pomponLives && !empty && wishes.length >= END_SPOT_MIN_WISHES ? <div ref={endSpotRef} aria-hidden="true" data-pompon-end="" style={{ height: 88 }} /> : null}
      {pomponLives && place ? (
        <Suspense fallback={null}>
          <ListPompon
            key={pomponMode}
            mode={pomponMode}
            layer={empty ? boxSlotRef : place.layer}
            seatRow={place.seatRow ?? undefined}
            endSpot={endSpotRef}
            handle={pomponRef}
            newWish={willPat && highlightVisible ? highlightId : null}
            selecting={selecting}
            selectionEnd={selectionEnd}
          />
        </Suspense>
      ) : null}

      {/* the moment is decorative; this line tells screen readers what happened */}
      {/* «Переел — Ик!» (variant c, approved 24.10) for the 5th own wish in a row */}
      {overfed && playsInApp('overfed', 'c') && carryDone && motionLevel === 'full' ? <Suspense fallback={null}><MoveMoment kind="overfed" variant="c" momentClass="response" className="h-40 w-full" /></Suspense> : null}
      <p role="status" className="sr-only">
        {addedWish ? t('wish.added_status', { title: addedWish.title }) : null}
      </p>

      <Sheet
        open={sheetOpen && shown !== null}
        onClose={() => setSheetOpen(false)}
        label={shown?.title}
        closeLabel={t('common.close')}
        footer={
          // Felix 23.10: no edit / ⋯ / delete here — those live in the tile's ⋯ (WishMenu). A screenshot of the wish
          // still says where it is from (Felix 22.10); decorative.
          shown ? <BrandStamp name={t('common.app_name')} /> : undefined
        }
      >
        {shown ? (
          <WishDetails
            wish={shown}
            showTitle
            // "Passt zusammen mit": a linked wish of THIS list opens its own sheet
            onOpenWish={(id) => {
              const target = findShown(id)
              return target ? () => setSheetWish(target) : null
            }}
          />
        ) : null}
      </Sheet>

      {bringMounted && !standalone ? (
        <Suspense fallback={null}>
          <BringFromListsSheet open={bringOpen} onClose={() => setBringOpen(false)} targetListId={wishlist.id} occasionId={occasionId} />
        </Suspense>
      ) : null}

      {promptMounted && !standalone ? (
        <Suspense fallback={null}>
          <ReceivedPromptSheet
            open={promptOpen}
            occasionId={occasionId}
            wishes={wishes}
            onReceived={markReceived}
            onClose={() => setPromptOpen(false)}
            onDismissed={() => {
              setPromptGone(true)
              void invalidateSharedWishViews(queryClient, cacheOccasion).catch(() => undefined)
            }}
          />
        </Suspense>
      ) : null}

      <WishMenu
        wish={menuWish}
        stage={menu?.stage ?? null}
        onStage={(stage) => setMenu((current) => (current ? { ...current, stage } : current))}
        listId={wishlist.id}
        onMove={move}
        onReceived={receivedFromMenu}
        onPriority={changePriority}
        onDelete={remove}
        listTitle={listTitle}
        onRemoveHere={(wish) => {
          waveBye(wish)
          removeHere(wish)
        }}
        onDeleteEverywhere={(wish) => {
          waveBye(wish)
          deleteEverywhere(wish)
        }}
        onSelectMany={startSelection}
        togetherCandidates={wishes}
        onTogether={(wish, ids) => void linkTogether(wish, ids)}
      />

      {chromeMounted ? (
        <Suspense fallback={null}>
          <SelectionChrome
            open={selecting}
            chosen={chosen}
            total={wishes.length}
            onAll={() => selection.setAll(wishes.map((wish) => wish.id))}
            onNone={() => selection.setAll([])}
            onDone={selection.exit}
            listId={wishlist.id}
            occasionList={!standalone}
            cacheOccasion={cacheOccasion}
            runMany={runMany}
            onEnded={selectionEnded}
          />
        </Suspense>
      ) : null}
    </section>
  )
}
