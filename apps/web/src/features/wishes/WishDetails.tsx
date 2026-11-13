import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OwnerWish, WishLinkRef } from '../../lib/api/types'
import { wishQuantityEnabled, wishTogetherEnabled } from '../../lib/api/wishExtras'
import { domainOf, formatApproxPrice } from '../../lib/format'
import { Button, ButtonLink, IconForward, cn, haptic } from '../../ui'
import { compareLinks } from './compareLinks'
import { IconExternal } from './icons'
import { PriorityLine } from './HeartGlyph'
import { GiftTile, ShopTile } from './ShopTile'
import { SheetPhoto } from './WishPhoto'
import './wishes.css'

// Body of the wish sheet (owner AND guest view; the guest's reservation actions are the sheet's footer, never in
// here). It only knows the wish's own fields (OwnerWish = no reservation fields at all), top to bottom:
//   the photo (from our database) · the name, price and "Wie sehr?" (the meter's heart + its word) · colour / brand ·
//   the note · "Aus dem Shop" (the shop of the link, „Zum Shop“) · "Woanders finden" (four search links by GTIN or
//   title — no prices in the app, the line says so honestly) · at the very end the shop's product text (long ones
//   open with "Mehr lesen"; Felix 23.10).
// Every link leaves in a new tab without referrer and opener. Nothing is loaded from a shop to show this: the shops'
// real icons on the tiles come through OUR Worker as bytes (ShopTile.tsx → GET /api/shop-icon).

/** Only http(s) links become clickable (the database enforces the same; defence in depth). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** A product text longer than this starts folded (four lines + "Mehr lesen"). */
const LONG_TEXT = 180

const OUT = { target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' } as const

/**
 * `showTitle`: the wish's name under the photo, next to the price (Felix 23.10: "the name below, not on top") —
 * the sheet then has no title of its own (the dialog is named by the Sheet's `label`).
 */
export function WishDetails({ wish, showTitle = false, onOpenWish }: {
  wish: OwnerWish
  showTitle?: boolean
  /**
   * "Passt zusammen mit": the list's way to open a linked wish's sheet — null for a wish it cannot open (one that lives
   * in another list); then that row is plain text
   */
  onOpenWish?: (wishId: string) => (() => void) | null
}) {
  const { t } = useTranslation('wishes')
  const href = safeHttpUrl(wish.url)
  const domain = href ? domainOf(href) : null
  const price = formatApproxPrice(wish.price_cents, { currency: wish.currency })
  const hasPhoto = Boolean(wish.photo)
  // "Anzahl" (20261030120000): only when more than one piece; one gift covers them all (variant A, Felix 30.10)
  const quantity = wishQuantityEnabled() && (wish.quantity ?? 1) > 1 ? (wish.quantity ?? 1) : null
  const together = wishTogetherEnabled() ? (wish.together ?? []) : []
  const facts = [
    quantity ? { key: 'quantity', label: t('wish.quantity_label'), value: t('wish.quantity_pieces', { count: quantity }), note: t('wish.quantity_one_gift') } : null,
    wish.color ? { key: 'color', label: t('wish.color_label'), value: wish.color } : null,
    wish.brand ? { key: 'brand', label: t('wish.brand_label'), value: wish.brand } : null,
  ].filter((fact) => fact !== null)
  return (
    <div className="flex flex-col gap-4 pb-2">
      <SheetPhoto wish={wish} />
      <div className="flex items-center gap-3">
        {/* with a photo above, the tile would say the same twice */}
        {hasPhoto ? null : domain ? <ShopTile site={wish.shop_name?.trim() || domain} host={domain} size="lg" /> : <GiftTile seed={wish.id} size="lg" />}
        <div className="min-w-0 flex-1">
          {showTitle ? (
            <h2 className="line-clamp-3 t-title-2 text-text hyphens-auto [overflow-wrap:anywhere]" data-wish-title="">
              {wish.title}
            </h2>
          ) : null}
          {price ? <p className={cn(showTitle ? 't-title-3' : 't-title-2', 'tabular-nums text-text')}>{price}</p> : null}
          {/* "how much": the meter's heart and its word, as on the tiles (Felix 23.10: no hint sentence) */}
          <p className="mt-1.5">
            <PriorityLine priority={wish.priority} />
          </p>
        </div>
      </div>
      {facts.length > 0 ? (
        <dl className="m-0 overflow-hidden rounded-2xl bg-fill" data-wish-facts="">
          {facts.map((fact, index) => (
            <div key={fact.key} className={cn('flex items-baseline gap-3 px-4 py-2.5', index > 0 && 'border-t border-separator')}>
              <dt className="w-24 shrink-0 t-subhead text-text-2">{fact.label}</dt>
              <dd className="m-0 min-w-0 flex-1 t-body text-text [overflow-wrap:anywhere]" data-fact={fact.key}>
                {fact.value}
                {'note' in fact && fact.note ? <span className="block t-footnote text-text-2">{fact.note}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {together.length > 0 ? <TogetherSection links={together} onOpenWish={onOpenWish} /> : null}
      {wish.note ? (
        <div className="flex flex-col gap-1">
          <h3 className="px-1 t-footnote font-semibold uppercase tracking-[0.06em] text-text-2">{t('wish.note_label')}</h3>
          <p className="whitespace-pre-wrap rounded-2xl bg-fill px-4 py-3 t-body text-text [overflow-wrap:anywhere]">{wish.note}</p>
        </div>
      ) : null}
      {href && domain ? <ShopSection href={href} domain={domain} shopName={wish.shop_name ?? null} /> : null}
      <CompareSection title={wish.title} gtin={wish.gtin ?? null} />
      {/* the shop's product text at the very end (Felix 23.10) */}
      {wish.description ? <ProductText text={wish.description} /> : null}
    </div>
  )
}

/**
 * "Passt zusammen mit" (20261030120000): the linked wishes — for the owner every one, for a friend only those the
 * database let them see (never a hint of a hidden one). Each row opens that wish's sheet when the list allows it.
 */
function TogetherSection({ links, onOpenWish }: { links: readonly WishLinkRef[]; onOpenWish?: (wishId: string) => (() => void) | null }) {
  const { t } = useTranslation('wishes')
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1" data-wish-together="">
      <h3 id={headingId} className="px-1 t-footnote font-semibold uppercase tracking-[0.06em] text-text-2">{t('wish.together_with')}</h3>
      <ul className="m-0 list-none overflow-hidden rounded-2xl bg-fill p-0">
        {links.map((link, index) => {
          const open = onOpenWish?.(link.id) ?? null
          return (
          <li key={link.id} className={cn(index > 0 && 'border-t border-separator')}>
            {open ? (
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left t-body text-text tr-colors active:bg-fill-2"
                onClick={() => {
                  haptic('tap')
                  open()
                }}
              >
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{link.title}</span>
                <IconForward size={18} className="shrink-0 text-text-3" />
              </button>
            ) : (
              <p className="px-4 py-2.5 t-body text-text [overflow-wrap:anywhere]">{link.title}</p>
            )}
          </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The product text: whole when short, else four lines with "Mehr lesen" / "Weniger anzeigen". */
function ProductText({ text }: { text: string }) {
  const { t } = useTranslation('wishes')
  const id = useId()
  const long = [...text].length > LONG_TEXT || text.split('\n').length > 4
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col items-start gap-0.5" data-wish-description="">
      <h3 className="px-1 t-footnote font-semibold uppercase tracking-[0.06em] text-text-2">{t('wish.description_label')}</h3>
      <p id={id} className={cn('whitespace-pre-line px-1 t-body text-text [overflow-wrap:anywhere]', long && !open && 'wish-clamp')}>
        {text}
      </p>
      {long ? (
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} hapticKind="select" onClick={() => setOpen((v) => !v)} className="-ml-3">
          {open ? t('wish.description_less') : t('wish.description_more')}
        </Button>
      ) : null}
    </div>
  )
}

/** "Aus dem Shop": the link's shop (its name from the link, else its domain) and a clear „Zum Shop“. */
function ShopSection({ href, domain, shopName }: { href: string; domain: string; shopName: string | null }) {
  const { t } = useTranslation('wishes')
  const headingId = useId()
  const name = shopName?.trim() || domain
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h3 id={headingId} className="px-1 t-footnote font-semibold uppercase tracking-[0.06em] text-text-2">
        {t('wish.shop_heading')}
      </h3>
      <div className="wish-shop-row glass-panel rounded-lg" data-wish-shop="">
        <ShopTile site={name} host={domain} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block t-body font-semibold text-text [overflow-wrap:anywhere]">{name}</span>
          {name !== domain ? <span className="block truncate t-footnote text-text-2">{domain}</span> : null}
        </span>
        <ButtonLink
          href={href}
          {...OUT}
          variant="secondary"
          size="sm"
          icon={<IconExternal />}
          aria-label={t('wish.shop_open_label', { shop: name })}
          onClick={() => haptic('tap')}
          className="shrink-0"
        >
          {t('wish.shop_open')}
        </ButtonLink>
      </div>
    </section>
  )
}

/** "Woanders finden": four search links (GTIN or title), each with its shop and the external mark. */
function CompareSection({ title, gtin }: { title: string; gtin: string | null }) {
  const { t } = useTranslation('wishes')
  const headingId = useId()
  const links = compareLinks({ title, gtin })
  if (links.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5" data-wish-compare="">
      <div className="px-1">
        <h3 id={headingId} className="t-footnote font-semibold uppercase tracking-[0.06em] text-text-2">
          {t('wish.compare_heading')}
        </h3>
        <p className="t-footnote text-text-2">{gtin ? t('wish.compare_hint_gtin') : t('wish.compare_hint')}</p>
      </div>
      <ul className="m-0 list-none overflow-hidden rounded-lg p-0 glass-panel">
        {links.map((link) => (
          <li key={link.id}>
            <a
              className="wish-shop-row"
              href={link.url}
              {...OUT}
              aria-label={t('wish.compare_open', { shop: link.shop })}
              data-compare={link.id}
              onClick={() => haptic('tap')}
            >
              <ShopTile site={link.shop} host={link.host} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block t-body font-semibold text-text">{link.shop}</span>
                <span className="block t-footnote text-text-2">{link.host}</span>
              </span>
              <IconExternal size={18} className="shrink-0 text-text-3" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
