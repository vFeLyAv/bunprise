import { describe, expect, it } from 'vitest'
import type { FeedOccasion } from '../../lib/api/types'
import { describeWhen, displayZone, groupUpcoming, guestCount } from './model'

// Fixed clock + explicit viewer zone: independent of the machine's time zone.
const BERLIN = 'Europe/Berlin'
const NOW = '2026-10-20T08:00:00Z' // Tue 20 Oct 2026, 10:00 in Berlin

function occasion(overrides: Partial<FeedOccasion> & Pick<FeedOccasion, 'id' | 'starts_at'>): FeedOccasion {
  return {
    title: `Anlass ${overrides.id}`,
    tz: BERLIN,
    all_day: false,
    place_text: null,
    role: 'member',
    rsvp: 'none',
    host_name: 'Anna',
    member_count: 3,
    wish_count: 0,
    my_reservation_count: 0,
    ...overrides,
  }
}

describe('groupUpcoming', () => {
  it('sorts upcoming rows into today · this week · later and keeps the server order inside a group', () => {
    const upcoming = [
      occasion({ id: 'ongoing', starts_at: '2026-10-19T18:00:00Z' }), // started yesterday, not over yet (server: upcoming)
      occasion({ id: 'today-morning', starts_at: '2026-10-20T05:00:00Z' }), // 07:00 today, already started
      occasion({ id: 'today-evening', starts_at: '2026-10-20T17:00:00Z' }),
      occasion({ id: 'in-3-days', starts_at: '2026-10-23T16:00:00Z' }),
      occasion({ id: 'in-6-days', starts_at: '2026-10-26T17:00:00Z' }), // after the DST switch on 25 Oct
      occasion({ id: 'in-7-days', starts_at: '2026-10-27T17:00:00Z' }),
      occasion({ id: 'november', starts_at: '2026-11-14T15:00:00Z' }),
    ]
    const sections = groupUpcoming(upcoming, { now: NOW, viewerZone: BERLIN })
    expect(sections.map((section) => [section.group, section.items.map((item) => item.id)])).toEqual([
      ['today', ['ongoing', 'today-morning', 'today-evening']],
      ['week', ['in-3-days', 'in-6-days']],
      ['later', ['in-7-days', 'november']],
    ])
  })

  it('orders occasions that start at the same moment by title, whatever order (random id) the server used', () => {
    const saturday = '2026-10-24T00:00:00Z'
    const rows = [
      occasion({ id: 'c', title: 'Kino', starts_at: saturday, all_day: true }),
      occasion({ id: 'a', title: 'Flohmarkt', starts_at: saturday, all_day: true }),
      occasion({ id: 'b', title: 'Brunch bei Mila', starts_at: saturday, all_day: true }),
    ]
    const titles = (list: FeedOccasion[]) => groupUpcoming(list, { now: NOW, viewerZone: BERLIN }).flatMap((section) => section.items.map((item) => item.title))
    expect(titles(rows)).toEqual(['Brunch bei Mila', 'Flohmarkt', 'Kino'])
    expect(titles([...rows].reverse())).toEqual(['Brunch bei Mila', 'Flohmarkt', 'Kino'])
  })

  it('omits empty groups and returns nothing for an empty feed', () => {
    expect(groupUpcoming([], { now: NOW, viewerZone: BERLIN })).toEqual([])
    const later = groupUpcoming([occasion({ id: 'x', starts_at: '2026-12-12T18:00:00Z' })], { now: NOW, viewerZone: BERLIN })
    expect(later.map((section) => section.group)).toEqual(['later'])
  })

  it('reads an all-day occasion as a calendar date in its own zone', () => {
    // Midnight of Wed 21 Oct in New York is still Tue 20 Oct for a viewer in Honolulu.
    const allDay = occasion({ id: 'ny', all_day: true, tz: 'America/New_York', starts_at: '2026-10-21T04:00:00Z' })
    expect(displayZone(allDay, 'Pacific/Honolulu')).toBe('America/New_York')
    expect(groupUpcoming([allDay], { now: '2026-10-20T20:00:00Z', viewerZone: 'Pacific/Honolulu' })[0]?.group).toBe('week')
    // a timed occasion follows the viewer's clock, and a broken zone falls back to it
    expect(displayZone({ all_day: false, tz: 'America/New_York' }, BERLIN)).toBe(BERLIN)
    expect(displayZone({ all_day: true, tz: 'Not/AZone' }, BERLIN)).toBe(BERLIN)
  })

  it('does not crash on a malformed start and files it under later', () => {
    const sections = groupUpcoming([occasion({ id: 'broken', starts_at: 'not-a-date' })], { now: NOW, viewerZone: BERLIN })
    expect(sections).toEqual([{ group: 'later', items: [expect.objectContaining({ id: 'broken' })] }])
    expect(describeWhen({ starts_at: 'not-a-date', tz: BERLIN, all_day: false })).toBeNull()
  })
})

describe('card numbers', () => {
  it('counts the guests without the host and never below zero', () => {
    expect(guestCount({ member_count: 4 })).toBe(3)
    expect(guestCount({ member_count: 1 })).toBe(0)
    expect(guestCount({ member_count: 0 })).toBe(0)
  })


})

describe('describeWhen', () => {
  it('combines the relative day with date and time in the viewer zone', () => {
    expect(describeWhen({ starts_at: '2026-10-21T17:00:00Z', tz: BERLIN, all_day: false }, { now: NOW, viewerZone: BERLIN })).toEqual({
      relative: 'Morgen',
      absolute: 'Mi., 21. Okt. · 19:00',
      date: 'Mi., 21. Okt.',
      span: { start: '19:00', end: null, nextDay: false },
      occasionTime: null,
    })
    expect(describeWhen({ starts_at: '2026-10-20T17:00:00Z', tz: BERLIN, all_day: false }, { now: NOW, viewerZone: BERLIN })?.relative).toBe('Heute')
    expect(describeWhen({ starts_at: '2026-10-10T10:00:00Z', tz: BERLIN, all_day: false }, { now: NOW, viewerZone: BERLIN })?.relative).toBe('Vor 10 Tagen')
  })

  it('shows only the date for an all-day occasion, in its own zone', () => {
    // midnight 24 Oct in New York = 06:00 in Berlin; the card says Saturday, not a time
    expect(describeWhen({ starts_at: '2026-10-24T04:00:00Z', tz: 'America/New_York', all_day: true }, { now: NOW, viewerZone: BERLIN })).toEqual({
      relative: 'In 4 Tagen',
      absolute: 'Sa., 24. Okt.',
      date: 'Sa., 24. Okt.',
      span: null,
      occasionTime: null,
    })
  })

  it('adds the occasion’s own wall time when its zone shows a different time', () => {
    // 19:00 in New York = 01:00 the next night in Berlin
    expect(describeWhen({ starts_at: '2026-10-21T23:00:00Z', tz: 'America/New_York', all_day: false }, { now: NOW, viewerZone: BERLIN })).toEqual({
      relative: 'Übermorgen',
      absolute: 'Do., 22. Okt. · 01:00',
      date: 'Do., 22. Okt.',
      span: { start: '01:00', end: null, nextDay: false },
      occasionTime: { time: '19:00', tz: 'America/New_York', span: { start: '19:00', end: null, nextDay: false } },
    })
  })

  // the end time (20261026180000): the clock times in the zone the card shows them in
  it('adds the end: the same day, the next day, and the next day only in the occasion zone', () => {
    const evening = { starts_at: '2026-10-21T17:00:00Z', ends_at: '2026-10-21T21:00:00Z', tz: BERLIN, all_day: false }
    expect(describeWhen(evening, { now: NOW, viewerZone: BERLIN })).toMatchObject({
      absolute: 'Mi., 21. Okt. · 19:00',
      date: 'Mi., 21. Okt.',
      span: { start: '19:00', end: '23:00', nextDay: false },
    })
    const party = { starts_at: '2026-10-21T17:00:00Z', ends_at: '2026-10-22T00:00:00Z', tz: BERLIN, all_day: false }
    expect(describeWhen(party, { now: NOW, viewerZone: BERLIN })?.span).toEqual({ start: '19:00', end: '02:00', nextDay: true })
    // seen from New York the same party is 13:00–20:00 on one day; its own zone says "until 02:00 the next day"
    expect(describeWhen(party, { now: NOW, viewerZone: 'America/New_York' })).toMatchObject({
      span: { start: '13:00', end: '20:00', nextDay: false },
      occasionTime: { tz: BERLIN, span: { start: '19:00', end: '02:00', nextDay: true } },
    })
  })

  it('shows no end for an all-day occasion, without the key (older server) and for an end not after the start', () => {
    expect(describeWhen({ starts_at: '2026-10-24T04:00:00Z', ends_at: '2026-10-24T10:00:00Z', tz: 'America/New_York', all_day: true }, { now: NOW, viewerZone: BERLIN })?.span).toBeNull()
    expect(describeWhen({ starts_at: '2026-10-21T17:00:00Z', tz: BERLIN, all_day: false }, { now: NOW, viewerZone: BERLIN })?.span?.end).toBeNull()
    expect(describeWhen({ starts_at: '2026-10-21T17:00:00Z', ends_at: '2026-10-21T17:00:00Z', tz: BERLIN, all_day: false }, { now: NOW, viewerZone: BERLIN })?.span?.end).toBeNull()
    expect(describeWhen({ starts_at: '2026-10-21T17:00:00Z', ends_at: 'later', tz: BERLIN, all_day: false }, { now: NOW, viewerZone: BERLIN })?.span?.end).toBeNull()
  })
})
