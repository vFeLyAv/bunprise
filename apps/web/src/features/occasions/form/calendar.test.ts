import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  clampKey,
  daysBetween,
  daysInMonth,
  endOfWeek,
  isDateKey,
  isLeapYear,
  monthGrid,
  monthKey,
  monthsBetween,
  nextWeekday,
  parseKey,
  SATURDAY,
  shiftMonths,
  startOfWeek,
  weekdayIndex,
} from './calendar'

// Calendar math of the date picker: civil days only (Date.UTC day numbers), so DST days are ordinary days.

describe('civil days', () => {
  it('accepts real days only, leap years included', () => {
    expect(isDateKey('2026-11-03')).toBe(true)
    expect(isDateKey('2024-02-29')).toBe(true)
    expect(isDateKey('2000-02-29')).toBe(true) // divisible by 400
    expect(isDateKey('2026-02-29')).toBe(false)
    expect(isDateKey('2100-02-29')).toBe(false) // divisible by 100, not by 400
    expect(isDateKey('2026-13-01')).toBe(false)
    expect(isDateKey('2026-04-31')).toBe(false)
    expect(isDateKey('26-11-03')).toBe(false)
    expect(parseKey('2026-11-03')).toEqual({ year: 2026, month: 11, day: 3 })
  })

  it('knows the length of every month', () => {
    expect([2024, 2026, 2000, 2100].map(isLeapYear)).toEqual([true, false, true, false])
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('counts and steps days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-10-20', '2026-11-01')).toBe(12)
    expect(daysBetween('2026-11-01', '2026-10-20')).toBe(-12)
  })

  it('treats daylight-saving days as ordinary days (Europe: 29 Mar and 25 Oct 2026)', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(daysBetween('2026-03-28', '2026-03-31')).toBe(3)
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3)
  })
})

describe('Monday-first weeks', () => {
  it('numbers weekdays from Monday (0) to Sunday (6)', () => {
    expect(weekdayIndex('2026-10-19')).toBe(0) // Monday
    expect(weekdayIndex('2026-10-24')).toBe(5) // Saturday
    expect(weekdayIndex('2026-10-25')).toBe(6) // Sunday
  })

  it('finds the week around a day, also across a year end', () => {
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28') // Friday → Monday before
    expect(endOfWeek('2027-01-01')).toBe('2027-01-03')
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19')
    expect(endOfWeek('2026-10-25')).toBe('2026-10-25')
  })

  it('finds the next Saturday strictly after a day', () => {
    expect(nextWeekday('2026-10-20', SATURDAY)).toBe('2026-10-24') // Tuesday
    expect(nextWeekday('2026-10-23', SATURDAY)).toBe('2026-10-24') // Friday: tomorrow
    expect(nextWeekday('2026-10-24', SATURDAY)).toBe('2026-10-31') // Saturday: next week
  })
})

describe('month grid', () => {
  it('always has six Monday-first weeks that hold the whole month once', () => {
    for (const ym of [
      { year: 2026, month: 11 }, // starts on a Sunday
      { year: 2027, month: 2 }, // starts on a Monday, 28 days
      { year: 2024, month: 2 }, // leap February
      { year: 2026, month: 3 }, // DST start
      { year: 2026, month: 10 }, // DST end
      { year: 2026, month: 12 }, // year end
    ]) {
      const weeks = monthGrid(ym)
      expect(weeks).toHaveLength(6)
      const days = weeks.flat()
      expect(days).toHaveLength(42)
      expect(weekdayIndex(days[0]!.key)).toBe(0)
      // consecutive civil days, no gap and no double day (DST included)
      days.forEach((day, i) => {
        if (i > 0) expect(day.key).toBe(addDays(days[i - 1]!.key, 1))
      })
      const inMonth = days.filter((day) => day.inMonth).map((day) => day.key)
      expect(inMonth).toHaveLength(daysInMonth(ym.year, ym.month))
      expect(inMonth[0]).toBe(`${ym.year}-${String(ym.month).padStart(2, '0')}-01`)
    }
  })

  it('shows the neighbouring months faded at the edges', () => {
    const november = monthGrid({ year: 2026, month: 11 }).flat()
    expect(november[0]).toEqual({ key: '2026-10-26', inMonth: false })
    expect(november[6]).toEqual({ key: '2026-11-01', inMonth: true }) // Sunday 1 Nov in the first row
    expect(november[41]).toEqual({ key: '2026-12-06', inMonth: false })
    const february = monthGrid({ year: 2027, month: 2 }).flat()
    expect(february[0]).toEqual({ key: '2027-02-01', inMonth: true })
    expect(february.filter((day) => !day.inMonth)).toHaveLength(14) // two whole weeks of March
  })

  it('contains each daylight-saving day exactly once', () => {
    expect(monthGrid({ year: 2026, month: 3 }).flat().filter((day) => day.key === '2026-03-29')).toHaveLength(1)
    expect(monthGrid({ year: 2026, month: 10 }).flat().filter((day) => day.key === '2026-10-25')).toHaveLength(1)
  })
})

describe('turning months', () => {
  it('adds months across years', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(addMonths({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 })
    expect(addMonths({ year: 2026, month: 10 }, -13)).toEqual({ year: 2025, month: 9 })
    expect(monthKey({ year: 2026, month: 3 })).toBe('2026-03')
    expect(monthsBetween({ year: 2026, month: 10 }, { year: 2027, month: 2 })).toBe(4)
  })

  it('keeps the day number and clamps it to the shorter month (PageUp / PageDown)', () => {
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(shiftMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(shiftMonths('2026-10-15', 1)).toBe('2026-11-15')
    expect(shiftMonths('2024-02-29', 12)).toBe('2025-02-28') // Shift+PageDown: a year
    expect(shiftMonths('2026-12-31', 2)).toBe('2027-02-28')
  })

  it('clamps a day into a range', () => {
    expect(clampKey('2026-10-01', '2026-10-19')).toBe('2026-10-19')
    expect(clampKey('2026-10-25', '2026-10-19')).toBe('2026-10-25')
    expect(clampKey('2027-01-01', undefined, '2026-12-31')).toBe('2026-12-31')
  })
})
