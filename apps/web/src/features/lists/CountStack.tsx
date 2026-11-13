import { useTranslation } from 'react-i18next'
import { IconGift, tileTone } from '../../ui'
import { shopLetter } from '../wishes/linkInput'
import { ShopIcon } from '../wishes/ShopTile'
import { WishThumb } from '../wishes/WishPhoto'
import type { PreviewWish } from './previews'

// How many wishes a list holds, as a picture instead of "4 Wünsche" (Felix 22.10): up to three overlapping round
// thumbnails — the wish's photo (from our database, only once the card is near the screen, through the shared
// photo queue), else its shop's letter (with the shop's real icon over it once our Worker has it — bytes from
// GET /api/shop-icon, never from the shop) or the gift in a soft tint — and a count bubble for the rest ("+4"). An
// empty list shows a dashed empty slot with a tiny gift outline. The number itself is said to screen readers as
// text ("4 Wünsche"); the picture is decorative. Nothing here depends on anything but the list's own wishes.

const MAX_DOTS = 3

export interface CountStackProps {
  count: number
  /** the first wishes (previews.ts); null while unknown → soft placeholder dots */
  preview: readonly PreviewWish[] | null
  /** a stable seed for the placeholder tints (the list id) */
  seed: string
  /** on a cover photo: the dots get a white ring, the bubble a light glass */
  onPhoto?: boolean
}

export function CountStack({ count, preview, seed, onPhoto = false }: CountStackProps) {
  const { t } = useTranslation('lists')
  const label = t('lists.card.wishes', { count })
  if (count <= 0) {
    return (
      <span className="lc-stack" data-empty="" data-on-photo={onPhoto ? '' : undefined}>
        <span aria-hidden="true" className="lc-stack-empty">
          <IconGift size={14} />
        </span>
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  const shown = Math.min(count, MAX_DOTS)
  const extra = count - shown
  return (
    <span className="lc-stack" data-on-photo={onPhoto ? '' : undefined} data-count={count}>
      <span aria-hidden="true" className="lc-stack-dots">
        {Array.from({ length: shown }, (_, index) => {
          const wish = preview?.[index] ?? null
          return <StackDot key={wish ? wish.id : `slot-${index}`} wish={wish} seed={`${seed}:${index}`} />
        })}
        {extra > 0 ? <span className="lc-stack-more">{t('lists.card.more', { count: extra })}</span> : null}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

function StackDot({ wish, seed }: { wish: PreviewWish | null; seed: string }) {
  if (!wish) {
    // not known yet: a soft gift dot in a stable tint (no spinner, nothing jumps when the real ones come)
    return (
      <span className="lc-stack-dot tile" data-tile={tileTone(seed)} data-placeholder="">
        <IconGift size={13} />
      </span>
    )
  }
  const letter = wish.shop ? shopLetter(wish.shop) : ''
  const fallback = (
    <span className="lc-stack-dot tile" data-tile={tileTone(wish.shop ? wish.shop.trim().toLowerCase() : wish.id)}>
      {letter || <IconGift size={13} />}
      {wish.host ? <ShopIcon host={wish.host} /> : null}
    </span>
  )
  return wish.photo ? (
    <span className="lc-stack-photo" data-wish-dot={wish.id}>
      <WishThumb wish={wish}>{fallback}</WishThumb>
    </span>
  ) : (
    <span className="lc-stack-photo" data-wish-dot={wish.id}>
      {fallback}
    </span>
  )
}
