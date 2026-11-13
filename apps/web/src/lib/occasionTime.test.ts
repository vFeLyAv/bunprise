import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { endsAtFor, endsOnNextDay, shownEnd, spanText, suggestedEnd, timeSpan } from './occasionTime'

// The end time of an occasion (20261026180000): the next-day rule of the form, the normaliser of the screens
// (an older server sends no ends_at) and the display "19:00–23:00" / "19:00 bis 02:00 (nächster Tag)".

const BERLIN = 'Europe/Berlin'
const t = (key: string, options: { start: string; end: string }) => i18next.t(key, options)

describe('the next-day rule', () => {
  it('an end earlier on the clock than the start lies on the next day; a later one on the same day', () => {
    expect(endsOnNextDay('19:00', '23:00')).toBe(false)
    expect(endsOnNextDay('19:00', '02:00')).toBe(true)
    expect(endsOnNextDay('00:30', '00:15')).toBe(true)
    expect(endsAtFor('2026-12-12', '19:00', '23:00', BERLIN)).toBe('2026-12-12T22:00:00.000Z')
    expect(endsAtFor('2026-12-12', '19:00', '02:00', BERLIN)).toBe('2026-12-13T01:00:00.000Z')
    // across the month and the year
    expect(endsAtFor('2026-12-31', '22:00', '01:30', BERLIN)).toBe('2027-01-01T00:30:00.000Z')
  })

  it('is daylight-saving safe: the night the clocks go back (Berlin, 25 Oct 2026) and forward (29 Mar 2026)', () => {
    // 24 Oct 20:00 CEST (18:00Z) until 25 Oct 02:00 — after the change that is CET: 01:00Z (7 hours)
    expect(endsAtFor('2026-10-24', '20:00', '02:00', BERLIN)).toBe('2026-10-25T01:00:00.000Z')
    // 28 Mar 22:00 CET (21:00Z) until 29 Mar 04:00 CEST (02:00Z)
    expect(endsAtFor('2026-03-28', '22:00', '04:00', BERLIN)).toBe('2026-03-29T02:00:00.000Z')
  })

  it('suggests three hours after the start, past midnight too', () => {
    expect(suggestedEnd('19:00')).toBe('22:00')
    expect(suggestedEnd('22:30')).toBe('01:30')
    expect(suggestedEnd('')).toBe('22:00')
  })
})

describe('shownEnd (what the screens may show)', () => {
  const timed = { starts_at: '2026-12-12T18:00:00.000Z', all_day: false }
  it('a timed occasion with an end after its start', () => {
    expect(shownEnd({ ...timed, ends_at: '2026-12-12T22:00:00.000Z' })).toBe('2026-12-12T22:00:00.000Z')
  })
  it('nothing for all-day, without an end, without the key (older server or persisted feed) and for junk', () => {
    expect(shownEnd({ ...timed, all_day: true, ends_at: '2026-12-12T22:00:00.000Z' })).toBeNull()
    expect(shownEnd({ ...timed, ends_at: null })).toBeNull()
    expect(shownEnd(timed)).toBeNull()
    expect(shownEnd({ ...timed, ends_at: '2026-12-12T18:00:00.000Z' })).toBeNull()
    expect(shownEnd({ ...timed, ends_at: '2026-12-12T17:00:00.000Z' })).toBeNull()
    expect(shownEnd({ ...timed, ends_at: 'bald' })).toBeNull()
  })
})

describe('the display', () => {
  const party = { starts_at: '2026-12-12T18:00:00.000Z', ends_at: '2026-12-13T01:00:00.000Z', all_day: false }
  it('start and end in the zone they are shown in, and whether the end falls on a later day there', () => {
    expect(timeSpan({ ...party, ends_at: '2026-12-12T22:00:00.000Z' }, BERLIN, 'de')).toEqual({ start: '19:00', end: '23:00', nextDay: false })
    expect(timeSpan(party, BERLIN, 'de')).toEqual({ start: '19:00', end: '02:00', nextDay: true })
    expect(timeSpan(party, 'America/New_York', 'de')).toEqual({ start: '13:00', end: '20:00', nextDay: false })
    expect(timeSpan({ ...party, ends_at: null }, BERLIN, 'de')).toEqual({ start: '19:00', end: null, nextDay: false })
  })

  it('"19:00" · "19:00–23:00" · "19:00 bis 02:00 (nächster Tag)"', () => {
    expect(spanText({ start: '19:00', end: null, nextDay: false }, t)).toBe('19:00')
    expect(spanText({ start: '19:00', end: '23:00', nextDay: false }, t)).toBe('19:00–23:00')
    expect(spanText({ start: '19:00', end: '02:00', nextDay: true }, t)).toBe('19:00 bis 02:00 (nächster Tag)')
  })
})
