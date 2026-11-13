import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberStartView, resetFeedSession } from '../feed/session'
import { resetCreateMenuForTests } from './createMenuStore'
import { OCCASION_ID, USER, me, renderLayout } from './test-utils'

// the menu's bunny is tested in features/mascot-ui; here it is a stub
vi.mock('../mascot-ui/WelcomeBunnies', () => ({
  default: (props: { choreography: string }) => <div data-testid="welcome-bunnies" data-choreography={props.choreography} />,
  preloadWelcome: () => undefined,
}))

afterEach(() => {
  act(() => resetCreateMenuForTests())
  resetFeedSession()
  vi.unstubAllEnvs()
})

describe('cached follow request dot', () => {
  it('shows no number, names the Lists tab, and reacts to the same-account cache only', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    const profile = { ...me(USER, 'Mila'), inbox: { follow_requests: 3 } }
    const { queryClient } = renderLayout('/soon', { profile })
    const link = await screen.findByRole('link', { name: 'Listen, neue Anfragen' })
    expect(link.textContent).toBe('Listen')
    expect(link.querySelector('.tabbar-request-dot')).not.toBeNull()
    act(() => queryClient.setQueryData(['me'], { ...profile, profile: { ...profile.profile, id: 'another-account' } }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Listen, neue Anfragen' })).toBeNull())
    expect(queryClient.isFetching()).toBe(0)
  })
  it('stays absent with the feature off even when the cache has requests', async () => {
    vi.stubEnv('VITE_LISTS', '0'); vi.stubEnv('VITE_DEMO', '0')
    renderLayout('/soon', { profile: { ...me(USER, 'Mila'), inbox: { follow_requests: 3 } } })
    expect(await screen.findByRole('link', { name: 'Listen' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Listen, neue Anfragen' })).toBeNull()
  })
  it.each([0, -1])('does not announce a nonpositive cached request count (%s)', async (count) => {
    vi.stubEnv('VITE_LISTS', '1')
    renderLayout('/soon', { profile: { ...me(USER, 'Mila'), inbox: { follow_requests: count } } })
    expect(await screen.findByRole('link', { name: 'Listen' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Listen, neue Anfragen' })).toBeNull()
    expect(document.querySelector('.tabbar-request-dot')).toBeNull()
  })
  it('has no focusable icon spans inside its named links', async () => {
    renderLayout('/soon')
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    expect([...nav.querySelectorAll('.tabbar-icon')].every((el) => el.getAttribute('tabindex') === '-1')).toBe(true)
    expect([...nav.querySelectorAll<HTMLElement>('a,button,[tabindex="0"]')].map((el) => el.getAttribute('aria-label') || el.textContent)).toEqual(['Start', 'Listen', 'Neu erstellen', 'Ideen', 'Profil'])
  })
})

const bar = () => screen.queryByRole('navigation', { name: 'Hauptnavigation' })
/** the selection pill of a capsule: motion renders its resting opacity inline */
const pillOpacity = (nav: HTMLElement, group: 'left' | 'right') => nav.querySelector<HTMLElement>(`.tabbar-group-${group} .tabbar-pill`)?.style.opacity

describe('tab bar: where it shows (wave 2: Start · Listen · + · Ideen · Profil)', () => {
  it.each([
    ['/soon', 'Start', 'left'],
    ['/lists', 'Listen', 'left'],
    ['/gifts', 'Ideen', 'right'],
    ['/settings', 'Profil', 'right'],
  ] as const)('on %s with "%s" selected — its capsule holds the pill', async (path, selected, group) => {
    renderLayout(path)
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    const current = within(nav).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual([selected])
    expect(pillOpacity(nav, group)).toBe('1')
    expect(pillOpacity(nav, group === 'left' ? 'right' : 'left')).toBe('0')
    // the screens end above the bar
    expect(document.documentElement.hasAttribute('data-tabbar')).toBe(true)
  })

  it.each([`/occasions/${OCCASION_ID}`, '/occasions/new', `/occasions/${OCCASION_ID}/wishes/new`, '/settings/export'])(
    'is hidden on the pushed screen %s',
    async (path) => {
      renderLayout(path)
      expect(await screen.findByText(/occasion|new wish|export/)).toBeTruthy()
      expect(bar()).toBeNull()
      expect(document.documentElement.hasAttribute('data-tabbar')).toBe(false)
    },
  )

  it('leaves with a pushed screen and comes back with the top-level one', async () => {
    const { router } = renderLayout('/soon')
    await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    await act(() => router.navigate({ to: '/occasions/$occasionId', params: { occasionId: OCCASION_ID } }))
    await waitFor(() => expect(bar()).toBeNull())
    await act(() => router.navigate({ to: '/gifts' }))
    expect(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).toBeTruthy()
  })
})

describe('tab bar: tabs and the "+"', () => {
  it('reads Start · Listen · ( + ) · Ideen · Profil, two tabs in each capsule around the "+"', async () => {
    renderLayout('/soon')
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    const controls = Array.from(nav.querySelectorAll<HTMLElement>('a, button'))
    expect(controls.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Start', 'Listen', 'Neu erstellen', 'Ideen', 'Profil'])
    expect(within(nav).getAllByRole('list').map((list) => within(list).getAllByRole('listitem').length)).toEqual([2, 2])
    const plus = within(nav).getByRole('button', { name: 'Neu erstellen' })
    expect(plus.getAttribute('aria-haspopup')).toBe('dialog')
    expect(plus.getAttribute('aria-expanded')).toBe('false')
    // the "+" sits between the two capsules in the DOM (and in the grid's middle column)
    expect(plus.closest('.tabbar-create-slot')?.previousElementSibling?.classList.contains('tabbar-group-left')).toBe(true)
    expect(plus.closest('.tabbar-create-slot')?.nextElementSibling?.classList.contains('tabbar-group-right')).toBe(true)
  })

  it('switches tabs with real links (no view transition) and moves the selection between the capsules', async () => {
    const { router } = renderLayout('/soon')
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    expect(within(nav).getByRole('link', { name: 'Listen' }).getAttribute('href')).toBe('/lists')
    expect(within(nav).getByRole('link', { name: 'Ideen' }).getAttribute('href')).toBe('/gifts')
    expect(within(nav).getByRole('link', { name: /Profil/ }).getAttribute('href')).toBe('/settings')
    fireEvent.click(within(nav).getByRole('link', { name: 'Ideen' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/gifts'))
    await waitFor(() => expect(within(bar()!).getByRole('link', { name: 'Ideen' }).getAttribute('aria-current')).toBe('page'))
    await waitFor(() => expect(pillOpacity(bar()!, 'right')).toBe('1'))
    fireEvent.click(within(bar()!).getByRole('link', { name: 'Listen' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/lists'))
    await waitFor(() => expect(pillOpacity(bar()!, 'left')).toBe('1'))
  })

  it('a tap on the tab you are on scrolls its screen back to the top (iOS, Telegram) instead of navigating', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const { router } = renderLayout('/soon')
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    scrollTo.mockClear()
    fireEvent.click(within(nav).getByRole('link', { name: 'Start' }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(router.state.location.pathname).toBe('/soon')
    // another tab still navigates
    fireEvent.click(within(nav).getByRole('link', { name: 'Listen' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/lists'))
    scrollTo.mockRestore()
  })

  it('the Start tab goes back to the view you left on Start ("Monat" → /soon?view=month)', async () => {
    renderLayout('/settings')
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' })
    expect(within(nav).getByRole('link', { name: 'Start' }).getAttribute('href')).toBe('/soon')
    act(() => rememberStartView('month'))
    expect(within(nav).getByRole('link', { name: 'Start' }).getAttribute('href')).toBe('/soon?view=month')
    act(() => rememberStartView('list'))
    expect(within(nav).getByRole('link', { name: 'Start' }).getAttribute('href')).toBe('/soon')
  })

  it('the Profil tab is the person’s avatar: initials in their stable colour, from the cached get_me', async () => {
    renderLayout('/soon', { profile: me(USER, 'Mila Muster') })
    const profile = within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('link', { name: /Profil/ })
    const avatar = profile.querySelector('.tile')
    expect(avatar?.textContent).toBe('MM')
    expect(avatar?.getAttribute('data-tile')).toMatch(/^[1-4]$/)
  })

  it('never shows another account’s initials', async () => {
    renderLayout('/soon', { profile: me('account-b', 'Ben Beispiel') })
    const profile = within(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).getByRole('link', { name: /Profil/ })
    expect(profile.querySelector('.tile')?.textContent).toBe('')
  })
})
