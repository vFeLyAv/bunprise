import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, foldLine, offsetMinutes, transitions, type IcsEvent } from './ics'
import { events, instantOf, maybe, one, parseIcs, unescapeText } from '../../test/icsValidate'

// The iCalendar writer of 'Zum Kalender hinzufügen' (./ics.ts; the Worker's copy has the same tests). Every file is read back by the strict
// reader in ./icsValidate.ts, and every timed start/end is resolved through the file's OWN VTIMEZONE to the instant
// it came from — so the zone data, daylight saving included, is proven by the file, not by the writer's Intl.

const NOW = new Date(Date.UTC(2026, 9, 27, 10, 0, 0))
const URL_BASE = 'https://bunprise.de/occasions/'
const ID = 'd1e0b000-0000-4000-8000-0000000000aa'

function event(over: Partial<IcsEvent> = {}): IcsEvent {
  return {
    id: ID, title: 'Annas Geburtstag', startsAt: '2026-11-04T18:00:00.000Z', endsAt: null, tz: 'Europe/Berlin', allDay: false,
    place: 'Café am Markt', url: `${URL_BASE}${ID}`, ...over,
  }
}

function roundTrip(list: IcsEvent[]) {
  const text = buildIcs({ events: list, now: NOW })
  const cal = parseIcs(text)
  return { text, cal, vevents: events(cal) }
}

describe('text', () => {
  it('escapes backslash, semicolon, comma and line breaks; strips other control characters (a tab is allowed)', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf\rg\u0007h\ti')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ngh\ti')
  })

  it('folds at 75 octets without splitting a UTF-8 character', () => {
    const line = `SUMMARY:${'День рождения 🎂 '.repeat(12)}`
    const folded = foldLine(line)
    for (const part of folded.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n').map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line)
    expect(folded).not.toContain('�')
  })

  it('round-trips hostile titles, places and descriptions through a strict reader', () => {
    const title = 'Anna; Ben, "Party" \\ wild\nZeile 2 — Ünïcödé 🎉 ' + 'x'.repeat(120)
    const place = 'Straße 1, 10115 Berlin; Hinterhof'
    const description = 'Bring: Sekt, Chips;\nund gute Laune\\'
    const { vevents } = roundTrip([event({ title, place, description })])
    const ev = vevents[0]!
    expect(unescapeText(one(ev, 'SUMMARY').value)).toBe(title.trim())
    expect(unescapeText(one(ev, 'LOCATION').value)).toBe(place)
    expect(unescapeText(one(ev, 'DESCRIPTION').value)).toBe(description.trim())
  })

  it('a property-injection attempt stays text', () => {
    const { text, vevents } = roundTrip([event({ title: 'X\r\nATTENDEE:mailto:evil@example.test\r\nEND:VEVENT' })])
    expect(vevents).toHaveLength(1)
    expect(maybe(vevents[0]!, 'ATTENDEE')).toBeUndefined()
    expect(text).not.toMatch(/\r\nATTENDEE/)
  })
})

describe('calendar structure', () => {
  it('VERSION, PRODID, METHOD; a stable UID per occasion; DTSTAMP in UTC; URL back to the occasion', () => {
    const { text, cal, vevents } = roundTrip([event(), event({ id: 'd1e0b000-0000-4000-8000-0000000000bb', title: 'Zwei' })])
    expect(one(cal, 'VERSION').value).toBe('2.0')
    expect(one(cal, 'METHOD').value).toBe('PUBLISH')
    expect(vevents.map((e) => one(e, 'UID').value)).toEqual([`${ID}@bunprise.de`, 'd1e0b000-0000-4000-8000-0000000000bb@bunprise.de'])
    expect(one(vevents[0]!, 'DTSTAMP').value).toBe('20261027T100000Z')
    expect(one(vevents[0]!, 'URL').value).toBe(`${URL_BASE}${ID}`)
    // the same input = the same file (a second import replaces, never duplicates)
    expect(buildIcs({ events: [event(), event({ id: 'd1e0b000-0000-4000-8000-0000000000bb', title: 'Zwei' })], now: NOW })).toBe(text)
  })

  it('nothing but the given fields: no ATTENDEE, ORGANIZER or anything about wishes', () => {
    const { text } = roundTrip([event({ description: 'Kurz' })])
    expect(text).not.toMatch(/ATTENDEE|ORGANIZER|wish|Wunsch|reserv/i)
  })

  it('an event without a valid start is left out; an empty list is still a valid calendar', () => {
    expect(roundTrip([event({ startsAt: 'kaputt' })]).vevents).toHaveLength(0)
    expect(roundTrip([]).vevents).toHaveLength(0)
  })
})

describe('time zones', () => {
  it('all-day: the DATE of the occasion in its own zone, DTEND the next day (exclusive)', () => {
    // midnight in Berlin = 23:00 UTC the day before
    const { vevents } = roundTrip([event({ allDay: true, startsAt: '2026-11-03T23:00:00.000Z' })])
    expect(one(vevents[0]!, 'DTSTART')).toMatchObject({ params: { VALUE: 'DATE' }, value: '20261104' })
    expect(one(vevents[0]!, 'DTEND')).toMatchObject({ params: { VALUE: 'DATE' }, value: '20261105' })
  })

  it('all-day at a month and year end, and 29 February', () => {
    const days = [['2026-12-30T23:00:00.000Z', '20261231', '20270101'], ['2028-02-28T23:00:00.000Z', '20280229', '20280301']]
    for (const [startsAt, start, end] of days) {
      const ev = roundTrip([event({ allDay: true, startsAt })]).vevents[0]!
      expect([one(ev, 'DTSTART').value, one(ev, 'DTEND').value]).toEqual([start, end])
    }
  })

  it('timed: DTSTART/DTEND in the occasion zone with a VTIMEZONE that resolves back to the same instants', () => {
    const list = [
      event({ startsAt: '2026-07-10T17:00:00.000Z', endsAt: '2026-07-10T21:00:00.000Z' }), // summer, +02:00
      event({ id: 'd1e0b000-0000-4000-8000-0000000000bb', startsAt: '2026-12-10T18:00:00.000Z', endsAt: '2026-12-11T01:00:00.000Z' }), // winter, until the next day
    ]
    const { cal, vevents } = roundTrip(list)
    expect(one(vevents[0]!, 'DTSTART')).toMatchObject({ params: { TZID: 'Europe/Berlin' }, value: '20260710T190000' })
    expect(one(vevents[1]!, 'DTSTART').value).toBe('20261210T190000')
    expect(one(vevents[1]!, 'DTEND').value).toBe('20261211T020000')
    vevents.forEach((ev, i) => {
      expect(new Date(instantOf(cal, one(ev, 'DTSTART'))).toISOString()).toBe(list[i]!.startsAt)
      expect(new Date(instantOf(cal, one(ev, 'DTEND'))).toISOString()).toBe(list[i]!.endsAt)
    })
    expect(cal.children.filter((c) => c.name === 'VTIMEZONE')).toHaveLength(1)
  })

  it('across the daylight-saving changes (Berlin 29.03 and 25.10.2026): the night of the change and the hours around it', () => {
    const list = [
      event({ startsAt: '2026-03-29T00:30:00.000Z', endsAt: '2026-03-29T02:00:00.000Z' }), // 01:30 +01 → 04:00 +02
      event({ id: 'd1e0b000-0000-4000-8000-0000000000bb', startsAt: '2026-10-24T20:00:00.000Z', endsAt: '2026-10-25T03:00:00.000Z' }), // 22:00 +02 → 04:00 +01
      event({ id: 'd1e0b000-0000-4000-8000-0000000000cc', startsAt: '2026-10-25T02:00:00.000Z' }), // 03:00 +01 (just after)
    ]
    const { cal, vevents } = roundTrip(list)
    expect(vevents.map((ev) => one(ev, 'DTSTART').value)).toEqual(['20260329T013000', '20261024T220000', '20261025T030000'])
    expect(one(vevents[1]!, 'DTEND').value).toBe('20261025T040000')
    vevents.forEach((ev, i) => {
      expect(new Date(instantOf(cal, one(ev, 'DTSTART'))).toISOString()).toBe(list[i]!.startsAt)
      const end = maybe(ev, 'DTEND')
      if (end) expect(new Date(instantOf(cal, end)).toISOString()).toBe(list[i]!.endsAt)
    })
    // the VTIMEZONE carries the two 2026 changes with the right offsets
    const zone = cal.children.find((c) => c.name === 'VTIMEZONE')!
    const changes = zone.children.map((o) => `${o.name} ${one(o, 'DTSTART').value} ${one(o, 'TZOFFSETFROM').value}>${one(o, 'TZOFFSETTO').value}`)
    expect(changes).toContain('DAYLIGHT 20260329T020000 +0100>+0200')
    expect(changes).toContain('STANDARD 20261025T030000 +0200>+0100')
  })

  it('several zones in one file (New York, Berlin, Kathmandu +05:45, Lord Howe ±30 min); southern-hemisphere summer', () => {
    const list = [
      event({ tz: 'America/New_York', startsAt: '2026-11-01T05:30:00.000Z', endsAt: '2026-11-01T07:30:00.000Z' }), // 01:30 EDT → 02:30 EST
      event({ id: 'd1e0b000-0000-4000-8000-0000000000bb', tz: 'Asia/Kathmandu', startsAt: '2026-11-04T12:15:00.000Z' }),
      event({ id: 'd1e0b000-0000-4000-8000-0000000000cc', tz: 'Australia/Lord_Howe', startsAt: '2027-01-10T08:00:00.000Z' }),
      event({ id: 'd1e0b000-0000-4000-8000-0000000000dd', tz: 'America/Sao_Paulo', startsAt: '2027-01-10T22:00:00.000Z' }),
    ]
    const { cal, vevents } = roundTrip(list)
    expect(cal.children.filter((c) => c.name === 'VTIMEZONE').map((z) => one(z, 'TZID').value).sort())
      .toEqual(['America/New_York', 'America/Sao_Paulo', 'Asia/Kathmandu', 'Australia/Lord_Howe'])
    expect(one(vevents[1]!, 'DTSTART').value).toBe('20261104T180000')
    vevents.forEach((ev, i) => {
      expect(new Date(instantOf(cal, one(ev, 'DTSTART'))).toISOString(), list[i]!.tz).toBe(list[i]!.startsAt)
    })
  })

  it('UTC and unknown zones are written in UTC (…Z) without a VTIMEZONE', () => {
    for (const tz of ['UTC', 'Etc/UTC', 'Mars/Olympus_Mons', 'Europe/Berlin;X=1']) {
      const { cal, vevents } = roundTrip([event({ tz, startsAt: '2026-11-04T18:00:00.000Z', endsAt: '2026-11-04T20:00:00.000Z' })])
      expect(one(vevents[0]!, 'DTSTART').value, tz).toBe('20261104T180000Z')
      expect(one(vevents[0]!, 'DTEND').value).toBe('20261104T200000Z')
      expect(cal.children.filter((c) => c.name === 'VTIMEZONE')).toHaveLength(0)
    }
  })

  it('no end, or an end not after the start: no DTEND; an all-day occasion ignores ends_at', () => {
    for (const endsAt of [null, '2026-11-04T18:00:00.000Z', '2026-11-04T17:00:00.000Z', 'nope']) {
      expect(maybe(roundTrip([event({ endsAt })]).vevents[0]!, 'DTEND')).toBeUndefined()
    }
    const allDay = roundTrip([event({ allDay: true, startsAt: '2026-11-03T23:00:00.000Z', endsAt: '2026-11-04T20:00:00.000Z' })]).vevents[0]!
    expect(one(allDay, 'DTEND').value).toBe('20261105')
  })

  it('offsets and transitions agree with known facts', () => {
    expect(offsetMinutes(Date.UTC(2026, 6, 1), 'Europe/Berlin')).toBe(120)
    expect(offsetMinutes(Date.UTC(2026, 0, 1), 'Asia/Kathmandu')).toBe(345)
    const changes = transitions('Europe/Berlin', Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1))
    expect(changes.map((c) => new Date(c.at).toISOString())).toEqual(['2026-03-29T01:00:00.000Z', '2026-10-25T01:00:00.000Z'])
  })
})
