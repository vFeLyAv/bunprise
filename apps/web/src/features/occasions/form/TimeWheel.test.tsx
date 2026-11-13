import { useState } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithClient } from '../test-utils'
import type { HourCycle } from './dateFormat'
import { TimeWheel } from './TimeWheel'

// The time wheel: spinbutton semantics (↑/↓, PageUp/PageDown, Home/End, typed digits), 5-minute steps,
// 24 h in German, the locale's own clock (12 h + AM/PM) in US English. The value is always "HH:mm" (24 h).

const LABELS = {
  group: 'Uhrzeit',
  hour: 'Stunde',
  minute: 'Minute',
  period: 'Vormittag oder Nachmittag',
  hourText: (hour: string) => `${hour} Uhr`,
  minuteText: (minute: string) => `${minute} Minuten`,
}

function Harness({ initial, locale = 'de-DE', cycle = 'h23', onChange }: { initial: string; locale?: string; cycle?: HourCycle; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <output data-testid="value">{value}</output>
      <TimeWheel
        value={value}
        locale={locale}
        cycle={cycle}
        labels={LABELS}
        onChange={(next) => {
          onChange?.(next)
          setValue(next)
        }}
      />
    </>
  )
}

const value = () => screen.getByTestId('value').textContent
const spin = (name: string) => screen.getByRole('spinbutton', { name })

describe('time wheel', () => {
  it('shows hours and 5-minute steps as two spinbuttons (24 h)', () => {
    renderWithClient(<Harness initial="19:00" />)
    expect(screen.getByRole('group', { name: 'Uhrzeit' })).toBeTruthy()
    expect(spin('Stunde').getAttribute('aria-valuenow')).toBe('19')
    expect(spin('Stunde').getAttribute('aria-valuetext')).toBe('19 Uhr')
    expect(spin('Stunde').getAttribute('aria-valuemin')).toBe('0')
    expect(spin('Stunde').getAttribute('aria-valuemax')).toBe('23')
    expect(spin('Minute').getAttribute('aria-valuenow')).toBe('0')
    expect(spin('Minute').querySelectorAll('.of-wheel-item')).toHaveLength(12)
    expect(screen.queryByRole('spinbutton', { name: 'Vormittag oder Nachmittag' })).toBeNull()
  })

  it('steps with the keys and stops at the ends', () => {
    renderWithClient(<Harness initial="19:00" />)
    fireEvent.keyDown(spin('Stunde'), { key: 'ArrowUp' })
    expect(value()).toBe('20:00')
    fireEvent.keyDown(spin('Stunde'), { key: 'ArrowDown' })
    fireEvent.keyDown(spin('Stunde'), { key: 'ArrowDown' })
    expect(value()).toBe('18:00')
    fireEvent.keyDown(spin('Minute'), { key: 'PageUp' })
    expect(value()).toBe('18:15')
    fireEvent.keyDown(spin('Minute'), { key: 'ArrowUp' })
    expect(value()).toBe('18:20')
    fireEvent.keyDown(spin('Minute'), { key: 'End' })
    expect(value()).toBe('18:55')
    fireEvent.keyDown(spin('Minute'), { key: 'ArrowUp' })
    expect(value()).toBe('18:55')
    fireEvent.keyDown(spin('Stunde'), { key: 'Home' })
    expect(value()).toBe('00:55')
    fireEvent.keyDown(spin('Stunde'), { key: 'ArrowDown' })
    expect(value()).toBe('00:55')
  })

  it('takes typed digits (the typed fallback), any minute included', () => {
    renderWithClient(<Harness initial="19:00" />)
    fireEvent.keyDown(spin('Stunde'), { key: '2' })
    fireEvent.keyDown(spin('Stunde'), { key: '1' })
    expect(value()).toBe('21:00')
    fireEvent.keyDown(spin('Minute'), { key: '0' })
    fireEvent.keyDown(spin('Minute'), { key: '7' })
    expect(value()).toBe('21:07')
    // the off-grid minute joins the wheel
    expect(spin('Minute').getAttribute('aria-valuenow')).toBe('7')
    expect(spin('Minute').querySelectorAll('.of-wheel-item')).toHaveLength(13)
  })

  it('keeps a stored off-grid time untouched until someone changes it', () => {
    const onChange = vi.fn()
    renderWithClient(<Harness initial="18:07" onChange={onChange} />)
    expect(spin('Minute').getAttribute('aria-valuenow')).toBe('7')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(spin('Minute'), { key: 'ArrowUp' })
    expect(value()).toBe('18:10')
  })

  it('a tap on an item picks it', () => {
    renderWithClient(<Harness initial="19:00" />)
    const items = Array.from(spin('Minute').querySelectorAll<HTMLElement>('.of-wheel-item'))
    fireEvent.click(items.find((item) => item.textContent === '30') as HTMLElement)
    expect(value()).toBe('19:30')
  })

  it('uses the 12 h clock with AM/PM for US English', () => {
    renderWithClient(<Harness initial="19:30" locale="en-US" cycle="h12" />)
    expect(spin('Stunde').getAttribute('aria-valuenow')).toBe('7')
    expect(spin('Stunde').getAttribute('aria-valuemin')).toBe('1')
    expect(spin('Stunde').getAttribute('aria-valuemax')).toBe('12')
    const period = spin('Vormittag oder Nachmittag')
    expect(period.getAttribute('aria-valuetext')).toBe('PM')
    fireEvent.keyDown(period, { key: 'a' })
    expect(value()).toBe('07:30')
    fireEvent.keyDown(spin('Stunde'), { key: '1' })
    fireEvent.keyDown(spin('Stunde'), { key: '2' })
    expect(value()).toBe('00:30') // 12 AM
    fireEvent.keyDown(period, { key: 'p' })
    expect(value()).toBe('12:30') // 12 PM
  })
})
