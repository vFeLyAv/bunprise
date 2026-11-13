import { Suspense, lazy, useId, useRef, useState, type CSSProperties } from 'react'
import type { NightMascot } from '@bunprise/mascot/night'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { requestFollow } from '../../lib/api/lists'
import type { CoverIcon, FollowedListCard, FollowedPerson, FollowSuggestion, ListsOverview, UpcomingList } from '../../lib/api/lists.types'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import type { ListPhotoMeta } from '../../lib/api/types'
import { Button, IconCheck, IconForward, Skeleton, buttonClass, fade, haptic, useBunniesShown, useReducedMotionPref, useSpring, useTapScale, type TileTone } from '../../ui'
import { useInView } from '../wishes/wishPhotos'
import { Mascot } from '../mascot-ui/Mascot'
import { playsInApp } from '../mascot-ui/inGallery'
import { useNightLatch } from './nightLatch'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import { AvatarPhoto } from '../profilePhotos/PersonPhoto'
import { useOnline } from '../auth/shared'
import { MotionLink, PressLink } from '../shell/MotionLink'
import { CountStack } from './CountStack'
import { CardCover } from './ListCover'
import { showsCover, useListCover } from './listCovers'
import { lastOpenedList, nameOpenedCover } from './listTransition'
import { CoverTile, coverToneOf } from './covers'
import { dateWords, todayKey, type DateWords } from './dates'
import { DateChip } from './OwnerListCard'
import { useListPreview } from './previews'
import { listsTabView } from './tabView'

// "Freunde" (follows-design §2.4): what others share with me — "Bald" (60 days; wishlists only, Felix 22.10: an
// occasion I am a guest of lives on Start and on its own screen, never in "Listen"), the people I follow with
// their follower lists (cards with the list's cover photo and the little wish picture, CountStack), "Aus deinen Anlässen" (only people who switched it on themselves) and "Meine
// Geschenkpläne". There is NOTHING about my own reservations on these cards (§2.4: the person a gift is for,
// glancing at my phone, would read it) — those live on a list's own screen and in the collapsed gift plans,
// which load only on a tap (a lazy guest module). Follow direction is honest: "Ihr folgt euch" / "Folgt dir nicht".

const GiftPlans = lazy(() => import('./GiftPlans'))

export interface FriendsSectionProps {
  userId: string
  /** null while the overview loads */
  overview: ListsOverview | null
  onShare: () => void
  /** "Code eingeben": the same sheet on its code tab (add-friends-design §2.1) */
  onEnterCode?: () => void
}

export function FriendsSection({ userId, overview, onShare, onEnterCode }: FriendsSectionProps) {
  const { t } = useTranslation('lists')
  if (!overview) return <FriendsSkeleton />
  const { following, suggestions } = overview
  const { upcoming } = listsTabView(overview)
  // following nobody: "how following works" + [Deinen Link teilen] — also for a newcomer who is already a
  // guest of an occasion (the usual first day after an invite link): their "Bald" comes first, then the help
  const followsNobody = friendsEmpty(overview)
  return (
    <div className="flex flex-col gap-8">
      {upcoming.length > 0 ? <SoonRail entries={upcoming} userId={userId} /> : null}
      {followsNobody ? <FriendsEmpty onShare={onShare} onEnterCode={onEnterCode} /> : null}
      {following.length > 0 ? (
        <div className="flex flex-col gap-7">
          {following.map((person) => (
            <PersonBlock key={person.profile.id} person={person} userId={userId} />
          ))}
        </div>
      ) : null}
      <Suggestions userId={userId} suggestions={suggestions} />
      <GiftPlansToggle userId={userId} />
      {/* the empty card carries this line itself */}
      {!followsNobody ? <p className="px-4 text-center t-footnote text-text-2 [text-wrap:balance]">{t('lists.friends.no_search')}</p> : null}
    </div>
  )
}

/**
 * "Abonniert" under my own lists in "Meine" (Felix 26.10: "after mine comes 'Abonniert' — they are not friends, but
 * you follow them and need their lists"; the "Freunde" tab stays as it is): the people I follow who do not follow me
 * back and share lists with me, as the same blocks as in "Freunde". Nothing while there is nobody like that.
 */
export function SubscribedSection({ userId, overview }: { userId: string; overview: ListsOverview | null }) {
  const { t } = useTranslation('lists')
  const headingId = useId()
  const people = overview?.following.filter((person) => !person.mutual && person.lists.length > 0) ?? []
  if (people.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="t-title-2 text-text">{t('lists.mine.subscribed')}</h2>
      <div className="flex flex-col gap-7">
        {people.map((person) => (
          <PersonBlock key={person.profile.id} person={person} userId={userId} level={3} />
        ))}
      </div>
    </section>
  )
}

/** "Freunde" shows its explanation (and Tapsi with the binoculars) while the account follows nobody. */
export function friendsEmpty(overview: Pick<ListsOverview, 'following'>): boolean {
  return overview.following.length === 0
}

// ---- "Bald": a horizontal rail of the next 60 days -------------------------------------------------------

function SoonRail({ entries, userId }: { entries: readonly UpcomingList[]; userId: string }) {
  const { t } = useTranslation('lists')
  const headingId = useId()
  const today = todayKey()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="t-title-2 text-text">{t('lists.friends.soon')}</h2>
      <ul className="lf-rail">
        {entries.map((entry) => (
          <li key={entry.list.id} className="lf-rail-item">
            <SoonCard entry={entry} today={today} userId={userId} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function SoonCard({ entry, today, userId }: { entry: UpcomingList; today: string; userId: string }) {
  const { t, i18n } = useTranslation('lists')
  const owner = entry.owner.display_name?.trim() || null
  return (
    <FriendListCard
      listId={entry.list.id}
      userId={userId}
      title={entry.list.title?.trim() || t('lists.card.untitled')}
      tone={coverToneOf(entry.list.cover_tone, entry.list.id)}
      icon={entry.list.cover_icon}
      photo={entry.list.photo}
      count={entry.list.wish_count}
      date={dateWords(entry.date, i18n.resolvedLanguage ?? 'de', today)}
      by={owner ? t('lists.friends.by', { name: owner }) : null}
      fresh={0}
    />
  )
}

/**
 * A list someone shares with me ("Bald" and under each person): its cover photo (or tone + symbol), the title,
 * who it is from, the little wish picture and "3 neu". Nothing about my own reservations (§2.4: the person a
 * gift is for, glancing at my phone, would read it) — those live on the list's screen and in "Meine Geschenkpläne".
 */
function FriendListCard({ listId, userId, title, tone, icon, photo, count, date, by, fresh }: {
  listId: string
  userId: string
  title: string
  tone: TileTone
  icon: CoverIcon | null
  photo: ListPhotoMeta | null | undefined
  count: number
  date: DateWords | null
  by: string | null
  fresh: number
}) {
  const { t } = useTranslation('lists')
  const tap = useTapScale(0.97)
  const spring = useSpring('snappy')
  const reduced = useReducedMotionPref()
  const slot = useRef<HTMLDivElement>(null)
  const photoRef = useRef<HTMLSpanElement>(null)
  const visible = useInView(slot)
  const cover = useListCover(listId, photo, visible)
  const hasCover = showsCover(cover)
  const preview = useListPreview(listId, userId, visible && count > 0)
  const dateChip = date && date.kind !== 'past' ? <DateChip words={date} /> : null
  return (
    <div ref={slot} className="lc-slot">
      <MotionLink
        to="/lists/$listId"
        params={{ listId }}
        className="lc-card lf-card glass-panel"
        data-tone={tone}
        data-photo={hasCover ? '' : undefined}
        whileTap={tap}
        transition={spring}
        onPointerDown={() => haptic('tap')}
        onClick={() => {
          if (hasCover && !reduced) nameOpenedCover(listId, photoRef.current)
        }}
      >
        {hasCover ? (
          <>
            <CardCover cover={cover} photoRef={photoRef} named={!reduced && lastOpenedList() === listId} />
            {dateChip ? <span className="lc-meta">{dateChip}</span> : null}
          </>
        ) : (
          <span className="lf-soon-top">
            <CoverTile tone={tone} icon={icon} size={36} />
            {dateChip}
          </span>
        )}
        <span className="lc-body">
          <span className="lc-title">{title}</span>
          {by ? <span className="lc-by">{by}</span> : null}
          <span className="lf-stack-row">
            <CountStack count={count} preview={preview} seed={listId} onPhoto={hasCover} />
            {fresh > 0 ? <span className="lf-new-count">{t('lists.friends.new_count', { count: fresh })}</span> : null}
          </span>
        </span>
      </MotionLink>
    </div>
  )
}

// ---- one person I follow ------------------------------------------------------------------------------

function PersonBlock({ person, userId, level = 2 }: { person: FollowedPerson; userId: string; level?: 2 | 3 }) {
  const { t } = useTranslation('lists')
  // under the "Abonniert" heading the person's name is one level deeper
  const Heading = level === 3 ? 'h3' : 'h2'
  const [why, setWhy] = useState(false)
  const reduced = useReducedMotionPref()
  const name = person.profile.display_name?.trim() || t('lists.header.name_fallback')
  const fresh = person.lists.some((list) => list.new_wish_count > 0)
  const headingId = useId()
  const whyId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="lf-person">
        {/* avatar and name open the person's profile (Felix 25.10); the name is the one link screen readers hear */}
        <PressLink to="/people/$profileId" params={{ profileId: person.profile.id }} className="lf-person-avatar" tabIndex={-1} aria-hidden="true">
          <ProfileAvatar seed={person.profile.id} name={person.profile.display_name} size={44}>
            <AvatarPhoto profileId={person.profile.id} meta={person.profile.photo} />
          </ProfileAvatar>
        </PressLink>
        <div className="lf-person-text">
          <div className="lf-person-line">
            <Heading id={headingId} className="lf-person-name">
              <PressLink to="/people/$profileId" params={{ profileId: person.profile.id }} className="lf-person-link">{name}</PressLink>
            </Heading>
            {fresh ? (
              <span className="lf-new-dot" role="img" aria-label={t('lists.friends.new_dot')} />
            ) : null}
          </div>
          {person.mutual ? (
          <span className="lf-direction lf-direction-mutual">{t('lists.friends.mutual')}</span>
        ) : (
          <button
            type="button"
            className="lf-direction"
            aria-expanded={why}
            aria-controls={whyId}
            onPointerDown={() => haptic('tap')}
            onClick={() => setWhy((value) => !value)}
          >
            {t('lists.friends.one_way')}
          </button>
        )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {why ? (
          <m.p
            key="why"
            id={whyId}
            className="lf-why"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={fade}
          >
            {t('lists.friends.one_way_hint', { name })}
          </m.p>
        ) : null}
      </AnimatePresence>
      {person.lists.length > 0 ? (
        <ul className="lf-rail">
          {person.lists.map((list) => (
            <li key={list.id} className="lf-rail-item lf-rail-item-small">
              <FollowedCard list={list} userId={userId} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="lf-none">
          {name} {t('lists.friends.no_lists')}
        </p>
      )}
    </section>
  )
}

function FollowedCard({ list, userId }: { list: FollowedListCard; userId: string }) {
  const { i18n } = useTranslation('lists')
  return (
    <FriendListCard
      listId={list.id}
      userId={userId}
      title={list.title}
      tone={coverToneOf(list.cover_tone, list.id)}
      icon={list.cover_icon}
      photo={list.photo}
      count={list.wish_count}
      date={list.due_on ? dateWords(list.due_on, i18n.resolvedLanguage ?? 'de') : null}
      by={null}
      fresh={list.new_wish_count}
    />
  )
}

// ---- "Aus deinen Anlässen" -------------------------------------------------------------------------------

type AskState = 'idle' | 'busy' | 'requested' | 'following'

function Suggestions({ userId, suggestions }: { userId: string; suggestions: readonly FollowSuggestion[] }) {
  const { t } = useTranslation('lists')
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="t-title-2 text-text">{t('lists.friends.suggestions')}</h2>
      {suggestions.length > 0 ? (
        <ul className="glass-panel lf-suggestions">
          {suggestions.map((suggestion) => (
            <SuggestionRow key={suggestion.profile.id} userId={userId} suggestion={suggestion} />
          ))}
        </ul>
      ) : (
        <div className="glass-panel lf-suggest-empty">
          <p className="t-subhead text-text-2">{t('lists.friends.suggestions_empty')}</p>
          <PressLink to="/settings" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            {t('lists.friends.suggestions_settings')}
          </PressLink>
        </div>
      )}
    </section>
  )
}

function SuggestionRow({ userId, suggestion }: { userId: string; suggestion: FollowSuggestion }) {
  const { t } = useTranslation('lists')
  const online = useOnline()
  const [state, setState] = useState<AskState>('idle')
  const working = useRef(false)
  const name = suggestion.profile.display_name?.trim() || t('lists.header.name_fallback')

  async function ask() {
    if (working.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    working.current = true
    setState('busy')
    try {
      // not optimistic: the server decides (shared occasion, no block); the answer is the same for "waiting"
      const status = await requestFollow(suggestion.profile.id, userId)
      if (!epoch.isCurrent()) return
      setState(status)
      feedback('success')
      toast.success(status === 'following' ? t('lists.friends.following_now', { name }) : t('lists.friends.requested_toast', { name }))
    } catch (err) {
      if (!epoch.isCurrent()) return
      setState('idle')
      const error = toAppError(err)
      feedback('error')
      toast.error(t(error.key, error.params))
    } finally {
      working.current = false
    }
  }

  return (
    <li className="lf-suggestion">
      <ProfileAvatar seed={suggestion.profile.id} name={suggestion.profile.display_name} size={40}>
        <AvatarPhoto profileId={suggestion.profile.id} meta={suggestion.profile.photo} />
      </ProfileAvatar>
      <span className="lf-suggestion-text">
        <span className="block truncate t-headline text-text">{name}</span>
        <span className="block truncate t-footnote text-text-2">{t('lists.friends.suggestion_from', { occasion: suggestion.shared_occasion_title })}</span>
      </span>
      {/* at 320 px the button goes under the text (lists.css): who and from which occasion stay readable */}
      <span className="lf-suggestion-action">
        {state === 'requested' || state === 'following' ? (
          <span className="lf-asked" role="status">
            <IconCheck size={16} />
            {t('lists.friends.requested')}
          </span>
        ) : (
          <Button size="sm" variant="secondary" loading={state === 'busy'} disabled={!online} onClick={() => void ask()}>
            {t('lists.friends.request')}
          </Button>
        )}
      </span>
    </li>
  )
}

// ---- "Meine Geschenkpläne": collapsed, no number; the plans load only on a tap ---------------------------

function GiftPlansToggle({ userId }: { userId: string }) {
  const { t } = useTranslation('lists')
  const reduced = useReducedMotionPref()
  const snappy = useSpring('snappy')
  // open / closed lives in this component only (never stored, §2.4)
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        className="lf-plans-toggle glass-panel"
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={() => haptic('tap')}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="block t-headline text-text">{t('lists.friends.plans')}</span>
          <span className="block t-footnote text-text-2">{t('lists.friends.plans_hint')}</span>
        </span>
        <m.span aria-hidden="true" className="inline-flex text-text-2" initial={false} animate={{ rotate: open ? 90 : 0 }} transition={reduced ? { duration: 0 } : snappy}>
          <IconForward size={18} />
        </m.span>
      </button>
      {open ? (
        <div id={panelId}>
          <Suspense fallback={<Skeleton height={64} rounded="lg" />}>
            <GiftPlans userId={userId} />
          </Suspense>
        </div>
      ) : null}
    </section>
  )
}

// ---- empty: Tapsi with binoculars ------------------------------------------------------------------------

const NightSleeper = lazy(() => import('../mascot-ui/NightSleeper'))
/** The box of <Mascot size="m"> (Mascot.tsx): the night Tapsi takes exactly its place. */
const TAPSI_BOX = { '--mascot-w': '160px', aspectRatio: '400 / 250' } as CSSProperties
/** His box fills the host (the same size as by day). */
function placeFill(m: NightMascot): void {
  m.rig.box.style.left = '0px'
  m.rig.box.style.top = '0px'
}

function FriendsEmpty({ onShare, onEnterCode }: { onShare: () => void; onEnterCode?: () => void }) {
  const { t } = useTranslation('lists')
  const titleId = useId()
  const mascots = useBunniesShown()
  // Weniger / Aus: the speck never moves, so he is no button then (a control that does nothing)
  const reduced = useReducedMotionPref()
  // at night he sleeps here, the binoculars on his tummy (mascot-ui/NightSleeper.tsx); once asleep here he stays
  // the night's Tapsi until the card goes (07:00: he wakes up in front of you). Not known yet (a moment after
  // mount): the day's Tapsi — his chunk is still loading then, nothing of him shows before the night one takes over
  const night = useNightLatch()
  return (
    <section aria-labelledby={titleId} className="glass-panel lf-empty">
      {/* Tapsi looks out for friends through binoculars, held in his own two paws (the package's
          `holding`): a calm look-around loop while his idle runs — the stage's one animating mascot, paused
          offscreen and in a hidden tab; "Kaninchen zeigen" off: none. 27.10 (Felix 26.10 «Пылинка … нравится»):
          ONLY a tap / Enter answers — he lowers them and brushes a speck off a lens (the package's 'speck'); never
          by itself. Weniger: the binoculars rest lowered, ^ ^, a tap moves nothing.
          23:00 – 07:00 («Nachts schlafen»): asleep, binoculars on his tummy; a tap wakes him (then 10 min awake, a tap
          is the speck again), Weniger: the still sleeping pose */}
      {mascots && night ? (
        <Suspense fallback={<div aria-hidden="true" className="mascot-box block" data-mascot-size="m" style={TAPSI_BOX} />}>
          <NightSleeper kind="hamster" binoculars size={160} fit sizeName="m" live={night.live}
            label={reduced ? undefined : t('lists.friends.tapsi_label')} awakeScene={playsInApp('speck') ? 'speck' : undefined}
            place={placeFill} className="mascot-box relative block overflow-visible" style={TAPSI_BOX} />
        </Suspense>
      ) : mascots ? (
        playsInApp('speck') && !reduced
          ? <Mascot kind="hamster" size="m" holding="binoculars" momentClass="illustration" interactive tapScene="speck" label={t('lists.friends.tapsi_label')} />
          : <Mascot kind="hamster" size="m" holding="binoculars" momentClass="illustration" />
      ) : null}
      <h2 id={titleId} className="t-title-2 text-text">{t('lists.friends.empty_title')}</h2>
      <Button size="lg" fullWidth onClick={onShare}>
        {t('lists.friends.empty_share')}
      </Button>
      {onEnterCode ? (
        <Button size="lg" fullWidth variant="secondary" onClick={onEnterCode}>
          {t('lists.friends.empty_enter')}
        </Button>
      ) : null}
      <div className="lf-how">
        <h3 className="lcs-label">{t('lists.friends.how_title')}</h3>
        <ol className="lf-how-list">
          <li>{t('lists.friends.how_link')}</li>
          <li>{t('lists.friends.how_occasion')}</li>
          <li>{t('lists.friends.how_direction')}</li>
        </ol>
      </div>
      <p className="t-footnote text-text-2 [text-wrap:balance]">{t('lists.friends.no_search')}</p>
    </section>
  )
}

function FriendsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton width={90} height={22} />
      <div className="flex gap-3">
        <Skeleton width={210} height={132} rounded="lg" />
        <Skeleton width={120} height={132} rounded="lg" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton width={40} height={40} rounded="full" />
        <Skeleton width={140} height={18} />
      </div>
      <div className="flex gap-3">
        <Skeleton width={160} height={120} rounded="lg" />
        <Skeleton width={160} height={120} rounded="lg" />
      </div>
    </div>
  )
}
