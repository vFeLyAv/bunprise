import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { domainOf } from '../../lib/format'
import { isDemoShopUrl, type GiftIdea, type GiftOffer } from '../../lib/api/giftIdeas'
import { currentLanguage } from '../../lib/i18n'
import { cn, haptic } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { IconExternal } from '../wishes/icons'
import { ShopTile } from '../wishes/ShopTile'
import { GiftPicture } from './GiftPicture'
import { asOfLabel, offerPriceLabel, priceRangeLabel } from './labels'
import './gifts.css'

// "Wo erhältlich": 2–4 shops with approximate prices, cheapest first (lib/api/giftIdeas.ts sorts them —
// a provider's order never decides). Honesty rules (brief 4.4): prices are approximate and dated; a paid
// placement or partner link wears „Anzeige“ in its own row AND in the reserved slot of the header; an invented
// demo shop is never a link (its domain cannot exist) and says so. A real shop opens in a new tab with no
// referrer and no opener (rel="sponsored" when paid).

export interface OffersSheetProps {
  idea: GiftIdea | null
  open: boolean
  onClose: () => void
  asOf: string | null
  /** the main action of the mode ("Zu meiner Wunschliste" / "Merken für Anna"), shown under the list */
  action?: ReactNode
}

export function OffersSheet({ idea, open, onClose, asOf, action }: OffersSheetProps) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  const sponsored = idea?.offers.some((offer) => offer.sponsored) ?? false
  const demo = idea ? idea.offers.every((offer) => isDemoShopUrl(offer.url)) : false
  return (
    <Sheet open={open && idea !== null} onClose={onClose} title={t('gifts.offers_title')} closeLabel={t('common.close')} footer={action}>
      {idea ? (
        <div className="flex flex-col gap-4 pb-1">
          <div className="flex items-center gap-3">
            <GiftPicture idea={idea} size="thumb" className="h-16 w-16 shrink-0 rounded-[16px]" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 t-headline text-text [overflow-wrap:anywhere]">{idea.title}</p>
              <p className="t-subhead font-semibold tabular-nums text-accent-text">{priceRangeLabel(t, idea, locale)}</p>
            </div>
            {/* the partner slot of the sheet: takes room only when an offer is paid (an empty slot would cut the
                product's name on a narrow phone; nothing moves here, the sheet's idea is fixed while it is open) */}
            <div className={cn('flex justify-end self-start', sponsored && 'min-w-[64px]')} data-slot="partner-label">
              {sponsored ? <span className="gift-tag" data-kind="ad">{t('gifts.sponsored')}</span> : null}
            </div>
          </div>
          <OfferRows offers={idea.offers} />
          <div className="flex flex-col gap-1 px-1 t-footnote text-text-2">
            <p>{asOf ? t('gifts.offers_as_of', { when: asOfLabel(asOf, locale, t('gifts.as_of_today')) }) : t('gifts.offers_as_of_unknown')}</p>
            {sponsored ? <p>{t('gifts.offers_sponsored_note')}</p> : null}
            {demo ? <p>{t('gifts.offers_demo')}</p> : null}
          </div>
        </div>
      ) : null}
    </Sheet>
  )
}

/** The shops of an idea with their approximate prices (also the topic screen's game sheet, features/gifts/topics). */
export function OfferRows({ offers }: { offers: readonly GiftOffer[] }) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  return (
    <ul className="overflow-hidden rounded-lg glass-panel">
      {offers.map((offer) => {
        const isDemo = isDemoShopUrl(offer.url)
        const host = domainOf(offer.url) ?? offer.shop
        const content = (
          <>
            <ShopTile site={offer.shop} host={domainOf(offer.url)} size="md" />
            {/* the shop and its address wrap rather than cut: "Demo-Shop" must stay readable at 320 px */}
            <span className="min-w-0 flex-1">
              <span className="block t-body font-semibold text-text [overflow-wrap:anywhere]">{offer.shop}</span>
              <span className="block t-footnote text-text-2 [overflow-wrap:anywhere]">{isDemo ? `${host} · ${t('gifts.offer_demo')}` : host}</span>
            </span>
            {offer.sponsored ? <span className="gift-tag" data-kind="ad">{t('gifts.sponsored')}</span> : null}
            <span className="shrink-0 t-headline tabular-nums text-text">{offerPriceLabel(t, offer.price_cents, locale)}</span>
            {isDemo ? null : <IconExternal size={18} className="shrink-0 text-text-3" />}
          </>
        )
        return (
          <li key={`${offer.shop}-${offer.url}`}>
            {isDemo ? (
              <div className="gift-offer" data-demo="">
                {content}
              </div>
            ) : (
              <a
                className="gift-offer"
                href={offer.url}
                target="_blank"
                rel={offer.sponsored ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
                referrerPolicy="no-referrer"
                aria-label={t('gifts.offer_open', { shop: offer.shop })}
                onClick={() => haptic('tap')}
              >
                {content}
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}
