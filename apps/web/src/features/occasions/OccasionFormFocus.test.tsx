import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderWithClient, HOST_ID } from './test-utils'
const settings = vi.hoisted(() => ({ calm: false }))
vi.mock('./form/motion', async (original) => ({ ...await original<typeof import('./form/motion')>(), useCalmMotion: () => settings.calm }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: ({ onEnd }: { onEnd: () => void }) => <button data-testid="date-bunny" onClick={onEnd}>End moment</button> }))
vi.mock('./form/DateField', () => ({ DateField: ({ open, onOpenChange, onChange }: {
  open: boolean; onOpenChange: (open: boolean) => void; onChange: (date: string) => void
}) => <><button type="button" onClick={() => onOpenChange(true)}>Open date</button>{open ? <button type="button" onClick={() => onChange('2030-06-15')}>Pick date</button> : null}</> }))
import { OccasionForm } from './OccasionForm'
import { emptyOccasionValues } from './form'

beforeEach(() => { settings.calm = false; vi.useFakeTimers() })
afterEach(() => vi.useRealTimers())
function form() { return renderWithClient(<OccasionForm userId={HOST_ID} tone={1} initial={emptyOccasionValues()} timeZone="Europe/Berlin" onSubmit={vi.fn()} />) }
function pick() {
  fireEvent.click(screen.getByRole('button', { name: 'Open date' }))
  const button = screen.getByRole('button', { name: 'Pick date' })
  button.focus(); fireEvent.click(button)
}

it('focuses the new title without a mascot and waits for date close before peeking', () => {
  form()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Titel' }))
  expect(screen.queryByTestId('date-bunny')).toBeNull()
  pick()
  expect(screen.queryByRole('button', { name: 'Pick date' })).toBeNull()
  act(() => vi.advanceTimersByTime(279))
  expect(screen.queryByTestId('date-bunny')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByTestId('date-bunny')).toBeTruthy()
  fireEvent.click(screen.getByTestId('date-bunny'))
  pick(); act(() => vi.advanceTimersByTime(280))
  expect(screen.queryByTestId('date-bunny')).toBeNull()
  act(() => vi.advanceTimersByTime(10_000))
  pick(); act(() => vi.advanceTimersByTime(280))
  expect(screen.getByTestId('date-bunny')).toBeTruthy()
})

it('never starts while typing or under reduced motion', () => {
  const view = form()
  pick()
  screen.getByRole('textbox', { name: 'Titel' }).focus()
  act(() => vi.advanceTimersByTime(300))
  expect(screen.queryByTestId('date-bunny')).toBeNull()
  view.unmount()
  settings.calm = true
  form(); pick(); act(() => vi.advanceTimersByTime(300))
  expect(screen.queryByTestId('date-bunny')).toBeNull()
})
