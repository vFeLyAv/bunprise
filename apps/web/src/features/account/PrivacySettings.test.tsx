import type { ReactNode } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../lib/api/types'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { AppError } from '../../lib/errors'
import { queryKeys } from '../../lib/queryKeys'
import { getToasts, toast } from '../../lib/toast'

// Profil › "Privatsphäre" (follows-design §2.11): the link sheet, the people screen and its "Blockiert" section,
// the switch "In Vorschlägen aus Anlässen erscheinen" (default OFF; the own REST write, optimistic with rollback),
// "Wer sieht was?" (static). Without the flag the group does not exist. Fictional data only.

const api = vi.hoisted(() => ({
  setInSuggestions: vi.fn<(value: boolean, expectedUserId?: string) => Promise<void>>(),
  getMe: vi.fn<(expectedUserId?: string) => Promise<Me>>(),
}))
vi.mock('../../lib/api/follows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/follows')>()),
  setInSuggestions: api.setInSuggestions,
}))
vi.mock('../../lib/api/profile', () => ({ getMe: api.getMe }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, search, hash, children, className }: { to: string; search?: Record<string, string>; hash?: string; children: ReactNode; className?: string }) => {
    const query = new URLSearchParams(search ?? {}).toString()
    return <a href={`${query ? `${to}?${query}` : to}${hash ? `#${hash}` : ''}`} className={className}>{children}</a>
  },
}))

import { PrivacySettings } from './PrivacySettings'
import { useFollowLinkSheetState } from '../people/linkSheetHost'

const ME = '00000000-0000-4000-8000-0000000000aa'

function me(inSuggestions = false): Me {
  return {
    profile: { id: ME, display_name: 'Mila', locale: 'de', onboarding_done_at: null, in_suggestions: inSuggestions },
    consents_ok: true,
    legal_versions: { terms: 't', privacy: 'p', age: 'a' },
    inbox: { follow_requests: 0 },
  }
}

function SheetState() {
  const state = useFollowLinkSheetState()
  return <output data-testid="sheet">{state.open ? `open:${state.manage ? 'manage' : 'share'}:${state.tab}` : 'closed'}</output>
}

function renderGroup(props: { disabled?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(queryKeys.me(), me())
  render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <ul>
          <PrivacySettings userId={ME} {...props} />
        </ul>
        <SheetState />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return queryClient
}

function deferred() {
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((_, fail) => { reject = fail })
  return { promise, reject }
}

beforeEach(() => {
  vi.stubEnv('VITE_LISTS', '1')
  setRenderedAccount(ME)
  api.getMe.mockResolvedValue(me())
  api.setInSuggestions.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
  for (const item of getToasts()) toast.dismiss(item.id)
})

describe('Profil › Privatsphäre', () => {
  it('the rows: my link (with "Alle Links deaktivieren"), followers & requests, blocked people, who sees what', () => {
    vi.stubEnv('VITE_DEMO', '')
    vi.stubEnv('VITE_FRIEND_CODES', '')
    renderGroup()
    const group = screen.getByRole('region', { name: 'Privatsphäre' })
    expect(within(group).getByRole('link', { name: 'Follower & Anfragen' }).getAttribute('href')).toBe('/people')
    expect(within(group).getByRole('link', { name: 'Blockierte Personen' }).getAttribute('href')).toBe('/people?section=blocked#people-blocked')
    // QA ACCOUNT-2: the hash lets the router bring the section into view after its own scroll reset (also when
    // the people screen is cached: the screen's own scroll ran before that reset and was undone)
    // without the codes' flag the one row is my follow link alone (the sheet: the link as the main thing)
    expect(within(group).queryByRole('button', { name: 'Mein Code & Link' })).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Mein Folgen-Link' }))
    expect(screen.getByTestId('sheet').textContent).toBe('open:manage:link')
  })

  it('with the codes: ONE row "Mein Code & Link" instead of "Mein Folgen-Link" + "Mein Code (QR)"; it opens on the code (Felix 27.10)', () => {
    vi.stubEnv('VITE_FRIEND_CODES', '1')
    renderGroup()
    const group = screen.getByRole('region', { name: 'Privatsphäre' })
    expect(within(group).queryByRole('button', { name: 'Mein Folgen-Link' })).toBeNull()
    expect(within(group).queryByRole('button', { name: 'Mein Code (QR)' })).toBeNull()
    expect(within(group).getAllByRole('button', { name: /Mein Code/ })).toHaveLength(1)
    fireEvent.click(within(group).getByRole('button', { name: 'Mein Code & Link' }))
    // "Alle Links deaktivieren" stays (manage); the sheet starts on "Mein Code" with the link below
    expect(screen.getByTestId('sheet').textContent).toBe('open:manage:code')
  })

  it('the switch starts OFF (Art. 25 Abs. 2) from get_me and moves at once; the server gets exactly the own row', async () => {
    renderGroup()
    const toggle = screen.getByRole('switch', { name: /In Vorschlägen aus Anlässen erscheinen/ })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Gäste aus gemeinsamen Anlässen der letzten 30 Tage sehen dich dann unter „Aus deinen Anlässen“ und können dich anfragen.')).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(api.setInSuggestions).toHaveBeenCalledWith(true, ME))
  })

  it('a failed write rolls back and says so; a late failure after an account switch does nothing', async () => {
    api.setInSuggestions.mockRejectedValueOnce(new AppError('network'))
    renderGroup()
    const toggle = screen.getByRole('switch', { name: /In Vorschlägen/ })
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    expect(getToasts().map((item) => item.text)).toContain('Die Einstellung konnte nicht gespeichert werden – sie ist wieder wie vorher.')
    for (const item of getToasts()) toast.dismiss(item.id)

    const late = deferred()
    api.setInSuggestions.mockReturnValueOnce(late.promise)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    endAccountEpoch()
    late.reject(new AppError('network'))
    await new Promise((done) => setTimeout(done, 20))
    expect(getToasts()).toEqual([])
  })

  it('"Wer sieht was?" is a static sheet', async () => {
    renderGroup()
    fireEvent.click(screen.getByRole('button', { name: 'Wer sieht was?' }))
    const sheet = await screen.findByRole('dialog', { name: 'Wer sieht was?' })
    for (const text of [
      '„Nur ich“ – so beginnt jede neue Liste. Niemand außer dir sieht sie.',
      'Folgen geht in eine Richtung: Wer dir folgt, sieht deine Listen – du seine erst, wenn du ihm auch folgst.',
      'Vorschläge aus Anlässen gibt es nur, wenn du sie einschaltest.',
      'Reservierungen zu deinen Wünschen siehst du nie.',
      'Deine Follower-Liste siehst nur du.',
    ]) expect(within(sheet).getByText(text)).toBeTruthy()
  })

  it('the account changed on the profile screen: nothing can be pressed', () => {
    vi.stubEnv('VITE_DEMO', '')
    vi.stubEnv('VITE_FRIEND_CODES', '')
    renderGroup({ disabled: true })
    expect((screen.getByRole('switch', { name: /In Vorschlägen/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Mein Folgen-Link' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('without the flag the group does not exist', () => {
    vi.stubEnv('VITE_LISTS', '')
    renderGroup()
    expect(screen.queryByRole('region', { name: 'Privatsphäre' })).toBeNull()
  })
})
