import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock('../../lib/api/profile', () => ({ getMe: api.get, updateMyProfile: api.update }))
import { RenameNameSheet } from './RenameNameSheet'

beforeEach(() => {
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
  setRenderedAccount('a')
  api.get.mockResolvedValue({ profile: { id: 'a', display_name: 'Mia' } })
  api.update.mockResolvedValue({ id: 'a', display_name: 'Mila' })
})

it('reads a fresh name on every opening, saves to the shown account and reopens with the new name', async () => {
  const saved = vi.fn(), close = vi.fn()
  const view = render(<RenameNameSheet userId="a" onClose={close} onSaved={saved} />)
  const field = await screen.findByLabelText('Name')
  expect((field as HTMLInputElement).value).toBe('Mia')
  fireEvent.change(field, { target: { value: ' Mila ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  expect(api.update).toHaveBeenCalledWith({ display_name: 'Mila' }, 'a')
  expect(saved).toHaveBeenCalledWith('Mila')
  view.unmount()
  api.get.mockResolvedValue({ profile: { id: 'a', display_name: 'Mila' } })
  render(<RenameNameSheet userId="a" onClose={close} onSaved={saved} />)
  expect((await screen.findByLabelText('Name') as HTMLInputElement).value).toBe('Mila')
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.get).toHaveBeenLastCalledWith('a')
  expect(screen.queryByText(/Abmelden|Konto löschen|Nutzungsbedingungen/)).toBeNull()
  expect(document.querySelector('[data-welcome],[data-mascot]')).toBeNull()
})

it('shows the 40 character limit inline and cancels without saving', async () => {
  const close = vi.fn()
  render(<RenameNameSheet userId="a" onClose={close} onSaved={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'a'.repeat(41) } })
  expect(screen.getByText('Dein Name darf höchstens 40 Zeichen haben')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(close).toHaveBeenCalledTimes(1)
  expect(api.update).not.toHaveBeenCalled()
})

it('discards a late save after account replacement', async () => {
  let finish!: (profile: unknown) => void
  api.update.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  const saved = vi.fn(), close = vi.fn()
  render(<RenameNameSheet userId="a" onClose={close} onSaved={saved} />)
  await screen.findByLabelText('Name')
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  endAccountEpoch(); setRenderedAccount('b')
  await act(async () => finish({ id: 'a', display_name: 'Mila' }))
  expect(saved).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it('stays mounted through closing, fetches only when opened, and rejects a save from a previous opening', async () => {
  const saved = vi.fn(), close = vi.fn()
  const props = { userId: 'a', onClose: close, onSaved: saved }
  const view = render(<RenameNameSheet {...props} open={false} />)
  expect(api.get).not.toHaveBeenCalled()
  view.rerender(<RenameNameSheet {...props} open />)
  const field = await screen.findByLabelText('Name')
  let finish!: (profile: unknown) => void
  api.update.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  fireEvent.change(field, { target: { value: 'Old save' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  view.rerender(<RenameNameSheet {...props} open={false} />)
  api.get.mockResolvedValue({ profile: { id: 'a', display_name: 'Fresh name' } })
  view.rerender(<RenameNameSheet {...props} open />)
  await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Fresh name'))
  await act(async () => finish({ id: 'a', display_name: 'Old save' }))
  expect(saved).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Fresh name')
  expect(api.get).toHaveBeenCalledTimes(2)
})
