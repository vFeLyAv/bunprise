import type { ReactNode } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18next from 'i18next'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { canGoBack: () => false, back: () => undefined }, navigate: () => Promise.resolve() }),
  // the legal text links to the other legal pages
  Link: ({ href, className, children }: { href?: string; className?: string; children?: ReactNode }) => <a href={href} className={className}>{children}</a>,
}))

import { NAMESPACES, contentLocale, currentLanguage, detectLanguage } from '../lib/i18n'
import { otherLanguages } from '../lib/i18nOtherLanguages'
import { formatPrice } from '../lib/format'
import { storageKeys } from '../lib/app'
import { LEGAL_VERSIONS } from '../lib/legal'
import { euros } from '../features/gifts/budget'
import { CountStack } from '../features/lists/CountStack'
import { DateTile } from '../features/calendar/DateTile'
import { monthTitle, weekdayLabels as calendarWeekdays } from '../features/calendar/grid'
import { CalendarGrid } from '../features/occasions/form/CalendarGrid'
import { formatRelativeDay, intlLocale } from '../features/occasions/form/dateFormat'
import { renderWithClient } from '../features/occasions/test-utils'
import { LegalPage } from '../features/legal/LegalPage'

// The app in Ukrainian (2026-10-27): the screens render the Ukrainian strings with Ukrainian plural forms and dates,
// prices and weekdays from Intl's uk-UA — while the server keeps only DE / EN (contentLocale) and the legal pages
// show the German text with a Ukrainian note. A Ukrainian browser gets Ukrainian, never Russian. The test setup
// bundles German only; this file adds Ukrainian.

const uk = import.meta.glob<{ default: Record<string, unknown> }>('../locales/uk/*.json', { eager: true })

beforeAll(async () => {
  for (const [path, mod] of Object.entries(uk)) {
    i18next.addResourceBundle('uk', path.split('/').pop()?.replace('.json', '') ?? '', mod.default, true, true)
  }
  await i18next.changeLanguage('uk')
})

afterAll(async () => {
  await i18next.changeLanguage('de')
})

const noSpaces = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ')

function browser(languages: string[]): string {
  window.localStorage.removeItem(storageKeys.lang)
  const spy = vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages)
  try {
    return detectLanguage()
  } finally {
    spy.mockRestore()
  }
}

describe('Bunprise in Ukrainian', () => {
  it('runs in Ukrainian', () => {
    expect(currentLanguage()).toBe('uk')
    expect(i18next.t('nav.lists')).toBe('Списки')
    expect(i18next.t('nav.start')).toBe('Головна')
    expect(i18next.t('settings.lang_uk')).toBe('Українська')
  })

  it('a list card says its wishes with the Ukrainian plural forms (1 бажання · 3 бажання · 5 бажань · 21 бажання)', () => {
    for (const [count, words] of [[1, '1 бажання'], [3, '3 бажання'], [5, '5 бажань'], [11, '11 бажань'], [21, '21 бажання']] as const) {
      const { unmount } = renderWithClient(<CountStack count={count} preview={null} seed="list-1" />)
      expect(screen.getByText(words)).toBeTruthy()
      unmount()
    }
  })

  it('a date tile shows the Ukrainian month and weekday', () => {
    const { container } = render(<DateTile occasion={{ id: 'occasion-1', starts_at: '2026-10-24T16:00:00Z', tz: 'Europe/Berlin', all_day: false }} />)
    // Saturday, 24 October 2026
    expect(container.textContent).toBe('жовт24сб')
  })

  it('the date picker titles the month "Жовтень 2026" (no "р.") and starts the week on Monday ("Пн" … "Нд")', () => {
    const locale = intlLocale('uk')
    expect(locale).toBe('uk-UA')
    renderWithClient(<CalendarGrid value="2026-10-24" today="2026-10-20" min="2026-10-19" locale={locale}
      labels={{ previous: 'Попередній місяць', next: 'Наступний місяць' }} onSelect={() => undefined} />)
    expect(screen.getAllByText('Жовтень 2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Пн').length).toBeGreaterThan(0)
    expect(monthTitle({ year: 2026, month: 12 }, 'uk')).toBe('Грудень 2026')
    expect(calendarWeekdays('uk')).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'])
  })

  it('relative days and euro prices follow uk-UA — with "€", not Ukrainian\'s own "EUR"', () => {
    expect(formatRelativeDay('2026-10-20', '2026-10-21', 'uk-UA')).toBe('Завтра')
    expect(formatRelativeDay('2026-10-20', '2026-11-01', 'uk-UA')).toBe('Через 12 днів')
    expect(noSpaces(formatPrice(8990))).toBe('89,90 €')
    expect(noSpaces(formatPrice(123450))).toBe('1 234,50 €')
    expect(noSpaces(euros(2490, 'uk'))).toBe('25 €')
    // the other languages keep their symbol
    expect(noSpaces(formatPrice(8990, { locale: 'de' }))).toBe('89,90 €')
    expect(formatPrice(8990, { locale: 'en' })).toBe('€89.90')
    expect(noSpaces(formatPrice(8990, { locale: 'ru' }))).toBe('89,90 €')
  })

  it('a Ukrainian browser gets Ukrainian — never Russian; each language only by its own code', () => {
    expect(browser(['uk-UA', 'ru-RU'])).toBe('uk')
    expect(browser(['uk'])).toBe('uk')
    expect(browser(['UK-ua'])).toBe('uk')
    expect(browser(['de-DE', 'uk-UA'])).toBe('de')
    expect(browser(['ru-RU', 'uk-UA'])).toBe('ru')
    // Russian as spoken in Ukraine is Russian; English as spoken in the UK is English
    expect(browser(['ru-UA'])).toBe('ru')
    expect(browser(['en-GB'])).toBe('en')
    // a remembered choice wins over the browser
    window.localStorage.setItem(storageKeys.lang, 'uk')
    const spy = vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ru-RU'])
    try {
      expect(detectLanguage()).toBe('uk')
    } finally {
      spy.mockRestore()
      window.localStorage.removeItem(storageKeys.lang)
    }
  })

  it('the server only ever hears DE or EN: Ukrainian sends "de" (profile, consents, places, gift ideas)', () => {
    expect(contentLocale('uk')).toBe('de')
    expect(contentLocale('ru')).toBe('de')
    expect(contentLocale('en')).toBe('en')
  })

  it('every namespace has its Ukrainian chunk in the lazy table (lib/i18nOtherLanguages.ts)', () => {
    expect(Object.keys(otherLanguages).filter((key) => key.startsWith('../locales/uk/')).sort()).toEqual(NAMESPACES.map((ns) => `../locales/uk/${ns}.json`).sort())
  })

  it('the legal pages show the German text with one Ukrainian note on top', async () => {
    render(<LegalPage kind="terms" version={LEGAL_VERSIONS.terms} />)
    const note = await screen.findByText('Юридичні тексти є лише німецькою та англійською мовами. Нижче — німецька версія.')
    expect(note.getAttribute('lang')).toBe('uk')
    expect(note.closest('article')?.getAttribute('lang')).toBe('de')
    expect((await screen.findAllByText(/ENTWURF/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/Архівна редакція: .* · DE/)).toBeTruthy()
  })
})
