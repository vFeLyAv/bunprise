import { LIMITS } from '../../lib/app'
import type { PlacePoint } from '../../lib/api/places'
import type { FeedOccasion, FeedScreen, OccasionInput, OccasionScreen, Rsvp } from '../../lib/api/types'
import { endsAtFor } from '../../lib/occasionTime'
import { dayKey, isoToZonedWallTime, zonedWallTimeToIso } from '../../lib/time'

// Pure logic of the occasion form (product-pilot S6, F4; pilot-decisions §7 limits).
// No React here, so validation and the optimistic screen shapes are unit-testable.

export interface OccasionFormValues {
  title: string
  /** "YYYY-MM-DD" in the occasion's zone ('' = not chosen yet) */
  date: string
  /** "HH:mm"; ignored while allDay is true */
  time: string
  /**
   * The end time (20261026180000), ignored while allDay is true: "HH:mm", '' = no end, null = unknown (the screen
   * came from a server without ends_at: the form offers no end and saving leaves the stored one alone).
   * An end earlier than `time` lies on the next day (lib/occasionTime.ts).
   */
  end: string | null
  allDay: boolean
  place: string
  /**
   * Where `place` is (20261027190000): the point of a suggestion picked WITH one, or the stored point of an opened
   * occasion. Missing / null = none (typed text, a recent place, the map switch off). The place row keeps the two in step.
   */
  point?: PlacePoint | null
  description: string
}

export type OccasionField = 'title' | 'date' | 'time' | 'end' | 'place' | 'description'
export type OccasionFieldError =
  | 'title_required'
  | 'title_too_long'
  | 'date_required'
  | 'date_invalid'
  | 'date_past'
  | 'time_required'
  | 'end_same'
  | 'end_invalid'
  | 'too_long'
export type OccasionFormErrors = Partial<Record<OccasionField, OccasionFieldError>>

/** Suggested start time when "all day" is switched off (product S6). */
export const DEFAULT_TIME = '19:00'

/** Field order = focus order for the first invalid field. */
export const FIELD_ORDER: readonly OccasionField[] = ['title', 'date', 'time', 'end', 'place', 'description']

export function emptyOccasionValues(): OccasionFormValues {
  return { title: '', date: '', time: DEFAULT_TIME, end: '', allDay: true, place: '', description: '' }
}

/** Form values of an existing occasion, as wall time in the occasion's own zone. */
export function valuesFromOccasion(occasion: OccasionScreen['occasion']): OccasionFormValues {
  const { date, time } = isoToZonedWallTime(occasion.starts_at, occasion.tz)
  return {
    title: occasion.title,
    date,
    time: occasion.all_day ? DEFAULT_TIME : time,
    end: endValueOf(occasion),
    allDay: occasion.all_day,
    place: occasion.place_text ?? '',
    ...pointOfOccasion(occasion),
    description: occasion.description ?? '',
  }
}

/** `{ point }` when the screen carries a stored point (20261027190000); nothing otherwise. */
function pointOfOccasion(occasion: OccasionScreen['occasion']): { point?: PlacePoint } {
  const { place_lat: lat, place_lon: lon } = occasion
  return typeof lat === 'number' && typeof lon === 'number' && occasion.place_text ? { point: { lat, lon } } : {}
}

/** The form's end: the wall time of ends_at in the occasion's zone; '' = none; null = the server sent no ends_at. */
function endValueOf(occasion: OccasionScreen['occasion']): string | null {
  if (occasion.ends_at === undefined) return null
  return !occasion.all_day && occasion.ends_at ? isoToZonedWallTime(occasion.ends_at, occasion.tz).time : ''
}

/** Unicode code points — what Postgres length() counts, so client and database agree on limits. */
export function charCount(value: string): number {
  return Array.from(value).length
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/

function isCalendarDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false
  const [y = 0, m = 0, d = 0] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** The earliest date a new occasion may have: yesterday in that zone (slack for time zones, product S6). */
export function earliestDate(timeZone: string, now: Date = new Date()): string {
  const [y = 1970, m = 1, d = 1] = dayKey(now, timeZone).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

export interface ValidateOptions {
  /** IANA zone the date is entered in (browser zone for new occasions, the occasion's zone when editing) */
  timeZone: string
  now?: Date
  /** edit: an unchanged date may stay in the past (e.g. fixing the description afterwards) */
  originalDate?: string
}

/** Inline errors (i18n keys in the `occasion` group); an empty object means the form can be saved. */
export function validateOccasion(values: OccasionFormValues, options: ValidateOptions): OccasionFormErrors {
  const errors: OccasionFormErrors = {}
  const title = values.title.trim()
  if (title === '') errors.title = 'title_required'
  else if (charCount(title) > LIMITS.occasionTitle) errors.title = 'title_too_long'

  if (values.date === '') errors.date = 'date_required'
  else if (!isCalendarDate(values.date)) errors.date = 'date_invalid'
  else if (values.date !== options.originalDate && values.date < earliestDate(options.timeZone, options.now)) {
    errors.date = 'date_past'
  }

  if (!values.allDay && !TIME_SHAPE.test(values.time)) errors.time = 'time_required'
  if (!values.allDay && values.end) {
    if (!TIME_SHAPE.test(values.end)) errors.end = 'end_invalid'
    else if (values.end === values.time) errors.end = 'end_same'
    else if (!errors.date && !errors.time) {
      // a daylight-saving night can still turn the two clock times around: the instants decide (like the database)
      const starts = Date.parse(zonedWallTimeToIso(values.date, values.time, options.timeZone))
      if (Date.parse(endsAtFor(values.date, values.time, values.end, options.timeZone)) <= starts) errors.end = 'end_same'
    }
  }
  if (charCount(values.place.trim()) > LIMITS.placeText) errors.place = 'too_long'
  if (charCount(values.description.trim()) > LIMITS.occasionDescription) errors.description = 'too_long'
  return errors
}

export function hasErrors(errors: OccasionFormErrors): boolean {
  return FIELD_ORDER.some((field) => errors[field] !== undefined)
}

/** Validated values → the database row (trimmed; empty optional texts become null). */
export function toOccasionInput(values: OccasionFormValues, timeZone: string, id?: string): OccasionInput {
  const place = values.place.trim()
  const description = values.description.trim()
  const input: OccasionInput = {
    title: values.title.trim(),
    starts_at: zonedWallTimeToIso(values.date, values.allDay ? null : values.time, timeZone),
    tz: timeZone,
    all_day: values.allDay,
    place_text: place === '' ? null : place,
    description: description === '' ? null : description,
  }
  // the point only with a place and only when there is one: left out, the database keeps the stored point for the same
  // text and drops it for a new one (trigger occasion_place_point_reset) — and an older database never sees the columns
  if (place !== '' && values.point) {
    input.place_lat = values.point.lat
    input.place_lon = values.point.lon
  }
  // the end goes out only when the form knew it (null = a server without ends_at: the stored end stays untouched)
  if (values.end !== null) {
    input.ends_at = !values.allDay && values.end !== '' ? endsAtFor(values.date, values.time, values.end, timeZone) : null
  }
  if (id) input.id = id
  return input
}

/** `{ ends_at }` when the input carries one (also null = "no end"); nothing when it leaves the end alone. */
function endOf(input: Pick<OccasionInput, 'ends_at'>): { ends_at?: string | null } {
  return input.ends_at !== undefined ? { ends_at: input.ends_at } : {}
}

/** `{ cover_theme }` (20261027140000, the motif) when the input carries one; nothing when it leaves it alone. */
function coverOf(input: Pick<OccasionInput, 'cover_theme'>): { cover_theme?: string | null } {
  return input.cover_theme !== undefined ? { cover_theme: input.cover_theme } : {}
}

/** The screen's point after an edit: the sent one; none for a new place text without one (the database does the same). */
function pointAfterEdit(occasion: OccasionScreen['occasion'], input: Pick<OccasionInput, 'place_text' | 'place_lat' | 'place_lon'>): { place_lat?: number | null; place_lon?: number | null } {
  if (input.place_lat !== undefined) return { place_lat: input.place_lat, place_lon: input.place_lon ?? null }
  if ((input.place_text ?? null) !== occasion.place_text && occasion.place_lat != null) return { place_lat: null, place_lon: null }
  return {}
}

/** What the host sees right after "Speichern", before the server answered (optimistic, F4). */
export function optimisticScreen(
  input: OccasionInput & { id: string },
  host: { id: string; display_name: string | null },
  createdAt: string,
): OccasionScreen {
  return {
    occasion: {
      id: input.id,
      title: input.title,
      starts_at: input.starts_at,
      ...endOf(input),
      tz: input.tz,
      all_day: input.all_day,
      place_text: input.place_text ?? null,
      // the point the form picked (20261027190000): the hero's mini map at once
      ...(input.place_lat != null && input.place_lon != null ? { place_lat: input.place_lat, place_lon: input.place_lon } : {}),
      description: input.description ?? null,
      created_at: createdAt,
      host,
      // the bring-along list (features/potluck): only when the form chose it
      ...(input.sections ? { sections: input.sections } : {}),
      // the motif the form showed (features/occasions/covers): Start and the hero show it at once
      ...coverOf(input),
    },
    viewer: { role: 'host', rsvp: 'going' },
    members: [{ profile_id: host.id, display_name: host.display_name, role: 'host', rsvp: 'going' }],
    invite: null,
    // the database trigger creates the list; until the real screen arrives the section shows a skeleton
    wishlist: null,
    ...(input.sections && input.sections !== 'wishes' ? { potluck: { max_items: 50, items: [] } } : {}),
  }
}

/**
 * The feed with a just-created occasion of mine (optimistic create, K10): the calendar tab finds it at
 * once and the bunny can file it onto its day while the insert travels. Host row: no reservation count
 * (always null for the host), no guests yet, no wishes yet. Kept in start order; an id that is there
 * already stays as it is. No feed in the cache: nothing to patch (the screen loads the real one).
 */
export function withNewFeedOccasion(
  feed: FeedScreen | undefined,
  input: OccasionInput & { id: string },
  hostName: string | null,
  /** wishes added in the form itself (extras): the calendar then offers no "Wünsche eintragen" */
  wishCount = 0,
): FeedScreen | undefined {
  if (!feed || feed.upcoming.some((row) => row.id === input.id) || feed.past.some((row) => row.id === input.id)) return feed
  const row: FeedOccasion = {
    id: input.id,
    title: input.title,
    starts_at: input.starts_at,
    ...endOf(input),
    tz: input.tz,
    all_day: input.all_day,
    place_text: input.place_text ?? null,
    role: 'host',
    rsvp: 'going',
    host_name: hostName,
    member_count: 1,
    wish_count: wishCount,
    my_reservation_count: null,
    ...(input.sections ? { sections: input.sections } : {}),
    ...coverOf(input),
  }
  const at = Date.parse(row.starts_at)
  const index = feed.upcoming.findIndex((other) => Date.parse(other.starts_at) > at)
  const upcoming = index < 0 ? [...feed.upcoming, row] : [...feed.upcoming.slice(0, index), row, ...feed.upcoming.slice(index)]
  return { ...feed, upcoming }
}

/** The feed without an occasion (a failed optimistic create rolls back). */
export function withoutFeedOccasion(feed: FeedScreen | undefined, occasionId: string): FeedScreen | undefined {
  if (!feed) return feed
  return { ...feed, upcoming: feed.upcoming.filter((row) => row.id !== occasionId), past: feed.past.filter((row) => row.id !== occasionId) }
}

/**
 * The feed with one occasion's edited fields (optimistic edit): the month view and Start show the new day at
 * once. Its list keeps the time order; whether it is upcoming or past is the server's answer on the refetch.
 */
export function withFeedOccasionEdit(
  feed: FeedScreen | undefined,
  occasionId: string,
  input: Pick<OccasionInput, 'title' | 'starts_at' | 'ends_at' | 'tz' | 'all_day' | 'place_text' | 'cover_theme'>,
): FeedScreen | undefined {
  if (!feed) return feed
  const patch = (rows: FeedOccasion[], newestFirst: boolean): FeedOccasion[] => {
    if (!rows.some((row) => row.id === occasionId)) return rows
    const next = rows.map((row) =>
      row.id === occasionId
        ? { ...row, title: input.title, starts_at: input.starts_at, ...endOf(input), tz: input.tz, all_day: input.all_day, place_text: input.place_text ?? null, ...coverOf(input) }
        : row,
    )
    // a stable sort: rows at the same moment keep the server's order
    const order = (a: FeedOccasion, b: FeedOccasion) => Date.parse(a.starts_at) - Date.parse(b.starts_at)
    return next.sort(newestFirst ? (a, b) => order(b, a) : order)
  }
  // get_feed: upcoming soonest first, past newest first
  return { ...feed, upcoming: patch(feed.upcoming, false), past: patch(feed.past, true) }
}

/**
 * Would leaving lose input? Two form states are the same occasion when every saved field is equal (spaces at
 * the ends do not count, the time and the end only while it is not all-day) — "Änderungen verwerfen?" asks only then.
 */
export function sameOccasionValues(a: OccasionFormValues, b: OccasionFormValues): boolean {
  return (
    a.title.trim() === b.title.trim() &&
    a.date === b.date &&
    a.allDay === b.allDay &&
    (a.allDay || (a.time === b.time && a.end === b.end)) &&
    a.place.trim() === b.place.trim() &&
    a.point?.lat === b.point?.lat &&
    a.point?.lon === b.point?.lon &&
    a.description.trim() === b.description.trim()
  )
}

/**
 * "Runaway date" (pilot-decisions §000 p. 11): did saving really move the occasion to another day? Compared as the
 * wall date in the occasion's own zone — a new time on the same day, or switching to all-day, is no move.
 */
export function movedToAnotherDay(occasion: Pick<OccasionScreen['occasion'], 'starts_at' | 'tz'>, values: Pick<OccasionFormValues, 'date'>): boolean {
  return isoToZonedWallTime(occasion.starts_at, occasion.tz).date !== values.date
}

/** The screen with edited occasion fields (optimistic edit); everything else stays untouched. */
export function withOccasionEdit(screen: OccasionScreen, input: OccasionInput): OccasionScreen {
  return {
    ...screen,
    occasion: {
      ...screen.occasion,
      title: input.title,
      starts_at: input.starts_at,
      ...endOf(input),
      tz: input.tz,
      all_day: input.all_day,
      place_text: input.place_text ?? null,
      ...pointAfterEdit(screen.occasion, input),
      description: input.description ?? null,
      ...coverOf(input),
    },
  }
}

/** The screen with my new RSVP (viewer + my row in the member list). */
export function withRsvp(screen: OccasionScreen, profileId: string, rsvp: Rsvp): OccasionScreen {
  return {
    ...screen,
    viewer: { ...screen.viewer, rsvp },
    members: screen.members.map((member) => (member.profile_id === profileId ? { ...member, rsvp } : member)),
  }
}

/**
 * The screen after the host removed a guest. remove_member() also revokes every active invite
 * link of the occasion (pilot-decisions §0.4), so the invite is gone as well.
 */
export function withoutMember(screen: OccasionScreen, profileId: string): OccasionScreen {
  return { ...screen, members: screen.members.filter((member) => member.profile_id !== profileId), invite: null }
}
