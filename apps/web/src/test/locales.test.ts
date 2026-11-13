import { describe, expect, it } from 'vitest'
import i18next from 'i18next'
import { LANGUAGES, NAMESPACES } from '../lib/i18n'

// DE, EN, RU and UK must always have the same keys (feature agents add keys to every language). Plural keys follow
// each language's plural rules (Intl.PluralRules, as i18next uses them): DE/EN key_one + key_other, RU and UK
// key_one + key_few + key_many + key_other ("1 желание · 2 желания · 5 желаний", "1 бажання · 2 бажання · 5 бажань").
// A plural key is one whose base has both _one and _other in German (a lone "tz_other" is an ordinary key).

const files = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*/*.json', { eager: true })

const PLURAL_FORMS: Record<(typeof LANGUAGES)[number], readonly string[]> = {
  de: ['one', 'other'],
  en: ['one', 'other'],
  ru: ['one', 'few', 'many', 'other'],
  uk: ['one', 'few', 'many', 'other'],
}

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

function entries(value: unknown, prefix = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [[prefix, value]]
  return Object.entries(value).flatMap(([key, child]) => entries(child, prefix ? `${prefix}.${key}` : key))
}

function load(lng: string, ns: string): Record<string, unknown> | undefined {
  return files[`../locales/${lng}/${ns}.json`]?.default
}

/** The German keys with every plural base spelled out in the forms of `lng`. */
function expectedKeys(deKeys: readonly string[], lng: (typeof LANGUAGES)[number]): string[] {
  const set = new Set(deKeys)
  const bases = new Set(deKeys.flatMap((key) => {
    const match = /^(.*)_one$/.exec(key)
    return match && set.has(`${match[1]}_other`) ? [match[1]] : []
  }))
  const rest = deKeys.filter((key) => {
    const match = /^(.*)_(one|other)$/.exec(key)
    return !(match && bases.has(match[1]))
  })
  return [...rest, ...[...bases].flatMap((base) => PLURAL_FORMS[lng].map((form) => `${base}_${form}`))].sort()
}

/** {{name}}, {{count}} … — sorted, without duplicates */
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1] ?? ''))].sort()
}

/** The German string a key translates: the key itself or, for a plural form the German lacks (_few/_many), _other. */
function germanSource(de: Map<string, unknown>, key: string): unknown {
  return de.get(key) ?? de.get(key.replace(/_(few|many)$/, '_other'))
}

describe('locales', () => {
  it('every language of the app has its translations', () => {
    expect([...LANGUAGES]).toEqual(['de', 'en', 'ru', 'uk'])
  })

  for (const ns of NAMESPACES) {
    it(`${ns}: DE, EN, RU and UK exist with identical keys (plural forms per language) and no empty strings`, () => {
      const de = load('de', ns)
      expect(de, `missing locales/de/${ns}.json`).toBeDefined()
      const deKeys = flatten(de)
      for (const lng of LANGUAGES) {
        const strings = load(lng, ns)
        expect(strings, `missing locales/${lng}/${ns}.json`).toBeDefined()
        expect(flatten(strings).sort(), `${lng}/${ns}.json`).toEqual(expectedKeys(deKeys, lng))
        for (const [key, value] of entries(strings)) {
          expect(typeof value, `${lng} ${key}`).toBe('string')
          expect((value as string).trim(), `${lng} ${key}`).not.toBe('')
        }
      }
    })

    it(`${ns}: RU and UK keep every placeholder and markup tag of the German text`, () => {
      const de = new Map(entries(load('de', ns)))
      for (const lng of ['ru', 'uk']) {
        for (const [key, value] of entries(load(lng, ns))) {
          const source = germanSource(de, key)
          expect(typeof source, `${lng} ${key} has no German source`).toBe('string')
          expect(placeholders(value as string), `${lng} ${key}`).toEqual(placeholders(source as string))
          expect((value as string).match(/<\/?\d+>/g) ?? [], `${lng} ${key}`).toEqual((source as string).match(/<\/?\d+>/g) ?? [])
        }
      }
    })

    it(`${ns}: UK is Ukrainian, not Russian (none of ы, э, ъ, ё)`, () => {
      for (const [key, value] of entries(load('uk', ns))) expect(value as string, `uk ${key}`).not.toMatch(/[ыэъё]/i)
    })
  }

  it('Ukrainian plural forms resolve for 1 · 2 · 5 · 11 · 21 · 22 · 25 (i18next + Intl.PluralRules)', async () => {
    const uk = i18next.createInstance()
    await uk.init({ lng: 'uk', resources: { uk: { nav: load('uk', 'nav') ?? {}, people: load('uk', 'people') ?? {} } }, ns: ['nav', 'people'], defaultNS: 'nav' })
    const wishes = (count: number) => uk.t('newmenu.wishes_count', { count })
    expect([1, 2, 5, 11, 21, 22, 25].map(wishes)).toEqual([
      '1 бажання', '2 бажання', '5 бажань', '11 бажань', '21 бажання', '22 бажання', '25 бажань',
    ])
    expect([1, 3, 5, 21].map((count) => uk.t('cal.cell_count', { date: '24', count }))).toEqual([
      '24, 1 подія', '24, 3 події', '24, 5 подій', '24, 21 подія',
    ])
    expect(uk.t('people:people.time.days', { count: 3 })).toBe('3 дні тому')
    expect(uk.t('people:people.time.days', { count: 11 })).toBe('11 днів тому')
  })

  it('Russian plural forms resolve for 1 · 2 · 5 · 11 · 21 · 22 · 25 (i18next + Intl.PluralRules)', async () => {
    const ru = i18next.createInstance()
    await ru.init({ lng: 'ru', resources: { ru: { nav: load('ru', 'nav') ?? {}, people: load('ru', 'people') ?? {} } }, ns: ['nav', 'people'], defaultNS: 'nav' })
    const wishes = (count: number) => ru.t('newmenu.wishes_count', { count })
    expect([1, 2, 5, 11, 21, 22, 25].map(wishes)).toEqual([
      '1 желание', '2 желания', '5 желаний', '11 желаний', '21 желание', '22 желания', '25 желаний',
    ])
    expect(ru.t('people:people.time.days', { count: 3 })).toBe('3 дня назад')
  })

  it('spec keys resolve across namespaces through fallbackNS', () => {
    expect(i18next.t('wish.add')).toBe('Wunsch hinzufügen')
    expect(i18next.t('errors.generic')).toBe('Hat nicht geklappt – versuch es nochmal')
    expect(i18next.t('common.app_name')).toBe('Bunprise')
    expect(i18next.t('onb.hello')).toContain('Pompon')
  })
})
