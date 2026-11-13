import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

// «Парад» (Felix 26.10, the Profil easter egg): 5 quick taps on the version line at the very bottom of Profil start
// the bunnies' tower over the "Abmelden" card (TowerMoment, a lazy chunk). The same mocks as AccountPages.test.tsx.
const api = vi.hoisted(() => ({ details: vi.fn(), navigate: vi.fn() }))
const tower = vi.hoisted(() => ({ made: [] as Array<{ reduced: boolean; finish: () => void }> }))
vi.mock('@tanstack/react-router', () => {
  const mocked = {
    useNavigate: () => api.navigate,
    useRouter: () => ({ history: { back: vi.fn() } }),
    useCanGoBack: () => false,
    Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>,
  }
  return { ...mocked, createLink: () => mocked.Link }
})
vi.mock('../../lib/api/account', () => ({
  exportMyData: vi.fn(), deleteMyAccount: vi.fn(), downloadJson: vi.fn(), exportFilename: () => 'x.json', getAccountDetails: api.details,
}))
vi.mock('../../lib/api/auth', () => ({ onAuthStateChange: () => () => undefined }))
const cache = vi.hoisted(() => ({ client: null as import('@tanstack/react-query').QueryClient | null }))
vi.mock('../../lib/query', async () => ({
  get queryClient() { return cache.client },
  isOfflineFeedEnabled: () => false, setOfflineFeedEnabled: vi.fn(), signOutEverywhere: vi.fn(), clearAccountDeviceState: vi.fn(),
}))
vi.mock('../../lib/api/profile', () => ({ updateMyProfile: vi.fn() }))
vi.mock('@bunprise/mascot/tower', () => ({
  TowerStage: class {
    busy = false
    isDestroyed = false
    suspended = false
    readonly done: Promise<void>
    constructor(_host: HTMLElement, options: { reduced: boolean }) {
      let resolve!: () => void
      this.done = new Promise((r) => { resolve = r })
      tower.made.push({ reduced: options.reduced, finish: () => { this.busy = false; resolve() } })
    }
    play() { this.busy = true }
    stop() { this.busy = false }
    destroy() { this.isDestroyed = true }
  },
}))
import { SettingsPage } from './AccountPages'
import { paradeTaps } from './paradeTaps'
import { resetStage } from '../mascot-ui/stage'

beforeEach(() => {
  cache.client = new QueryClient()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.details.mockResolvedValue({ me: { profile: { id: 'account-a', display_name: 'Mia' }, consents_ok: true }, email: 'fixture@example.org' })
  paradeTaps.reset()
  document.documentElement.dataset['motion'] = 'full'
})
afterEach(() => {
  cleanup()
  tower.made.length = 0
  resetStage()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-motion')
  document.documentElement.removeAttribute('data-bunnies')
})

function versionLine(container: HTMLElement): HTMLElement {
  const line = container.querySelector<HTMLElement>('[data-pilot-line]')
  if (!line) throw new Error('no version line')
  return line
}

describe('Profil: the tower easter egg', () => {
  it('5 quick taps on the version line build the tower over the "Abmelden" card; it goes away at its end', async () => {
    const { container } = render(<SettingsPage userId="account-a" />)
    await screen.findAllByText('fixture@example.org')
    const line = versionLine(container)
    for (let i = 0; i < 4; i++) fireEvent.click(line)
    expect(container.querySelector('[data-tower]')).toBeNull()
    fireEvent.click(line)
    await waitFor(() => expect(tower.made).toHaveLength(1))
    const host = container.querySelector<HTMLElement>('[data-tower]')
    expect(host).toBeTruthy()
    // it sits in the card's wrapper, right before the card (the wrapper is positioned)
    expect(host?.nextElementSibling?.querySelector('.set-logout')).toBeTruthy()
    expect(host?.parentElement?.className).toMatch(/\brelative\b/)
    expect(tower.made[0]?.reduced).toBe(false)
    // no visible change to the line itself (a secret: no hint)
    expect(line.textContent).toMatch(/Version/)
    await act(async () => { tower.made[0]?.finish(); await Promise.resolve() })
    await waitFor(() => expect(container.querySelector('[data-tower]')).toBeNull())
  })

  it('"Kaninchen zeigen" off: taps do nothing', async () => {
    document.documentElement.dataset['bunnies'] = 'off'
    const { container } = render(<SettingsPage userId="account-a" />)
    await screen.findAllByText('fixture@example.org')
    for (let i = 0; i < 5; i++) fireEvent.click(versionLine(container))
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-tower]')).toBeNull()
    expect(tower.made).toHaveLength(0)
  })

  it('"Weniger": the still heads', async () => {
    document.documentElement.dataset['motion'] = 'reduce'
    const { container } = render(<SettingsPage userId="account-a" />)
    await screen.findAllByText('fixture@example.org')
    for (let i = 0; i < 5; i++) fireEvent.click(versionLine(container))
    await waitFor(() => expect(tower.made).toHaveLength(1))
    expect(tower.made[0]?.reduced).toBe(true)
  })
})
