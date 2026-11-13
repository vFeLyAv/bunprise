import { useId, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { FeedOccasion, Rsvp } from '../../lib/api/types'
import { DateBadge, IconCheck, IconMapPin, IconQuestion, IconX, cn, haptic, tileTone, useSpring, useTapScale } from '../../ui'
import { HostLine, PersonAvatar } from '../calendar/PersonMark'
import { initialsOf, personKey, preferredTone, type PersonTone } from '../calendar/people'
import { coverMetaOf, FeedCover, FeedMotifCover } from './FeedCover'
import { shownCover } from '../occasions/covers/themes'
import { MotionLink } from './MotionLink'
import { spanText } from '../../lib/occasionTime'
import { badgeParts, describeWhen, guestCount } from './model'
import { lastOpenedOccasion, occasionTransitionName, rememberOpenedOccasion } from './session'
import { useIntentPreload } from './useIntentPreload'
import '../../styles/feed.css'

type TagTone = 'accent' | 'neutral' | 'ok'

const TAG_TONE: Record<TagTone, string> = {
  accent: 'bg-accent-100 text-accent-text',
  neutral: 'bg-fill text-text-2',
  ok: 'bg-ok-bg text-ok',
}

/** Static status pill inside a card (not interactive: the whole card is the link). */
function Tag({ tone, icon, children }: { tone: TagTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-control px-2.5 t-footnote font-semibold', TAG_TONE[tone])}>
      {icon}
      {children}
    </span>
  )
}

/** Host card: role + guest count. Nothing about reservations exists in this branch. A bring-along-only occasion
 *  (sections 'bring') says so instead of "no wishes yet": it has no wish list on purpose. */
function HostTags({ guests, noWishes, bringOnly }: { guests: number; noWishes: boolean; bringOnly: boolean }) {
  const { t } = useTranslation('feed')
  return (
    <>
      <Tag tone="accent">{t('feed.chip_host')}</Tag>
      <Tag tone="neutral">{guests === 0 ? t('feed.chip_guests_none') : t('feed.chip_guests', { count: guests })}</Tag>
      {bringOnly ? <Tag tone="neutral">{t('feed.chip_bring')}</Tag> : noWishes ? <Tag tone="neutral">{t('feed.chip_no_wishes')}</Tag> : null}
    </>
  )
}

const RSVP_TAG: Record<Exclude<Rsvp, 'none'>, { key: string; tone: TagTone; icon?: ReactNode }> = {
  going: { key: 'feed.chip_rsvp_going', tone: 'ok', icon: <IconCheck size={14} /> },
  maybe: { key: 'feed.chip_rsvp_maybe', tone: 'neutral', icon: <IconQuestion size={14} /> },
  declined: { key: 'feed.chip_rsvp_declined', tone: 'neutral', icon: <IconX size={14} /> },
}

/** A past occasion never asks for an answer any more. */
function showsRsvp(rsvp: Rsvp, past: boolean): boolean {
  return rsvp !== 'none' || !past
}

/** Only the RSVP: Start can be visible over the recipient's shoulder (pilot-decisions §000.11). */
function MemberTags({ rsvp, past }: { rsvp: Rsvp; past: boolean }) {
  const { t } = useTranslation('feed')
  const answer = rsvp === 'none' ? null : RSVP_TAG[rsvp]
  return (
    <>
      {answer ? (
        <Tag tone={answer.tone} icon={answer.icon}>{t(answer.key)}</Tag>
      ) : showsRsvp(rsvp, past) ? (
        <Tag tone="accent">{t('feed.chip_rsvp_none')}</Tag>
      ) : null}
    </>
  )
}

export interface FeedCardProps {
  occasion: FeedOccasion
  /** a card of the collapsed "past 30 days" group */
  past?: boolean
  /**
   * the host's colour on Start (wave 2): the same as their chips in the month view (calendar/people.ts
   * assignTones over the whole feed); alone, the person's preferred tone
   */
  personTone?: PersonTone
}

/**
 * One occasion in the feed (wave 1): a frosted card washed with the occasion's own colour (the same stable
 * hash as its tint on the occasion screen), a little calendar page on the left, the title big, where and
 * who below. The whole card links to the occasion screen (S7) and presses like a button.
 * With a cover photo (Felix 25.10) the photo runs across the card's top and dissolves into it, and the calendar
 * page sits on its lower edge — like the occasion screen's hero (FeedCover.tsx).
 */
export function FeedCard({ occasion, past = false, personTone }: FeedCardProps) {
  const { t } = useTranslation('feed')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const cover = coverMetaOf(occasion, queryClient)
  // no photo: the stored motif (Felix 26.10, occasions.cover_theme) takes the photo's place; a photo always wins
  const motif = cover ? null : shownCover(occasion.cover_theme)
  const covered = cover !== null || motif !== null
  const id = useId()
  const tap = useTapScale(0.98)
  const spring = useSpring('snappy')
  const when = describeWhen(occasion)
  const badge = badgeParts(occasion)
  const tone = tileTone(occasion.id)
  const transitionName = occasionTransitionName(occasion.id)
  const isHost = occasion.role === 'host'
  const ids = {
    title: `${id}-title`,
    when: `${id}-when`,
    host: `${id}-host`,
    place: `${id}-place`,
    tags: `${id}-tags`,
  }
  const hostName = !isHost && occasion.host_name?.trim() ? occasion.host_name.trim() : null
  const place = occasion.place_text?.trim() ? occasion.place_text.trim() : null
  const hasTags = isHost || showsRsvp(occasion.rsvp, past)
  const describedBy = [when && ids.when, hostName && ids.host, place && ids.place, hasTags && ids.tags].filter(Boolean).join(' ')
  // hover / focus intent only — never on touch: scrolling the feed must not load occasion screens
  const { cancel: cancelPreload, ...preloadOnIntent } = useIntentPreload(occasion.id)

  function open(event: MouseEvent<HTMLAnchorElement>) {
    cancelPreload() // the navigation loads the screen itself
    // Name the opened card synchronously, before the router starts the view transition.
    event.currentTarget.style.viewTransitionName = transitionName
    rememberOpenedOccasion(occasion.id)
    // On click, not pointerdown (unlike the kit's Card): starting to scroll on a card must not vibrate.
    haptic('tap')
    // A plain tap: the screen change starts once the tap's own frame (the pressed card) is on screen. The
    // view transition holds rendering while the router renders the occasion screen — that time no
    // longer counts against the tap (INP). A modified click (new tab, …) stays the link's own.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const go = () => void navigate({ to: '/occasions/$occasionId', params: { occasionId: occasion.id } })
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0))
    else setTimeout(go, 0)
  }

  const style: CSSProperties & Record<'--card-tint', string> = { '--card-tint': `var(--tint-${tone})` }
  if (lastOpenedOccasion() === occasion.id) style.viewTransitionName = transitionName

  const content = (
    <>
      {badge ? (
        <DateBadge tone={tone} month={badge.month} day={badge.day} weekday={badge.weekday}
          className={cn(past && 'opacity-70', covered && 'feed-cover-badge')} />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        {when ? (
          <span id={ids.when} className="block t-footnote">
            <span className={cn('font-semibold', past ? 'text-text-2' : 'text-accent-text')}>{when.relative}</span>
            {/* with an end (20261026180000): "Sa., 31. Okt. · 19:00–23:00" / "… 19:00 bis 02:00 (nächster Tag)" */}
            <span className="text-text-2"> · {when.span?.end ? `${when.date} · ${spanText(when.span, t)}` : when.absolute}</span>
            {when.occasionTime ? (
              <span className="block text-text-2">{t('feed.time_in_host_tz', { time: spanText(when.occasionTime.span, t), tz: when.occasionTime.tz })}</span>
            ) : null}
          </span>
        ) : null}
        <h3 id={ids.title} className="mt-0.5 line-clamp-2 t-title-3 font-bold text-text hyphens-auto [overflow-wrap:anywhere]">
          {occasion.title}
        </h3>
        {place ? (
          <span id={ids.place} className="mt-1 flex items-center gap-1.5 t-subhead text-text-2">
            <IconMapPin size={15} className="shrink-0" />
            <span className="min-w-0 truncate">{place}</span>
          </span>
        ) : null}
        {hostName ? (
          <span id={ids.host} className="mt-2 flex min-w-0 items-center gap-2 t-subhead text-text-2">
            <PersonAvatar person={{ key: personKey(occasion), initials: initialsOf(hostName), tone: personTone ?? preferredTone(personKey(occasion)) }} size={24} />
            <HostLine text={t('feed.hosted_by', { name: hostName })} name={hostName} />
          </span>
        ) : null}
        {hasTags ? (
          <span id={ids.tags} className="mt-3 flex flex-wrap gap-1.5">
            {isHost ? (
              <HostTags guests={guestCount(occasion)} noWishes={!past && occasion.wish_count === 0} bringOnly={!past && occasion.sections === 'bring'} />
            ) : (
              <MemberTags rsvp={occasion.rsvp} past={past} />
            )}
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <MotionLink
      to="/occasions/$occasionId"
      params={{ occasionId: occasion.id }}
      preload={false}
      {...preloadOnIntent}
      aria-labelledby={ids.title}
      aria-describedby={describedBy}
      data-past={past ? '' : undefined}
      data-cover={covered ? '' : undefined}
      className={cn(
        'glass-panel feed-card flex rounded-lg p-4 text-left text-text tr-colors',
        covered ? 'flex-col' : 'gap-4',
        'focus-visible:[box-shadow:var(--ring),var(--panel-shadow)]',
      )}
      style={style}
      whileTap={tap}
      transition={spring}
      onClick={open}
    >
      {covered ? (
        <>
          {cover ? <FeedCover occasionId={occasion.id} meta={cover} /> : motif ? <FeedMotifCover theme={motif} /> : null}
          <span className="flex gap-4">{content}</span>
        </>
      ) : content}
    </MotionLink>
  )
}
