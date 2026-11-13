import { useId, useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { OwnerWish } from '../../lib/api/types'
import { wishQuantityEnabled } from '../../lib/api/wishExtras'
import { domainOf, formatApproxPrice } from '../../lib/format'
import { IconCheck, IconForward, IconGift, IconMore, cn, fade, haptic, tileTone, useReducedMotionPref, useSpring, useTapScale } from '../../ui'
import { PriorityHeart } from './HeartGlyph'
import { shopLetter } from './linkInput'
import { useLongPress } from './selection/useLongPress'
import { ShopIcon, ShopTile } from './ShopTile'
import { safeHttpUrl } from './WishDetails'
import { WishThumb } from './WishPhoto'
import './wishes.css'
import './selection/selectTile.css'

// The wishes of a list as a 2-column grid of square tiles (Felix 22.10: "eher quadratisch, mit dem Foto aus dem
// Shop, kurzer Titel, irgendwo dezent das Shop-Icon"). Neutral building blocks shared by the owner and the guest
// view: they only know the wish's own fields (OwnerWish = no reservation fields at all). The guest view adds its
// state chip through the `status` slot; the owner view never passes one — it passes its ⋯ through `menu` (its own
// button next to the tile's button, never inside it).
//   picture  the product photo from OUR database (only once the tile is near the screen, the shared queue of
//            wishPhotos.ts), filling the square; without one a soft tint with the shop's letter (its real icon as a
//            white chip over it once our Worker has it) or the gift
//   corner   the shop's small tile: its letter, and its real icon fading in over it (Felix 23.10). The icon's
//            bytes come from OUR Worker (GET /api/shop-icon), never from the shop: the device never contacts a shop
//   heart    "how much": the wish-o-meter's heart on a glass disc in the picture's bottom right corner (Felix 23.10;
//            HeartGlyph.tsx PriorityHeart — the word for screen readers)
//   text     the title (2 lines) and the price

export { safeHttpUrl }

/** Sheet title that wraps (up to three lines) instead of being cut after one: the whole title is readable there. */
export function SheetTitle({ children }: { children: ReactNode }) {
  return <span className="line-clamp-3 block whitespace-normal hyphens-auto [overflow-wrap:anywhere]">{children}</span>
}

/** Seconds between two tiles of the first-presentation cascade (capped: a long list does not wait). */
const STAGGER_STEP = 0.045
const STAGGER_MAX_STEPS = 8

/**
 * The tiles of the list's first presentation (the screen's content arrived after its skeleton) rise in one after
 * another; later tiles (a refetch, a new wish) come in without a cascade. Pure: the initial order is captured once
 * by the caller (`useState(() => entranceOrder(...))`).
 */
export function entranceOrder(entrance: boolean, ids: readonly string[]): ReadonlyMap<string, number> | null {
  return entrance ? new Map(ids.map((id, index) => [id, index])) : null
}

/** The delay of a tile in the first-presentation cascade (0 for every tile that came later). */
export function entranceDelay(order: ReadonlyMap<string, number> | null, id: string): number {
  const index = order?.get(id)
  return index === undefined ? 0 : Math.min(index, STAGGER_MAX_STEPS) * STAGGER_STEP
}

/**
 * How the tiles that leave now go (owner view, «Помпон в открытом списке» 31.10): «Verschieben» lets the moved tiles fly
 * to the screen's right edge (px to the right per wish id, measured so that none leaves the screen) while Pompon hops
 * after them; every other tile shrinks away as always.
 */
export interface WishExit {
  fly: ReadonlyMap<string, number>
}

export interface WishGridProps {
  children: ReactNode
  /** first presentation: the tiles rise in (with their entranceDelay) instead of simply being there */
  entrance?: boolean
  /** owner view: how the tiles that leave right now go (AnimatePresence hands it to the leaving tiles) */
  exit?: WishExit
  className?: string
}

/** The grid. Tiles that leave (moved, received, deleted) shrink away while the others glide into place. */
export function WishGrid({ children, entrance = false, exit, className }: WishGridProps) {
  return (
    <ul className={cn('wg-grid', className)}>
      <AnimatePresence mode="popLayout" initial={entrance} custom={exit}>
        {children}
      </AnimatePresence>
    </ul>
  )
}

/** «Verschieben»: off to the right edge — a little wind-up, then away, turning a bit, smaller, gone (≈ 0.5 s). */
function flyExit(dx: number) {
  return {
    x: [0, -6, dx * 0.7, dx],
    y: [0, -4, -14, -18],
    rotate: [0, -2, 7, 9],
    scale: [1, 1.02, 0.86, 0.82],
    opacity: [1, 1, 0.9, 0],
    transition: { duration: 0.52, times: [0, 0.23, 0.77, 1], ease: [0.5, 0, 0.8, 0.5] as const },
  }
}

/**
 * The picture of a freshly added wish pops up where Pompon put the gift down (K10: the wish is carried into the
 * list): from small and a little turned, with one bounce. Decided once, when the tile appears. `data-wish-tile` is
 * the carry's landing target.
 */
function TileDrop({ drop, children }: { drop: boolean; children: ReactNode }) {
  const bouncy = useSpring('bouncy')
  const [dropIn] = useState(drop)
  return (
    <m.span
      data-wish-tile=""
      className="wt-drop"
      initial={dropIn ? { scale: 0.45, rotate: -12, opacity: 0 } : false}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={{ ...bouncy, opacity: { ...fade, duration: 0.12 } }}
    >
      {children}
    </m.span>
  )
}

/** A small favicon would only be a blur at this size: the big letter stays then. */
const FALLBACK_ICON_MIN_PX = 48

/**
 * Without a photo (and until it is there): the shop's letter on its own tint — its real icon as a white chip over the
 * letter once our Worker has one — or the gift on the wish's tint.
 */
function TileFallback({ wishId, shop, host }: { wishId: string; shop: string | null; host: string | null }) {
  const letter = shop ? shopLetter(shop) : ''
  return (
    <span
      className="wt-fallback tile"
      data-tile={tileTone(shop ? shop.trim().toLowerCase() : wishId)}
      data-shop-tile={letter ? '' : undefined}
    >
      {letter ? <span className="wt-letter">{letter}</span> : <IconGift size={36} />}
      {host ? <ShopIcon host={host} minPx={FALLBACK_ICON_MIN_PX} /> : null}
    </span>
  )
}

export interface WishTileProps {
  wish: OwnerWish
  onPress: () => void
  /** Guest view only: the state chip. The owner view never passes anything here. */
  status?: ReactNode
  /** On the picture's top left (the "Erhalten" mark of a received wish). */
  badge?: ReactNode
  /** Owner view only: the ⋯ (WishTileMenuButton) — its own button on the tile's corner. */
  menu?: ReactNode
  /** Freshly added: a soft accent wash that fades out. */
  highlight?: boolean
  /** Owner view, "wish added": the tile keeps its place but waits invisible until the carried gift lies there. */
  concealed?: boolean
  /** Received wishes (and, owner only, a list hidden by the emergency switch): a little quieter. */
  muted?: boolean
  /** Shared wishes (20261027200000): the quiet line "auch in „…“" / "Vorübergehend ausgeblendet" under the price. */
  places?: string | null
  /** Seconds this tile waits in the first-presentation cascade (entranceDelay). */
  enterDelay?: number
  /**
   * Owner view only (Felix 30.10, request #4): a long press starts selection mode. The friends' view never passes
   * it — there a long press is just a press.
   */
  onLongPress?: () => void
  /** A long press started (the owner view warms the lazy selection chunk). */
  onLongPressArm?: () => void
  /** Selection mode is on for this tile: the circle shows, `onPress` toggles, the tile wobbles (or, calm, outlines). */
  selectable?: boolean
  selected?: boolean
  /** AnimatePresence (popLayout) measures the tile through this ref. */
  ref?: Ref<HTMLLIElement>
}

export function WishTile({ wish, onPress, status, badge, menu, highlight = false, concealed = false, muted = false, places = null, enterDelay = 0, onLongPress, onLongPressArm, selectable = false, selected = false, ref }: WishTileProps) {
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  const snappy = useSpring('snappy')
  const bouncy = useSpring('bouncy')
  const tap = useTapScale(0.97)
  // in selection mode the tile is already selectable: a long press there is just a press
  const longPress = useLongPress(selectable ? undefined : onLongPress, onLongPressArm)
  const href = safeHttpUrl(wish.url)
  const domain = href ? domainOf(href) : null
  // the shop's own name when the link told it ("Zalando"), else the domain: the same letter as in the sheet
  const shop = domain ? wish.shop_name?.trim() || domain : null
  const price = formatApproxPrice(wish.price_cents, { currency: wish.currency })
  const quantity = wishQuantityEnabled() ? (wish.quantity ?? 1) : 1
  return (
    <m.li
      ref={ref}
      layout={reduced ? false : 'position'}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // the entrance waits its turn in the cascade; leaving and moving never wait. «Verschieben» (WishExit, the
      // grid's AnimatePresence `custom`): the moved tiles fly to the edge instead
      variants={{
        leave: (how?: WishExit) => {
          const dx = how?.fly.get(wish.id)
          if (reduced) return { opacity: 0, transition: fade }
          return dx === undefined ? { opacity: 0, scale: 0.86, transition: { ...smooth, opacity: fade } } : flyExit(dx)
        },
      }}
      exit="leave"
      transition={
        reduced
          ? fade
          : { ...smooth, delay: enterDelay, opacity: { ...fade, duration: 0.22, delay: enterDelay }, layout: smooth }
      }
      className="wt"
      data-wish-id={wish.id}
      data-muted={muted ? '' : undefined}
      // selection mode: the iPhone wobble, or (reduced motion) a calm outline instead (selection/selectTile.css)
      data-select={selectable ? (reduced ? 'calm' : 'jiggle') : undefined}
    >
      {/* the whole tile answers the finger (its ⋯ too): a small spring press; only the colour under reduced motion */}
      <m.div
        className={cn('wt-card glass-panel', concealed && 'invisible')}
        data-highlight={highlight ? '' : undefined}
        data-concealed={concealed ? '' : undefined}
        whileTap={tap}
        transition={snappy}
      >
        {selectable ? <span aria-hidden="true" className="wt-ring" data-on={selected ? '' : undefined} /> : null}
        <button
          type="button"
          className="wt-open"
          aria-pressed={selectable ? selected : undefined}
          // in selection mode the toggle itself ticks (useWishSelection); one tick per touch
          onPointerDown={(event) => {
            if (!selectable) haptic('tap')
            longPress.onPointerDown(event)
          }}
          onPointerMove={longPress.onPointerMove}
          onPointerUp={longPress.onPointerUp}
          onPointerCancel={longPress.onPointerCancel}
          onContextMenu={longPress.onContextMenu}
          onClick={() => {
            // the release of the long press that started selection mode: no sheet, no toggle on top
            if (longPress.consumeClick()) return
            onPress()
          }}
        >
          {/* keyed by `concealed`: the drop plays when the tile shows up, not while it waits invisible */}
          <TileDrop key={concealed ? 'waiting' : 'shown'} drop={highlight && !reduced}>
            <span className="wt-media">
              <WishThumb wish={wish} className="wt-thumb" imgClassName="wt-photo-img">
                <TileFallback wishId={wish.id} shop={shop} host={domain} />
              </WishThumb>
              {shop && wish.photo ? <ShopTile site={shop} host={domain} size="sm" className="wt-shop" /> : null}
              {badge ? <span className="wt-badge">{badge}</span> : null}
              {selectable ? (
                <span aria-hidden="true" className="wt-sel" data-on={selected ? '' : undefined} data-wish-select="">
                  <AnimatePresence initial={false}>
                    {selected ? (
                      <m.span
                        key="check"
                        className="wt-sel-check"
                        initial={reduced ? { opacity: 0 } : { scale: 0.3, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={reduced ? { opacity: 0, transition: fade } : { scale: 0.3, opacity: 0, transition: { ...snappy, opacity: fade } }}
                        transition={reduced ? fade : { ...bouncy, opacity: fade }}
                      >
                        <IconCheck size={15} />
                      </m.span>
                    ) : null}
                  </AnimatePresence>
                </span>
              ) : null}
              {/* "how much": the meter's heart in the picture's corner (Felix 23.10) */}
              <PriorityHeart priority={wish.priority} className="wt-heart" />
            </span>
          </TileDrop>
          <span className="wt-text">
            <span className="wt-title">{wish.title}</span>
            {price || quantity > 1 ? (
              <span className="wt-meta">
                {price ? <span className="wt-price tabular-nums">{price}</span> : null}
                {/* "Anzahl" (Felix 30.10): how many pieces the wish asks for, e.g. 4 AirTags */}
                {quantity > 1 ? <span className="tabular-nums" data-wish-quantity="">×{quantity}</span> : null}
              </span>
            ) : null}
            {places ? <span className="wt-places" data-wish-places="">{places}</span> : null}
            {status ? <span className="wt-status">{status}</span> : null}
          </span>
        </button>
        {menu}
      </m.div>
    </m.li>
  )
}

/** The ⋯ on an own wish tile: a small glass dot on the picture's corner (44 px to tap). */
export function WishTileMenuButton({ title, onPress }: { title: string; onPress: () => void }) {
  const { t } = useTranslation('wishes')
  return (
    <button
      type="button"
      className="wt-more"
      aria-label={t('wish.menu_label', { title })}
      aria-haspopup="dialog"
      onPointerDown={() => haptic('tap')}
      onClick={onPress}
    >
      <IconMore size={18} />
    </button>
  )
}

/** "✓ Erhalten" on the picture of a received wish. */
export function ReceivedBadge() {
  const { t } = useTranslation('wishes')
  return (
    <span className="wt-received">
      <IconCheck size={12} />
      {t('wish.received_badge')}
    </span>
  )
}

/**
 * The received wishes at the bottom of a list, collapsed: "Erhalten (2)" (owner) / "Schon erhalten (2)" (guests).
 * Open / closed lives in this component only (never stored).
 */
export function ReceivedSection({ label, a11yLabel, count, children }: { label: string; a11yLabel: string; count: number; children: ReactNode }) {
  const reduced = useReducedMotionPref()
  const snappy = useSpring('snappy')
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <section className="flex flex-col gap-3" data-received-section="">
      <button
        type="button"
        className="wr-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={a11yLabel}
        onPointerDown={() => haptic('tap')}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" className="wr-check">
          <IconCheck size={14} />
        </span>
        <span className="min-w-0 flex-1 text-left">{label}</span>
        <span className="wr-count tabular-nums" aria-hidden="true">{count}</span>
        <m.span aria-hidden="true" className="inline-flex text-text-2" initial={false} animate={{ rotate: open ? 90 : 0 }} transition={reduced ? { duration: 0 } : snappy}>
          <IconForward size={16} />
        </m.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div key="received" id={panelId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
            {children}
          </m.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
