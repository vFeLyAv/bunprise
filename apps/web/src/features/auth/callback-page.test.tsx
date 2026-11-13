import { beforeEach, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from '../../routeTree.gen'
import { completeOAuthCallback, rememberPostLoginTarget } from '../../lib/api/auth'
import { AppError } from '../../lib/errors'
import { destinationAfterSignIn } from './flow'

vi.mock('../../lib/api/auth', async (original) => ({
  ...await original<typeof import('../../lib/api/auth')>(), completeOAuthCallback: vi.fn(),
}))
vi.mock('./flow', async (original) => ({
  ...await original<typeof import('./flow')>(), destinationAfterSignIn: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
})

function renderCallback() {
  const router = createRouter({
    routeTree, context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ['/auth/callback'] }),
  })
  render(<StrictMode><RouterProvider router={router} /></StrictMode>)
  return router
}

it('retries the profile request without exchanging OAuth again', async () => {
  vi.mocked(completeOAuthCallback).mockResolvedValue({ user: { id: 'account-a' } } as Awaited<ReturnType<typeof completeOAuthCallback>>)
  vi.mocked(destinationAfterSignIn).mockRejectedValueOnce(new AppError('network')).mockResolvedValue('/legal/datenschutz')
  const router = renderCallback()
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Nochmal versuchen' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/legal/datenschutz'))
  expect(completeOAuthCallback).toHaveBeenCalledTimes(1)
  expect(destinationAfterSignIn).toHaveBeenCalledTimes(2)
  expect(vi.mocked(destinationAfterSignIn).mock.calls.every((call) => call[1] === 'account-a')).toBe(true)
})

it('offers a new login, with the saved destination, after failed PKCE exchange', async () => {
  rememberPostLoginTarget('/i')
  vi.mocked(completeOAuthCallback).mockRejectedValue(new AppError('oauth_failed'))
  renderCallback()
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Nochmal versuchen' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Anmelden' }).getAttribute('href')).toBe('/login?next=%2Fi')
  expect(destinationAfterSignIn).not.toHaveBeenCalled()
})
