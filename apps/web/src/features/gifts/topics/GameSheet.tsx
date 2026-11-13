import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { drawnArtId, GIFT_ART_PREFIX, ownImagePath, photoFallbackArt } from '../../../lib/api/giftIdeas'
import type { GiftTopicIdea } from '../../../lib/api/giftTopics'
import { currentLanguage } from '../../../lib/i18n'
import { Sheet } from '../../../ui/Sheet'
import { GiftPicture } from '../GiftPicture'
import { asOfLabel, priceRangeLabel } from '../labels'
import { OfferRows } from '../OffersSheet'
import { ARCH_TONE, lookOf } from '../plays/looks'
import { SceneArt } from '../plays/SceneArt'
import { GameCarousel, type CarouselSlide } from './GameCarousel'
import { awardLabel, minutesLabel, playersLabel } from './words'

// One idea of a topic opened (design 26.10 §3): the sheet "Wo erhältlich" of the deck, with on top the pictures —
// for a board game first OUR animation of the game (plays once when the sheet opens; reduced motion: its end pose),
// then the real photo of the box through our Worker, on a white plate with "Bild: <Shop>" (the shop of the
// cheapest offer, whose page named the photo). A photo that does not load leaves only the drawing (no dots, no
// arrows). Then the name, publisher and prize, the facts, our short text, "So wird gespielt", the shops with
// approximate, dated prices; the action of the mode is pinned below ("Zu meiner Wunschliste" / "Merken für Anna").

export interface GameSheetProps {
  idea: GiftTopicIdea | null
  open: boolean
  onClose: () => void
  asOf: string | null
  reduced: boolean
  action?: ReactNode
}

export function GameSheet({ idea, open, onClose, asOf, reduced, action }: GameSheetProps) {
  const { t } = useTranslation('gifts')
  const name = idea?.game?.name ?? idea?.title ?? ''
  return (
    <Sheet open={open && idea !== null} onClose={onClose} label={name} closeLabel={t('common.close')} footer={action} detent="full">
      {/* a new idea = a fresh sheet body (the photo's failure and the slide belong to one idea) */}
      {idea ? <GameSheetBody key={idea.id} idea={idea} open={open} asOf={asOf} reduced={reduced} /> : null}
    </Sheet>
  )
}

function GameSheetBody({ idea, open, asOf, reduced }: { idea: GiftTopicIdea; open: boolean; asOf: string | null; reduced: boolean }) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  const [photoFailed, setPhotoFailed] = useState(false)
  const game = idea.game
  const name = game?.name ?? idea.title
  const look = lookOf(idea.id)
  const photo = photoFallbackArt(idea.image_url) !== null ? ownImagePath(idea.image_url) : null
  const art = photoFallbackArt(idea.image_url) ?? drawnArtId(idea.image_url)
  const shop = idea.offers[0]?.shop ?? ''

  const slides: CarouselSlide[] = []
  if (look) {
    slides.push({
      key: 'scene',
      kind: 'drawing',
      label: t('topics.slide_drawing'),
      node: (
        <div className="tile absolute inset-0" data-tile={ARCH_TONE[look.archetype]}>
          <SceneArt look={look} play={open} reduced={reduced} className="absolute inset-0" />
        </div>
      ),
    })
  } else if (game && art) {
    // a board game without its own animation yet: our drawing of it
    slides.push({ key: 'drawing', kind: 'drawing', label: t('topics.slide_drawing'), node: <GiftPicture idea={{ id: idea.id, image_url: `${GIFT_ART_PREFIX}${art}` }} /> })
  } else {
    // any other idea: its picture as the deck shows it (photo with "Bild: <Shop>", else the drawing)
    slides.push({ key: 'picture', kind: 'drawing', label: t('topics.slide_photo', { name }), node: <GiftPicture idea={idea} credit={shop} /> })
  }
  if (game && photo && !photoFailed) {
    slides.push({
      key: 'photo',
      kind: 'photo',
      label: t('topics.slide_photo', { name }),
      node: (
        <>
          <img src={photo} alt="" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setPhotoFailed(true)} />
          {shop ? <span className="topic-credit">{t('gifts.picture_credit', { shop })}</span> : null}
        </>
      ),
    })
  }

  const book = idea.book
  const by = game ? [game.publisher, game.award ? awardLabel(t, game.award) : null].filter(Boolean).join(' · ') : book ? `${book.genre} · ${book.author} · ${book.publisher}` : null
  // the rules exist in every UI language (30.10); should one be missing, the Worker sends English or German — say so
  const foreignRules = idea.how_to_play_lang !== null && idea.how_to_play_lang !== locale
  const foreignNote = idea.how_to_play_lang === 'en' ? t('topics.how_to_english') : t('topics.how_to_german')
  return (
    <div className="flex flex-col gap-4 pb-1">
      <GameCarousel name={name} slides={slides} />
      <div className="flex flex-col gap-0.5 px-1">
        <h2 className="t-title-2 text-text [overflow-wrap:anywhere]">{name}</h2>
        {by ? <p className="t-footnote text-text-2">{by}</p> : null}
        <p className="t-subhead font-semibold tabular-nums text-accent-text">{priceRangeLabel(t, idea, locale)}</p>
      </div>
      {game ? (
        <div className="topic-factrow">
          <span>
            {t('topics.fact_players')}
            <b>{playersLabel(t, game)}</b>
          </span>
          <span>
            {t('topics.fact_time')}
            <b>{minutesLabel(t, game)}</b>
          </span>
          <span>
            {t('topics.fact_age')}
            <b>{t('topics.age_value', { age: game.age_min })}</b>
          </span>
        </div>
      ) : null}
      {book ? (
        <div className="topic-factrow" data-cols="2">
          <span>
            {t('topics.fact_pages')}
            <b>{t('topics.pages_value', { pages: book.pages })}</b>
          </span>
          <span>
            {t('topics.fact_year')}
            <b>{book.year}</b>
          </span>
        </div>
      ) : null}
      {idea.blurb ? <p className="px-1 t-body text-text" lang={idea.blurb_lang ?? undefined}>{idea.blurb}</p> : null}
      {/* a book: "Worum geht's" — our own 1–2 sentences (never the publisher's text), like "So wird gespielt" */}
      {idea.about ? (
        <section className="topic-howto" aria-labelledby={`about-${idea.id}`}>
          <h3 id={`about-${idea.id}`}>{t('topics.about_title')}</h3>
          <p lang={idea.about_lang ?? undefined}>{idea.about}</p>
        </section>
      ) : null}
      {idea.how_to_play ? (
        <section className="topic-howto" aria-labelledby={`howto-${idea.id}`}>
          <h3 id={`howto-${idea.id}`}>{t('topics.how_to_title')}</h3>
          <p lang={idea.how_to_play_lang ?? undefined}>{idea.how_to_play}</p>
          {foreignRules ? <small>{foreignNote}</small> : null}
        </section>
      ) : null}
      <OfferRows offers={idea.offers} />
      <p className="px-1 t-footnote text-text-2">
        {asOf ? t('gifts.offers_as_of', { when: asOfLabel(asOf, locale, t('gifts.as_of_today')) }) : t('gifts.offers_as_of_unknown')}
      </p>
    </div>
  )
}
