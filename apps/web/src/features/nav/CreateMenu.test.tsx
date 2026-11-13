import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LazyMotion, domMax } from 'motion/react'
import { Sheet } from '../../ui/Sheet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen } from '../../lib/api/types'
import { createMenu, resetCreateMenuForTests } from './createMenuStore'
import { feedRow, renderLayout } from './test-utils'

const api = vi.hoisted(() => ({ getFeed: vi.fn() }))
vi.mock('../../lib/api/occasions', () => ({ getFeed: api.getFeed, getOccasionScreen: vi.fn() }))
// the bunny is tested in features/mascot-ui; here: which moment the menu asks for and how it plays it
vi.mock('../mascot-ui/BunnyMoment', () => ({
  BunnyMoment: (props: { kind: string; pick?: { preset: string; special?: string }; whenSeen?: string }) => (
    <div data-testid="bunny-moment" data-kind={props.kind} data-preset={props.pick?.preset} data-special={props.pick?.special} data-when-seen={props.whenSeen} />
  ),
}))
vi.mock('../mascot-ui/WelcomeBunnies', () => ({ default: () => null, preloadWelcome: () => undefined }))
// the director's pool is tested in mascot-ui/system.test.ts; here a moment can be forced (default: a climb, no jump)
type Forced = { preset: string; special?: string }
const moments = vi.hoisted(() => ({ forced: { preset: 'climb-left' } as Forced | null, calls: [] as Array<[string, Record<string, unknown>]> }))
vi.mock('../mascot-ui/director', async (importOriginal) => {
  const real = await importOriginal<typeof import('../mascot-ui/director')>()
  return {
    ...real,
    pickMoment: (family: Parameters<typeof real.pickMoment>[0], context: Parameters<typeof real.pickMoment>[1] = {}) => {
      moments.calls.push([family, context as Record<string, unknown>])
      if (context.motion && context.motion !== 'full') return null
      return moments.forced ? { coat: 'fawn', edge: 'left', ...moments.forced } : real.pickMoment(family, context)
    },
  }
})
// the jump out of the "+" (mascot-ui/carry): recorded; the test ends it with its onDone
type JumpRequest = { from: DOMRect; to: { top: number }; item?: string; hideBehind?: Element | null; onDone?: () => void }
const jumps = vi.hoisted(() => {
  const requests: JumpRequest[] = []
  return { requests, carry: (request: JumpRequest) => { requests.push(request); return Promise.resolve() } }
})
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => jumps.carry }))

const HOST_A = '0b7c8a1e-3333-4a5b-9c3d-00000000000a'
const HOST_B = '0b7c8a1e-3333-4a5b-9c3d-00000000000b'
const GUEST = '0b7c8a1e-3333-4a5b-9c3d-00000000000c'
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

const FEED_MANY: FeedScreen = {
  upcoming: [feedRow(HOST_A, 'Milas Geburtstag', 'host', soon(3)), feedRow(GUEST, 'Annas Einweihung', 'member', soon(5)), feedRow(HOST_B, 'Spieleabend', 'host', soon(12))],
  past: [],
}

afterEach(() => {
  act(() => resetCreateMenuForTests())
  vi.clearAllMocks()
  moments.forced = { preset: 'climb-left' }
  moments.calls.length = 0
  jumps.requests.length = 0
})

async function openMenu(path = '/soon', feed?: FeedScreen) {
  const view = renderLayout(path, { feed })
  const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' })
  const plus = within(nav).getByRole('button', { name: 'Neu erstellen' })
  fireEvent.click(plus)
  const dialog = await screen.findByRole('dialog', { name: 'Was möchtest du erstellen?' })
  return { ...view, plus, dialog }
}

describe('create menu: open and close', () => {
  it('"+" opens a modal dialog with the two big buttons and the peeking bunny', async () => {
    const { plus, dialog } = await openMenu('/soon', FEED_MANY)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(plus.getAttribute('aria-expanded')).toBe('true')
    expect(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /Anlass erstellen/ })).toBeTruthy()
    // the "×" sits inside the dialog (the focus trap reaches it)
    expect(within(dialog).getByRole('button', { name: 'Schließen' })).toBeTruthy()
    const bunny = await within(dialog).findByTestId('bunny-moment')
    expect(bunny.dataset.kind).toBe('peek')
    // the page behind is inert while the menu is open
    expect(document.querySelector('nav[data-tabbar]')?.closest('[inert]')).not.toBeNull()
  })

  it('"Kaninchen zeigen" off (or motion off): the menu has no bunny at all — no peek, no jump, no room kept', async () => {
    moments.forced = { preset: 'peek-once', special: 'jump-out' }
    for (const [attr, value] of [['bunnies', 'off'], ['motion', 'off']] as const) {
      document.documentElement.dataset[attr] = value
      try {
        const { dialog, unmount } = await openMenu('/soon', FEED_MANY)
        await act(() => new Promise((resolve) => setTimeout(resolve, 450)))
        expect(within(dialog).getByRole('button', { name: /Anlass erstellen/ })).toBeTruthy()
        expect(within(dialog).queryByTestId('bunny-moment')).toBeNull()
        expect(dialog.querySelector('.cm-bunny')).toBeNull()
        expect(jumps.requests).toHaveLength(0)
        act(() => resetCreateMenuForTests())
        unmount()
      } finally {
        delete document.documentElement.dataset[attr]
      }
    }
  })

  it('closes with Esc and gives the focus back to the "+"', async () => {
    const { plus } = await openMenu('/soon', FEED_MANY)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(plus)
    expect(plus.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('nav[data-tabbar]')?.closest('[inert]')).toBeNull()
  })

  it('a new opening during the closing animation starts at the first step', async () => {
    const { dialog, plus } = await openMenu('/soon', FEED_MANY)
    fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
    await within(dialog).findByRole('heading', { name: 'Für welchen Anlass?' })
    act(() => createMenu.close())
    fireEvent.click(plus)
    await screen.findByRole('dialog', { name: 'Was möchtest du erstellen?' })
    expect(screen.queryByRole('heading', { name: 'Für welchen Anlass?' })).toBeNull()
    expect(createMenu.isOpen()).toBe(true)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('Escape dismisses only a sheet above the menu and keeps its background locked', async () => {
    await openMenu('/soon', FEED_MANY)
    function NestedSheet() {
      const [open, setOpen] = useState(true)
      return <LazyMotion features={domMax} strict><Sheet open={open} onClose={() => setOpen(false)} title="Nested settings" closeLabel="Close nested">Details</Sheet></LazyMotion>
    }
    render(<NestedSheet />)
    await screen.findByRole('dialog', { name: 'Nested settings' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nested settings' })).toBeNull())
    expect(createMenu.isOpen()).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Was möchtest du erstellen?' })).toBeTruthy()
    expect(document.documentElement.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('closes with the "×" and with a tap outside the panel', async () => {
    const first = await openMenu('/soon', FEED_MANY)
    fireEvent.click(within(first.dialog).getByRole('button', { name: 'Schließen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(first.plus)
    await screen.findByRole('dialog')
    fireEvent.click(document.querySelector('.cm-scrim')!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('has exactly one centre button — the bar’s own "+" turned into "×" — while open, closing and after close', async () => {
    const { plus, dialog } = await openMenu('/soon', FEED_MANY)
    const nav = document.querySelector('nav[data-tabbar]')!
    // open: one round button (the bar's), its glyph turned; the dialog's close button draws nothing
    expect(document.querySelectorAll('.tabbar-create')).toHaveLength(1)
    expect(nav.hasAttribute('data-menu-open')).toBe(true)
    expect(nav.hasAttribute('data-menu-layer')).toBe(true)
    const close = within(dialog).getByRole('button', { name: 'Schließen' })
    expect(close.className).not.toMatch(/glass|tabbar-create/)
    expect(close.querySelector('svg')).toBeNull()
    fireEvent.click(close)
    // closing: still exactly one, already back to "+" (no data-menu-open), the page usable at once
    expect(document.querySelectorAll('.tabbar-create')).toHaveLength(1)
    expect(nav.hasAttribute('data-menu-open')).toBe(false)
    expect(plus.getAttribute('aria-expanded')).toBe('false')
    expect(nav.closest('[inert]')).toBeNull()
    expect(document.activeElement).toBe(plus)
    // after close: the menu is gone, the bar is back below the scrim layer — and still one button
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(nav.hasAttribute('data-menu-layer')).toBe(false))
    expect(document.querySelectorAll('.tabbar-create')).toHaveLength(1)
    expect(document.querySelectorAll('.cm-close')).toHaveLength(0)
  })

  it('the closing layer catches no taps and releases the scroll lock at once', async () => {
    await openMenu('/soon', FEED_MANY)
    const layer = document.querySelector('.cm-layer')!
    expect(layer.hasAttribute('data-closing')).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    // the exit animation may still run, but the layer is already passive
    const closing = document.querySelector('.cm-layer')
    if (closing) expect(closing.hasAttribute('data-closing')).toBe(true)
    expect(document.documentElement.style.overflow).toBe('')
    expect(document.body.style.overflow).toBe('')
    await waitFor(() => expect(document.querySelector('.cm-layer')).toBeNull())
  })

  it('keeps Tab inside the dialog', async () => {
    const { dialog } = await openMenu('/soon', FEED_MANY)
    const close = within(dialog).getByRole('button', { name: 'Schließen' })
    close.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
  })
})

describe('create menu: where the buttons lead', () => {
  it('"Anlass erstellen" → the new-occasion form', async () => {
    const { dialog, router } = await openMenu('/soon', FEED_MANY)
    fireEvent.click(within(dialog).getByRole('button', { name: /Anlass erstellen/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/occasions/new'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('"Wunsch hinzufügen" with exactly one occasion I host → straight to its wish form', async () => {
    const one: FeedScreen = { upcoming: [feedRow(GUEST, 'Annas Einweihung', 'member', soon(2)), feedRow(HOST_A, 'Milas Geburtstag', 'host', soon(3))], past: [] }
    const { dialog, router } = await openMenu('/gifts', one)
    fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/occasions/${HOST_A}/wishes/new`))
  })

  it('"Wunsch hinzufügen" with several → "Für welchen Anlass?" lists only mine, in date order', async () => {
    const { dialog, router } = await openMenu('/soon', FEED_MANY)
    fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
    const step = await within(dialog).findByRole('heading', { name: 'Für welchen Anlass?' })
    expect(step).toBeTruthy()
    const choices = within(dialog).getAllByRole('button').filter((button) => button.classList.contains('cm-choice'))
    expect(choices.map((button) => button.textContent?.match(/Milas Geburtstag|Spieleabend|Annas Einweihung/)?.[0])).toEqual(['Milas Geburtstag', 'Spieleabend'])
    // back to the two buttons, then pick the second occasion
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zurück' }))
    await within(dialog).findByRole('heading', { name: 'Was möchtest du erstellen?' })
    fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
    await within(dialog).findByRole('heading', { name: 'Für welchen Anlass?' })
    const second = within(dialog).getAllByRole('button').find((button) => button.textContent?.includes('Spieleabend'))!
    fireEvent.click(second)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/occasions/${HOST_B}/wishes/new`))
  })

  it('"Wunsch hinzufügen" with none → a friendly nudge to create an occasion first', async () => {
    const none: FeedScreen = { upcoming: [feedRow(GUEST, 'Annas Einweihung', 'member', soon(2))], past: [] }
    const { dialog, router } = await openMenu('/settings', none)
    fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
    expect(await within(dialog).findByRole('heading', { name: 'Erst ein Anlass, dann die Wünsche' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Erst einen Anlass erstellen' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/occasions/new'))
  })

  it('loads the feed when it is not cached yet (the existing get_feed, no other request)', async () => {
    api.getFeed.mockResolvedValue({ upcoming: [feedRow(HOST_A, 'Milas Geburtstag', 'host', soon(3))], past: [] } satisfies FeedScreen)
    const { dialog, router } = await openMenu('/settings')
    fireEvent.click(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/occasions/${HOST_A}/wishes/new`))
    expect(api.getFeed).toHaveBeenCalledTimes(1)
  })
})

describe('create menu: the bunny (Felix 22.10: back, lively at every opening, never just there)', () => {
  /** The moment starts 350 ms after the panel rose. */
  const afterRise = () => act(() => new Promise((resolve) => setTimeout(resolve, 450)))

  it('every opening asks the director for a "+" menu moment of its tab and plays it over the panel, from hidden', async () => {
    document.documentElement.dataset['motion'] = 'full'
    try {
      for (const [path, tab] of [['/soon', 'start'], ['/lists', 'lists']] as const) {
        const { dialog, unmount } = await openMenu(path, FEED_MANY)
        await afterRise()
        const bunny = await within(dialog).findByTestId('bunny-moment')
        expect(bunny.dataset).toMatchObject({ kind: 'peek', preset: 'climb-left', whenSeen: 'none' })
        // over the panel's own top edge: the stage sits right above the panel, as wide as the panel
        expect(dialog.querySelector('.cm-glide')?.firstElementChild?.classList.contains('cm-bunny')).toBe(true)
        expect(moments.calls.at(-1)).toEqual(['create-menu', expect.objectContaining({ tab, motion: 'full' })])
        act(() => resetCreateMenuForTests())
        unmount()
      }
    } finally {
      delete document.documentElement.dataset['motion']
    }
  })

  it('23:00 – 07:00 («Nachts schlafen»): Pompon plays the approved `sleepy` — he peeks, yawns and nods off on the edge, no waking', async () => {
    document.documentElement.dataset['motion'] = 'full'
    moments.forced = { preset: 'peek-once', special: 'jump-out' }
    try {
      // (the menu's chunk loads mascot-ui/night.ts with import(): loaded before the opening that counts)
      const first = await openMenu('/soon', FEED_MANY)
      act(() => resetCreateMenuForTests())
      first.unmount()
      await act(async () => { await import('../mascot-ui/night') })
      globalThis.__bunpriseNightClock = () => new Date().setHours(23, 30, 0, 0)
      const { dialog, unmount } = await openMenu('/lists', FEED_MANY)
      await afterRise()
      const bunny = await within(dialog).findByTestId('bunny-moment')
      expect(bunny.dataset).toMatchObject({ kind: 'peek', preset: 'sleepy', whenSeen: 'none' })
      expect(bunny.dataset.special).toBeUndefined()
      expect(jumps.requests).toHaveLength(0)
      act(() => resetCreateMenuForTests())
      unmount()
      // the switch off: the day's moments at night too
      localStorage.setItem('bunprise.nightSleep', '0')
      moments.forced = { preset: 'climb-left' }
      const day = await openMenu('/soon', FEED_MANY)
      await afterRise()
      expect((await within(day.dialog).findByTestId('bunny-moment')).dataset.preset).toBe('climb-left')
      act(() => resetCreateMenuForTests())
      day.unmount()
    } finally {
      localStorage.removeItem('bunprise.nightSleep')
      delete document.documentElement.dataset['motion']
    }
  })

  it('the jump out of the "+": the arc goes behind the panel, the climb-out starts only once the jump is over — at every jump', async () => {
    document.documentElement.dataset['motion'] = 'full'
    moments.forced = { preset: 'peek-once', special: 'jump-out' }
    try {
      const { dialog, plus } = await openMenu('/soon', FEED_MANY)
      await afterRise()
      expect(jumps.requests).toHaveLength(1)
      const jump = jumps.requests[0]!
      const panel = dialog.querySelector('.cm-panel')!
      expect(jump.item).toBe('none')
      // cut out where the panel is: never over its cards; it lands out of sight under the panel's top edge
      expect(jump.hideBehind).toBe(panel)
      expect(jump.to.top).toBe(panel.getBoundingClientRect().top + 128)
      // while it jumps there is no second bunny on the edge — and none that appears already sitting there
      expect(dialog.querySelector('.cm-bunny')).not.toBeNull()
      expect(within(dialog).queryByTestId('bunny-moment')).toBeNull()
      act(() => jump.onDone?.())
      const bunny = await within(dialog).findByTestId('bunny-moment')
      expect(bunny.dataset).toMatchObject({ preset: 'peek-once', whenSeen: 'none' })

      // closed and opened again: it jumps again (it used to jump once per session, then only sat there)
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      fireEvent.click(plus)
      const again = await screen.findByRole('dialog', { name: 'Was möchtest du erstellen?' })
      await afterRise()
      expect(jumps.requests).toHaveLength(2)
      expect(within(again).queryByTestId('bunny-moment')).toBeNull()
    } finally {
      delete document.documentElement.dataset['motion']
    }
  })

  it('a close mid-jump ends it: a late onDone of the old jump starts no bunny', async () => {
    document.documentElement.dataset['motion'] = 'full'
    moments.forced = { preset: 'peek-once', special: 'jump-out' }
    try {
      await openMenu('/soon', FEED_MANY)
      await afterRise()
      const jump = jumps.requests[0]!
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      act(() => jump.onDone?.())
      expect(screen.queryByTestId('bunny-moment')).toBeNull()
    } finally {
      delete document.documentElement.dataset['motion']
    }
  })

  it('reduced motion: no bunny over the panel and no jump (a frozen bunny there "keeps staring at you")', async () => {
    document.documentElement.dataset['motion'] = 'reduce'
    moments.forced = { preset: 'peek-once', special: 'jump-out' }
    try {
      const { dialog } = await openMenu('/soon', FEED_MANY)
      await afterRise()
      expect(within(dialog).getByRole('button', { name: /Wunsch hinzufügen/ })).toBeTruthy()
      expect(within(dialog).queryByTestId('bunny-moment')).toBeNull()
      expect(dialog.querySelector('.cm-bunny')).toBeNull()
      expect(jumps.requests).toHaveLength(0)
    } finally {
      delete document.documentElement.dataset['motion']
    }
  })
})
