import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFeedSession } from '../feed/session'
import { AppLayout } from './AppLayout'
import { resetCreateMenuForTests } from './createMenuStore'
import { getTabDrag } from './tabDrag'
import { clearTabCopies, hasTabCopy } from './tabCopies'

// The swipe between the four tabs (TabSwipe.tsx): commit, cancel, the rubber band, who owns a touch, reduced motion.
// The edge-swipe-back stays off here (it is the installed PWA's); the menu's bunny is a stub.
vi.mock('./swipeEnv', () => ({ swipeBackEnabled: () => false, isStandalone: () => false }))
vi.mock('../mascot-ui/WelcomeBunnies', () => ({ default: () => null, preloadWelcome: () => undefined }))
// "once the first screen is idle" comes at once here (jsdom has no requestIdleCallback: it would be a 800 ms timer)
vi.mock('../feed/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../feed/session')>()),
  whenIdle: (task: () => void) => {
    const timer = setTimeout(task, 0)
    return () => clearTimeout(timer)
  },
}))
const haptics = vi.hoisted(() => ({ haptic: vi.fn() }))
vi.mock('../../ui/haptics', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../ui/haptics')>()), haptic: haptics.haptic }))

const WIDTH = 400

function Screen({ name }: { name: string }) {
  return (
    <>
      <header className="fixed top-0">bar of {name}</header>
      <main>
        <p>{name}</p>
        <div data-swipe-own="">
          <p>deck of {name}</p>
        </div>
        <input aria-label={`field of ${name}`} defaultValue="" />
        <button type="button" onClick={() => document.body.setAttribute('data-clicked', name)}>
          button of {name}
        </button>
        {/* the Lists buddy's DOM (@bunprise/mascot/buddy): his body catches the finger, the puppet is a shadow host */}
        <div className="bd-layer">
          <div className="bd-actor" data-drag-own="">
            <div className="bd-host" data-testid={`bunny host of ${name}`} />
            <div className="bd-hit">bunny of {name}</div>
          </div>
        </div>
      </main>
    </>
  )
}

function renderApp(initial = '/soon') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const root = createRootRoute({ component: () => <Outlet /> })
  const authed = createRoute({ getParentRoute: () => root, id: '_authed', component: () => <AppLayout userId="account-a" queryClient={queryClient} /> })
  const child = (path: string, name: string) => createRoute({ getParentRoute: () => authed, path, component: () => <Screen name={name} /> })
  const routeTree = root.addChildren([
    authed.addChildren([child('/soon', 'start'), child('/lists', 'lists'), child('/gifts', 'gifts'), child('/settings', 'profile'), child('/occasions/$occasionId', 'occasion')]),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initial] }), defaultPendingMinMs: 0 })
  // the app root is #root (production): the gesture moves its <header>/<main>, the neighbour lies before them
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

const parts = () => Array.from(document.querySelectorAll<HTMLElement>('#root > header, #root > main'))
const layers = () => Array.from(document.querySelectorAll<HTMLElement>('#root > .tab-swipe-layer'))
const moved = () => parts().some((part) => part.style.transform !== '' || part.style.opacity !== '')

function touch(type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', target: Element, x: number, y = 300, pointerType = 'touch') {
  fireEvent[type](target, { pointerId: 1, pointerType, isPrimary: true, button: 0, clientX: x, clientY: y })
}

/** A finger: down at the first x, then each move; released at the last unless `hold`. */
function drag(target: Element, xs: number[], { y = 300, ys, hold = false, pointerType = 'touch' }: { y?: number; ys?: number[]; hold?: boolean; pointerType?: string } = {}) {
  const [first, ...rest] = xs
  touch('pointerDown', target, first ?? 0, ys?.[0] ?? y, pointerType)
  rest.forEach((x, index) => touch('pointerMove', target, x, ys?.[index + 1] ?? y, pointerType))
  if (!hold) touch('pointerUp', target, rest[rest.length - 1] ?? first ?? 0, ys?.[ys.length - 1] ?? y, pointerType)
}

const pause = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

/** The gesture is a lazy chunk the layout loads once the first screen is idle (jsdom: a timer). */
async function ready(name: string) {
  await screen.findByText(name)
  await waitFor(() => expect(document.documentElement.hasAttribute('data-tab-swipe')).toBe(true), { timeout: 4000 })
  // React 19 reveals a freshly resolved lazy component with a short throttle
  await pause(350)
}

beforeAll(async () => {
  await import('./TabSwipe')
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: WIDTH, configurable: true })
  haptics.haptic.mockClear()
})

afterEach(() => {
  act(() => resetCreateMenuForTests())
  resetFeedSession()
  document.getElementById('root')?.remove()
  document.body.removeAttribute('data-clicked')
  delete document.documentElement.dataset.motion
  clearTabCopies()
})

describe('tab swipe: switching', () => {
  it('the page follows the finger, the neighbour slides in beside it and the pill follows; released past 30 % it switches', async () => {
    const { router } = renderApp('/soon')
    await ready('start')
    const text = screen.getByText('start')
    // locked after the slop (300 → 288), then 1:1 from there
    drag(text, [300, 288, 200], { hold: true })
    expect(parts().every((part) => part.style.transform === 'translate3d(-88px, 0, 0)')).toBe(true)
    // Start is the first tab: only the next one (Listen) lies beside it, a skeleton (not seen yet)
    expect(layers()).toHaveLength(1)
    expect(layers()[0]?.style.transform).toBe(`translate3d(${WIDTH - 88}px, 0, 0)`)
    expect(layers()[0]?.classList.contains('tab-swipe-skeleton')).toBe(true)
    expect(document.documentElement.hasAttribute('data-tab-swiping')).toBe(true)
    // the pill of the left capsule is on its way from Start to Listen
    expect(getTabDrag()).toEqual({ left: { slot: 88 / WIDTH, opacity: 1, scale: 1 } })
    touch('pointerMove', text, 120)
    touch('pointerUp', text, 120)
    expect(haptics.haptic).toHaveBeenCalledWith('select')
    await waitFor(() => expect(router.state.location.pathname).toBe('/lists'), { timeout: 3000 })
    await screen.findByText('lists')
    await waitFor(() => expect(layers()).toHaveLength(0))
    expect(moved()).toBe(false)
    expect(getTabDrag()).toBeNull()
    expect(document.documentElement.hasAttribute('data-tab-swiping')).toBe(false)
    // a push like a tap on the bar: back returns to Start
    expect(router.history.length).toBe(2)
  })

  it('a tab that was left slides in as its copy (inert, hidden, no ids); a swipe to the right goes back', async () => {
    const { router } = renderApp('/soon')
    await ready('start')
    fireEvent.change(screen.getByLabelText('field of start'), { target: { value: 'typed' } })
    await act(() => router.navigate({ to: '/lists' }))
    await screen.findByText('lists')
    expect(hasTabCopy('start')).toBe(true)
    drag(screen.getByText('lists'), [100, 112, 200], { hold: true })
    const prev = layers().find((layer) => layer.textContent?.includes('bar of start'))
    expect(prev).toBeDefined()
    expect(prev?.getAttribute('aria-hidden')).toBe('true')
    expect(prev?.hasAttribute('inert')).toBe(true)
    expect(prev?.querySelector('[id]')).toBeNull()
    expect(prev?.querySelector('input')?.value).toBe('typed')
    expect(prev?.style.transform).toBe(`translate3d(${88 - WIDTH}px, 0, 0)`)
    // only the side the page is pulled to is placed (Ideen on the right would be a skeleton: not needed yet)
    expect(layers()).toHaveLength(1)
    touch('pointerMove', screen.getByText('lists'), 300)
    touch('pointerUp', screen.getByText('lists'), 300)
    await waitFor(() => expect(router.state.location.pathname).toBe('/soon'), { timeout: 3000 })
    await waitFor(() => expect(layers()).toHaveLength(0))
    expect(moved()).toBe(false)
  })

  it('released too early it springs back and stays', async () => {
    const { router } = renderApp('/lists')
    await ready('lists')
    const text = screen.getByText('lists')
    drag(text, [300, 288, 260], { hold: true })
    // a slow finger: the release comes long after the last move (no flick)
    await pause(150)
    touch('pointerUp', text, 260)
    expect(haptics.haptic).not.toHaveBeenCalled()
    await waitFor(() => expect(layers()).toHaveLength(0), { timeout: 3000 })
    expect(router.state.location.pathname).toBe('/lists')
    expect(moved()).toBe(false)
    expect(getTabDrag()).toBeNull()
  })

  it('past the first tab the page pulls with a rubber band and springs back', async () => {
    const { router } = renderApp('/soon')
    await ready('start')
    const text = screen.getByText('start')
    drag(text, [100, 112, 312], { hold: true })
    const x = parseFloat(parts()[0]?.style.transform.replace('translate3d(', '') ?? '0')
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(200 * 0.5)
    // nothing to the left of Start: no neighbour, the pill stays
    expect(layers().every((layer) => !layer.style.transform.startsWith('translate3d(-'))).toBe(true)
    expect(getTabDrag()).toBeNull()
    touch('pointerUp', text, 312)
    // (no neighbour was placed at all: only the side a page is pulled to gets one, and Start has none on the left)
    await waitFor(() => expect(moved()).toBe(false), { timeout: 3000 })
    expect(layers()).toHaveLength(0)
    expect(router.state.location.pathname).toBe('/soon')
  })

  it('a touch that catches the moving page takes it from where it is', async () => {
    const { router } = renderApp('/lists')
    await ready('lists')
    const text = screen.getByText('lists')
    // just short of 30 %, released slowly: the page starts to spring back …
    drag(text, [300, 288, 178], { hold: true })
    await pause(150)
    touch('pointerUp', text, 178)
    // … and a new finger catches it at once: no jump, it continues 1:1 from where the page is
    touch('pointerDown', text, 250)
    expect(parts().every((part) => part.style.transform === 'translate3d(-110px, 0, 0)')).toBe(true)
    touch('pointerMove', text, 240)
    expect(parts().every((part) => part.style.transform === 'translate3d(-120px, 0, 0)')).toBe(true)
    touch('pointerMove', text, 100)
    touch('pointerUp', text, 100)
    await waitFor(() => expect(router.state.location.pathname).toBe('/gifts'), { timeout: 3000 })
    await waitFor(() => expect(layers()).toHaveLength(0))
  })
})

/** The deck of a screen gets a place on screen (jsdom has no layout). */
function placeDeck(name: string, box: { left: number; top: number; right: number; bottom: number }) {
  const deck = screen.getByText(`deck of ${name}`).parentElement as HTMLElement
  vi.spyOn(deck, 'getBoundingClientRect').mockReturnValue({ ...box, x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, toJSON: () => ({}) } as DOMRect)
  return deck
}

describe('tab swipe v2: the deck is never a handle for the page', () => {
  it('a sideways swipe that starts just beside the deck (inside its margin) is the deck’s, even fast', async () => {
    const { router } = renderApp('/gifts')
    await ready('gifts')
    placeDeck('gifts', { left: 16, top: 400, right: 384, bottom: 700 })
    // the finger goes down on the page's text 12 px under the deck: still the deck's zone
    drag(screen.getByText('gifts'), [300, 288, 60], { y: 712 })
    expect(moved()).toBe(false)
    expect(layers()).toHaveLength(0)
    await pause(50)
    expect(router.state.location.pathname).toBe('/gifts')
    // well away from the deck the same swipe turns the tab
    drag(screen.getByText('gifts'), [300, 288, 60], { y: 200 })
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'), { timeout: 3000 })
  })

  it('a finger on the deck does not catch the page while it springs: the spring finishes', async () => {
    const { router } = renderApp('/lists')
    await ready('lists')
    placeDeck('lists', { left: 16, top: 400, right: 384, bottom: 700 })
    // released short and slow: the page springs back …
    drag(screen.getByText('lists'), [300, 288, 178], { y: 200, hold: true })
    await pause(150)
    touch('pointerUp', screen.getByText('lists'), 178, 200)
    expect(parts()[0]?.style.transform).not.toBe('')
    // … a finger lands on the deck and swipes: the page is not caught, it does not follow the finger (a caught page
    // would move at once, before the next frame of the spring)
    const before = parts()[0]?.style.transform
    touch('pointerDown', screen.getByText('deck of lists'), 250, 500)
    touch('pointerMove', screen.getByText('deck of lists'), 60, 500)
    expect(parts()[0]?.style.transform).toBe(before)
    touch('pointerUp', screen.getByText('deck of lists'), 60, 500)
    await waitFor(() => expect(layers()).toHaveLength(0), { timeout: 3000 })
    expect(router.state.location.pathname).toBe('/lists')
    expect(moved()).toBe(false)
  })
})

describe('tab swipe v2: a swipe is never scrolled as well', () => {
  it('from the moment the swipe is decided its touchmoves are cancelled; before that and on pushed screens they are not', async () => {
    const { router } = renderApp('/soon')
    await ready('start')
    const text = screen.getByText('start')
    // undecided (inside the slop): the browser may still scroll
    touch('pointerDown', text, 300)
    touch('pointerMove', text, 296)
    expect(fireEvent.touchMove(text)).toBe(true)
    // decided sideways: cancelled
    touch('pointerMove', text, 280)
    expect(fireEvent.touchMove(text)).toBe(false)
    touch('pointerMove', text, 200)
    expect(fireEvent.touchMove(text)).toBe(false)
    touch('pointerUp', text, 200)
    await waitFor(() => expect(router.state.location.pathname).toBe('/lists'), { timeout: 3000 })
    await waitFor(() => expect(layers()).toHaveLength(0), { timeout: 3000 })
    // a vertical touch is the browser's: never cancelled
    const lists = screen.getByText('lists')
    touch('pointerDown', lists, 200, 300)
    touch('pointerMove', lists, 204, 340)
    expect(fireEvent.touchMove(lists)).toBe(true)
    touch('pointerUp', lists, 204, 340)
    // a pushed screen has no listener at all
    await act(() => router.navigate({ to: '/occasions/$occasionId', params: { occasionId: '0b7c8a1e-5555-4a5b-9c3d-000000000001' } }))
    const occasion = await screen.findByText('occasion')
    touch('pointerDown', occasion, 300)
    touch('pointerMove', occasion, 200)
    expect(fireEvent.touchMove(occasion)).toBe(true)
    touch('pointerUp', occasion, 200)
  })

  it('a diagonal of 35° switches, one of 50° stays a scroll', async () => {
    const { router } = renderApp('/soon')
    await ready('start')
    const text = screen.getByText('start')
    const tan = (degrees: number) => Math.tan((degrees * Math.PI) / 180)
    // 50°: up and to the left — the page does not move
    drag(text, [300, 292, 100], { ys: [500, 500 - 8 * tan(50), 500 - 200 * tan(50)] })
    expect(moved()).toBe(false)
    expect(layers()).toHaveLength(0)
    // 35°: the page follows and switches
    drag(text, [300, 290, 100], { ys: [500, 500 - 10 * tan(35), 500 - 200 * tan(35)] })
    await waitFor(() => expect(router.state.location.pathname).toBe('/lists'), { timeout: 3000 })
  })

  it('the neighbours’ code loads while the tab is idle (not in the first frame of a drag)', async () => {
    const { router } = renderApp('/lists')
    const load = vi.spyOn(router, 'loadRouteChunk')
    await ready('lists')
    await waitFor(() => {
      const paths = load.mock.calls.map(([route]) => route.fullPath)
      expect(paths).toContain('/soon')
      expect(paths).toContain('/gifts')
    })
  })
})

describe('tab swipe: the Lists buddy one picks up (Felix 27.10)', () => {
  it('carried sideways he never turns the tab — from his body or his puppet; a swipe on the page still does', async () => {
    const { router } = renderApp('/lists')
    await ready('lists')
    // the long press (~250 ms) that picks him up, then carried far to the left and released fast
    touch('pointerDown', screen.getByText('bunny of lists'), 300)
    await pause(300)
    for (const x of [288, 200, 100, 30]) touch('pointerMove', screen.getByText('bunny of lists'), x)
    expect(moved()).toBe(false)
    expect(layers()).toHaveLength(0)
    expect(getTabDrag()).toBeNull()
    touch('pointerUp', screen.getByText('bunny of lists'), 30)
    // a touch inside the puppet's shadow root reaches the document as the shadow host: his too, either way
    drag(screen.getByTestId('bunny host of lists'), [100, 112, 360])
    expect(moved()).toBe(false)
    await pause(50)
    expect(router.state.location.pathname).toBe('/lists')
    expect(haptics.haptic).not.toHaveBeenCalled()
    // the very same swipe started on the page turns the tab as before
    drag(screen.getByText('lists'), [300, 288, 60])
    await waitFor(() => expect(router.state.location.pathname).toBe('/gifts'), { timeout: 3000 })
  })

  it('a finger on him does not catch the page while it springs back', async () => {
    const { router } = renderApp('/lists')
    await ready('lists')
    drag(screen.getByText('lists'), [300, 288, 178], { hold: true })
    await pause(150)
    touch('pointerUp', screen.getByText('lists'), 178)
    const before = parts()[0]?.style.transform
    expect(before).not.toBe('')
    touch('pointerDown', screen.getByText('bunny of lists'), 250)
    touch('pointerMove', screen.getByText('bunny of lists'), 60)
    expect(parts()[0]?.style.transform).toBe(before)
    touch('pointerUp', screen.getByText('bunny of lists'), 60)
    await waitFor(() => expect(layers()).toHaveLength(0), { timeout: 3000 })
    expect(router.state.location.pathname).toBe('/lists')
    expect(moved()).toBe(false)
  })
})

describe('tab swipe: what does not swipe', () => {
  it('a vertical move is scrolling: nothing moves', async () => {
    const { router } = renderApp('/soon')
    await ready('start')
    drag(screen.getByText('start'), [200, 204, 210], { ys: [300, 340, 420] })
    expect(layers()).toHaveLength(0)
    expect(moved()).toBe(false)
    expect(router.state.location.pathname).toBe('/soon')
  })

  it('things with their own sideways gesture keep it: the deck, fields', async () => {
    renderApp('/soon')
    await ready('start')
    drag(screen.getByText('deck of start'), [300, 288, 100], { hold: true })
    expect(moved()).toBe(false)
    touch('pointerUp', screen.getByText('deck of start'), 100)
    drag(screen.getByLabelText('field of start'), [300, 288, 100])
    expect(moved()).toBe(false)
    expect(layers()).toHaveLength(0)
  })

  it('the strips along the left and right edge belong to the system', async () => {
    renderApp('/lists')
    await ready('lists')
    drag(screen.getByText('lists'), [10, 30, 200], { hold: true })
    expect(moved()).toBe(false)
    touch('pointerUp', screen.getByText('lists'), 200)
    drag(screen.getByText('lists'), [WIDTH - 8, WIDTH - 30, 100], { hold: true })
    expect(moved()).toBe(false)
    touch('pointerUp', screen.getByText('lists'), 100)
  })

  it('an open sheet or menu keeps the page under it still', async () => {
    renderApp('/lists')
    await ready('lists')
    const sheet = document.body.appendChild(Object.assign(document.createElement('div'), { role: 'dialog' }))
    sheet.setAttribute('aria-modal', 'true')
    drag(screen.getByText('lists'), [300, 288, 100], { hold: true })
    expect(moved()).toBe(false)
    touch('pointerUp', screen.getByText('lists'), 100)
    sheet.remove()
  })

  it('a mouse does not swipe (outside the dev phone frame)', async () => {
    renderApp('/lists')
    await ready('lists')
    drag(screen.getByText('lists'), [300, 288, 100], { hold: true, pointerType: 'mouse' })
    expect(moved()).toBe(false)
    touch('pointerUp', screen.getByText('lists'), 100, 300, 'mouse')
  })

  it('pushed screens keep the browser’s own gestures: no swipe, no touch-action', async () => {
    const { router } = renderApp('/soon')
    await ready('start')
    await act(() => router.navigate({ to: '/occasions/$occasionId', params: { occasionId: '0b7c8a1e-5555-4a5b-9c3d-000000000001' } }))
    await screen.findByText('occasion')
    expect(document.documentElement.hasAttribute('data-tab-swipe')).toBe(false)
    drag(screen.getByText('occasion'), [300, 288, 100])
    expect(moved()).toBe(false)
    expect(router.state.location.pathname).toContain('/occasions/')
  })

  it('a tap stays a tap', async () => {
    renderApp('/soon')
    await ready('start')
    const button = screen.getByRole('button', { name: 'button of start' })
    drag(button, [200, 202])
    fireEvent.click(button)
    expect(document.body.getAttribute('data-clicked')).toBe('start')
    expect(moved()).toBe(false)
  })
})

describe('tab swipe: reduced motion', () => {
  it('the page does not slide: it dims a little, then switches at once', async () => {
    document.documentElement.dataset.motion = 'reduce'
    const { router } = renderApp('/soon')
    await ready('start')
    const text = screen.getByText('start')
    drag(text, [300, 288, 200], { hold: true })
    expect(parts().every((part) => part.style.transform === '')).toBe(true)
    expect(layers()).toHaveLength(0)
    const opacity = Number(parts()[0]?.style.opacity)
    expect(opacity).toBeGreaterThan(0.5)
    expect(opacity).toBeLessThan(1)
    // the pill still follows the finger (direct manipulation, no animation)
    expect(getTabDrag()?.left?.slot).toBeGreaterThan(0)
    touch('pointerMove', text, 140)
    touch('pointerUp', text, 140)
    expect(haptics.haptic).toHaveBeenCalledWith('select')
    await waitFor(() => expect(router.state.location.pathname).toBe('/lists'), { timeout: 3000 })
    await screen.findByText('lists')
    await waitFor(() => expect(moved()).toBe(false))
  })
})
