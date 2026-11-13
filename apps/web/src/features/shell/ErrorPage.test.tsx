import { fireEvent, render, screen } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { expect, it, vi } from 'vitest'
import { ErrorPage } from './ErrorPage'
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))
it('offers retry and a working route back to Start without exposing a raw error', async () => {
  const reset = vi.fn()
  const root = createRootRoute({ component: Outlet })
  const router = createRouter({ routeTree: root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/failure', component: () => <ErrorPage error={new Error('private server detail')} reset={reset} /> }),
    createRoute({ getParentRoute: () => root, path: '/soon', component: () => <h1>Start</h1> }),
  ]), history: createMemoryHistory({ initialEntries: ['/failure'] }) })
  render(<RouterProvider router={router} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Nochmal versuchen' }))
  expect(reset).toHaveBeenCalledOnce()
  expect(screen.queryByText('private server detail')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Zum Start' }))
  expect(await screen.findByRole('heading', { name: 'Start' })).toBeTruthy()
})
