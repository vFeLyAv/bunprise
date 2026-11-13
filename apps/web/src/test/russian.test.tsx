import type { ReactNode } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18next from 'i18next'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { canGoBack: () => false, back: () => undefined }, navigate: () => Promise.resolve() }),
  // the legal text links to the other legal pages
  Link: ({ href, className, children }: { href?: string; className?: string; children?: ReactNode }) => <a href={href} className={className}>{children}</a>,
}))

import { contentLocale, currentLanguage, detectLanguage } from '../lib/i18n'
import { formatPrice } from '../lib/format'
import { storageKeys } from '../lib/app'
import { LEGAL_VERSIONS } from '../lib/legal'
import { CountStack } from '../features/lists/CountStack'
import { DateTile } from '../features/calendar/DateTile'
import { monthTitle, weekdayLabels as calendarWeekdays } from '../features/calendar/grid'
import { CalendarGrid } from '../features/occasions/form/CalendarGrid'
import { formatRelativeDay, intlLocale } from '../features/occasions/form/dateFormat'
import { renderWithClient } from '../features/occasions/test-utils'
import { LegalPage } from '../features/legal/LegalPage'

// The app in Russian (2026-10-23): the screens render the Russian strings with Russian plural forms and dates,
// prices and weekdays from Intl's ru-RU — while the server keeps only DE / EN (contentLocale) and the legal pages
// show the German text with a Russian note. The test setup bundles German only; this file adds Russian.

const ru = import.meta.glob<{ default: Record<string, unknown> }>('../locales/ru/*.json', { eager: true })

beforeAll(async () => {
  for (const [path, mod] of Object.entries(ru)) {
    i18next.addResourceBundle('ru', path.split('/').pop()?.replace('.json', '') ?? '', mod.default, true, true)
  }
  await i18next.changeLanguage('ru')
})

afterAll(async () => {
  await i18next.changeLanguage('de')
})

const noSpaces = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ')

describe('Bunprise in Russian', () => {
  it('runs in Russian', () => {
    expect(currentLanguage()).toBe('ru')
    expect(i18next.t('nav.lists')).toBe('Списки')
  })

  it('a list card says its wishes with the Russian plural forms (1 желание · 3 желания · 5 желаний · 21 желание)', () => {
    for (const [count, words] of [[1, '1 желание'], [3, '3 желания'], [5, '5 желаний'], [21, '21 желание']] as const) {
      const { unmount } = renderWithClient(<CountStack count={count} preview={null} seed="list-1" />)
      expect(screen.getByText(words)).toBeTruthy()
      unmount()
    }
  })

  it('a date tile shows the Russian month and weekday', () => {
    const { container } = render(<DateTile occasion={{ id: 'occasion-1', starts_at: '2026-10-24T16:00:00Z', tz: 'Europe/Berlin', all_day: false }} />)
    // Saturday, 24 October 2026
    expect(container.textContent).toBe('окт24сб')
  })

  it('the date picker titles the month "Октябрь 2026" (no "г.") and starts the week on Monday ("Пн")', () => {
    const locale = intlLocale('ru')
    expect(locale).toBe('ru-RU')
    renderWithClient(<CalendarGrid value="2026-10-24" today="2026-10-20" min="2026-10-19" locale={locale}
      labels={{ previous: 'Предыдущий месяц', next: 'Следующий месяц' }} onSelect={() => undefined} />)
    expect(screen.getAllByText('Октябрь 2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Пн').length).toBeGreaterThan(0)
    expect(monthTitle({ year: 2026, month: 12 }, 'ru')).toBe('Декабрь 2026')
    expect(calendarWeekdays('ru')).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
  })

  it('relative days and euro prices follow ru-RU (EUR stays EUR)', () => {
    expect(formatRelativeDay('2026-10-20', '2026-10-21', 'ru-RU')).toBe('Завтра')
    expect(formatRelativeDay('2026-10-20', '2026-11-01', 'ru-RU')).toBe('Через 12 дней')
    expect(noSpaces(formatPrice(8990))).toBe('89,90 €')
    expect(noSpaces(formatPrice(123450))).toBe('1 234,50 €')
  })

  it('a Russian browser gets Russian; the server only ever hears DE or EN', () => {
    window.localStorage.removeItem(storageKeys.lang)
    const languages = vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ru-RU', 'de-DE'])
    try {
      expect(detectLanguage()).toBe('ru')
    } finally {
      languages.mockRestore()
    }
    expect(contentLocale('ru')).toBe('de')
    expect(contentLocale('en')).toBe('en')
    expect(contentLocale('de')).toBe('de')
  })

  it('the legal pages show the German text with one Russian note on top', async () => {
    render(<LegalPage kind="terms" version={LEGAL_VERSIONS.terms} />)
    const note = await screen.findByText('Юридические тексты есть только на немецком и английском языках. Ниже — немецкая версия.')
    expect(note.getAttribute('lang')).toBe('ru')
    expect(note.closest('article')?.getAttribute('lang')).toBe('de')
    expect((await screen.findAllByText(/ENTWURF/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/Архивная редакция: .* · DE/)).toBeTruthy()
  })
})
