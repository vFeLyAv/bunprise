import { useRef, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { shopIconHost, shopIconQuery } from '../../lib/api/shopIcon'
import { useObjectUrl } from '../../lib/objectUrl'
import { IconGift, cn, tileTone } from '../../ui'
import { useInView } from './inView'
import { shopLetter } from './linkInput'
import './wishes.css'

// The shop of a wish: the first letter of the shop's name on a tile whose tint is a stable hash of that name
// (ui/tile.ts) — instantly, on every screen — and, when the shop's real icon is known, that icon fading in over the
// letter once it is decoded (Felix 23.10: "Shop-Namen ohne Logos"). The icon's bytes come ONLY from our Worker
// (lib/api/shopIcon.ts → GET /api/shop-icon): the <img> shows an object URL of that Blob, never a shop's address,
// so the device never contacts a shop (features/wishes/secrecy.test.ts checks it). No icon / any error → the letter
// simply stays. A wish without a link gets the gift tile in the tint of its own id. Tints never depend on reservations.

const TILE_SIZE = {
  lg: 'h-12 w-12 rounded-[14px] text-[1.375rem]',
  md: 'h-11 w-11 rounded-md text-[1.25rem]',
  sm: 'h-6 w-6 rounded-[7px] text-[0.8125rem]',
} as const

/** The smallest icon (in its own pixels) a tile shows; a smaller favicon would only be a blur, the letter is crisper. */
const MIN_ICON_PX = { lg: 24, md: 24, sm: 16 } as const

export type ShopTileSize = keyof typeof TILE_SIZE

/** Object URLs already decoded once (with their natural width): shown again at once, without a second fade. */
const decodedIcons = new Map<string, number>()

/** The shop's icon (bytes from our Worker) once the element `ref` is near the screen; null until then / without one. */
function useShopIconUrl(host: string | null | undefined, ref: RefObject<Element | null>): string | null {
  const key = shopIconHost(host)
  const visible = useInView(ref, key !== null)
  const query = useQuery({ ...shopIconQuery(key ?? ''), enabled: key !== null && visible })
  return useObjectUrl(query.data ?? null)
}

/**
 * The <img> of an icon: invisible until decoded, then it fades in over the letter (an opaque white backing, so the
 * letter never shows through a transparent icon). An object URL decoded before appears at once (no second fade).
 */
function ShopIconImage({ url, minPx }: { url: string; minPx: number }) {
  // decided once, when the <img> appears: after its own first load it must still fade in
  const [instant] = useState(() => decodedIcons.has(url))
  const [shown, setShown] = useState(() => (decodedIcons.get(url) ?? 0) >= minPx && instant)
  return (
    <img
      src={url}
      alt=""
      decoding="async"
      draggable={false}
      className="shop-icon-img"
      data-loaded={shown ? '' : undefined}
      data-instant={instant ? '' : undefined}
      onLoad={(event) => {
        const width = event.currentTarget.naturalWidth
        decodedIcons.set(url, width)
        if (width >= minPx) setShown(true)
      }}
    />
  )
}

/**
 * The icon layer of a shop: a box over its parent (which must be positioned) that holds the icon once it is there.
 * Asks for it only near the screen. Decorative (the shop's name is said next to it).
 */
export function ShopIcon({ host, minPx = 16, className }: { host: string | null | undefined; minPx?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const url = useShopIconUrl(host, ref)
  return (
    <span ref={ref} aria-hidden="true" className={cn('shop-icon', className)} data-shop-icon="">
      {url ? <ShopIconImage key={url} url={url} minPx={minPx} /> : null}
    </span>
  )
}

/**
 * The tile of a shop ("shop.example" → S) with its real icon over it when `host` is given and the Worker has one.
 * Decorative: the shop's name is said next to it.
 */
export function ShopTile({ site, host, size = 'md', className }: { site: string; host?: string | null; size?: ShopTileSize; className?: string }) {
  const letter = shopLetter(site)
  return (
    <span
      aria-hidden="true"
      data-tile={tileTone(site.trim().toLowerCase())}
      data-shop-tile=""
      className={cn('tile shop-tile grid shrink-0 place-items-center font-bold leading-none tracking-[-0.02em]', TILE_SIZE[size], className)}
    >
      {letter || <IconGift size={size === 'sm' ? 14 : 22} />}
      {host ? <ShopIcon host={host} minPx={MIN_ICON_PX[size]} /> : null}
    </span>
  )
}

/** The gift tile of a wish without a link (tint by the wish's id, as in every list). */
export function GiftTile({ seed, size = 'md', className }: { seed: string; size?: ShopTileSize; className?: string }) {
  return (
    <span aria-hidden="true" data-tile={tileTone(seed)} className={cn('tile grid shrink-0 place-items-center', TILE_SIZE[size], className)}>
      <IconGift size={size === 'sm' ? 14 : size === 'lg' ? 24 : 22} />
    </span>
  )
}
