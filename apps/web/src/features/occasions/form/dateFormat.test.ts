import { describe, expect, it } from 'vitest'
import { formatTime } from '../../../lib/time'
import {
  badgePartsOf,
  dayPeriodLabels,
  formatFullDate,
  formatMonthYear,
  formatRelativeDay,
  formatRowDate,
  formatTimeValue,
  hourCycleOf,
  intlLocale,
  weekdayLabels,
} from './dateFormat'
import { from12h, hourOptions, minuteOptions, nearestIndex, parseTime, to12h, toTimeValue } from './wheelModel'

// DE/EN formatting of the occasion form and the model of the time wheel.

describe('locale of the form', () => {
  it('is German for the German UI and the browser\'s own English for the English UI', () => {
    expect(intlLocale('de', ['en-US'])).toBe('de-DE')
    expect(intlLocale('en', ['de-DE', 'en-US'])).toBe('en-US')
    expect(intlLocale('en', ['en-GB', 'de'])).toBe('en-GB')
    expect(intlLocale('en', ['de-DE', 'fr'])).toBe('en-GB') // no English preference: the European English
  })
})

describe('dates', () => {
  it('writes the row value in the app language', () => {
    expect(formatRowDate('2026-11-03', 'de-DE')).toBe('Di., 3. Nov. 2026')
    expect(formatRowDate('2026-11-03', 'en-GB')).toBe('Tue, 3 Nov 2026')
    expect(formatRowDate('2026-11-03', 'en-US')).toBe('Tue, Nov 3, 2026')
  })

  it('never shifts the day, whatever the zone of the device (civil dates at UTC midnight)', () => {
    expect(formatRowDate('2026-03-29', 'de-DE')).toBe('So., 29. März 2026')
    expect(formatRowDate('2026-10-25', 'de-DE')).toBe('So., 25. Okt. 2026')
    expect(formatRowDate('2027-01-01', 'de-DE')).toBe('Fr., 1. Jan. 2027')
  })

  it('names days, months and weekdays for the grid', () => {
    expect(formatFullDate('2026-11-03', 'de-DE')).toBe('Dienstag, 3. November 2026')
    expect(formatFullDate('2026-11-03', 'en-GB')).toBe('Tuesday, 3 November 2026')
    expect(formatMonthYear({ year: 2026, month: 11 }, 'de-DE')).toBe('November 2026')
    expect(formatMonthYear({ year: 2027, month: 3 }, 'de-DE')).toBe('März 2027')
    expect(formatMonthYear({ year: 2026, month: 11 }, 'en-GB')).toBe('November 2026')
    expect(weekdayLabels('de-DE').map((day) => day.short)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])
    expect(weekdayLabels('en-GB').map((day) => day.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(weekdayLabels('de-DE')[0]?.long).toBe('Montag')
  })

  it('gives the calendar page the same parts as the feed card', () => {
    expect(badgePartsOf('2026-11-05', 'de-DE')).toEqual({ month: 'NOV', day: '5', weekday: 'Do' })
    expect(badgePartsOf('2026-03-29', 'de-DE')).toEqual({ month: 'MÄR', day: '29', weekday: 'So' })
    expect(badgePartsOf('2026-11-05', 'en-GB')).toEqual({ month: 'NOV', day: '5', weekday: 'Thu' })
  })

  it('says how far away the day is', () => {
    expect(formatRelativeDay('2026-10-20', '2026-10-20', 'de-DE')).toBe('Heute')
    expect(formatRelativeDay('2026-10-20', '2026-10-21', 'de-DE')).toBe('Morgen')
    expect(formatRelativeDay('2026-10-20', '2026-11-01', 'de-DE')).toBe('In 12 Tagen')
    expect(formatRelativeDay('2026-10-20', '2026-10-19', 'de-DE')).toBe('Gestern')
    expect(formatRelativeDay('2026-10-20', '2026-11-29', 'de-DE')).toBe('In 6 Wochen')
    expect(formatRelativeDay('2026-10-20', '2027-05-08', 'de-DE')).toBe('In 7 Monaten')
    expect(formatRelativeDay('2026-10-20', '2026-10-21', 'en-GB')).toBe('Tomorrow')
    expect(formatRelativeDay('2026-10-20', '2026-11-01', 'en-GB')).toBe('In 12 days')
  })
})

describe('times', () => {
  it('uses 24 h in German and the locale\'s own clock in English', () => {
    expect(hourCycleOf('de-DE')).toBe('h23')
    expect(hourCycleOf('en-GB')).toBe('h23')
    expect(hourCycleOf('en-US')).toBe('h12')
    expect(formatTimeValue('19:05', 'de-DE', 'h23')).toBe('19:05')
    expect(formatTimeValue('09:00', 'de-DE', 'h23')).toBe('09:00')
    expect(formatTimeValue('19:05', 'en-US', 'h12')).toMatch(/^7:05\sPM$/)
    expect(formatTimeValue('00:30', 'en-US', 'h12')).toMatch(/^12:30\sAM$/)
    expect(formatTimeValue('', 'de-DE', 'h23')).toBe('')
    expect(dayPeriodLabels('en-US')).toEqual({ am: 'AM', pm: 'PM' })
  })

  it('the occasion page and Start show a time the way the form chip does (no "07:00 PM")', () => {
    const at = (iso: string, locale: string) => formatTime(iso, { locale, timeZone: 'UTC' })
    expect(at('2026-10-24T19:00:00Z', 'en')).toMatch(/^7:00\sPM$/)
    expect(at('2026-10-24T18:30:00Z', 'en-US')).toBe(formatTimeValue('18:30', 'en-US', 'h12'))
    expect(at('2026-10-24T09:00:00Z', 'de')).toBe('09:00')
    expect(at('2026-10-24T18:30:00Z', 'de-DE')).toBe(formatTimeValue('18:30', 'de-DE', 'h23'))
  })
})

describe('time wheel model', () => {
  it('reads and writes "HH:mm"', () => {
    expect(parseTime('19:05')).toEqual({ hour: 19, minute: 5 })
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('7:05')).toBeNull()
    expect(toTimeValue(7, 5)).toBe('07:05')
  })

  it('offers 5-minute steps and keeps a stored minute that is off the grid', () => {
    expect(minuteOptions()).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    expect(minuteOptions(7)).toEqual([0, 5, 7, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    expect(minuteOptions(30)).toHaveLength(12)
  })

  it('orders the hours like the system wheel', () => {
    expect(hourOptions('h23')).toEqual(Array.from({ length: 24 }, (_, i) => i))
    expect(hourOptions('h12')).toEqual([12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('maps every hour to the 12 h clock and back', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const { hour12, pm } = to12h(hour)
      expect(hour12).toBeGreaterThanOrEqual(1)
      expect(hour12).toBeLessThanOrEqual(12)
      expect(from12h(hour12, pm)).toBe(hour)
    }
    expect(to12h(0)).toEqual({ hour12: 12, pm: false })
    expect(to12h(12)).toEqual({ hour12: 12, pm: true })
    expect(nearestIndex([0, 5, 10], 7)).toBe(1)
  })
})
