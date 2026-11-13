// «Помпон в открытом списке» (approved 31.10) — the React host of the list Pompon (./listPlay.ts): a lazy chunk of
// the owner's own list screen (OwnerWishlist.tsx loads it with React.lazy, only for her own list — the occasion
// screen keeps the carried gift and the sleeping hamster). Renders nothing itself: his box lives in the screen's
// content (`layer`), the empty list's box in its slot.
//
//   «Kaninchen zeigen» off / «Animationen: Aus» → nothing is loaded; «Weniger», battery saver, the system's reduced
//   motion → his still poses; a sheet open → paused (one mascot at a time is ./listPlay.ts's, mascot-ui/stage.ts).
//   At night (mascot-ui/night.ts, 23:00 – 07:00, «Nachts schlafen» on) he sleeps on his seat (mascot-ui/nightMount.ts,
//   the same sleeper as on Start: opened at night = already asleep); a tap wakes him — then the day's Pompon takes over
//   on that very seat; 10 minutes after the last touch of him he falls asleep again (once he rests). The empty box at
//   night: no peeks until a tap on the box woke him.
// Only the owner's own actions reach him (OwnerWishlist passes them); nothing about reservations — see
// listPlay.secrecy.test.ts.
import { useEffect, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AWAKE_MS } from '@bunprise/mascot/night-clock'
import { useBunniesShown, useLayerRoot, useMotionAttr } from '../../ui'
import type { MotionAttr } from '../../ui/motionMode'
import { useSheetOpen } from '../../ui/layers'
import type { ListPompon as Pompon, ListPomponMode } from './listPlay'

/** Still poses: every level but 'full' ('auto' = no attribute: the system setting). */
function stillOf(level: MotionAttr): boolean {
  if (level === 'full') return false
  if (level === 'auto') return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return true
}

/** He rests this long after the screen painted before he loads (the tiles rise in first). */
const AFTER_PAINT_MS = 250
/** Busy when the awake time is up: ask again after this. */
const RETRY_MS = 1500

export interface ListPomponProps {
  mode: ListPomponMode
  /** list: the screen's content (position: relative) — empty: the box's slot */
  layer: RefObject<HTMLElement | null>
  /** list: the header's row with the icon and the date */
  seatRow?: RefObject<HTMLElement | null>
  /** list: the spot under a long list */
  endSpot?: RefObject<HTMLElement | null>
  /** the living Pompon (null while he sleeps or is not there): OwnerWishlist sends him the list's moments */
  handle: RefObject<Pompon | null>
  /** a new own wish to pat into place (its id; once) */
  newWish?: string | null
  /** selection mode */
  selecting?: boolean
  /** how selection mode ended (set right before `selecting` goes false) */
  selectionEnd?: RefObject<{ kind: 'move' | 'bulk'; rects: readonly DOMRectReadOnly[] } | null>
}

export default function ListPompon({ mode, layer, seatRow, endSpot, handle, newWish = null, selecting = false, selectionEnd }: ListPomponProps) {
  const { t } = useTranslation('wishes')
  const shown = useBunniesShown()
  const level = useMotionAttr()
  const still = stillOf(level)
  const sheetOpen = useSheetOpen()
  const root = useLayerRoot()
  const latest = useRef({ still, sheetOpen, endText: t('wish.pompon_end') })
  useEffect(() => {
    latest.current = { still, sheetOpen, endText: t('wish.pompon_end') }
  })
  const patted = useRef<string | null>(null)
  const pending = useRef<string | null>(newWish)
  const tryWish = useRef<() => void>(() => undefined)
  const selectingRef = useRef(selecting)
  const off = !shown || level === 'off'

  useEffect(() => {
    if (off) return
    let alive = true
    // the mascots' clock (mascot-ui/night.ts: the device's, dev / demo `?night=`) once it is loaded
    let clock: () => number = Date.now
    let day: Pompon | null = null
    let sleeper: { destroy(): void; readonly mascot: { state: string; awakeUntil: number } } | null = null
    let sleeps = false
    let deadline = -Infinity
    let timer: ReturnType<typeof setTimeout> | undefined
    let offNight: (() => void) | undefined
    const scroller = root && root !== document.body ? root : window

    const seatOf = (): { x: number; y: number } | null => {
      const l = layer.current
      const row = seatRow?.current
      if (!l || !row) return null
      const lr = l.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      const b = (row.parentElement ?? row).getBoundingClientRect()
      return { x: b.right - lr.left - 30, y: r.bottom - lr.top - 2 }
    }

    const buildDay = (): Promise<void> =>
      import('./listPlay').then((m) => {
        const l = layer.current
        if (!alive || !l || day) return
        day = m.createListPompon({
          mode,
          layer: l,
          // (read when needed: the end spot comes and goes with the list's length)
          seatRow: () => seatRow?.current ?? null,
          endSpot: () => endSpot?.current ?? null,
          scroller,
          still: latest.current.still,
          endText: latest.current.endText,
        })
        day.setPaused(latest.current.sheetOpen)
        if (mode === 'empty') day.setNight(sleeps, deadline)
        handle.current = day
        tryWish.current()
      })

    const dropDay = () => {
      if (handle.current === day) handle.current = null
      day?.destroy()
      day = null
    }

    // ---- the night (list mode): he sleeps on his seat; a tap wakes him into the day's Pompon
    const sleepOnSeat = (live: boolean): void => {
      void import('../mascot-ui/nightMount').then((nm) => nm.loadNight().then((mod) => {
        const l = layer.current
        if (!alive || !l || sleeper) return
        let prev: string | null = live ? 'awake' : null
        const handleNight = nm.mountNight(mod, l, {
          kind: 'bunny',
          coat: 'fawn',
          size: 96,
          still: latest.current.still,
          ...(live ? { startAwake: true } : {}),
          wear: true,
          place: (night) => {
            const seat = seatOf()
            if (!seat) return
            night.rig.box.style.left = `${Math.round(seat.x - night.rig.size / 2)}px`
            night.rig.box.style.top = `${Math.round(seat.y - night.rig.feet)}px`
          },
          onChange: (state, night) => {
            const was = prev
            prev = state
            // woken (a tap, the morning, the switch off): the day's Pompon takes over on that very seat
            if (state === 'awake' && was !== null && was !== 'awake') {
              deadline = night.awakeUntil
              void buildDay().then(() => {
                if (!alive || !day) return
                sleeper?.destroy()
                sleeper = null
                arm()
              })
            }
          },
        })
        handleNight.mascot.rig.box.style.zIndex = '4'
        sleeper = handleNight
        if (prev === null) prev = handleNight.mascot.state
        dropDay()
      }), () => undefined)
    }

    /** The day's Pompon is awake at night: time to sleep? (10 min after the last touch, once he rests.) */
    const arm = (): void => {
      clearTimeout(timer)
      if (!alive || mode !== 'list' || !sleeps || !day) return
      const wait = Math.max(0, deadline - clock())
      timer = setTimeout(() => {
        if (!alive || !day || !sleeps) return
        if (clock() < deadline) {
          arm()
          return
        }
        if (day.busy || selectingRef.current) {
          timer = setTimeout(arm, RETRY_MS)
          return
        }
        sleepOnSeat(day.seen && !latest.current.still)
      }, Math.min(wait, 2 ** 31 - 1))
    }

    // a touch of the awake Pompon at night: awake again for 10 minutes from now
    const onDown = (e: Event) => {
      const target = e.target as Element | null
      if (sleeps && day && target?.closest?.('.lp-hit')) {
        deadline = clock() + AWAKE_MS
        arm()
      }
    }
    const l0 = layer.current
    l0?.addEventListener('pointerdown', onDown, true)

    const start = setTimeout(() => {
      void import('../mascot-ui/night').then((n) => {
        if (!alive) return
        clock = n.nightClock
        let first = true
        offNight = n.watchSleeps((now) => {
          const was = sleeps
          sleeps = now
          if (mode === 'empty') {
            if (first) void buildDay()
            day?.setNight(now, deadline)
          } else if (first) {
            if (now) sleepOnSeat(false)
            else void buildDay()
          } else if (now && !was) {
            // the night began while the list is open: he dozes off when he rests
            deadline = clock()
            arm()
          }
          first = false
        })
      }, () => {
        if (alive) void buildDay()
      })
    }, AFTER_PAINT_MS)

    return () => {
      alive = false
      clearTimeout(start)
      clearTimeout(timer)
      offNight?.()
      l0?.removeEventListener('pointerdown', onDown, true)
      sleeper?.destroy()
      sleeper = null
      dropDay()
    }
    // the settings below are applied to the living Pompon without rebuilding him
  }, [off, mode, layer, seatRow, endSpot, handle, root])

  useEffect(() => {
    handle.current?.setStill(still)
  }, [still, handle])
  useEffect(() => {
    handle.current?.setPaused(sheetOpen)
  }, [sheetOpen, handle])

  // a new own wish: pat it into place (once), as soon as he and the tile are there
  useEffect(() => {
    pending.current = newWish
    tryWish.current = () => {
      const id = pending.current
      const p = handle.current
      const l = layer.current
      if (!id || !p || !l || patted.current === id) return
      const tile = Array.from(l.querySelectorAll<HTMLElement>('[data-wish-id]')).find((el) => el.dataset.wishId === id)
      if (!tile) return
      patted.current = id
      p.wish(tile)
    }
    tryWish.current()
  }, [newWish, handle, layer])

  // selection mode: he holds his ears; its end tells him how it ended
  useEffect(() => {
    if (selectingRef.current === selecting) return
    selectingRef.current = selecting
    // (OwnerWishlist resets it when selection mode starts)
    const ending = selecting ? undefined : (selectionEnd?.current ?? undefined)
    handle.current?.selection(selecting, ending)
  }, [selecting, handle, selectionEnd])

  return null
}
