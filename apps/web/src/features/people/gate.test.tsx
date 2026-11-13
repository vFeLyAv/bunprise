import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FollowPeek, ViaLinkRequest } from '../../lib/api/follows.types'
import type { Me } from '../../lib/api/types'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { AppError } from '../../lib/errors'

// FollowGate — the signed-in part of /f (W03, like JoinGate): a FRESH get_me and a FRESH peek_follow_link
// (staleTime 0), the owner's banner / avatar / name, the three facts, "Folgen anfragen" (waits for the server and
// is sent for the account named on THIS screen) / "Nicht jetzt"; the variants own link · already following /
// asked · invalid; an incomplete profile goes to /welcome/profile?next=/f; a failure for a former account does not
// put the code back. Fictional data only.

const api = vi.hoisted(() => ({
  getLocalSession: vi.fn<() => Promise<Session | null>>(),
  getMe: vi.fn<(expectedUserId?: string) => Promise<Me>>(),
  peekFollowLink: vi.fn<(code: string, expectedUserId?: string) => Promise<FollowPeek>>(),
  requestFollowViaLink: vi.fn<(code: string, expectedUserId?: string) => Promise<ViaLinkRequest>>(),
  navigate: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../lib/supabase', () => ({
  hasLocalSession: () => true,
  getLocalSession: api.getLocalSession,
  getSupabase: () => Promise.reject(new Error('the Supabase client is never loaded in these tests')),
  onClientReady: () => () => {},
}))
vi.mock('../../lib/api/profile', () => ({ getMe: api.getMe }))
vi.mock('../../lib/api/follows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/follows')>()),
  peekFollowLink: api.peekFollowLink,
  requestFollowViaLink: api.requestFollowViaLink,
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    return <a href={href} className={className}>{children}</a>
  }
  return { Link, createLink: () => Link, useNavigate: () => api.navigate }
})

import FollowGate from './FollowGate'
import { consumePendingFollow, getPendingFollow, setPendingFollow } from './pendingFollow'

const ME = 'f1c7e000-0000-4000-8000-0000000000aa'
const CLARA = 'd1e0a000-0000-4000-8000-000000000003'
const CODE = '5c'.repeat(32)
const SESSION = { user: { id: ME } } as Session

function me({ display_name = 'Mila Sommer', consents_ok = true }: { display_name?: string | null; consents_ok?: boolean } = {}): Me {
  return {
    profile: { id: ME, display_name, locale: 'de', onboarding_done_at: null },
    consents_ok,
    legal_versions: { terms: 't', privacy: 'p', age: 'a' },
  }
}

function peek(relation: Partial<FollowPeek['relation']> = {}): FollowPeek {
  return { profile: { id: CLARA, display_name: 'Clara Test', banner: 'sky' }, relation: { self: false, i_follow: 'none', ...relation } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function renderGate(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const onSignedOut = vi.fn()
  const onInvalid = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <FollowGate onSignedOut={onSignedOut} onInvalid={onInvalid} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { onSignedOut, onInvalid, queryClient }
}

beforeEach(() => {
  sessionStorage.clear()
  consumePendingFollow()
  setPendingFollow(CODE)
  setRenderedAccount(ME)
  api.getLocalSession.mockResolvedValue(SESSION)
  api.getMe.mockResolvedValue(me())
  api.peekFollowLink.mockResolvedValue(peek())
  api.requestFollowViaLink.mockResolvedValue({ status: 'requested', profile_id: CLARA })
})
afterEach(() => {
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
})

describe('FollowGate (W03)', () => {
  it('asks the server afresh, names the owner and says what the request shares — nothing is sent by opening', async () => {
    const { queryClient } = renderGate()
    expect(await screen.findByRole('heading', { name: 'Clara Test folgen?' })).toBeTruthy()
    expect(api.getMe).toHaveBeenCalledWith(ME)
    expect(api.peekFollowLink).toHaveBeenCalledWith(CODE, ME)
    expect(screen.getByText('Mit deiner Anfrage sieht Clara Test deinen Namen „Mila Sommer“.')).toBeTruthy()
    expect(screen.getByText('Erst wenn Clara Test zustimmt, siehst du die geteilten Listen.')).toBeTruthy()
    expect(screen.getByText('Du kannst jederzeit aufhören zu folgen.')).toBeTruthy()
    expect(api.requestFollowViaLink).not.toHaveBeenCalled()
    expect(getPendingFollow()).toBe(CODE)
    // the peek is never reused: staleTime 0, nothing kept for later
    expect(queryClient.getQueryCache().find({ queryKey: ['followPeek', ME, CODE] })?.options.gcTime).toBe(0)
  })

  it('"Folgen anfragen" waits for the server, for the account of this screen, and uses the code once', async () => {
    renderGate()
    fireEvent.click(await screen.findByRole('button', { name: 'Folgen anfragen' }))
    await waitFor(() => expect(api.requestFollowViaLink).toHaveBeenCalledWith(CODE, ME))
    expect(await screen.findByRole('heading', { name: 'Angefragt' })).toBeTruthy()
    expect(screen.getByText('Clara Test entscheidet selbst. Sobald Clara Test zustimmt, siehst du die geteilten Listen.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zum Profil von Clara Test' }).getAttribute('href')).toBe(`/people/${CLARA}`)
    expect(getPendingFollow()).toBeNull()
  })

  it('variants: my own link · already following · already asked', async () => {
    api.peekFollowLink.mockResolvedValue(peek({ self: true }))
    const first = renderGate()
    expect(await screen.findByRole('heading', { name: 'Das ist dein eigener Link' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Folgen anfragen' })).toBeNull()
    void first
  })

  it('variant: already following', async () => {
    api.peekFollowLink.mockResolvedValue(peek({ i_follow: 'following' }))
    renderGate()
    expect(await screen.findByRole('heading', { name: 'Du folgst Clara Test schon' })).toBeTruthy()
    await waitFor(() => expect(getPendingFollow()).toBeNull())
  })

  it('variant: already asked (waiting or silently declined — the same)', async () => {
    api.peekFollowLink.mockResolvedValue(peek({ i_follow: 'requested' }))
    renderGate()
    expect(await screen.findByText('Du hast Clara Test schon angefragt. Clara Test entscheidet selbst.')).toBeTruthy()
  })

  it('a dead link (invite_invalid) drops the code and shows the one invalid page', async () => {
    api.peekFollowLink.mockRejectedValue(new AppError('invite_invalid'))
    const { onInvalid } = renderGate()
    await waitFor(() => expect(onInvalid).toHaveBeenCalled())
    expect(getPendingFollow()).toBeNull()
  })

  it('no name / no current legal records → /welcome/profile?next=/f (the code stays)', async () => {
    api.getMe.mockResolvedValue(me({ consents_ok: false }))
    renderGate()
    await waitFor(() => expect(api.navigate).toHaveBeenCalledWith({ to: '/welcome/profile', search: { next: '/f' }, replace: true }))
    expect(api.peekFollowLink).not.toHaveBeenCalled()
    expect(getPendingFollow()).toBe(CODE)
  })

  it('"Nicht jetzt" forgets the code and goes to Start — nothing is sent', async () => {
    renderGate()
    fireEvent.click(await screen.findByRole('button', { name: 'Nicht jetzt' }))
    expect(getPendingFollow()).toBeNull()
    expect(api.navigate).toHaveBeenCalledWith({ to: '/soon' })
    expect(api.requestFollowViaLink).not.toHaveBeenCalled()
  })

  it('a newer link in the same tab never shows the person of the previous one — not even for a frame', async () => {
    const { queryClient } = renderGate()
    expect(await screen.findByRole('heading', { name: 'Clara Test folgen?' })).toBeTruthy()
    cleanup()
    const ANNA = 'd1e0a000-0000-4000-8000-000000000001'
    const annaPeek = deferred<FollowPeek>()
    api.peekFollowLink.mockReturnValueOnce(annaPeek.promise)
    setPendingFollow('6d'.repeat(32))
    renderGate(queryClient) // the same cache: the previous answer may still be in it
    await waitFor(() => expect(api.peekFollowLink).toHaveBeenLastCalledWith('6d'.repeat(32), ME))
    expect(screen.queryByText(/Clara/)).toBeNull()
    annaPeek.resolve({ profile: { id: ANNA, display_name: 'Anna Beispiel', banner: null }, relation: { self: false, i_follow: 'following' } })
    expect(await screen.findByRole('heading', { name: 'Du folgst Anna Beispiel schon' })).toBeTruthy()
  })

  it('a failure for the current account puts the code back; for a former account it does not (W06)', async () => {
    api.requestFollowViaLink.mockRejectedValueOnce(new AppError('network'))
    renderGate()
    fireEvent.click(await screen.findByRole('button', { name: 'Folgen anfragen' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(getPendingFollow()).toBe(CODE)

    const late = deferred<ViaLinkRequest>()
    api.requestFollowViaLink.mockReturnValueOnce(late.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Folgen anfragen' }))
    await waitFor(() => expect(api.requestFollowViaLink).toHaveBeenCalledTimes(2))
    endAccountEpoch()
    late.reject(new AppError('network'))
    await new Promise((done) => setTimeout(done, 20))
    expect(getPendingFollow()).toBeNull()
  })

  it('an old request failure never replaces a newer link opened while it was in flight', async () => {
    const late = deferred<ViaLinkRequest>()
    api.requestFollowViaLink.mockReturnValueOnce(late.promise)
    renderGate()
    fireEvent.click(await screen.findByRole('button', { name: 'Folgen anfragen' }))
    await waitFor(() => expect(api.requestFollowViaLink).toHaveBeenCalledWith(CODE, ME))
    cleanup()
    const newer = '7a'.repeat(32)
    setPendingFollow(newer)
    late.reject(new AppError('network'))
    await new Promise((done) => setTimeout(done, 20))
    expect(getPendingFollow()).toBe(newer)
  })

  it('the button sends only the code shown on this screen, even if a newer link is already pending', async () => {
    renderGate()
    const request = await screen.findByRole('button', { name: 'Folgen anfragen' })
    const newer = '7a'.repeat(32)
    setPendingFollow(newer)
    fireEvent.click(request)
    await waitFor(() => expect(api.requestFollowViaLink).toHaveBeenCalledWith(CODE, ME))
    expect(getPendingFollow()).toBe(newer)
  })
})
