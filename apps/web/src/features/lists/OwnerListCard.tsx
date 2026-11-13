import { useRef, type ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { AnyListVisibility, OwnerListCard as OwnerListCardData } from '../../lib/api/lists.types'
import { cn, useReducedMotionPref, useSpring, useTapScale } from '../../ui'
import { useInView } from '../wishes/wishPhotos'
import { MotionLink } from '../shell/MotionLink'
import { CountStack } from './CountStack'
import { CardCover, CardCoverBusy } from './ListCover'
import { showsCover, useListCover } from './listCovers'
import { ListCardMenuButton } from './ListMenu'
import { lastOpenedList, nameOpenedCover } from './listTransition'
import { CoverTile, coverToneOf } from './covers'
import { dateWords, type DateWords } from './dates'
import { useListPreview } from './previews'

// One card of "Meine" (follows-design §2.3; Felix 22.10) — OWNER module. A list WITHOUT an occasion only (occasions
// live on their own screens). It shows the cover — the list's photo filling the card (a scrim keeps the white title
// readable) or its tone + symbol —, the title, how many wishes as a little picture (CountStack: up to three round
// thumbnails + "+4"; the number is said as text to screen readers), who sees it and its date — and NOTHING about
// reservations: no word, no count, no colour, no mascot reaction (the card's type has no such field; asOwnerLists()
// drops anything else, W02). The ⋯ on its corner (the list's settings, ListMenu) is its own button next to the card's
// link, never inside it. Tapping a card with a photo carries the photo into the list's header (listTransition.ts).

export interface OwnerListCardProps {
  card: OwnerListCardData
  today: string
  /** the account of the screen (the card's thumbnails ask for its list once it is near the screen) */
  userId?: string
  /** the bunny is still carrying it in: the card waits invisible in its place */
  concealed?: boolean
  /** it just landed: a short warm highlight */
  highlight?: boolean
  /** the ⋯ of the card (my own lists): opens the list's settings */
  onMenu?: () => void
}

export function OwnerListCard({ card, today, userId, concealed = false, highlight = false, onMenu }: OwnerListCardProps) {
  const { t, i18n } = useTranslation('lists')
  const tap = useTapScale(0.97)
  const spring = useSpring('snappy')
  const reduced = useReducedMotionPref()
  const slot = useRef<HTMLDivElement>(null)
  const photoRef = useRef<HTMLSpanElement>(null)
  const visible = useInView(slot)
  const tone = coverToneOf(card.cover_tone, card.id)
  const title = card.title?.trim() || t('lists.card.untitled')
  const words = card.due_on ? dateWords(card.due_on, i18n.resolvedLanguage ?? 'de', today) : null
  const cover = useListCover(card.id, card.photo, visible)
  const hasCover = showsCover(cover)
  const preview = useListPreview(card.id, userId, visible && !concealed && card.wish_count > 0)

  return (
    <div ref={slot} className="lc-slot">
      <MotionLink
        to="/lists/$listId"
        params={{ listId: card.id }}
        data-tone={tone}
        data-list-card={card.id}
        data-photo={hasCover ? '' : undefined}
        className={cn('lc-card glass-panel', concealed && 'lc-concealed')}
        whileTap={tap}
        transition={spring}
        onClick={() => {
          // the photo glides into the list's header (not under reduced motion: then the screen simply crossfades)
          if (hasCover && !reduced) nameOpenedCover(card.id, photoRef.current)
        }}
      >
        {hasCover ? (
          <CardCover cover={cover} photoRef={photoRef} named={!reduced && lastOpenedList() === card.id} />
        ) : (
          <span className="lc-cover" data-cover="">
            <CoverTile tone={tone} icon={card.cover_icon} size={40} />
          </span>
        )}
        <span className="lc-body">
          <span className="lc-title">{title}</span>
          <CountStack count={card.wish_count} preview={preview} seed={card.id} onPhoto={hasCover} />
        </span>
        <span className="lc-meta">
          <VisibilityChip visibility={card.visibility} />
          {words ? <DateChip words={words} /> : null}
        </span>
        {cover.busy ? <CardCoverBusy /> : null}
        {highlight ? <span aria-hidden="true" className="lc-glow" /> : null}
      </MotionLink>
      {onMenu ? <ListCardMenuButton title={title} onPress={onMenu} /> : null}
    </div>
  )
}

/** "Nur ich" / "Follower" / "Gäste" — who sees the list (the owner's own setting). */
export function VisibilityChip({ visibility, className }: { visibility: AnyListVisibility; className?: string }) {
  const { t } = useTranslation('lists')
  return (
    <span className={cn('lc-chip', className)} data-visibility={visibility}>
      {visibility === 'private' ? <GlyphLock /> : visibility === 'followers' ? <GlyphPeople /> : <GlyphGuests />}
      {t(`lists.card.visibility_${visibility}`)}
    </span>
  )
}

export function DateChip({ words }: { words: DateWords }) {
  const { t } = useTranslation('lists')
  const text =
    words.kind === 'today' ? t('lists.card.date_today')
      : words.kind === 'tomorrow' ? t('lists.card.date_tomorrow')
        : words.kind === 'days' ? t('lists.card.date_days', { count: words.count })
          : words.text
  return (
    <span className="lc-chip lc-chip-date" data-soon={words.kind === 'today' || words.kind === 'tomorrow' || (words.kind === 'days' && words.count <= 14) ? '' : undefined}>
      {text}
    </span>
  )
}

function Small({ children }: { children: ReactNode }) {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export function GlyphLock() {
  return (
    <Small>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Small>
  )
}

export function GlyphPeople() {
  return (
    <Small>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5" />
      <path d="M15.5 5.6a3.1 3.1 0 0 1 0 5.8M17.3 14.8c1.8.6 2.9 2.2 3.2 4.7" />
    </Small>
  )
}

function GlyphGuests() {
  return (
    <Small>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </Small>
  )
}

/** The dashed first tile of the grid: "+ Neue Liste". */
export function NewListTile({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation('lists')
  const tap = useTapScale(0.97)
  const spring = useSpring('snappy')
  return (
    <m.button type="button" className="lc-new" whileTap={tap} transition={spring} onClick={onPress}>
      <span aria-hidden="true" className="lc-new-plus">
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className="lc-new-label">{t('lists.mine.new')}</span>
    </m.button>
  )
}
