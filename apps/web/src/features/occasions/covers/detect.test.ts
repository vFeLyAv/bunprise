import { describe, expect, it } from 'vitest'
import { BLOCKED, RULES, THEME_PRIORITY, easterSunday, explainTheme, holidayOf, nearlyContains, normalizeTitle, oneSlip, themeOf } from './detect'
import { SAMPLE_TITLES } from './samples'
import { THEME_IDS, isThemeId } from './themes'

// The title → motif detection (ported with its table from the gallery prototype, packages/mascot/test/covers.test.ts):
// on the device only, precision over recall — 105 titles, 35 of them traps.

describe('the motif list', () => {
  it('16 motifs, each once, each in the priority order, each with words', () => {
    expect(THEME_IDS.length).toBe(16)
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length)
    expect([...THEME_PRIORITY].sort()).toEqual([...THEME_IDS].sort())
    for (const id of THEME_IDS) expect(RULES.find((r) => r.theme === id)?.words.length ?? 0, id).toBeGreaterThan(0)
  })

  it('isThemeId is the allow-list', () => {
    expect(isThemeId('birthday')).toBe(true)
    expect(isThemeId('Birthday')).toBe(false)
    expect(isThemeId('none')).toBe(false)
    expect(isThemeId(3)).toBe(false)
  })
})

describe('themeOf: the detection table', () => {
  it.each(SAMPLE_TITLES.map((s) => [s.title, s.date ?? '', s.expect] as const))('%s %s → %s', (title, date, expected) => {
    expect(themeOf(title, date ? { date } : {})).toBe(expected)
  })

  it('the table is big enough and has traps; every motif is in it', () => {
    expect(SAMPLE_TITLES.length).toBeGreaterThanOrEqual(100)
    expect(SAMPLE_TITLES.filter((s) => s.expect === null).length).toBeGreaterThanOrEqual(20)
    expect(SAMPLE_TITLES.filter((s) => s.trap).length).toBeGreaterThanOrEqual(25)
    for (const id of THEME_IDS) expect(SAMPLE_TITLES.some((s) => s.expect === id), id).toBe(true)
  })

  it("Felix's examples: gym (also in Russian), birthday, game night — and the screenshots' titles", () => {
    expect(themeOf('Gym')).toBe('sport')
    expect(themeOf('Зал')).toBe('sport')
    expect(themeOf('Training im Gym')).toBe('sport')
    expect(themeOf('Geburtstag von Anna')).toBe('birthday')
    expect(themeOf('День рождения')).toBe('birthday')
    expect(themeOf('Spieleabend')).toBe('gamenight')
    expect(themeOf('Steuererklärung')).toBeNull()
  })

  it('an empty or blank title has no motif', () => {
    expect(themeOf('')).toBeNull()
    expect(themeOf('   ')).toBeNull()
    expect(themeOf('🎉🎉')).toBeNull()
  })

  it('a sad or medical word blocks every motif, also on a holiday', () => {
    expect(explainTheme('Geburtstag im Krankenhaus')).toMatchObject({ theme: null, via: 'blocked' })
    expect(themeOf('Trauerfeier', { date: '2026-12-24' })).toBeNull()
    expect(BLOCKED.length).toBeGreaterThan(10)
  })

  it('is pure: the same title gives the same answer, case and accents do not matter', () => {
    expect(themeOf('GEBURTSTAG')).toBe('birthday')
    expect(themeOf('Wohnungs-Einweihung')).toBe('housewarming')
    expect(themeOf('Fussball')).toBe('sport')
    expect(themeOf('Fußball')).toBe('sport')
    expect(themeOf('Ёлка и Новый год')).toBe('newyear')
    for (let i = 0; i < 3; i += 1) expect(themeOf('Spieleabend bei Mila')).toBe('gamenight')
  })

  it('explains why', () => {
    expect(explainTheme('Geburstag Oma')).toEqual({ theme: 'birthday', via: 'word', pattern: '~geburtstag', matched: 'geburstag' })
    expect(explainTheme('Party', { date: '2026-12-31' })).toMatchObject({ theme: 'newyear', via: 'date' })
    expect(explainTheme('Юбилей бабушки')).toMatchObject({ theme: 'birthday', via: 'weak' })
    expect(explainTheme('Treffen mit Jo')).toEqual({ theme: null, via: 'none', pattern: null, matched: null })
  })
})

describe('the helpers', () => {
  it('normalizeTitle: lower case, ß → ss, accents off, punctuation = space', () => {
    expect(normalizeTitle('Größe & Fußball-Spiel!')).toBe('grosse fussball spiel')
    expect(normalizeTitle('  Ёлка, йога  ')).toBe('елка иога')
    expect(normalizeTitle("Max's B-Day")).toBe('max s b day')
  })

  it('oneSlip: one missing, extra or swapped letter — never a wrong one', () => {
    expect(oneSlip('geburstag', 'geburtstag')).toBe(true)
    expect(oneSlip('geburtsstag', 'geburtstag')).toBe(true)
    expect(oneSlip('gebrutstag', 'geburtstag')).toBe(true)
    expect(oneSlip('geburtstsg', 'geburtstag')).toBe(false)
    expect(oneSlip('weinnacht', 'weihnacht')).toBe(false)
  })

  it('nearlyContains: only for stems of 8+ letters', () => {
    expect(nearlyContains('weinachtsfeier', 'weihnacht')).toBe(true)
    expect(nearlyContains('kinoabend', 'kino')).toBe(true)
    expect(nearlyContains('kio', 'kino')).toBe(false)
  })

  it('Easter Sunday and the holidays of a day', () => {
    expect(easterSunday(2026)).toEqual([4, 5])
    expect(easterSunday(2027)).toEqual([3, 28])
    expect(easterSunday(2025)).toEqual([4, 20])
    expect(holidayOf('2026-04-06')).toBe('easter')
    expect(holidayOf('2026-04-07')).toBeNull()
    expect(holidayOf('2026-12-26')).toBe('christmas')
    expect(holidayOf('2027-01-01')).toBe('newyear')
    expect(holidayOf('2026-10-31')).toBe('halloween')
    expect(holidayOf('not a date')).toBeNull()
  })
})
