import { useState } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithClient } from '../test-utils'
import { CalendarGrid } from './CalendarGrid'

// The month grid of the date picker: WAI-ARIA APG date-picker keyboard support, Monday-first weeks,
// the earliest day, picks by tap (also of a faded neighbouring day) and from outside (quick chips).

const TODAY = '2026-10-20' // a Tuesday
const MIN = '2026-10-19' // yesterday: the form's slack for time zones

function Harness({ initial = '', onSelect, onEscape, autoFocus = true }: { initial?: string; onSelect?: (day: string) => void; onEscape?: () => void; autoFocus?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <button type="button" onClick={() => setValue('2026-12-24')}>
        chip
      </button>
      <CalendarGrid
        value={value}
        today={TODAY}
        min={MIN}
        locale="de-DE"
        labels={{ previous: 'Vorheriger Monat', next: 'Nächster Monat' }}
        autoFocus={autoFocus}
        onEscape={onEscape}
        onSelect={(day) => {
          onSelect?.(day)
          setValue(day)
        }}
      />
    </>
  )
}

const focusedDay = () => (document.activeElement as HTMLElement | null)?.dataset['date']
const press = (key: string, init: { shiftKey?: boolean } = {}) => fireEvent.keyDown(document.activeElement as Element, { key, ...init })
const monthLabel = () => document.querySelector('.of-cal-title')?.textContent

describe('calendar grid (date picker)', () => {
  it('is a labelled grid with Monday-first columns, today marked', () => {
    renderWithClient(<Harness />)
    const grid = screen.getByRole('grid', { name: 'Oktober 2026' })
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Montag',
      'Dienstag',
      'Mittwoch',
      'Donnerstag',
      'Freitag',
      'Samstag',
      'Sonntag',
    ])
    expect(screen.getByRole('gridcell', { name: 'Dienstag, 20. Oktober 2026' }).getAttribute('aria-current')).toBe('date')
    // six weeks, the first starts on Monday 28 September (the faded days carry no name)
    expect(grid.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(grid.querySelector('td')?.textContent).toBe('28')
  })

  it('starts the keyboard on today, or on the chosen day', () => {
    const { unmount } = renderWithClient(<Harness />)
    expect(focusedDay()).toBe(TODAY)
    unmount()
    renderWithClient(<Harness initial="2026-11-05" />)
    expect(focusedDay()).toBe('2026-11-05')
    expect(monthLabel()).toBe('November 2026')
    expect(screen.getByRole('gridcell', { name: 'Donnerstag, 5. November 2026' }).getAttribute('aria-selected')).toBe('true')
  })

  it('moves like the APG date picker: arrows, Home/End, PageUp/PageDown, Shift for years', () => {
    renderWithClient(<Harness />)
    press('ArrowRight')
    expect(focusedDay()).toBe('2026-10-21')
    press('ArrowDown')
    expect(focusedDay()).toBe('2026-10-28')
    press('ArrowLeft')
    expect(focusedDay()).toBe('2026-10-27')
    press('ArrowUp')
    expect(focusedDay()).toBe('2026-10-20')
    press('End')
    expect(focusedDay()).toBe('2026-10-25') // Sunday
    press('Home')
    expect(focusedDay()).toBe('2026-10-19') // Monday
    press('PageDown')
    expect(focusedDay()).toBe('2026-11-19')
    expect(monthLabel()).toBe('November 2026')
    press('PageDown', { shiftKey: true })
    expect(focusedDay()).toBe('2027-11-19')
    expect(monthLabel()).toBe('November 2027')
    press('PageUp', { shiftKey: true })
    press('PageUp')
    expect(focusedDay()).toBe('2026-10-19')
    expect(monthLabel()).toBe('Oktober 2026')
  })

  it('crosses month ends with the arrows and announces the new month', () => {
    renderWithClient(<Harness initial="2026-10-31" />)
    expect(document.querySelector('.of-cal-title')?.getAttribute('aria-live')).toBe('polite')
    press('ArrowRight')
    expect(focusedDay()).toBe('2026-11-01')
    expect(monthLabel()).toBe('November 2026')
    press('ArrowLeft')
    expect(focusedDay()).toBe('2026-10-31')
    expect(monthLabel()).toBe('Oktober 2026')
  })

  it('picks the focused day with Enter or Space and closes with Esc', () => {
    const onSelect = vi.fn()
    const onEscape = vi.fn()
    renderWithClient(<Harness onSelect={onSelect} onEscape={onEscape} />)
    press('ArrowRight')
    press('Enter')
    expect(onSelect).toHaveBeenLastCalledWith('2026-10-21')
    expect(screen.getByRole('gridcell', { name: 'Mittwoch, 21. Oktober 2026' }).getAttribute('aria-selected')).toBe('true')
    press('ArrowRight')
    press(' ')
    expect(onSelect).toHaveBeenLastCalledWith('2026-10-22')
    press('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('never goes before the earliest day', () => {
    const onSelect = vi.fn()
    renderWithClient(<Harness onSelect={onSelect} />)
    const past = screen.getByRole('gridcell', { name: 'Sonntag, 18. Oktober 2026' })
    expect(past.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(past)
    expect(onSelect).not.toHaveBeenCalled()
    press('Home') // Monday 19 = the earliest day
    press('ArrowLeft')
    expect(focusedDay()).toBe(MIN)
    press('PageUp')
    expect(focusedDay()).toBe(MIN)
    expect((screen.getByRole('button', { name: 'Vorheriger Monat' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('picks a tapped day, also a faded day of the next month, and turns the page to it', () => {
    const onSelect = vi.fn()
    renderWithClient(<Harness onSelect={onSelect} autoFocus={false} />)
    fireEvent.click(screen.getByRole('gridcell', { name: 'Freitag, 30. Oktober 2026' }))
    expect(onSelect).toHaveBeenLastCalledWith('2026-10-30')
    const faded = screen.getByRole('grid').querySelectorAll<HTMLElement>('td[data-outside]')
    fireEvent.click(faded[faded.length - 1] as HTMLElement) // Sunday 8 November
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-08')
    expect(monthLabel()).toBe('November 2026')
    expect(screen.getByRole('gridcell', { name: 'Sonntag, 8. November 2026' }).getAttribute('aria-selected')).toBe('true')
  })

  it('follows a pick from outside (a quick chip) to its month, and the chevrons turn pages', () => {
    renderWithClient(<Harness autoFocus={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'chip' }))
    expect(monthLabel()).toBe('Dezember 2026')
    expect(screen.getByRole('gridcell', { name: 'Donnerstag, 24. Dezember 2026' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }))
    expect(monthLabel()).toBe('Januar 2027')
    fireEvent.click(screen.getByRole('button', { name: 'Vorheriger Monat' }))
    expect(monthLabel()).toBe('Dezember 2026')
  })
})
