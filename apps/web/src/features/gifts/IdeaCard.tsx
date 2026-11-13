import { useTranslation } from 'react-i18next'
import type { MotionValue } from 'motion/react'
import * as m from 'motion/react-m'
import { isDemoShopUrl, type GiftIdea } from '../../lib/api/giftIdeas'
import { currentLanguage } from '../../lib/i18n'
import { IconCheck, IconForward, IconPlus, cn, haptic, useSpring, useTapScale } from '../../ui'
import { GiftPicture } from './GiftPicture'
import { IconMoreLike, IconShop } from './icons'
import { offerPriceLabel, priceRangeLabel } from './labels'
import './gifts.css'

// One idea, big: the picture, the name, "ca. 17–39 €", where to get it — and its actions.
// The picture carries two corner slots: left the partner / „Anzeige“ label (RESERVED: always laid out, empty
// in the demo — a real partner offer fills it, contract `sponsored`), right „Demo“ for invented products.

export interface IdeaCardProps {
  idea: GiftIdea
  /** the verdict stamps follow the drag (opacity motion values), null on the cards behind */
  stamps: { like: MotionValue<number>; skip: MotionValue<number> } | null
  likeStamp: string
  /** "Nicht für mich" / for someone "Nicht für Anna" (the same words as the button under the deck) */
  skipStamp: string
  /** "Für mich": the wishlist action; "Für jemanden": none (the ♥ below saves) */
  onAddToList?: (() => void) | null
  addedToList?: boolean
  onMoreLike: () => void
  moreBusy: boolean
  onOffers: () => void
  /** ids put in by "Mehr wie das" wear "Neu" */
  isNew: boolean
  interactive: boolean
}

export function IdeaCard({ idea, stamps, likeStamp, skipStamp, onAddToList, addedToList, onMoreLike, moreBusy, onOffers, isNew, interactive }: IdeaCardProps) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  const tap = useTapScale(0.96)
  const snappy = useSpring('snappy')
  const demo = idea.offers.length > 0 && idea.offers.every((offer) => isDemoShopUrl(offer.url))
  const sponsored = idea.offers.some((offer) => offer.sponsored)
  const cheapest = idea.offers[0]
  const summary = cheapest ? t('gifts.where_summary', { count: idea.offers.length, price: offerPriceLabel(t, cheapest.price_cents, locale) }) : null
  const tab = interactive ? 0 : -1
  return (
    <>
      {/* the picture takes whatever the card has left: the bigger, the better */}
      <div className="relative min-h-[170px] flex-1">
        <GiftPicture idea={idea} className="absolute inset-0" credit={cheapest?.shop} />
        <div className="gift-corner" data-side="start" data-slot="partner-label">
          {sponsored ? <span className="gift-tag" data-kind="ad">{t('gifts.sponsored')}</span> : isNew ? <span className="gift-tag" data-kind="new">{t('gifts.new_badge')}</span> : null}
        </div>
        {demo ? (
          <div className="gift-corner" data-side="end">
            <span className="gift-tag" data-kind="demo">{t('gifts.demo_badge')}</span>
          </div>
        ) : null}
        {stamps ? (
          <>
            <m.span aria-hidden="true" className="gift-stamp" data-kind="like" data-copy-rest="opacity:0" style={{ opacity: stamps.like }}>
              {likeStamp}
            </m.span>
            <m.span aria-hidden="true" className="gift-stamp" data-kind="skip" data-copy-rest="opacity:0" style={{ opacity: stamps.skip }}>
              {skipStamp}
            </m.span>
          </>
        ) : null}
        {/* "Wo erhältlich": a small glass pill on the picture (opens the shops with their prices) */}
        {summary ? (
          <m.button
            type="button"
            tabIndex={tab}
            className="gift-where glass-float"
            aria-label={`${t('gifts.where')}: ${summary}`}
            whileTap={tap}
            transition={snappy}
            onPointerDown={() => haptic('tap')}
            onClick={onOffers}
          >
            <IconShop size={18} className="shrink-0" />
            <span className="truncate">{summary}</span>
            <IconForward size={14} className="shrink-0 opacity-60" />
          </m.button>
        ) : null}
      </div>
      {/* Felix 25.10: the details keep the same height on every card (two title lines reserved, one row of
          actions), so the picture above never changes size from one idea to the next */}
      <div data-gift-details="" className="flex flex-none flex-col px-4 pb-3.5 pt-3">
        <h3 className="line-clamp-2 min-h-[calc(2*var(--lh-title-3))] t-title-3 text-text [overflow-wrap:anywhere]">{idea.title}</h3>
        {/* only the price (Felix 26.10: "less busy" — what it matches is said once, in "Warum diese Ideen?") */}
        <p className="mt-0.5 flex h-(--lh-subhead) min-w-0 items-baseline overflow-hidden t-subhead">
          <span className="shrink-0 font-semibold tabular-nums text-accent-text">{priceRangeLabel(t, idea, locale)}</span>
        </p>
        {/* the actions: only the top card shows them (gifts.css) — the next card's picture and name are already
            visible underneath while the top one is dragged away */}
        <div data-gift-actions="" className="mt-2.5 flex flex-nowrap items-center gap-2">
          <m.button
            type="button"
            tabIndex={tab}
            disabled={moreBusy}
            className="inline-flex h-11 min-w-0 max-w-full flex-[1_1_9rem] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-fill px-3.5 t-subhead font-semibold text-text tr-colors active:bg-fill-2 disabled:opacity-50"
            whileTap={tap}
            transition={snappy}
            onPointerDown={() => haptic('tap')}
            onClick={onMoreLike}
          >
            <IconMoreLike size={18} />
            {t('gifts.more_like')}
          </m.button>
          {onAddToList ? (
            <m.button
              type="button"
              tabIndex={tab}
              disabled={addedToList}
              aria-label={addedToList ? t('gifts.on_list') : t('gifts.add_to_list')}
              className={cn(
                'inline-flex h-11 min-w-0 max-w-full flex-[1_1_9rem] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 t-subhead font-semibold tr-colors',
                addedToList ? 'bg-ok-bg text-ok' : 'bg-accent-400 text-text-on-accent active:bg-accent-500',
              )}
              whileTap={addedToList ? undefined : tap}
              transition={snappy}
              onPointerDown={() => {
                if (!addedToList) haptic('tap')
              }}
              onClick={onAddToList}
            >
              {addedToList ? <IconCheck size={18} /> : <IconPlus size={18} />}
              <span className="truncate">{addedToList ? t('gifts.on_list') : t('gifts.add_to_list_short')}</span>
            </m.button>
          ) : null}
        </div>
      </div>
    </>
  )
}
