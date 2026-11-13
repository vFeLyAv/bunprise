import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from '../../routeTree.gen'
import { requestEmailCode, verifyEmailCode } from '../../lib/api/auth'
import { forgetEmailAttempt, readEmailAttempt, rememberEmailAttempt } from './flow'

vi.mock('../../lib/api/auth', async (original) => ({
  ...await original<typeof import('../../lib/api/auth')>(), requestEmailCode: vi.fn(), verifyEmailCode: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  forgetEmailAttempt()
  vi.mocked(requestEmailCode).mockResolvedValue()
})

function renderCode(path: string) {
  const router = createRouter({
    routeTree, context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

it('resends an existing-account code without enabling signup, even when the URL mode changes', async () => {
  rememberEmailAttempt('known@example.test', Date.now() - 61_000, 'signin')
  renderCode('/login/code?mode=signup&next=%2Fi')
  await screen.findByRole('heading', { name: 'Code eingeben' })
  expect(document.activeElement).toBe(screen.getByLabelText('Sechsstelliger Code'))
  fireEvent.click(screen.getByRole('button', { name: 'Code nochmal schicken' }))
  await waitFor(() => expect(requestEmailCode).toHaveBeenCalledWith('known@example.test', expect.objectContaining({ mode: 'signin' })))
  expect(readEmailAttempt()?.mode).toBe('signin')
  const back = new URL(screen.getByRole('link', { name: 'Andere E-Mail-Adresse' }).getAttribute('href')!, 'http://localhost')
  expect(back.searchParams.get('mode')).toBe('signin')
  expect(back.searchParams.get('method')).toBe('email')
  expect(back.searchParams.get('next')).toBe('/i')
})

it('returns an expired signup attempt to its email form without sending a new code', async () => {
  rememberEmailAttempt('new@example.test', Date.now() - 11 * 60_000, 'signup')
  const router = renderCode('/login/code?mode=signup&next=%2Fi')
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(router.state.location.search).toMatchObject({ mode: 'signup', method: 'email', next: '/i' })
  expect(requestEmailCode).not.toHaveBeenCalled()
})

// QA ACCOUNT-1: the field's own six-character limit used to cut "123 456" to "12345" before the digits were read
it('a pasted code with a space or a whole mail line fills all six slots and checks itself', async () => {
  rememberEmailAttempt('new@example.test', Date.now(), 'signup')
  const verify = vi.mocked(verifyEmailCode).mockRejectedValue(new Error('stop here'))
  renderCode('/login/code?mode=signup&next=%2Fsoon')
  const field = await screen.findByLabelText('Sechsstelliger Code')
  fireEvent.paste(field, { clipboardData: { getData: () => 'Dein Code: 123 456' } })
  await waitFor(() => expect(verify).toHaveBeenCalledWith('new@example.test', '123456'))
  expect((field as HTMLInputElement).value).toBe('123456')
})

// QA ACCOUNT-6: an address without an account never says so — but the screen offers the way to sign up
it('sign-in keeps its neutral line while typing and offers "Konto erstellen" with the same address', async () => {
  rememberEmailAttempt('maybe@example.test', Date.now(), 'signin')
  renderCode('/login/code?mode=signin&next=%2Fsoon')
  const field = await screen.findByLabelText('Sechsstelliger Code')
  fireEvent.change(field, { target: { value: '12' } })
  expect(screen.getByText('Wenn für diese Adresse ein Konto besteht, ist der Code unterwegs.')).toBeTruthy()
  const signup = new URL(screen.getByRole('link', { name: 'Neu hier? Konto erstellen' }).getAttribute('href')!, 'http://localhost')
  expect(signup.pathname).toBe('/login')
  expect(signup.searchParams.get('mode')).toBe('signup')
  expect(signup.searchParams.get('method')).toBe('email')
  expect(signup.searchParams.get('next')).toBe('/soon')
})

it('a sign-up code screen has no "Konto erstellen" link', async () => {
  rememberEmailAttempt('new@example.test', Date.now(), 'signup')
  renderCode('/login/code?mode=signup&next=%2Fsoon')
  await screen.findByLabelText('Sechsstelliger Code')
  expect(screen.queryByRole('link', { name: 'Neu hier? Konto erstellen' })).toBeNull()
})
