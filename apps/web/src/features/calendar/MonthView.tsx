import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { onlineManager, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AnimatePresence, useMotionValue, type MotionValue, type PanInfo } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { FeedOccasion } from '../../lib/api/types'
import { toAppError } from '../../lib/errors'
import { currentLanguage } from '../../lib/i18n'
import { hasSeenHint, markHintSeen, showHint } from '../../lib/hints'
import { feedQuery } from '../../lib/queries'
import { spanText, timeSpan } from '../../lib/occasionTime'
import { browserTimeZone } from '../../lib/time'
import { occasionTransitionName } from '../../lib/viewTransition'
import { springs } from '../../motion/springs'
import { useMotionLevel, type MotionLevel } from '../../motion/useMotionLevel'
import { Button, IconForward, Skeleton, cn, fade, haptic, useBunniesShown, useLayerRoot, useReducedMotionPref, useSpring, useTapScale } from '../../ui'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { GlyphChevronLeft, GlyphChevronRight } from '../nav/glyphs'
import { MotionLink } from '../shell/MotionLink'
import { requestInviteFocus } from '../occasions/inviteFocus'
import { byStart } from '../feed/model'
import { DateTile } from './DateTile'
import { KindGlyph } from './glyphs'
import {
  addMonths,
  groupByDay,
  longDayLabel,
  monthGrid,
  monthOfDay,
  monthTitle,
  occasionDay,
  occasionZone,
  sameMonth,
  todayKey,
  weekdayLabels,
  type GridDay,
  type YearMonth,
} from './grid'
import { CARRY_DELAY_MS, CARRY_SAFETY_MS, carryOntoDay, dispatchLanded, onLanded } from './landing'
import {
  chipLabel,
  normalizeSelection,
  occasionKind,
  peopleOf,
  personKey,
  type OccasionKind,
  type PeopleSelection,
  type Person,
  type PersonKey,
  type PersonTone,
} from './people'
import { PeopleFilter } from './PeopleFilter'
import { HostLine, PersonDot } from './PersonMark'
import {
  lastCalendarFilter,
  lastCalendarOpened,
  lastCalendarView,
  rememberCalendarFilter,
  rememberCalendarOpened,
  rememberCalendarView,
} from './session'
import './calendar.css'

// the comic card «Pompon & Tapsi» under the agenda and its reader (features/comic): a small chunk of their own
const ComicStart = lazy(() => import('../comic/ComicStartSlot'))

// Start's "Monat" view (wave 2; the calendar tab of wave 1, reference (a) in our light style) — a lazy chunk of
// the Start screen (features/feed/FeedPage). A month grid, Monday first, today ringed, weekends a shade
// warmer; every day shows what is on it from afar: up to two chips in the colour of the person it belongs to
// (you = the accent; people.ts), a glyph for the kind (a cake for birthdays, a sparkle otherwise) and a short
// word ("Milas", "Grillabend"), "+N" for more. Above the month a people filter ("Alle · Du · Anna · …": tap
// people to see only theirs). Month change by swipe and chevrons (springs), "Heute" in Start's top bar; tap a
// day → its occasions below in a frosted list (no day chosen → the whole month), tap one → its page.
// Data: the feed query only (upcoming + the past 30 days) — months without data simply show no chips.
// K10: every day cell carries data-day; `created` opens that occasion's month and day, marks its cell as the
// landing target and lets the bunny carry it there (landing.ts). Nothing here is about reservations.

const SWIPE_RATIO = 0.18
/** px between two months in the strip (calendar.css .cal-strip column-gap): a visible seam while swiping */
const MONTH_GAP = 16
const SWIPE_VELOCITY = 350
/** chips a day cell shows before "+N" (the second slot becomes "+N" when there are more) */
const CHIP_SLOTS = 2

/**
 * Glides the month strip to `to` with the smooth spring of springs.ts, from the finger's speed (semi-implicit
 * Euler, 4 ms sub-steps). A few lines of our own instead of motion's animate(): no extra chunk for the
 * shared entry to list (invite landing budget). Returns stop().
 */
function glide(x: MotionValue<number>, to: number, velocity: number, onDone: () => void): () => void {
  const { stiffness, damping, mass } = springs.smooth
  x.stop()
  let position = x.get()
  let v = velocity
  let last = performance.now()
  let frame = 0
  const step = (now: number) => {
    const dt = Math.min(0.064, Math.max(0, (now - last) / 1000))
    last = now
    const steps = Math.max(1, Math.ceil(dt / 0.004))
    for (let i = 0; i < steps; i += 1) {
      v += ((-stiffness * (position - to) - damping * v) / mass) * (dt / steps)
      position += v * (dt / steps)
    }
    if (Math.abs(v) < 10 && Math.abs(position - to) < 0.5) {
      x.set(to)
      onDone()
      return
    }
    x.set(position)
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}

type Occasions = Map<string, FeedOccasion[]>

interface Landing {
  occasionId: string
  day: string
  landed: boolean
}

/** What a chip shows, worked out once per occasion. */
interface ChipFace {
  person: PersonKey
  tone: PersonTone
  kind: OccasionKind
  label: string
}

/** "Heute" lives in Start's top bar: the month view tells it whether it shows and what it does. */
export interface TodayControl {
  visible: boolean
  go: () => void
}

function useToday(zone: string): string {
  const [today, setToday] = useState(() => todayKey(Date.now(), zone))
  // a calendar left open over midnight moves its "today" (checked when the tab becomes visible again)
  useEffect(() => {
    const update = () => setToday(todayKey(Date.now(), zone))
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [zone])
  return today
}

/**
 * The occasions a cell shows as chips: the first CHIP_SLOTS — or, with more, the first one and "+N". The landing
 * occasion (K10) is always among them, so the bunny's card has a chip to become.
 */
function chipsOf(items: readonly FeedOccasion[], landingId: string | null): { shown: FeedOccasion[]; hidden: FeedOccasion[] } {
  if (items.length <= CHIP_SLOTS) return { shown: [...items], hidden: [] }
  const shown = items.slice(0, CHIP_SLOTS - 1)
  const landing = landingId ? items.find((item) => item.id === landingId) : undefined
  if (landing && !shown.includes(landing)) shown[shown.length - 1] = landing
  return { shown, hidden: items.filter((item) => !shown.includes(item)) }
}

/** The colours of the people behind "+N" (each once, at most three): "+2" still says who. */
function hiddenTones(hidden: readonly FeedOccasion[], faces: ReadonlyMap<string, ChipFace>): PersonTone[] {
  const tones: PersonTone[] = []
  for (const occasion of hidden) {
    const tone = faces.get(occasion.id)?.tone
    if (tone !== undefined && !tones.includes(tone)) tones.push(tone)
  }
  return tones.slice(0, 3)
}

const DayCell = memo(function DayCell({
  day,
  occasions,
  faces,
  today,
  selected,
  interactive,
  landing,
  preview,
  locale,
  onSelect,
}: {
  day: GridDay
  occasions: FeedOccasion[]
  faces: ReadonlyMap<string, ChipFace>
  today: boolean
  selected: boolean
  interactive: boolean
  landing: Landing | null
  /** the people filter's legend effect: a person under the pointer / focus — the others' chips step back */
  preview: PersonKey | null
  locale: string
  onSelect: (day: GridDay) => void
}) {
  const { t } = useTranslation('nav')
  const date = longDayLabel(day.key, locale)
  const label = today
    ? occasions.length > 0
      ? t('cal.cell_today_count', { date, count: occasions.length })
      : t('cal.cell_today', { date })
    : occasions.length > 0
      ? t('cal.cell_count', { date, count: occasions.length })
      : t('cal.cell', { date })
  const isLanding = landing?.day === day.key
  const { shown, hidden } = chipsOf(occasions, isLanding ? (landing?.occasionId ?? null) : null)
  return (
    <button
      type="button"
      className="cal-day"
      data-day={day.key}
      data-outside={day.inMonth ? undefined : ''}
      data-today={today ? '' : undefined}
      data-weekend={day.weekday >= 5 ? '' : undefined}
      data-landing={isLanding ? '' : undefined}
      aria-pressed={selected}
      aria-current={today ? 'date' : undefined}
      aria-label={label}
      tabIndex={interactive ? 0 : -1}
      onClick={() => onSelect(day)}
    >
      <span className="cal-num">{day.day}</span>
      <span className="cal-chips" aria-hidden="true">
        {shown.map((occasion) => {
          const face = faces.get(occasion.id)
          if (!face) return null
          const waiting = isLanding && landing?.occasionId === occasion.id
          return (
            <span
              key={occasion.id}
              className="cal-chip person-tone"
              data-person-tone={face.tone}
              data-kind={face.kind}
              data-dim={preview !== null && preview !== face.person ? '' : undefined}
              data-landing-chip={waiting ? '' : undefined}
              data-landed={waiting && landing?.landed ? '' : undefined}
            >
              <KindGlyph kind={face.kind} size={9} className="cal-chip-glyph" />
              <span className="cal-chip-text">{face.label}</span>
            </span>
          )
        })}
        {hidden.length > 0 ? (
          <span className="cal-more">
            {hiddenTones(hidden, faces).map((tone) => (
              <span key={tone} className="cal-more-dot person-tone" data-person-tone={tone} />
            ))}
            <span>{t('cal.more', { count: hidden.length })}</span>
          </span>
        ) : null}
      </span>
    </button>
  )
})

function MonthGrid({
  month,
  byDay,
  faces,
  today,
  selected,
  interactive,
  landing,
  preview,
  locale,
  onSelect,
}: {
  month: YearMonth
  byDay: Occasions
  faces: ReadonlyMap<string, ChipFace>
  today: string
  selected: string | null
  interactive: boolean
  landing: Landing | null
  preview: PersonKey | null
  locale: string
  onSelect: (day: GridDay) => void
}) {
  const weeks = useMemo(() => monthGrid(month), [month])
  return (
    <div className="cal-month" aria-hidden={interactive ? undefined : true} inert={interactive ? undefined : true}>
      {weeks.map((week) => (
        <div key={week[0]?.key} className="cal-week">
          {week.map((day) => (
            <DayCell
              key={day.key}
              day={day}
              occasions={byDay.get(day.key) ?? EMPTY}
              faces={faces}
              today={day.key === today}
              selected={day.key === selected}
              interactive={interactive}
              landing={landing?.day === day.key ? landing : null}
              preview={preview}
              locale={locale}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

const EMPTY: FeedOccasion[] = []

/** "Ganztägig" · "19:00" · "19:00–23:00" · "19:00 bis 02:00 (nächster Tag)" (the end: 20261026180000). */
function whenLine(occasion: FeedOccasion, allDayLabel: string, t: (key: string, options: { start: string; end: string }) => string): string {
  if (occasion.all_day || !Number.isFinite(Date.parse(occasion.starts_at))) return allDayLabel
  return spanText(timeSpan(occasion, occasionZone(occasion)), t)
}

function AgendaRow({ occasion, person, arriving }: { occasion: FeedOccasion; person: Person | undefined; arriving: boolean }) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const tap = useTapScale(0.98)
  const spring = useSpring('snappy')
  const bouncy = useSpring('bouncy')
  const reduced = useReducedMotionPref()
  const name = occasionTransitionName(occasion.id)
  const host = occasion.role === 'host'
  const hostName = host ? '' : (occasion.host_name?.trim() ?? '')
  const who = host ? t('cal.host') : hostName ? t('cal.hosted_by', { name: hostName }) : null
  const place = occasion.place_text?.trim() || null

  function open(event: MouseEvent<HTMLAnchorElement>) {
    // the row and the occasion's hero share a name: the row grows into the hero (view transition)
    event.currentTarget.style.viewTransitionName = name
    rememberCalendarOpened(occasion.id)
    haptic('tap')
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const go = () => void navigate({ to: '/occasions/$occasionId', params: { occasionId: occasion.id } })
    requestAnimationFrame(() => setTimeout(go, 0))
  }

  return (
    <m.li
      className="cal-agenda-item"
      // K10: the occasion the bunny just put on its day drops into the list (the others are simply there)
      initial={arriving ? (reduced ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.96 }) : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...bouncy, opacity: fade }}
    >
      <MotionLink
        to="/occasions/$occasionId"
        params={{ occasionId: occasion.id }}
        preload={false}
        className="cal-row"
        style={lastCalendarOpened() === occasion.id ? { viewTransitionName: name } : undefined}
        whileTap={tap}
        transition={spring}
        onClick={open}
      >
        <DateTile occasion={occasion} />
        <span className="min-w-0 flex-1">
          <span className="block truncate t-headline text-text">{occasion.title}</span>
          <span className="mt-0.5 block truncate t-footnote text-text-2">
            {whenLine(occasion, t('cal.all_day'), t)}
            {place ? ` · ${place}` : ''}
          </span>
          {who ? (
            <span className={cn('mt-1 flex min-w-0 items-center gap-1.5 t-caption-1 font-semibold', host ? 'text-accent-text' : 'text-text-2')}>
              {person ? <PersonDot tone={person.tone} /> : null}
              <HostLine text={who} name={hostName} />
            </span>
          ) : null}
        </span>
        <GlyphChevronRight size={18} className="shrink-0 text-text-3" />
      </MotionLink>
    </m.li>
  )
}

/** The occasions under the grid: the chosen day's, or the whole month's when no day is chosen. */
function Agenda({
  heading,
  items,
  people,
  empty,
  landing,
  viewKey,
}: {
  heading: string
  items: FeedOccasion[]
  people: ReadonlyMap<PersonKey, Person>
  /** the empty card's text and its way on */
  empty: { text: string; action: ReactNode }
  landing: Landing | null
  viewKey: string
}) {
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  // K10: the new occasion is not in the list until the bunny has put it on its day
  const waitingId = landing && !landing.landed ? landing.occasionId : null
  const shown = waitingId ? items.filter((occasion) => occasion.id !== waitingId) : items
  const arrivingId = landing?.landed ? landing.occasionId : null
  // named by its text, not by an id: while one view fades out and the next fades in, both have a heading
  return (
    <section aria-label={heading} className="flex flex-col gap-2">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.div
          key={viewKey}
          className="flex flex-col gap-2"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: fade }}
          transition={{ ...smooth, opacity: fade }}
        >
          <h2 className="px-1 t-title-3 text-text">{heading}</h2>
          {shown.length > 0 ? (
            <ul className="cal-agenda">
              {shown.map((occasion) => (
                <AgendaRow key={occasion.id} occasion={occasion} person={people.get(personKey(occasion))} arriving={occasion.id === arrivingId} />
              ))}
            </ul>
          ) : waitingId ? null : (
            <EmptyAgenda text={empty.text} action={empty.action} />
          )}
        </m.div>
      </AnimatePresence>
    </section>
  )
}

/**
 * True once `ref` lies fully in the part of the screen the floating tab bar leaves free (and stays true): an
 * IntersectionObserver whose bottom margin is the bar's share of the viewport (no bar: the whole viewport).
 */
function useAboveTabBar(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!enabled || seen || !el || typeof IntersectionObserver !== 'function') return
    const barTop = document.querySelector('nav.tabbar')?.getBoundingClientRect().top
    const covered = barTop ? Math.max(0, Math.round(window.innerHeight - barTop)) : 0
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0.98)) setSeen(true)
      },
      { rootMargin: `0px 0px -${covered}px 0px`, threshold: [0.98, 1] },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, enabled, seen])
  return seen
}

/** Bunny host height above the empty card: its bottom edge lies 16 px below the card's top (the paws rest on it). */
// WelcomeStage has a 120 px minimum; keep the reserved space and its clipping edge in agreement.
const EMPTY_BUNNY_PX = 120

/**
 * Nothing on this day / in this month: a frosted card with the way on — and Pompon peeking over its edge (K8:
 * a moment at the screen's quiet places; once per visit, then his calm pose; no bunny and no room for one with
 * "Kaninchen zeigen" off or motion off). He comes only once the bunny's room and the card stand fully in the
 * free area above the floating tab bar: never behind the centred "+", and his once-per-visit peek is never spent
 * out of sight (the room is kept from the start, so nothing moves when he arrives).
 */
function EmptyAgenda({ text, action }: { text: string; action: ReactNode }) {
  const card = useRef<HTMLDivElement>(null)
  const room = useRef<HTMLDivElement>(null)
  const bunnies = useBunniesShown()
  const inView = useAboveTabBar(room, bunnies)
  return (
    <div ref={room} className="relative" style={bunnies ? { paddingTop: EMPTY_BUNNY_PX - 16 } : undefined}>
      {bunnies && inView ? (
        <BunnyMoment
          kind="peek"
          family="screen-host:start"
          calm="still"
          once="visit"
          onceKey="calendar-empty"
          cardRef={card}
          minSize={92}
          maxSize={108}
          className="pointer-events-none absolute inset-x-0 top-0 z-2"
          style={{ height: EMPTY_BUNNY_PX }}
        />
      ) : null}
      <div ref={card} className="cal-empty relative z-1">
        <p className="t-callout text-text-2">{text}</p>
        {action}
      </div>
    </div>
  )
}

function CreateAction() {
  const { t } = useTranslation('nav')
  const tap = useTapScale(0.97)
  const snappy = useSpring('snappy')
  return (
    <MotionLink to="/occasions/new" className="cal-empty-action" whileTap={tap} transition={snappy}>
      {t('cal.create')}
    </MotionLink>
  )
}

function ShowAllAction({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation('nav')
  const tap = useTapScale(0.97)
  const snappy = useSpring('snappy')
  return (
    <m.button type="button" className="cal-empty-action" whileTap={tap} transition={snappy} onClick={onPress}>
      {t('cal.show_all')}
    </m.button>
  )
}

/**
 * K10, after the bunny filed a new occasion: a glass pill right under its row — "Freunde einladen →" opens
 * the occasion with its invite card in focus (occasions/inviteFocus.ts: in memory, never in the URL), so
 * creating flows straight on into inviting. In the flow of the page (never over the row it belongs to); a
 * status line tells screen readers what happened. The pill stays for this visit.
 */
function FiledInvite({ occasion }: { occasion: FeedOccasion }) {
  const { t } = useTranslation(['nav', 'onboarding'])
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  const tap = useTapScale(0.95)
  const snappy = useSpring('snappy')
  const ref = useRef<HTMLDivElement>(null)
  const status = useRef<HTMLParagraphElement>(null)
  const [first] = useState(() => !hasSeenHint('first-occasion'))
  // wishes already added in the form, or an occasion for bring-along only: no "Wünsche eintragen" as the next step
  const [wantsWishes] = useState(() => occasion.wish_count === 0 && occasion.sections !== 'bring')
  // the first-occasion line counts as this session's optional hint (lib/hints.ts: no comic card besides it)
  useEffect(() => (first ? showHint('first-occasion') : undefined), [first])
  // the pill is the next step: it comes into view above the tab bar (calendar.css: scroll-margin)
  useEffect(() => {
    markHintSeen('first-occasion')
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' })
      status.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [reduced])
  return (
    <div ref={ref} className="mt-4 scroll-mb-[calc(var(--nav-bar-space,90px)+var(--sp-2))]">
      <p ref={status} role="status" tabIndex={-1} className="t-callout text-text outline-none">
        {t('cal.filed_status', { title: occasion.title })}
        {first ? <span className="mt-2 block">{t(wantsWishes ? 'onb.first_occasion_done' : 'onb.first_occasion_done_short', { ns: 'onboarding' })}</span> : null}
      </p>
      <m.div
        className="cal-invite flex-wrap"
        initial={reduced ? false : { opacity: 0, y: -10, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...bouncy, opacity: fade }}
      >
        {wantsWishes ? (
          <MotionLink to="/occasions/$occasionId/wishes/new" params={{ occasionId: occasion.id }}
            className="cal-invite-pill glass-float" whileTap={tap} transition={snappy}>
            {t('cal.add_wishes')}
          </MotionLink>
        ) : null}
        <MotionLink
          to="/occasions/$occasionId"
          params={{ occasionId: occasion.id }}
          className="cal-invite-pill glass-float"
          aria-label={t('cal.invite_pill_label', { title: occasion.title })}
          whileTap={tap}
          transition={snappy}
          onClick={() => {
            haptic('tap')
            requestInviteFocus(occasion.id)
          }}
        >
          <span>{t('cal.invite_pill')}</span>
          <IconForward size={18} />
        </MotionLink>
      </m.div>
    </div>
  )
}

export interface MonthViewProps {
  /** `?created=<occasion id>`: open its month and day; its chip waits for the carry animation (K10) */
  created: string | null
  /** drops the `created` search param once the landing is done (a later visit must not replay it) */
  onLandingDone?: () => void
  /** "Heute" in Start's top bar */
  onToday?: (control: TodayControl | null) => void
}

export default function MonthView({ created, onLandingDone, onToday }: MonthViewProps) {
  const { t } = useTranslation('nav')
  const locale = currentLanguage()
  const zone = browserTimeZone()
  const today = useToday(zone)
  const reduced = useReducedMotionPref()
  const query = useQuery({ ...feedQuery(), retryOnMount: false })
  // the comic card's chunk only while it was never closed or opened on this device (decided once per visit)
  const [comicOn] = useState(() => !hasSeenHint('story-1'))
  const remembered = lastCalendarView()
  const [month, setMonth] = useState<YearMonth>(() => remembered?.month ?? monthOfDay(today) ?? { year: 2026, month: 1 })
  const [selected, setSelected] = useState<string | null>(() => remembered?.selected ?? null)
  const [landing, setLanding] = useState<Landing | null>(null)
  // the people filter: null = everyone; else the people whose occasions show (remembered for this page session)
  const [filter, setFilter] = useState<PeopleSelection>(() => lastCalendarFilter())
  const [preview, setPreview] = useState<PersonKey | null>(null)
  // a filter change lets the remaining chips pop in once (not on every month change)
  const [filterPulse, setFilterPulse] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const running = useRef<(() => void) | null>(null)
  /** the month change in flight: its step and the day to select once it landed (null = the month) */
  const pending = useRef<{ delta: number; select: string | null }>({ delta: 0, select: null })
  const resetX = useRef(false)

  const occasions = useMemo(() => [...(query.data?.upcoming ?? []), ...(query.data?.past ?? [])], [query.data])
  const people = useMemo(() => peopleOf(occasions, { withMe: true }), [occasions])
  const peopleByKey = useMemo(() => new Map(people.map((person) => [person.key, person])), [people])
  const faces = useMemo(() => {
    const map = new Map<string, ChipFace>()
    for (const occasion of occasions) {
      const person = personKey(occasion)
      const kind = occasionKind(occasion.title)
      map.set(occasion.id, { person, tone: peopleByKey.get(person)?.tone ?? 'me', kind, label: chipLabel(occasion.title, kind) })
    }
    return map
  }, [occasions, peopleByKey])
  // people who left the feed drop out of the filter (nobody left = everyone)
  const activeFilter = useMemo(() => normalizeSelection(filter, people), [filter, people])
  const visible = useMemo(
    () => (activeFilter ? occasions.filter((occasion) => activeFilter.has(personKey(occasion))) : occasions),
    [occasions, activeFilter],
  )
  // each day in Start's order (feed/model byStart: the same start by title, never the server's random tie)
  const byDay = useMemo(() => {
    const days = groupByDay(visible, zone)
    for (const items of days.values()) items.sort(byStart)
    return days
  }, [visible, zone])

  useEffect(() => {
    rememberCalendarView({ month, selected })
  }, [month, selected])
  useEffect(() => {
    rememberCalendarFilter(activeFilter)
  }, [activeFilter])

  const changeFilter = useCallback((next: PeopleSelection) => {
    setFilter(next)
    setFilterPulse((value) => value + 1)
  }, [])

  // after a month change committed, the strip is re-centred in the same frame (no flash of the old month)
  useLayoutEffect(() => {
    if (!resetX.current) return
    resetX.current = false
    x.jump(0)
  }, [month, x])

  const commit = useCallback((delta: number, select: string | null) => {
    if (delta === 0) return
    resetX.current = true
    setMonth((current) => addMonths(current, delta))
    setSelected(select)
  }, [])

  const go = useCallback(
    (delta: number, velocity = 0, select: string | null = null) => {
      if (delta === 0) return
      const width = viewport.current?.clientWidth ?? 0
      if (running.current) {
        // interrupt: the running change lands at once, the new one starts from there
        running.current()
        running.current = null
        commit(pending.current.delta, pending.current.select)
        pending.current = { delta: 0, select: null }
      }
      haptic('select')
      if (reduced || width === 0) {
        commit(delta, select)
        return
      }
      pending.current = { delta, select }
      running.current = glide(x, -delta * (width + MONTH_GAP), velocity, () => {
        running.current = null
        const done = pending.current
        pending.current = { delta: 0, select: null }
        commit(done.delta, done.select)
      })
    },
    [commit, reduced, x],
  )

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const width = viewport.current?.clientWidth ?? 0
    const offset = info.offset.x
    const velocity = info.velocity.x
    if (offset < -width * SWIPE_RATIO || velocity < -SWIPE_VELOCITY) go(1, velocity)
    else if (offset > width * SWIPE_RATIO || velocity > SWIPE_VELOCITY) go(-1, velocity)
    // not far enough: the drag's own constraint springs the strip back to its place
  }

  const toToday = () => {
    const target = monthOfDay(today)
    setSelected(null)
    if (!target || sameMonth(target, month)) return
    const delta = (target.year - month.year) * 12 + (target.month - month.month)
    if (Math.abs(delta) === 1) go(delta)
    else {
      haptic('select')
      setMonth(target)
    }
  }
  const toTodayRef = useRef(toToday)
  useLayoutEffect(() => {
    toTodayRef.current = toToday
  })

  // the cells are memoised: their handler stays the same function and reads the shown month from a ref
  const monthRef = useRef(month)
  useLayoutEffect(() => {
    monthRef.current = month
  }, [month])
  const onSelect = useCallback(
    (day: GridDay) => {
      if (!day.inMonth) {
        // a greyed neighbour day: that month slides in with the day chosen
        const target = monthOfDay(day.key)
        const shown = monthRef.current
        if (target) go((target.year - shown.year) * 12 + (target.month - shown.month), 0, day.key)
        return
      }
      haptic('select')
      // the chosen day again: back to the whole month
      setSelected((current) => (current === day.key ? null : day.key))
    },
    [go],
  )

  // K10: `created` — once the occasion is in the feed: its month, its day, the landing target; everyone shows
  // (a filter must never hide the occasion the bunny is bringing)
  const [handledCreated, setHandledCreated] = useState<string | null>(null)
  if (created && handledCreated !== created) {
    const occasion = occasions.find((item) => item.id === created)
    const day = occasion ? occasionDay(occasion, zone) : null
    const target = day ? monthOfDay(day) : null
    if (occasion && day && target) {
      setHandledCreated(created)
      setMonth(target)
      setSelected(day)
      setFilter(null)
      setLanding({ occasionId: occasion.id, day, landed: false })
    }
  }

  // the carry animation reports the landing (landing.ts: dispatchLanded); the chip and the row appear then
  const landingId = landing && !landing.landed ? landing.occasionId : null
  useEffect(() => {
    if (!landingId) return
    const land = () => setLanding((current) => (current && current.occasionId === landingId ? { ...current, landed: true } : current))
    return onLanded((id) => {
      if (id === landingId) land()
    })
  }, [landingId])

  // K10: the bunny files the new occasion — full motion: it carries the card from the "+" onto the day
  // (lazy carry chunk, one mascot at a time, any tap skips); reduced: the chip and the row only fade in
  // once the screen is there; off: they are just there. The level is read when the landing starts.
  const motionLevel = useMotionLevel()
  const levelRef = useRef<MotionLevel>(motionLevel)
  useEffect(() => {
    levelRef.current = motionLevel
  }, [motionLevel])
  const layer = useLayerRoot()
  useEffect(() => {
    if (!landingId) return
    const id = landingId
    let alive = true
    const controller = new AbortController()
    const finish = () => {
      if (alive) {
        alive = false
        dispatchLanded(id)
        controller.abort()
      }
    }
    const level = levelRef.current
    const timers: number[] = []
    if (level !== 'full') {
      finish()
    } else {
      // a show that never reports back still ends with the chip on its day
      timers.push(window.setTimeout(finish, CARRY_SAFETY_MS))
      timers.push(
        window.setTimeout(() => {
          const cell = viewport.current?.querySelector('[data-landing]')
          if (!cell) return finish()
          // the card is yours: it flies in your colour and becomes your chip on the day
          void carryOntoDay(cell, layer, controller.signal).then(finish)
        }, CARRY_DELAY_MS),
      )
    }
    return () => {
      alive = false
      controller.abort()
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [landingId, layer])

  const landed = landing?.landed === true
  useEffect(() => {
    if (landed) onLandingDone?.()
  }, [landed, onLandingDone])
  const filed = landed ? occasions.find((item) => item.id === landing?.occasionId) ?? null : null

  const title = monthTitle(month, locale)
  const weekdays = useMemo(() => weekdayLabels(locale), [locale])
  const showsToday = sameMonth(monthOfDay(today) ?? month, month) && selected === null
  const prev = addMonths(month, -1)
  const next = addMonths(month, 1)

  // "Heute" in Start's top bar
  useEffect(() => {
    onToday?.({ visible: !showsToday, go: () => toTodayRef.current() })
  }, [onToday, showsToday])
  useEffect(() => () => onToday?.(null), [onToday])

  const monthItems = useMemo(() => {
    const list: FeedOccasion[] = []
    for (const [day, items] of byDay) {
      const ym = monthOfDay(day)
      if (ym && sameMonth(ym, month)) list.push(...items)
    }
    return list.sort(byStart)
  }, [byDay, month])
  const dayItems = selected ? (byDay.get(selected) ?? []) : monthItems
  const filtered = activeFilter !== null
  // a day or a month that is over: nothing can be created there any more (and "noch nichts geplant" would be odd)
  const thisMonth = monthOfDay(today)
  const over = selected ? selected < today : !!thisMonth && month.year * 12 + month.month < thisMonth.year * 12 + thisMonth.month
  const empty = {
    text: filtered
      ? t(selected ? 'cal.empty_day_filtered' : 'cal.month_empty_filtered')
      : t(over ? (selected ? 'cal.past_day' : 'cal.past_month') : selected ? 'cal.empty_day' : 'cal.month_empty'),
    action: filtered ? <ShowAllAction onPress={() => changeFilter(null)} /> : over ? null : <CreateAction />,
  }

  let notice: ReactNode = null
  if (!query.data) {
    if (query.isError) {
      notice = (
        <div role="alert" className="cal-empty">
          <p className="t-callout text-text-2">{t('cal.error')}</p>
          <p className="t-footnote text-text-3">{t(toAppError(query.error).key)}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('cal.retry')}
          </Button>
        </div>
      )
    } else if (!onlineManager.isOnline() || query.fetchStatus === 'paused') {
      notice = <p role="status" className="cal-empty t-callout text-text-2">{t('cal.offline')}</p>
    } else {
      // the feed is on its way (usually it is cached already): quiet rows, never a spinner
      notice = (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span role="status" className="sr-only">{t('newmenu.loading')}</span>
          <div aria-hidden="true" className="cal-agenda">
            {[0, 1].map((row) => (
              <div key={row} className="cal-row">
                <Skeleton width={56} height={64} rounded="md" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton width="58%" height={16} />
                  <Skeleton width="40%" height={12} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* the people filter: only where there is someone to tell apart (you and at least one friend) */}
      {people.length > 1 ? <PeopleFilter people={people} selection={activeFilter} onChange={changeFilter} onPreview={setPreview} /> : null}
      <section aria-label={title} className="cal-card">
        <div className="cal-head">
          <h2 className="cal-title t-title-2 text-text" aria-live="polite">
            {title}
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" className="cal-nav" aria-label={t('cal.prev')} onClick={() => go(-1)}>
              <GlyphChevronLeft size={22} />
            </button>
            <button type="button" className="cal-nav" aria-label={t('cal.next')} onClick={() => go(1)}>
              <GlyphChevronRight size={22} />
            </button>
          </div>
        </div>
        <div className="cal-weekdays" aria-hidden="true">
          {weekdays.map((label, index) => (
            <span key={index} data-weekend={index >= 5 ? '' : undefined}>
              {label}
            </span>
          ))}
        </div>
        {/* data-swipe-own: a sideways swipe here turns the month, never the tab (features/nav/tabSwipeRules.ts) */}
        <div ref={viewport} className="cal-viewport" role="group" aria-label={t('cal.grid')} data-filter-pulse={filterPulse || undefined} data-swipe-own="">
          <m.div
            className="cal-strip"
            style={{ x, touchAction: 'pan-y' }}
            drag={reduced ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={1}
            dragMomentum={false}
            onDragEnd={onDragEnd}
          >
            <MonthGrid month={prev} byDay={byDay} faces={faces} today={today} selected={selected} interactive={false} landing={null} preview={null} locale={locale} onSelect={onSelect} />
            {/* a filter change remounts the shown month's chips once, so they pop in (calendar.css) */}
            <MonthGrid key={filterPulse} month={month} byDay={byDay} faces={faces} today={today} selected={selected} interactive landing={landing} preview={preview} locale={locale} onSelect={onSelect} />
            <MonthGrid month={next} byDay={byDay} faces={faces} today={today} selected={selected} interactive={false} landing={null} preview={null} locale={locale} onSelect={onSelect} />
          </m.div>
        </div>
      </section>
      {notice ?? (
        <Agenda
          viewKey={`${selected ?? `${month.year}-${month.month}`}:${filterPulse}`}
          heading={selected ? longDayLabel(selected, locale) : t('cal.in_month', { month: title })}
          items={dayItems}
          people={peopleByKey}
          empty={empty}
          landing={landing}
        />
      )}
      {filed ? <FiledInvite occasion={filed} /> : null}
      {/* the comic card «Pompon & Tapsi» under the month's agenda (features/comic/rules.ts says when) and its reader */}
      {comicOn && query.data ? <Suspense fallback={null}><ComicStart feed={query.data} /></Suspense> : null}
    </div>
  )
}
