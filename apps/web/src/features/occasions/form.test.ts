import { describe, expect, it } from 'vitest'
import type { OccasionScreen } from '../../lib/api/types'
import {
  charCount,
  earliestDate,
  emptyOccasionValues,
  hasErrors,
  movedToAnotherDay,
  optimisticScreen,
  sameOccasionValues,
  toOccasionInput,
  validateOccasion,
  valuesFromOccasion,
  withFeedOccasionEdit,
  withNewFeedOccasion,
  withOccasionEdit,
  withRsvp,
  withoutMember,
  type OccasionFormValues,
} from './form'
import { countRsvps } from './MembersSection'
import { visibleInviteLink } from './inviteLink'

const BERLIN = 'Europe/Berlin'
const NOW = new Date('2026-10-20T10:00:00Z')

function values(patch: Partial<OccasionFormValues> = {}): OccasionFormValues {
  return { ...emptyOccasionValues(), title: 'Milas Geburtstag', date: '2026-12-12', ...patch }
}

const screen: OccasionScreen = {
  occasion: {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Milas Geburtstag',
    starts_at: '2026-12-12T18:00:00.000Z',
    tz: BERLIN,
    all_day: false,
    place_text: 'Café am Markt',
    description: null,
    created_at: '2026-10-01T10:00:00.000Z',
    host: { id: 'host-1', display_name: 'Mila' },
  },
  viewer: { role: 'member', rsvp: 'none' },
  members: [
    { profile_id: 'host-1', display_name: 'Mila', role: 'host', rsvp: 'going' },
    { profile_id: 'guest-1', display_name: 'Jonas', role: 'member', rsvp: 'none' },
    { profile_id: 'guest-2', display_name: 'Ida', role: 'member', rsvp: 'maybe' },
  ],
  invite: { active: true, expires_at: '2026-12-19T18:00:00.000Z' },
  wishlist: null,
}

describe('occasion form validation (S6)', () => {
  it('requires a title and a date, and accepts the minimum', () => {
    expect(validateOccasion(emptyOccasionValues(), { timeZone: BERLIN, now: NOW })).toEqual({
      title: 'title_required',
      date: 'date_required',
    })
    expect(validateOccasion(values({ title: '   ' }), { timeZone: BERLIN, now: NOW }).title).toBe('title_required')
    expect(hasErrors(validateOccasion(values(), { timeZone: BERLIN, now: NOW }))).toBe(false)
  })

  it('counts code points like the database and never truncates', () => {
    expect(charCount('🎂🎈')).toBe(2)
    expect(validateOccasion(values({ title: '🎂'.repeat(80) }), { timeZone: BERLIN, now: NOW }).title).toBeUndefined()
    expect(validateOccasion(values({ title: 'x'.repeat(81) }), { timeZone: BERLIN, now: NOW }).title).toBe('title_too_long')
    expect(validateOccasion(values({ place: 'p'.repeat(201) }), { timeZone: BERLIN, now: NOW }).place).toBe('too_long')
    expect(validateOccasion(values({ description: 'd'.repeat(501) }), { timeZone: BERLIN, now: NOW }).description).toBe('too_long')
  })

  it('allows yesterday (time zone slack) but not earlier days for new occasions', () => {
    expect(earliestDate(BERLIN, NOW)).toBe('2026-10-19')
    expect(validateOccasion(values({ date: '2026-10-19' }), { timeZone: BERLIN, now: NOW }).date).toBeUndefined()
    expect(validateOccasion(values({ date: '2026-10-18' }), { timeZone: BERLIN, now: NOW }).date).toBe('date_past')
    expect(validateOccasion(values({ date: '2026-02-30' }), { timeZone: BERLIN, now: NOW }).date).toBe('date_invalid')
  })

  it('lets an edited occasion keep its own past date, but not move to another past day', () => {
    const options = { timeZone: BERLIN, now: NOW, originalDate: '2026-09-01' }
    expect(validateOccasion(values({ date: '2026-09-01' }), options).date).toBeUndefined()
    expect(validateOccasion(values({ date: '2026-09-02' }), options).date).toBe('date_past')
  })

  it('needs a time only when the occasion is not all day', () => {
    expect(validateOccasion(values({ allDay: true, time: '' }), { timeZone: BERLIN, now: NOW }).time).toBeUndefined()
    expect(validateOccasion(values({ allDay: false, time: '' }), { timeZone: BERLIN, now: NOW }).time).toBe('time_required')
    expect(validateOccasion(values({ allDay: false, time: '19:00' }), { timeZone: BERLIN, now: NOW }).time).toBeUndefined()
  })
})

describe('occasion form → database row', () => {
  it('stores all-day occasions at midnight of their zone and timed ones at the wall time', () => {
    expect(toOccasionInput(values({ allDay: true }), BERLIN).starts_at).toBe('2026-12-11T23:00:00.000Z')
    expect(toOccasionInput(values({ allDay: false, time: '19:00' }), BERLIN).starts_at).toBe('2026-12-12T18:00:00.000Z')
  })

  it('trims texts, turns empty optional fields into null and only sets an id when given', () => {
    const input = toOccasionInput(values({ title: '  Party  ', place: '   ', description: ' Bring Musik mit \n' }), BERLIN)
    expect(input).toEqual({
      title: 'Party',
      starts_at: '2026-12-11T23:00:00.000Z',
      tz: BERLIN,
      // the form knew the end (none): it goes out as null, like every other emptied field
      ends_at: null,
      all_day: true,
      place_text: null,
      description: 'Bring Musik mit',
    })
    expect(toOccasionInput(values(), BERLIN, 'abc').id).toBe('abc')
  })

  it('round-trips an existing occasion into the form in its own zone', () => {
    expect(valuesFromOccasion(screen.occasion)).toMatchObject({ date: '2026-12-12', time: '19:00', allDay: false, place: 'Café am Markt', description: '' })
  })

  it('is DST-safe: midnight and wall times on the days the clocks change (Berlin 2026)', () => {
    // all-day = midnight of the zone: CET (+1) on 29 March, still CEST (+2) at midnight on 25 October
    expect(toOccasionInput(values({ date: '2026-03-29', allDay: true }), BERLIN).starts_at).toBe('2026-03-28T23:00:00.000Z')
    expect(toOccasionInput(values({ date: '2026-10-25', allDay: true }), BERLIN).starts_at).toBe('2026-10-24T22:00:00.000Z')
    // evening wall times after the change
    expect(toOccasionInput(values({ date: '2026-03-29', allDay: false, time: '19:00' }), BERLIN).starts_at).toBe('2026-03-29T17:00:00.000Z')
    expect(toOccasionInput(values({ date: '2026-10-25', allDay: false, time: '19:00' }), BERLIN).starts_at).toBe('2026-10-25T18:00:00.000Z')
    // 02:30 does not exist on 29 March (→ 03:30 CEST); on 25 October it exists twice (→ the second, CET)
    expect(toOccasionInput(values({ date: '2026-03-29', allDay: false, time: '02:30' }), BERLIN).starts_at).toBe('2026-03-29T01:30:00.000Z')
    expect(toOccasionInput(values({ date: '2026-10-25', allDay: false, time: '02:30' }), BERLIN).starts_at).toBe('2026-10-25T01:30:00.000Z')
    // and back into the form: the same day and wall time
    for (const [date, time] of [
      ['2026-03-29', '19:00'],
      ['2026-10-25', '19:00'],
      ['2026-10-25', '00:05'],
    ] as const) {
      const input = toOccasionInput(values({ date, time, allDay: false }), BERLIN)
      expect(valuesFromOccasion({ ...screen.occasion, starts_at: input.starts_at, tz: BERLIN, all_day: false })).toMatchObject({ date, time })
    }
  })
})

describe('screen updates (optimistic)', () => {
  it('builds the host screen of a new occasion without a list and without guests', () => {
    const input = { ...toOccasionInput(values(), BERLIN), id: 'new-id' }
    const optimistic = optimisticScreen(input, { id: 'host-1', display_name: 'Mila' }, '2026-10-20T10:00:00.000Z')
    expect(optimistic.viewer).toEqual({ role: 'host', rsvp: 'going' })
    expect(optimistic.members).toEqual([{ profile_id: 'host-1', display_name: 'Mila', role: 'host', rsvp: 'going' }])
    expect(optimistic.invite).toBeNull()
    expect(optimistic.wishlist).toBeNull()
    expect(optimistic.occasion).toMatchObject({ id: 'new-id', title: 'Milas Geburtstag', tz: BERLIN })
  })

  it('applies an edit, an RSVP and a removal without touching anything else', () => {
    const edited = withOccasionEdit(screen, toOccasionInput(values({ title: 'Neu', allDay: true }), BERLIN))
    expect(edited.occasion).toMatchObject({ title: 'Neu', all_day: true, host: screen.occasion.host, created_at: screen.occasion.created_at })
    expect(edited.members).toBe(screen.members)

    const answered = withRsvp(screen, 'guest-1', 'going')
    expect(answered.viewer.rsvp).toBe('going')
    expect(answered.members.find((m) => m.profile_id === 'guest-1')?.rsvp).toBe('going')
    expect(answered.members.find((m) => m.profile_id === 'guest-2')?.rsvp).toBe('maybe')

    const removed = withoutMember(screen, 'guest-2')
    expect(removed.members.map((m) => m.profile_id)).toEqual(['host-1', 'guest-1'])
    expect(removed.invite).toBeNull() // remove_member revokes the active links (pilot-decisions §0.4)
  })

  it('moves an edited occasion in the feed and keeps each list in its time order', () => {
    const row = (id: string, starts_at: string) => ({
      id, title: id, starts_at, tz: BERLIN, all_day: true, place_text: null, role: 'host' as const, rsvp: 'going' as const,
      host_name: 'Mila', member_count: 1, wish_count: 0, my_reservation_count: null,
    })
    const feed = { upcoming: [row('a', '2026-11-01T10:00:00.000Z'), row('b', '2026-11-05T10:00:00.000Z'), row('c', '2026-11-09T10:00:00.000Z')], past: [] }
    const input = toOccasionInput(values({ title: 'A neu', date: '2026-11-07' }), BERLIN)
    const next = withFeedOccasionEdit(feed, 'a', input)
    expect(next?.upcoming.map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(next?.upcoming[1]).toMatchObject({ title: 'A neu', starts_at: input.starts_at, member_count: 1 })
    expect(withFeedOccasionEdit(undefined, 'a', input)).toBeUndefined()
  })

  it('"runaway date": only another wall day in the occasion\'s zone counts as moved', () => {
    // 18:00 UTC on 12 Dec = 19:00 in Berlin, same day
    expect(movedToAnotherDay(screen.occasion, { date: '2026-12-12' })).toBe(false)
    expect(movedToAnotherDay(screen.occasion, { date: '2026-12-13' })).toBe(true)
    // 23:30 UTC on 12 Dec is already the 13th in Berlin
    expect(movedToAnotherDay({ starts_at: '2026-12-12T23:30:00.000Z', tz: BERLIN }, { date: '2026-12-13' })).toBe(false)
  })

  it('counts the host as going and every guest by their answer', () => {
    expect(countRsvps(screen.members)).toEqual({ going: 1, maybe: 1, declined: 0, none: 1 })
  })
})

describe('fresh invite link visibility', () => {
  const fresh = { url: 'https://app.test/i#token', at: 2_000 }

  it('shows a fresh link while the screen still has to catch up or reports an active invite', () => {
    expect(visibleInviteLink(fresh, null, 1_000)).toBe(fresh.url)
    expect(visibleInviteLink(fresh, { active: true, expires_at: '2026-12-19T18:00:00.000Z' }, 3_000)).toBe(fresh.url)
  })

  it('hides it once newer screen data says the link is gone (guest removed, expired)', () => {
    expect(visibleInviteLink(fresh, null, 2_000)).toBe(fresh.url) // same moment: still the fresh link
    expect(visibleInviteLink(fresh, null, 3_000)).toBeNull()
    expect(visibleInviteLink(null, { active: true, expires_at: '2026-12-19T18:00:00.000Z' }, 3_000)).toBeNull()
  })
})

// The end time (Felix 26.10, supabase/migrations/20261026180000_occasion_end_time.sql)
describe('the end time', () => {
  const timed = (patch: Partial<OccasionFormValues> = {}) => values({ allDay: false, time: '19:00', ...patch })
  const check = (v: OccasionFormValues) => validateOccasion(v, { timeZone: BERLIN, now: NOW })

  it('is optional; an end equal to the start is refused, an earlier one means the next day', () => {
    expect(check(timed({ end: '' })).end).toBeUndefined()
    expect(check(timed({ end: '23:00' })).end).toBeUndefined()
    expect(check(timed({ end: '02:00' })).end).toBeUndefined()
    expect(check(timed({ end: '19:00' })).end).toBe('end_same')
    expect(check(timed({ end: '7 Uhr' })).end).toBe('end_invalid')
    // all-day: the end is ignored (the row is hidden), whatever it holds
    expect(check(values({ allDay: true, end: '19:00', time: '19:00' })).end).toBeUndefined()
    expect(hasErrors(check(timed({ end: '19:00' })))).toBe(true)
  })

  it('goes out as ends_at: the same day, the next day, null without one or when all-day', () => {
    expect(toOccasionInput(timed({ end: '23:00' }), BERLIN).ends_at).toBe('2026-12-12T22:00:00.000Z')
    expect(toOccasionInput(timed({ end: '02:00' }), BERLIN).ends_at).toBe('2026-12-13T01:00:00.000Z')
    expect(toOccasionInput(timed({ end: '' }), BERLIN).ends_at).toBeNull()
    expect(toOccasionInput(values({ allDay: true, end: '23:00' }), BERLIN).ends_at).toBeNull()
  })

  it('is left out when the form did not know it (a server without ends_at): the stored end stays', () => {
    const input = toOccasionInput(timed({ end: null }), BERLIN)
    expect('ends_at' in input).toBe(false)
  })

  it('round-trips: the stored end in the occasion zone; none → \'\'; no key → null', () => {
    expect(valuesFromOccasion({ ...screen.occasion, ends_at: '2026-12-12T22:00:00.000Z' }).end).toBe('23:00')
    expect(valuesFromOccasion({ ...screen.occasion, ends_at: '2026-12-13T01:00:00.000Z' }).end).toBe('02:00')
    expect(valuesFromOccasion({ ...screen.occasion, ends_at: null }).end).toBe('')
    expect(valuesFromOccasion({ ...screen.occasion, all_day: true, ends_at: null }).end).toBe('')
    expect(valuesFromOccasion(screen.occasion).end).toBeNull()
  })

  it('counts as a change only while the occasion is timed', () => {
    expect(sameOccasionValues(timed({ end: '23:00' }), timed({ end: '22:00' }))).toBe(false)
    expect(sameOccasionValues(timed({ end: '' }), timed({ end: '' }))).toBe(true)
    expect(sameOccasionValues(values({ allDay: true, end: '23:00' }), values({ allDay: true, end: '' }))).toBe(true)
  })

  it('reaches the optimistic screen and feed row; an edit without it keeps the stored one', () => {
    const input = { ...toOccasionInput(timed({ end: '23:00' }), BERLIN), id: 'new-id' }
    expect(optimisticScreen(input, { id: 'host-1', display_name: 'Mila' }, NOW.toISOString()).occasion.ends_at).toBe('2026-12-12T22:00:00.000Z')
    const feed = withNewFeedOccasion({ upcoming: [], past: [] }, input, 'Mila')
    expect(feed?.upcoming[0]?.ends_at).toBe('2026-12-12T22:00:00.000Z')
    expect(feed?.upcoming[0]?.wish_count).toBe(0)
    // wishes added in the form: the new row counts them (the calendar then offers no "Wünsche eintragen")
    expect(withNewFeedOccasion({ upcoming: [], past: [] }, { ...input, sections: 'both' }, 'Mila', 3)?.upcoming[0]).toMatchObject({ wish_count: 3, sections: 'both' })

    const stored = { ...screen, occasion: { ...screen.occasion, ends_at: '2026-12-12T22:00:00.000Z' } }
    expect(withOccasionEdit(stored, toOccasionInput(timed({ end: '' }), BERLIN)).occasion.ends_at).toBeNull()
    expect(withOccasionEdit(stored, toOccasionInput(timed({ title: 'Neu', end: null }), BERLIN)).occasion.ends_at).toBe('2026-12-12T22:00:00.000Z')
    const row = { ...feed!.upcoming[0]!, id: 'a' }
    expect(withFeedOccasionEdit({ upcoming: [row], past: [] }, 'a', toOccasionInput(timed({ end: '02:00' }), BERLIN))?.upcoming[0]?.ends_at).toBe('2026-12-13T01:00:00.000Z')
    expect(withFeedOccasionEdit({ upcoming: [row], past: [] }, 'a', toOccasionInput(timed({ end: null }), BERLIN))?.upcoming[0]?.ends_at).toBe('2026-12-12T22:00:00.000Z')
  })
})

describe('the place point (20261027190000, the mini map)', () => {
  const POINT = { lat: 51.16094, lon: 10.45108 }
  const stored = { ...screen, occasion: { ...screen.occasion, place_lat: POINT.lat, place_lon: POINT.lon } }

  it('read from the screen only with both numbers and a place; nothing from an older server', () => {
    expect(valuesFromOccasion(stored.occasion).point).toEqual(POINT)
    expect(valuesFromOccasion(screen.occasion)).not.toHaveProperty('point')
    expect(valuesFromOccasion({ ...stored.occasion, place_lat: null, place_lon: null })).not.toHaveProperty('point')
  })

  it('sent only with a place and a point; never for typed text', () => {
    expect(toOccasionInput(values({ place: 'Café am Markt', point: POINT }), BERLIN)).toMatchObject({ place_lat: POINT.lat, place_lon: POINT.lon })
    expect(toOccasionInput(values({ place: 'Café am Markt' }), BERLIN)).not.toHaveProperty('place_lat')
    expect(toOccasionInput(values({ place: '  ', point: POINT }), BERLIN)).not.toHaveProperty('place_lat')
  })

  it('the optimistic screen: the new point; a new text without one drops it; the same text keeps it', () => {
    const input = { ...toOccasionInput(values({ place: 'Café am Markt', point: POINT }), BERLIN), id: 'new-id' }
    expect(optimisticScreen(input, { id: 'host-1', display_name: 'Mila' }, NOW.toISOString()).occasion).toMatchObject({ place_lat: POINT.lat, place_lon: POINT.lon })
    expect(withOccasionEdit(stored, toOccasionInput(values({ place: 'Bei mir' }), BERLIN)).occasion).toMatchObject({ place_lat: null, place_lon: null })
    expect(withOccasionEdit(stored, toOccasionInput(values({ place: 'Café am Markt' }), BERLIN)).occasion).toMatchObject({ place_lat: POINT.lat, place_lon: POINT.lon })
  })

  it('a different point counts as a change ("Änderungen verwerfen?")', () => {
    expect(sameOccasionValues(values({ place: 'A', point: POINT }), values({ place: 'A', point: { lat: 1, lon: 2 } }))).toBe(false)
    expect(sameOccasionValues(values({ place: 'A', point: null }), values({ place: 'A' }))).toBe(true)
  })
})
