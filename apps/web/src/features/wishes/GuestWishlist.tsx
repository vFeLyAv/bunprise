import { startTransition, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { cancelReservation, reserveTogether, reserveWish } from '../../lib/api/reservations'
import { wishTogetherEnabled } from '../../lib/api/wishExtras'
import { asGuestWishes, type GuestWish, type OccasionScreen, type OccasionScreenWishlist } from '../../lib/api/types'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { occasionScreenQuery } from '../../lib/queries'
import { qk } from '../../lib/queryKeys'
import { toast } from '../../lib/toast'
import { hasSeenHint, markHintSeen, showHint } from '../../lib/hints'
import { BrandStamp, Button, EmptyState, IconCheck, IconEyeOff, IconGift, IconLock, cn, fade, useReducedMotionPref, useSpring } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { Mascot, preloadMascot, type MascotHandle } from '../mascot-ui/Mascot'
import { BunnyHint } from '../mascot-ui/BunnyHint'
import { playsInApp } from '../mascot-ui/inGallery'
import { sortWishes } from './wishOrder'
import { placesText } from './wishPlaces'
import { peekOpenWish, takeOpenWish } from './openWish'
import { WishDetails } from './WishDetails'
import { ReceivedBadge, ReceivedSection, WishGrid, WishTile, entranceDelay, entranceOrder } from './WishGrid'

// GUEST VIEW of the wishlist (S7-guest, S9-guest, F8) — the only place with reservation UI.
// - Guests see "Reserviert" or "Von dir reserviert", never who reserved (pilot-decisions §0.8).
// - Reserve/cancel are NOT optimistic: the button shows its loading state until the server answered;
//   only then the list changes and the hamster celebrates (pilot-decisions §7).
// - Offline the reservation state is hidden and the buttons are disabled (product-pilot F8).
// - Nothing here is persisted or put into the URL; the occasion screen query is memory-only.
// - Account boundary (lib/accountBoundary.ts): a request belongs to the account that started it. An
//   answer arriving after that account ended in this tab does nothing — no toast, no list change,
//   no hamster, no refetch — so the next account (maybe the owner) learns nothing from it.
// - Felix 22.10: the wishes are square tiles (WishGrid.tsx, the same tiles as the owner's, the state chip in the
//   tile's status slot); what the owner already received sits collapsed under "Schon erhalten" and cannot be
//   reserved any more (the database refuses a new reservation of a received wish anyway).

/**
 * Wave 2 (features/lists): a list WITHOUT an occasion of someone the viewer follows. The owner's name comes
 * from the list screen, the refresh after an answer goes to that screen, and the giver's own cap answer
 * (limit_reached: 5 active reservations for one person) reads `limitText` — only the giver ever sees it.
 */
export interface StandaloneGuestList {
  listId: string
  ownerName: string | null
  limitText: string
  /** after every answer: refresh the list's screen (and what depends on it) */
  onSettled: () => void
}

interface GuestWishlistBase {
  wishlist: OccasionScreenWishlist
  /** the screen's content just arrived after its skeleton: the rows rise in one after another */
  entrance?: boolean
}

export type GuestWishlistProps = GuestWishlistBase & ({ occasionId: string; standalone?: undefined } | { occasionId?: undefined; standalone: StandaloneGuestList })

/** A state the server just confirmed. It counts only until fresh server data replaces `base`. */
interface Confirmed {
  wishId: string
  reserved: boolean
  reserved_by_me: boolean
  base: OccasionScreenWishlist
}

type Busy = { wishId: string; action: 'reserve' | 'cancel' | 'together' } | null

interface SheetState {
  wish: GuestWish
  open: boolean
  /** the reservation just succeeded: the hamster jumps and hides the wish in his cheeks */
  cheer: boolean
}

const selectHostName = (screen: OccasionScreen): string | null => screen.occasion.host.display_name?.trim() || null

/** The reward moment's beats (s after the server's yes): the hamster at once, his line, then the way back. */
const CHEER_LINE_DELAY = 0.14
const CHEER_BUTTON_DELAY = 0.26

/** The host's display name from the occasion screen already in memory (no request of its own). */
function useHostName(occasionId: string): string | null {
  const { data } = useQuery({ ...occasionScreenQuery(occasionId), enabled: false, select: selectHostName })
  return data ?? null
}

export function GuestWishlist(props: GuestWishlistProps) {
  const { wishlist, entrance = false, standalone } = props
  // the occasion of the list ('' for a list without one: the occasion-screen lookups below find nothing)
  const occasionId = props.occasionId ?? ''
  const { t } = useTranslation(['wishes', 'onboarding'])
  const [hintDismissed, setHintDismissed] = useState(() => hasSeenHint('reserve-hint'))
  const dismissHint = () => { markHintSeen('reserve-hint'); setHintDismissed(true) }
  const queryClient = useQueryClient()
  const online = useOnline()
  const occasionHost = useHostName(occasionId)
  const hostName = standalone ? standalone.ownerName : occasionHost
  const headingId = useId()
  // the latest standalone callbacks for the late answers below (the object is new on every render)
  const standaloneRef = useRef(standalone)
  useEffect(() => {
    standaloneRef.current = standalone
  })

  const latest = useRef(wishlist)
  useEffect(() => {
    latest.current = wishlist
  })

  const [confirmed, setConfirmed] = useState<readonly Confirmed[]>([])
  const wishes = useMemo(() => {
    const live = confirmed.filter((c) => c.base === wishlist)
    return sortWishes(asGuestWishes(wishlist.wishes)).map((wish) => {
      const c = live.find((entry) => entry.wishId === wish.id)
      return c ? { ...wish, reserved: c.reserved, reserved_by_me: c.reserved_by_me } : wish
    })
  }, [wishlist, confirmed])
  const reserveHint = !hintDismissed && online && wishes.some((wish) => !wish.reserved)
  // on screen = this session's optional hint (lib/hints.ts: the comic card on Start waits for another session)
  useEffect(() => (reserveHint ? showHint('reserve-hint') : undefined), [reserveHint])
  // what the owner already received: shown apart, never reservable (the same confirmed answers apply)
  const receivedWishes = useMemo(() => {
    const live = confirmed.filter((c) => c.base === wishlist)
    return asGuestWishes(wishlist.received ?? []).map((wish) => {
      const c = live.find((entry) => entry.wishId === wish.id)
      return c ? { ...wish, reserved: c.reserved, reserved_by_me: c.reserved_by_me } : wish
    })
  }, [wishlist, confirmed])
  const justConfirmed = useMemo(
    () => new Set(confirmed.filter((c) => c.base === wishlist).map((c) => c.wishId)),
    [confirmed, wishlist],
  )
  const mine = wishes.filter((wish) => wish.reserved_by_me).length
  // first presentation only: later rows (refetch, a confirmed state) come in without the cascade
  const [order] = useState(() => entranceOrder(entrance, wishes.map((wish) => wish.id)))

  const [sheet, setSheet] = useState<SheetState | null>(() => {
    const id = peekOpenWish(wishlist.id)
    const wish = wishes.find((entry) => entry.id === id) ?? receivedWishes.find((entry) => entry.id === id)
    return wish ? { wish, open: true, cheer: false } : null
  })
  useEffect(() => {
    takeOpenWish(wishlist.id)
  }, [wishlist.id])
  const findWish = (id: string) => wishes.find((wish) => wish.id === id) ?? receivedWishes.find((wish) => wish.id === id)
  const shown = sheet ? (findWish(sheet.wish.id) ?? sheet.wish) : null
  const shownReceived = shown !== null && receivedWishes.some((wish) => wish.id === shown.id)
  const [busy, setBusy] = useState<Busy>(null)
  const working = useRef(false)

  // The host removed the wish while its sheet was open: the sheet closes by itself and says so.
  const gone = sheet?.open === true && findWish(sheet.wish.id) === undefined
  const sheetOpen = sheet?.open === true && !gone
  useEffect(() => {
    if (gone) toast.info(t('reserve.wish_gone'))
  }, [gone, t])
  // Which wish's sheet is on screen right now (read after the server answered).
  const openSheetId = useRef<string | null>(null)
  useEffect(() => {
    openSheetId.current = sheetOpen && sheet ? sheet.wish.id : null
  })
  const doneHint = hostName ? t('reserve.done_hint', { host: hostName }) : t('reserve.done_hint_neutral')

  const confirm = useCallback((wishId: string, reserved: boolean, reservedByMe: boolean) => {
    const base = latest.current
    setConfirmed((prev) => [
      ...prev.filter((c) => c.base === base && c.wishId !== wishId),
      { wishId, reserved, reserved_by_me: reservedByMe, base },
    ])
  }, [])

  const refresh = useCallback(() => {
    const list = standaloneRef.current
    if (list) {
      // a list without an occasion: its own screen refreshes (and my plans); no occasion or feed changed
      list.onSettled()
      void queryClient.invalidateQueries({ queryKey: qk.myReservations() }).catch(() => undefined)
      return
    }
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.occasion(occasionId) }),
      queryClient.invalidateQueries({ queryKey: qk.myReservations() }),
      queryClient.invalidateQueries({ queryKey: qk.feed() }),
    ]).catch(() => undefined)
  }, [queryClient, occasionId])

  function openSheet(wish: GuestWish) {
    // Rendering the sheet is not urgent for the tap (INP): the row's pressed colour paints first, the
    // sheet renders in a transition and slides in right after.
    startTransition(() => setSheet({ wish, open: true, cheer: false }))
    if (!wish.reserved) preloadMascot()
  }

  async function reserve(wish: GuestWish) {
    if (working.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    working.current = true
    setBusy({ wishId: wish.id, action: 'reserve' })
    try {
      await reserveWish(wish.id, epoch.userId)
      if (!epoch.isCurrent()) return
      confirm(wish.id, true, true)
      dismissHint()
      feedback('success')
      if (openSheetId.current === wish.id) {
        // the sheet is the confirmation: the hamster celebrates there, next to the hint
        setSheet((s) => (s && s.wish.id === wish.id ? { ...s, cheer: true } : s))
      } else {
        toast.success(doneHint)
      }
    } catch (err) {
      if (!epoch.isCurrent()) return // a former account's answer: not a word about it
      const error = toAppError(err)
      if (error.code === 'already_reserved') {
        confirm(wish.id, true, false)
        feedback('warning')
        toast.error(t('reserve.conflict'))
      } else if (error.code === 'not_found') {
        setSheet((s) => (s ? { ...s, open: false } : s))
        toast.error(t('reserve.wish_gone'))
      } else if (error.code === 'limit_reached' && standaloneRef.current) {
        // the giver's own cap on a list without an occasion (5 active for one person): only the giver sees it
        feedback('warning')
        toast.error(standaloneRef.current.limitText)
      } else {
        feedback('error')
        toast.error(error.code === 'network' ? t('reserve.needs_network') : t(error.key, error.params))
      }
    } finally {
      working.current = false
      if (epoch.isCurrent()) {
        setBusy(null)
        refresh()
      }
    }
  }

  /**
   * "Passt zusammen" (20261030120000): the linked wishes that are FREE right now (the confirmed answers of this list
   * count over the screen's flags). Only what the database let this guest see is ever in `together`.
   */
  function freePartners(wish: GuestWish): string[] {
    if (!wishTogetherEnabled() || wish.reserved) return []
    return (wish.together ?? []).flatMap((link) => {
      const here = findWish(link.id)
      const taken = here ? here.reserved : link.reserved
      return taken ? [] : [link.id]
    })
  }

  /** "Beides reservieren" / "Alle reservieren": ONE server call, all or nothing; not optimistic. */
  async function reserveAll(wish: GuestWish, partners: readonly string[]) {
    if (working.current || !online || partners.length === 0) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    working.current = true
    setBusy({ wishId: wish.id, action: 'together' })
    try {
      await reserveTogether(wish.id, partners, epoch.userId)
      if (!epoch.isCurrent()) return
      for (const id of [wish.id, ...partners]) confirm(id, true, true)
      dismissHint()
      feedback('success')
      if (openSheetId.current === wish.id) setSheet((s) => (s && s.wish.id === wish.id ? { ...s, cheer: true } : s))
      toast.success(t('reserve.together_done', { count: partners.length + 1 }))
    } catch (err) {
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      if (error.code === 'already_reserved') {
        feedback('warning')
        toast.error(t('reserve.together_conflict'))
      } else if (error.code === 'validation') {
        feedback('warning')
        toast.error(t('reserve.together_changed'))
      } else if (error.code === 'not_found') {
        feedback('warning')
        toast.error(t('reserve.wish_gone'))
      } else if (error.code === 'limit_reached' && standaloneRef.current) {
        feedback('warning')
        toast.error(standaloneRef.current.limitText)
      } else {
        feedback('error')
        toast.error(error.code === 'network' ? t('reserve.needs_network') : t(error.key, error.params))
      }
    } finally {
      working.current = false
      if (epoch.isCurrent()) {
        setBusy(null)
        refresh()
      }
    }
  }

  async function cancel(wish: GuestWish) {
    if (working.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    working.current = true
    setBusy({ wishId: wish.id, action: 'cancel' })
    try {
      await cancelReservation(wish.id, epoch.userId)
      if (!epoch.isCurrent()) return
      confirm(wish.id, false, false)
      // done: the sheet slides away and the toast confirms (no hamster for a cancellation)
      setSheet((s) => (s && s.wish.id === wish.id ? { ...s, open: false, cheer: false } : s))
      toast.info(t('reserve.cancelled_hint'))
    } catch (err) {
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      feedback('error')
      toast.error(error.code === 'network' ? t('reserve.needs_network') : t(error.key, error.params))
    } finally {
      working.current = false
      if (epoch.isCurrent()) {
        setBusy(null)
        refresh()
      }
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={headingId} className="t-title-2 text-text">
          {hostName ? t('wish.section_title_guest', { host: hostName }) : t('wish.section_title_guest_neutral')}
        </h2>
        <AnimatePresence initial={false}>
          {online && mine > 0 ? <ReservationSummary key="summary" count={mine} /> : null}
        </AnimatePresence>
        {!online ? (
          <p role="status" className="flex w-full items-center gap-2 t-footnote text-text-2">
            <IconLock size={16} className="shrink-0" />
            {t('reserve.needs_network')}
          </p>
        ) : null}
      </div>

      {reserveHint ? <div data-reserve-hint="">
        <BunnyHint kind="hamster" text={t('onboarding:onb.hint_reserve')} action={t('reserve.hint_understood')} onDismiss={dismissHint} />
      </div> : null}

      {wishes.length === 0 && receivedWishes.length === 0 ? (
        <EmptyState
          mascot={<Mascot kind="hamster" size="m" scene="sleep" />}
          title={t('wish.empty_title')}
          text={hostName ? t('wish.empty_guest', { host: hostName }) : t('wish.empty_guest_neutral')}
        />
      ) : wishes.length === 0 ? (
        <p className="wg-all-done glass-panel">{t('wish.all_received_guest')}</p>
      ) : (
        <WishGrid entrance={order !== null}>
          {wishes.map((wish) => (
            <WishTile
              key={wish.id}
              wish={wish}
              enterDelay={entranceDelay(order, wish.id)}
              onPress={() => openSheet(wish)}
              // shared wishes: "auch in „…“" / "auch in einer anderen Liste" (only lists I may know about, Q18)
              places={placesText(t, wish.also_in)}
              status={
                online && wish.reserved ? <ReservationChip wish={wish} animateIn={justConfirmed.has(wish.id)} /> : undefined
              }
            />
          ))}
        </WishGrid>
      )}

      {receivedWishes.length > 0 ? (
        <ReceivedSection
          label={t('wish.received_title_guest')}
          a11yLabel={t('wish.received_label_guest', { count: receivedWishes.length })}
          count={receivedWishes.length}
        >
          <WishGrid>
            {receivedWishes.map((wish) => (
              <WishTile key={wish.id} wish={wish} muted badge={<ReceivedBadge />} onPress={() => openSheet(wish)} />
            ))}
          </WishGrid>
        </ReceivedSection>
      ) : null}

      <Sheet
        open={sheetOpen && shown !== null}
        onClose={() => setSheet((s) => (s ? { ...s, open: false } : s))}
        label={shown?.title}
        closeLabel={t('common.close')}
        footer={
          shown && shownReceived ? (
            <>
              <ReceivedGuestNote wish={shown} />
              <BrandStamp name={t('common.app_name')} className="pt-4" />
            </>
          ) : shown ? (
            <>
              <GuestSheetActions
                wish={shown}
                online={online}
                busy={busy?.wishId === shown.id ? busy.action : busy ? 'other' : null}
                cheer={sheet?.cheer === true}
                doneHint={doneHint}
                onReserve={() => void reserve(shown)}
                onCancel={() => void cancel(shown)}
                together={freePartners(shown)}
                onReserveTogether={(partners) => void reserveAll(shown, partners)}
              />
              {/* a screenshot of the wish says where it is from (Felix 22.10); decorative */}
              <BrandStamp name={t('common.app_name')} className="pt-4" />
            </>
          ) : undefined
        }
      >
        {shown ? (
          <WishDetails
            wish={shown}
            showTitle
            // a linked wish of THIS list opens its own sheet; one from another list stays plain text
            onOpenWish={(id) => {
              const target = findWish(id)
              return target ? () => setSheet({ wish: target, open: true, cheer: false }) : null
            }}
          />
        ) : null}
      </Sheet>
    </section>
  )
}

/**
 * "n von dir reserviert" (reserve.summary) — counts only this list and exists only from n = 1 (nothing to say at 0).
 * It grows in with the first own reservation and fades out with the last; the number slides between.
 */
function ReservationSummary({ count }: { count: number }) {
  const { t } = useTranslation('wishes')
  const reduced = useReducedMotionPref()
  const snappy = useSpring('snappy')
  const bouncy = useSpring('bouncy')
  return (
    <m.p
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
      transition={reduced ? fade : { ...bouncy, opacity: fade }}
      className="relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-control bg-accent-100 px-3 t-footnote font-semibold text-accent-text"
    >
      <IconGift size={16} className="shrink-0" />
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={count}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
          transition={reduced ? fade : { ...snappy, opacity: fade }}
          className="whitespace-nowrap"
        >
          {t('reserve.summary', { count })}
        </m.span>
      </AnimatePresence>
    </m.p>
  )
}

/** A received wish's sheet: no reservation any more — the owner has it already. */
function ReceivedGuestNote({ wish }: { wish: GuestWish }) {
  const { t } = useTranslation('wishes')
  return (
    <div className="flex flex-col items-center gap-2 pb-1 text-center" data-received-note="">
      {wish.reserved_by_me ? <ReservationChip wish={wish} /> : null}
      <p className="flex items-center justify-center gap-2 t-subhead text-text-2">
        <IconCheck size={16} className="shrink-0" />
        {t('wish.received_guest_info')}
      </p>
    </div>
  )
}

/** "Reserviert" (muted, never a name) or "Von dir reserviert" (accent). */
function ReservationChip({ wish, animateIn = false }: { wish: GuestWish; animateIn?: boolean }) {
  const { t } = useTranslation('wishes')
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  const mineChip = wish.reserved_by_me
  return (
    <m.span
      initial={animateIn ? (reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }) : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduced ? fade : { ...bouncy, opacity: fade }}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-control px-2 t-caption-1 font-semibold',
        mineChip ? 'bg-accent-100 text-accent-text' : 'bg-fill text-text-2',
      )}
    >
      {mineChip ? <IconCheck size={14} className="shrink-0" /> : <IconLock size={14} className="shrink-0" />}
      {mineChip ? t('reserve.mine') : t('reserve.taken_anonymous')}
    </m.span>
  )
}

interface GuestSheetActionsProps {
  wish: GuestWish
  online: boolean
  /** this wish's request in flight, another wish's, or none */
  busy: 'reserve' | 'cancel' | 'together' | 'other' | null
  cheer: boolean
  /** "Versteckt! … erfährt nichts." — the hamster's line right after a reservation */
  doneHint: string
  onReserve: () => void
  onCancel: () => void
  /** "Passt zusammen": the linked wishes that are free right now (empty: no joint button) */
  together?: readonly string[]
  onReserveTogether?: (partners: readonly string[]) => void
}

function GuestSheetActions({ wish, online, busy, cheer, doneHint, onReserve, onCancel, together = [], onReserveTogether }: GuestSheetActionsProps) {
  const { t } = useTranslation('wishes')
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  const state = !online ? 'offline' : wish.reserved_by_me ? 'mine' : wish.reserved ? 'taken' : 'free'
  // The first state appears with the sheet; later changes (after the server answered) glide in.
  const [firstState] = useState(state)
  const enter = state === firstState ? false : reduced ? { opacity: 0 } : { opacity: 0, y: 12 }
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state === firstState) return
    // The pressed button was replaced by the new state: keep the focus inside the dialog (its panel)
    // instead of losing it to <body>; the status line announces the result.
    if (document.activeElement === document.body || document.activeElement === null) {
      box.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true })
    }
  }, [state, firstState])

  const secretLine = (
    <p className="flex items-center justify-center gap-2 text-center t-footnote text-text-2">
      <IconEyeOff size={16} className="shrink-0" />
      {t('reserve.owner_cant_see')}
    </p>
  )

  return (
    <m.div
      ref={box}
      key={state}
      initial={enter}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? fade : { ...smooth, opacity: fade }}
      className="flex flex-col gap-3"
    >
      {state === 'free' ? (
        <>
          <Button
            size="lg"
            fullWidth
            icon={<IconGift />}
            loading={busy === 'reserve'}
            loadingLabel={t('reserve.pending')}
            disabled={busy !== null}
            onClick={onReserve}
          >
            {t('reserve.give')}
          </Button>
          {together.length > 0 && onReserveTogether ? (
            <div className="flex flex-col gap-1.5" data-reserve-together="">
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                icon={<IconGift />}
                loading={busy === 'together'}
                loadingLabel={t('reserve.pending')}
                disabled={busy !== null}
                onClick={() => onReserveTogether(together)}
              >
                {together.length === 1 ? t('reserve.together_two') : t('reserve.together_all', { count: together.length + 1 })}
              </Button>
              <p className="text-center t-footnote text-text-2">{t('reserve.together_hint')}</p>
            </div>
          ) : null}
          {secretLine}
        </>
      ) : state === 'mine' ? (
        cheer ? (
          // The reward moment (blocker 15), one beat after another: the hamster bounces up and jumps
          // (then hides the wish in his cheeks), his line follows, then the way back. The chip is not
          // shown now — the line says the same; it is there the next time the sheet opens.
          <>
            <HamsterCheer />
            <m.p
              role="status"
              className="text-center t-headline text-text"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduced ? fade : { ...smooth, delay: CHEER_LINE_DELAY, opacity: { ...fade, delay: CHEER_LINE_DELAY } }}
            >
              {doneHint}
            </m.p>
            <m.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduced ? fade : { ...smooth, delay: CHEER_BUTTON_DELAY, opacity: { ...fade, delay: CHEER_BUTTON_DELAY } }}
            >
              <CancelButton busy={busy} onCancel={onCancel} />
            </m.div>
          </>
        ) : (
          <>
            <p className="flex justify-center">
              <ReservationChip wish={wish} />
            </p>
            {secretLine}
            <CancelButton busy={busy} onCancel={onCancel} />
          </>
        )
      ) : state === 'taken' ? (
        <div className="flex flex-col items-center gap-2 pb-1 text-center">
          <ReservationChip wish={wish} />
          <p className="t-subhead text-text-2">{t('reserve.taken_info')}</p>
        </div>
      ) : (
        <p role="status" className="flex items-center justify-center gap-2 pb-1 text-center t-subhead text-text-2">
          <IconLock size={16} className="shrink-0" />
          {t('reserve.needs_network')}
        </p>
      )}
    </m.div>
  )
}

/** "Reservierung aufheben" — the way back, in every 'mine' state of the sheet. */
function CancelButton({ busy, onCancel }: { busy: GuestSheetActionsProps['busy']; onCancel: () => void }) {
  const { t } = useTranslation('wishes')
  return (
    <Button
      variant="secondary"
      size="lg"
      fullWidth
      loading={busy === 'cancel'}
      loadingLabel={t('reserve.cancelling')}
      disabled={busy !== null}
      onClick={onCancel}
    >
      {t('reserve.cancel')}
    </Button>
  )
}

/**
 * The hamster's moment (pilot-decisions §7, blocker 15: size m, the moment's main figure): he bounces up
 * into the sheet (bouncy spring), jumps, then hides the wish in his cheeks — and since 27.10 (Felix 26.10: «Psst с
 * тапси хорошо, оставляем») seals the secret: both paws over his mouth, ^ ^, a head tilt and a nod — the package's
 * scene 'secret' (jump → eat → «Psst», one timeline, lazily loaded; Weniger: the still «Psst» pose). Only the giver
 * sees it: this component exists only in the guest's own sheet after the server confirmed the reservation (`cheer`).
 * Back in the gallery (inGallery.ts) the old jump → eat plays.
 */
function HamsterCheer() {
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  const hamster = useRef<MascotHandle | null>(null)
  const next = useRef<ReturnType<typeof setTimeout> | null>(null)
  const psst = playsInApp('secret')
  useEffect(
    () => () => {
      if (next.current) clearTimeout(next.current)
    },
    [],
  )
  return (
    <m.div
      className="flex justify-center"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={reduced ? fade : { ...bouncy, opacity: fade }}
    >
      <Mascot
        kind="hamster"
        size="m"
        ref={hamster}
        scene={psst ? 'secret' : 'jump'}
        onSceneEnd={(scene) => {
          if (psst || scene !== 'jump') return
          // The package reports the end while it still counts as busy: start eat right after.
          next.current = setTimeout(() => {
            void hamster.current?.play('eat')
          }, 0)
        }}
      />
    </m.div>
  )
}
