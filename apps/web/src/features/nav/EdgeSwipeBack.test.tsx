import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './AppLayout'
import { clearGhosts, ghostCount, ghostFor } from './ghost'

// The gesture runs in the installed PWA only; here it is switched on like there.
vi.mock('./swipeEnv', () => ({ swipeBackEnabled: () => true, isStandalone: () => true }))
vi.mock('../mascot-ui/WelcomeBunnies', () => ({ default: () => null, preloadWelcome: () => undefined }))

const OCCASION = '0b7c8a1e-5555-4a5b-9c3d-000000000001'
const WIDTH = 400

function Screen({ name }: { name: string }) {
  return (
    <>
      <header className="fixed top-0">bar of {name}</header>
      <main>
        <p>{name}</p>
        <input aria-label={`field of ${name}`} defaultValue="" />
        <button type="button" onClick={() => document.body.setAttribute('data-clicked', name)}>
          button of {name}
        </button>
      </main>
    </>
  )
}

function renderApp(initial: string[] = ['/soon']) {
  const queryClient = new QueryClient()
  const root = createRootRoute({ component: () => <Outlet /> })
  const authed = createRoute({ getParentRoute: () => root, id: '_authed', component: () => <AppLayout userId="account-a" queryClient={queryClient} /> })
  const routeTree = root.addChildren([
    authed.addChildren([
      createRoute({ getParentRoute: () => authed, path: '/soon', component: () => <Screen name="feed" /> }),
      createRoute({ getParentRoute: () => authed, path: '/occasions/$occasionId', component: () => <Screen name="occasion" /> }),
    ]),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: initial, initialIndex: initial.length - 1 }) })
  // the app root is #root (production): the gesture moves its <header>/<main>, the copy lies before them
  const container = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }))
  render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
    { container },
  )
  return { router }
}

const edge = () => document.querySelector<HTMLElement>('[data-swipe-edge]')
const parts = () => Array.from(document.querySelectorAll<HTMLElement>('#root > header, #root > main'))

function pointer(type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', target: HTMLElement, x: number, y = 300) {
  fireEvent[type](target, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y })
}

// the controller is a lazy chunk of the layout: in the app it has long arrived before the first tap
beforeAll(async () => {
  await import('./EdgeSwipeBack')
})

const pause = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

beforeEach(() => {
  clearGhosts()
  Object.defineProperty(window, 'innerWidth', { value: WIDTH, configurable: true })
})
afterEach(() => {
  document.getElementById('root')?.remove()
  document.body.removeAttribute('data-clicked')
  clearGhosts()
})

async function openOccasion(router: ReturnType<typeof renderApp>['router']) {
  await screen.findByText('feed')
  // the lazy controller mounts (and starts keeping copies) right after the first screen; React 19 reveals a
  // freshly resolved lazy component with a short throttle (≈ 300 ms) — in the app long before any tap
  await pause(400)
  fireEvent.change(screen.getByLabelText('field of feed'), { target: { value: 'typed' } })
  await act(() => router.navigate({ to: '/occasions/$occasionId', params: { occasionId: OCCASION } }))
  await screen.findByText('occasion')
}

describe('edge swipe-back: the previous screen is kept', () => {
  it('a push keeps an inert copy of the covered screen (bar, content, typed values; no ids)', async () => {
    const { router } = renderApp()
    await openOccasion(router)
    expect(ghostCount()).toBe(1)
    const ghost = ghostFor(0)!
    expect(ghost.node.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.node.hasAttribute('inert')).toBe(true)
    expect(ghost.node.textContent).toContain('bar of feed')
    expect(ghost.node.querySelector<HTMLInputElement>('input')?.value).toBe('typed')
    expect(ghost.node.querySelector('[id]')).toBeNull()
    // not in the document until a gesture needs it
    expect(ghost.node.isConnected).toBe(false)
  })

  it('offers the gesture on pushed screens with a screen to go back to only', async () => {
    const { router } = renderApp()
    await screen.findByText('feed')
    expect(edge()).toBeNull()
    await openOccasion(router)
    expect(edge()).not.toBeNull()
  })

  it('a pushed screen opened directly (no history) has no gesture', async () => {
    renderApp([`/occasions/${OCCASION}`])
    await screen.findByText('occasion')
    expect(edge()).toBeNull()
  })
})

describe('edge swipe-back: the gesture', () => {
  it('the screen follows the finger over the copy of the previous one; released far enough, it goes back', async () => {
    const { router } = renderApp()
    await openOccasion(router)
    const zone = edge()!
    pointer('pointerDown', zone, 6)
    pointer('pointerMove', zone, 40)
    pointer('pointerMove', zone, 120)
    // the copy of the feed lies under the moving screen, before the screen's own parts
    const ghost = document.querySelector('#root > .swipe-ghost')
    expect(ghost?.textContent).toContain('feed')
    expect(parts().every((part) => part.style.transform.includes('translate3d(114px'))).toBe(true)
    pointer('pointerMove', zone, 300)
    pointer('pointerUp', zone, 300)
    await waitFor(() => expect(router.state.location.pathname).toBe('/soon'), { timeout: 3000 })
    await screen.findByText('feed')
    await waitFor(() => expect(document.querySelector('.swipe-ghost')).toBeNull())
    expect(document.querySelector('.swipe-paper')).toBeNull()
    expect(parts().every((part) => part.style.transform === '')).toBe(true)
  })

  it('released too early it springs back and stays', async () => {
    const { router } = renderApp()
    await openOccasion(router)
    const zone = edge()!
    pointer('pointerDown', zone, 6)
    pointer('pointerMove', zone, 30)
    // a slow finger: the last move comes long after the one before (no flick)
    await pause(150)
    pointer('pointerMove', zone, 60)
    pointer('pointerUp', zone, 60)
    await waitFor(() => expect(document.querySelector('.swipe-ghost')).toBeNull(), { timeout: 3000 })
    expect(router.state.location.pathname).toBe(`/occasions/${OCCASION}`)
    expect(parts().every((part) => part.style.transform === '')).toBe(true)
  })

  it('a vertical move is scrolling: nothing moves', async () => {
    const { router } = renderApp()
    await openOccasion(router)
    const zone = edge()!
    pointer('pointerDown', zone, 6, 300)
    pointer('pointerMove', zone, 9, 360)
    pointer('pointerMove', zone, 40, 420)
    pointer('pointerUp', zone, 40, 420)
    expect(document.querySelector('.swipe-ghost')).toBeNull()
    expect(parts().every((part) => part.style.transform === '')).toBe(true)
    expect(router.state.location.pathname).toBe(`/occasions/${OCCASION}`)
  })

  it('a tap on the edge zone reaches what lies under it', async () => {
    const { router } = renderApp()
    await openOccasion(router)
    const zone = edge()!
    const under = screen.getByRole('button', { name: 'button of occasion' })
    const original = document.elementFromPoint
    document.elementFromPoint = () => under
    try {
      pointer('pointerDown', zone, 8)
      pointer('pointerUp', zone, 8)
    } finally {
      document.elementFromPoint = original
    }
    expect(document.body.getAttribute('data-clicked')).toBe('occasion')
  })
})
