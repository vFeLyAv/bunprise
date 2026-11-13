import { describe, expect, it } from 'vitest'
import type { FeedOccasion } from '../../lib/api/types'
import {
  GRID_WEEKS,
  addMonths,
  daysInMonth,
  groupByDay,
  longDayLabel,
  monthGrid,
  monthOfDay,
  monthTitle,
  monthsBetween,
  normalizeMonth,
  occasionDay,
  parseDayKey,
  todayKey,
  weekdayLabels,
} from './grid'

function occasion(id: string, startsAt: string, allDay = false, tz = 'Europe/Berlin'): FeedOccasion {
  return {
    id, title: id, starts_at: startsAt, tz, all_day: allDay, place_text: null, role: 'host', rsvp: 'going',
    host_name: 'Mila', member_count: 1, wish_count: 0, my_reservation_count: null,
  }
}

describe('month grid: Monday first, always six weeks', () => {
  it('October 2026 starts on a Thursday: Mon 28 Sep … Sun 8 Nov', () => {
    const weeks = monthGrid({ year: 2026, month: 10 })
    expect(weeks).toHaveLength(GRID_WEEKS)
    expect(weeks.every((week) => week.length === 7)).toBe(true)
    const first = weeks[0]!
    expect(first.map((day) => day.key)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(first.map((day) => day.inMonth)).toEqual([false, false, false, true, true, true, true])
    expect(first.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(weeks[5]![6]!.key).toBe('2026-11-08')
    expect(weeks.flat().filter((day) => day.inMonth)).toHaveLength(31)
  })

  it('a month that starts on a Monday has no leading days (June 2026)', () => {
    const weeks = monthGrid({ year: 2026, month: 6 })
    expect(weeks[0]![0]).toMatchObject({ key: '2026-06-01', inMonth: true, day: 1 })
  })

  it('a month that starts on a Sunday has six leading days (November 2026)', () => {
    const first = monthGrid({ year: 2026, month: 11 })[0]!
    expect(first.filter((day) => !day.inMonth)).toHaveLength(6)
    expect(first[6]).toMatchObject({ key: '2026-11-01', inMonth: true })
  })

  it('crosses the year boundary and knows leap years', () => {
    const december = monthGrid({ year: 2026, month: 12 }).flat()
    expect(december.at(-1)!.key.startsWith('2027-01')).toBe(true)
    const january = monthGrid({ year: 2027, month: 1 }).flat()
    expect(january[0]!.key.startsWith('2026-12')).toBe(true)
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29)
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28)
    expect(monthGrid({ year: 2028, month: 2 }).flat().filter((day) => day.inMonth)).toHaveLength(29)
  })

  it('every day appears once and the days run on without a gap (also across DST, 25 Oct 2026)', () => {
    const days = monthGrid({ year: 2026, month: 10 }).flat().map((day) => day.key)
    expect(new Set(days).size).toBe(42)
    expect(days).toContain('2026-10-25')
    expect(days.indexOf('2026-10-26') - days.indexOf('2026-10-25')).toBe(1)
  })
})

describe('month navigation', () => {
  it('adds months across year boundaries in both directions', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(addMonths({ year: 2026, month: 10 }, -22)).toEqual({ year: 2024, month: 12 })
    expect(normalizeMonth(2026, 0)).toEqual({ year: 2025, month: 12 })
    expect(normalizeMonth(2026, 13)).toEqual({ year: 2027, month: 1 })
    expect(monthsBetween({ year: 2026, month: 11 }, { year: 2027, month: 2 })).toBe(3)
  })

  it('reads day keys strictly', () => {
    expect(parseDayKey('2026-10-24')).toEqual({ year: 2026, month: 10, day: 24 })
    expect(parseDayKey('2026-02-30')).toBeNull()
    expect(parseDayKey('2026-13-01')).toBeNull()
    expect(parseDayKey('24.10.2026')).toBeNull()
    expect(monthOfDay('2026-10-24')).toEqual({ year: 2026, month: 10 })
  })
})

describe('labels in the UI language', () => {
  it('weekday heads start on Monday', () => {
    expect(weekdayLabels('de')).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])
    expect(weekdayLabels('en')[0]).toBe('Mon')
  })

  it('month titles and long day names', () => {
    expect(monthTitle({ year: 2026, month: 10 }, 'de')).toBe('Oktober 2026')
    expect(monthTitle({ year: 2026, month: 10 }, 'en')).toBe('October 2026')
    expect(longDayLabel('2026-10-24', 'de')).toBe('Samstag, 24. Oktober')
  })
})

describe('occasions on days', () => {
  it('a timed occasion lies on the viewer’s day, an all-day one on its own zone’s date', () => {
    // 23:30 in Berlin on 24 Oct = already 25 Oct in Tokyo
    const timed = occasion('timed', '2026-10-24T21:30:00Z')
    expect(occasionDay(timed, 'Europe/Berlin')).toBe('2026-10-24')
    expect(occasionDay(timed, 'Asia/Tokyo')).toBe('2026-10-25')
    // an all-day birthday on 12 Dec (Berlin midnight) stays 12 Dec for a viewer in New York
    const birthday = occasion('birthday', '2026-12-11T23:00:00Z', true)
    expect(occasionDay(birthday, 'America/New_York')).toBe('2026-12-12')
    expect(occasionDay(occasion('broken', 'not a date'))).toBeNull()
  })

  it('groups by day in the given order, each occasion once', () => {
    const a = occasion('a', '2026-10-23T16:00:00Z')
    const b = occasion('b', '2026-10-23T18:00:00Z')
    const c = occasion('c', '2026-11-01T10:00:00Z')
    const days = groupByDay([a, b, c, a], 'Europe/Berlin')
    expect([...days.keys()]).toEqual(['2026-10-23', '2026-11-01'])
    expect(days.get('2026-10-23')!.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('today follows the viewer’s zone', () => {
    const instant = Date.UTC(2026, 9, 20, 22, 30)
    expect(todayKey(instant, 'Europe/Berlin')).toBe('2026-10-21')
    expect(todayKey(instant, 'America/New_York')).toBe('2026-10-20')
  })
})
