import type { ReactNode } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InviteCandidate, MyInvitation, OccasionInviteInfo } from '../../lib/api/invitations'
import type { Me } from '../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { AppError } from '../../lib/errors'
import { queryKeys } from '../../lib/queryKeys'
import { getToasts, toast } from '../../lib/toast'
import { GUEST_ID, HOST_ID, OCCASION_ID, guestScreen, hostScreen } from '../occasions/test-utils'

// "Freunde einladen" in the client (docs/spec/in-app-invites-design.md §7): the card on Start and its sheet, the
// friend picker, the occasion screen's entries, Profil › Privatsphäre — behind VITE_INVITES. Invented data only.

const api = vi.hoisted(() => ({
  getMyInvitations: vi.fn<(userId?: string) => Promise<MyInvitation[]>>(),
  respondOccasionInvite: vi.fn<(id: string, accept: boolean, userId?: string) => Promise<{ occasion_id: string } | null>>(),
  getInviteCandidates: vi.fn<(occasionId: string, userId?: string) => Promise<InviteCandidate[]>>(),
  sendOccasionInvites: vi.fn<(occasionId: string, ids: readonly string[], userId?: string) => Promise<{ profile_id: string; state: string; expires_at: string | null }[]>>(),
  withdrawOccasionInvite: vi.fn<(occasionId: string, profileId: string, userId?: string) => Promise<void>>(),
  getOccasionInviteInfo: vi.fn<(occasionId: string, userId?: string) => Promise<OccasionInviteInfo>>(),
  setGuestsCanInvite: vi.fn<(occasionId: string, allowed: boolean, userId?: string) => Promise<void>>(),
  setInvitationsFrom: vi.fn<(value: 'friends' | 'nobody', userId?: string) => Promise<void>>(),
}))
const follows = vi.hoisted(() => ({ blockPerson: vi.fn<(id: string, userId?: string) => Promise<void>>() }))
const nav = vi.hoisted(() => ({ navigate: vi.fn() }))
const profile = vi.hoisted(() => ({ getMe: vi.fn<(userId?: string) => Promise<Me>>() }))
vi.mock('../../lib/api/invitations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/invitations')>()), ...api }))
vi.mock('../../lib/api/follows', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/follows')>()), ...follows }))
vi.mock('../../lib/api/profile', () => profile)
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => nav.navigate,
}))

import InvitationInbox from './InvitationInbox'
import InviteFriendsSheet from './InviteFriendsSheet'
import { InvitationsPrivacyRow } from './InvitationsPrivacyRow'
import { inviteCountOf } from './dot'
import { invitesEnabled } from './flag'
import { invitationKeys } from './queries'
import { MembersSection } from '../occasions/MembersSection'

const ME = '00000000-0000-4000-8000-0000000000aa'
const ANNA = '00000000-0000-4000-8000-0000000000a1'
const PAULA = '00000000-0000-4000-8000-0000000000a2'

function meWith(count: number, from: 'friends' | 'nobody' = 'friends', id = ME): Me {
  return {
    profile: { id, display_name: 'Lena', locale: 'de', onboarding_done_at: null, invitations_from: from },
    consents_ok: true,
    legal_versions: { terms: 't', privacy: 'p', age: 'a' },
    inbox: { follow_requests: 0, occasion_invites: count },
  }
}

const invitation = (patch: Partial<MyInvitation> = {}): MyInvitation => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  occasion: { id: OCCASION_ID, title: 'Grillabend', starts_at: '2030-11-14T17:00:00.000Z', tz: 'Europe/Berlin', all_day: false },
  host_name: 'Ben',
  from_host: false,
  inviter: { id: ANNA, display_name: 'Anna', banner: null, photo: null, banner_photo: null },
  expires_at: '2030-11-02T10:00:00.000Z',
  created_at: '2030-10-26T10:00:00.000Z',
  ...patch,
})

const candidate = (id: string, name: string, state: InviteCandidate['state'] = 'none', expires: string | null = null): InviteCandidate => ({
  profile: { id, display_name: name, banner: null, photo: null, banner_photo: null }, state, expires_at: expires,
})

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

function renderIn(ui: ReactNode, queryClient = client()) {
  render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>{ui}</LazyMotion>
    </QueryClientProvider>,
  )
  return queryClient
}

beforeEach(() => {
  vi.stubEnv('VITE_INVITES', '1')
  setRenderedAccount(ME)
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
  for (const item of getToasts()) toast.dismiss(item.id)
})

describe('the flag and the dot', () => {
  it('on in the demo and with VITE_INVITES=1, off otherwise', () => {
    expect(invitesEnabled({ VITE_DEMO: '1' })).toBe(true)
    expect(invitesEnabled({ VITE_INVITES: '1' })).toBe(true)
    expect(invitesEnabled({ VITE_DEMO: '0', VITE_INVITES: '0' })).toBe(false)
    expect(invitesEnabled({})).toBe(false)
  })

  it('counts only this account\'s cached get_me, never a negative or odd number, nothing without the flag', () => {
    expect(inviteCountOf(meWith(2), ME)).toBe(2)
    expect(inviteCountOf(meWith(2, 'friends', 'someone-else'), ME)).toBe(0)
    expect(inviteCountOf(meWith(-3), ME)).toBe(0)
    expect(inviteCountOf(undefined, ME)).toBe(0)
    vi.stubEnv('VITE_INVITES', '0')
    vi.stubEnv('VITE_DEMO', '0')
    expect(inviteCountOf(meWith(2), ME)).toBe(0)
  })
})

describe('the card on Start and its sheet', () => {
  function inbox(list: MyInvitation[]) {
    api.getMyInvitations.mockResolvedValue(list)
    const queryClient = client()
    queryClient.setQueryData(queryKeys.me(), meWith(list.length))
    renderIn(<InvitationInbox userId={ME} count={list.length} />, queryClient)
    return queryClient
  }

  it('shows who invites, the title, day and time and the expiry; several read as one stack', async () => {
    inbox([invitation(), invitation({ id: '00000000-0000-4000-8000-0000000000c2', occasion: { ...invitation().occasion, title: 'Brunch' } })])
    const card = await screen.findByRole('button', { name: /^Anna lädt dich ein. /u })
    expect(card.textContent).toContain('„Grillabend“')
    expect(card.textContent).toContain('gilt bis')
    expect(card.getAttribute('aria-label')).toMatch(/Grillabend.*gilt bis/)
    expect(card.textContent).toContain('1 weitere Einladung')
    expect(api.getMyInvitations).toHaveBeenCalledWith(ME)
    expect(document.body.textContent).not.toMatch(/reserv/i)
  })

  it('the sheet says what joining shares, the host by name only, and that a decline stays silent', async () => {
    inbox([invitation()])
    fireEvent.click(await screen.findByRole('button', { name: /^Anna lädt dich ein. /u }))
    const dialog = await screen.findByRole('dialog', { name: 'Anna lädt dich ein' })
    expect(within(dialog).getByText('Gastgeber: Ben')).toBeTruthy()
    expect(dialog.textContent).toContain('Mit dem Beitritt sehen Ben und die Gäste deinen Namen „Lena“')
    expect(dialog.textContent).toContain('Ben sieht, dass Anna dich eingeladen hat.')
    expect(within(dialog).getByText('Anna erfährt nicht, wenn du ablehnst.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Ablehnen und blockieren' })).toBeTruthy()
  })

  it('an invitation of the host itself does not say "Ben sieht, dass …"', async () => {
    inbox([invitation({ from_host: true, inviter: { id: ANNA, display_name: 'Ben', banner: null } })])
    fireEvent.click(await screen.findByRole('button', { name: /^Ben lädt dich ein. /u }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).not.toContain('dich eingeladen hat')
  })

  it('"Beitreten" waits for the server, then the occasion opens and the card and the dot are gone', async () => {
    let resolve!: (value: { occasion_id: string }) => void
    api.respondOccasionInvite.mockReturnValue(new Promise((r) => { resolve = r }))
    const queryClient = inbox([invitation()])
    fireEvent.click(await screen.findByRole('button', { name: /^Anna lädt dich ein. /u }))
    fireEvent.click(await screen.findByRole('button', { name: 'Beitreten' }))
    expect(api.respondOccasionInvite).toHaveBeenCalledWith(invitation().id, true, ME)
    // still there while the server works (no optimistic join)
    expect(queryClient.getQueryData<MyInvitation[]>(invitationKeys.inbox(ME))).toHaveLength(1)
    // the server's next answers: the invitation is gone
    api.getMyInvitations.mockResolvedValue([])
    await act(async () => resolve({ occasion_id: OCCASION_ID }))
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/occasions/$occasionId', params: { occasionId: OCCASION_ID } }))
    expect(queryClient.getQueryData<MyInvitation[]>(invitationKeys.inbox(ME))).toEqual([])
    expect(queryClient.getQueryData<Me>(queryKeys.me())?.inbox?.occasion_invites).toBe(0)
  })

  it('without current consents "Beitreten" leads to the profile step and comes back to Start', async () => {
    api.respondOccasionInvite.mockRejectedValue(new AppError('consent_required'))
    inbox([invitation()])
    fireEvent.click(await screen.findByRole('button', { name: /^Anna lädt dich ein. /u }))
    fireEvent.click(await screen.findByRole('button', { name: 'Beitreten' }))
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/welcome/profile', search: { next: '/soon' } }))
  })

  it('"Ablehnen" is optimistic and silent; a failure brings the card back with a toast', async () => {
    api.respondOccasionInvite.mockRejectedValueOnce(new AppError('network'))
    const queryClient = inbox([invitation()])
    fireEvent.click(await screen.findByRole('button', { name: /^Anna lädt dich ein. /u }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ablehnen' }))
    expect(queryClient.getQueryData<MyInvitation[]>(invitationKeys.inbox(ME))).toEqual([])
    await waitFor(() => expect(queryClient.getQueryData<MyInvitation[]>(invitationKeys.inbox(ME))).toHaveLength(1))
    expect(getToasts().some((item) => item.kind === 'error')).toBe(true)
  })

  it('"Ablehnen und blockieren" declines, then blocks the inviter', async () => {
    api.respondOccasionInvite.mockResolvedValue(null)
    follows.blockPerson.mockResolvedValue(undefined)
    inbox([invitation()])
    fireEvent.click(await screen.findByRole('button', { name: /^Anna lädt dich ein. /u }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ablehnen und blockieren' }))
    // one more question first (blocking is a strong step); nothing is sent before it
    const confirm = await screen.findByRole('dialog', { name: 'Anna blockieren?' })
    expect(api.respondOccasionInvite).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Ablehnen und blockieren' }))
    await waitFor(() => expect(follows.blockPerson).toHaveBeenCalledWith(ANNA, ME))
    expect(api.respondOccasionInvite).toHaveBeenCalledWith(invitation().id, false, ME)
    expect(getToasts().some((item) => item.text === 'Abgelehnt – Anna ist blockiert')).toBe(true)
  })
})

describe('the friend picker', () => {
  function picker(list: InviteCandidate[], isHost = true, info: OccasionInviteInfo = { guests_can_invite: false, can_invite: true, invited_by: [] }) {
    api.getInviteCandidates.mockResolvedValue(list)
    api.getOccasionInviteInfo.mockResolvedValue(info)
    return renderIn(<InviteFriendsSheet open onClose={() => undefined} occasionId={OCCASION_ID} userId={ME} isHost={isHost} hostName="Ben" />)
  }

  it('lists my friends; "Einladen" turns the row into "Eingeladen" at once, the date follows from the server', async () => {
    api.sendOccasionInvites.mockResolvedValue([{ profile_id: ANNA, state: 'invited', expires_at: '2030-11-02T10:00:00.000Z' }])
    picker([candidate(ANNA, 'Anna'), candidate(PAULA, 'Paula', 'invited', '2030-11-01T10:00:00.000Z')])
    const invite = await screen.findByRole('button', { name: 'Anna einladen' })
    expect(screen.getByRole('button', { name: 'Einladung an Paula zurückziehen' })).toBeTruthy()
    expect(screen.getByText('Hier stehen Menschen, denen du folgst und die dir folgen.')).toBeTruthy()
    expect(screen.getByText(/Ob jemand ablehnt, erfährst du nicht\./)).toBeTruthy()
    fireEvent.click(invite)
    expect(await screen.findByRole('button', { name: 'Einladung an Anna zurückziehen' })).toBeTruthy()
    expect(api.sendOccasionInvites).toHaveBeenCalledWith(OCCASION_ID, [ANNA], ME)
    await waitFor(() => expect(screen.getAllByText(/Eingeladen · bis/)).toHaveLength(2))
  })

  it('the daily limit rolls the row back and says so in plain words', async () => {
    api.sendOccasionInvites.mockRejectedValue(new AppError('limit_reached'))
    picker([candidate(ANNA, 'Anna')])
    fireEvent.click(await screen.findByRole('button', { name: 'Anna einladen' }))
    expect(await screen.findByRole('button', { name: 'Anna einladen' })).toBeTruthy()
    await waitFor(() => expect(getToasts().some((item) => item.text === 'Für heute hast du genug eingeladen. Morgen geht es weiter.')).toBe(true))
  })

  it('"Zurückziehen" is optimistic too', async () => {
    api.withdrawOccasionInvite.mockResolvedValue(undefined)
    picker([candidate(PAULA, 'Paula', 'invited', '2030-11-01T10:00:00.000Z')])
    fireEvent.click(await screen.findByRole('button', { name: 'Einladung an Paula zurückziehen' }))
    expect(await screen.findByText('Zurückgezogen')).toBeTruthy()
    expect(api.withdrawOccasionInvite).toHaveBeenCalledWith(OCCASION_ID, PAULA, ME)
  })

  it('no friends yet: says what a friend is', async () => {
    picker([])
    expect(await screen.findByText('Noch keine Freunde hier')).toBeTruthy()
    expect(screen.getByText('Freunde sind Menschen, denen du folgst und die dir folgen.')).toBeTruthy()
  })

  it('a guest reads that the host allows it and sees the inviter later; no host switch for a guest', async () => {
    picker([candidate(ANNA, 'Anna')], false)
    expect(await screen.findByText('Ben erlaubt Gästen, Freunde einzuladen. Ben sieht, wen du eingeladen hast, sobald die Person beitritt.')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('the host switches "Gäste dürfen Freunde einladen" (default off), optimistic with rollback', async () => {
    api.setGuestsCanInvite.mockRejectedValueOnce(new AppError('network'))
    picker([candidate(ANNA, 'Anna')])
    const toggle = await screen.findByRole('switch', { name: /Gäste dürfen Freunde einladen/ })
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    expect(api.setGuestsCanInvite).toHaveBeenCalledWith(OCCASION_ID, true, ME)
  })
})

describe('the occasion screen ("Wer kommt")', () => {
  // since 27.10 (Felix) the ways to invite are rows on top of the members list (occasions/InviteSection.tsx)
  it('the host gets "Freunde einladen" and "Per Link einladen" on top of the members list', async () => {
    api.getOccasionInviteInfo.mockResolvedValueOnce({ guests_can_invite: false, can_invite: true, invited_by: [] })
    renderIn(<MembersSection screen={hostScreen()} userId={HOST_ID} />)
    const group = await screen.findByRole('group', { name: 'Einladen' })
    expect(await within(group).findByRole('button', { name: 'Freunde einladen' })).toBeTruthy()
    expect(within(group).getByRole('button', { name: 'Per Link einladen' })).toBeTruthy()
  })

  it('once the server says the host may not invite in the app any more (the start), the link stays', async () => {
    api.getOccasionInviteInfo.mockResolvedValueOnce({ guests_can_invite: false, can_invite: false, invited_by: [] })
    renderIn(<MembersSection screen={hostScreen()} userId={HOST_ID} />)
    await waitFor(() => expect(api.getOccasionInviteInfo).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Freunde einladen' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Per Link einladen' })).toBeTruthy()
  })

  it('a guest without the permission sees no invite rows at all (and never the link)', async () => {
    api.getOccasionInviteInfo.mockResolvedValueOnce({ guests_can_invite: false, can_invite: false, invited_by: [] })
    renderIn(<MembersSection screen={guestScreen()} userId={GUEST_ID} />)
    await waitFor(() => expect(api.getOccasionInviteInfo).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: 'Einladen' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Freunde einladen/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Per Link einladen' })).toBeNull()
  })

  it('… with the permission: the row says who allows it and opens the picker; still no link for a guest', async () => {
    api.getOccasionInviteInfo.mockResolvedValue({ guests_can_invite: true, can_invite: true, invited_by: [] })
    api.getInviteCandidates.mockResolvedValue([candidate(ANNA, 'Anna')])
    renderIn(<MembersSection screen={guestScreen()} userId={GUEST_ID} />)
    const row = await screen.findByRole('button', { name: /Freunde einladen/ })
    expect(row.textContent).toContain('Mila erlaubt es Gästen')
    expect(row.closest('[role="group"]')?.getAttribute('aria-label')).toBe('Einladen')
    expect(screen.queryByRole('button', { name: 'Per Link einladen' })).toBeNull()
    fireEvent.click(row)
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('without the flag: no request, no picker row — the host keeps "Per Link einladen"', () => {
    vi.stubEnv('VITE_INVITES', '0')
    vi.stubEnv('VITE_DEMO', '0')
    renderIn(<MembersSection screen={hostScreen()} userId={HOST_ID} />)
    expect(screen.queryByRole('button', { name: 'Freunde einladen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Per Link einladen' })).toBeTruthy()
    expect(api.getOccasionInviteInfo).not.toHaveBeenCalled()
  })

  it('"eingeladen von Anna" next to a guest — for the host only', async () => {
    // the "Freunde einladen" entry asked get_occasion_invite_info; the member list reads that cache entry
    const queryClient = client()
    queryClient.setQueryData(invitationKeys.info(OCCASION_ID), { guests_can_invite: true, can_invite: true, invited_by: [{ profile_id: GUEST_ID, inviter: { id: ANNA, display_name: 'Ida' } }] })
    renderIn(<MembersSection screen={hostScreen()} userId={HOST_ID} />, queryClient)
    expect(await screen.findByText(/· eingeladen von Ida$/)).toBeTruthy()
    // a guest never gets the label (the same cache)
    renderIn(<MembersSection screen={guestScreen()} userId={GUEST_ID} />, queryClient)
    expect(screen.getAllByText(/eingeladen von Ida/)).toHaveLength(1)
  })
})

describe('Profil › Privatsphäre › "Einladungen in Anlässe"', () => {
  function row(from: 'friends' | 'nobody' = 'friends') {
    profile.getMe.mockResolvedValue(meWith(0, from))
    const queryClient = client()
    queryClient.setQueryData(queryKeys.me(), meWith(0, from))
    renderIn(<ul><InvitationsPrivacyRow userId={ME} /></ul>, queryClient)
    return queryClient
  }

  it('starts on "Von Freunden"; "Niemand" moves at once and is written as the own value', async () => {
    // the server answers get_me with the new value afterwards
    api.setInvitationsFrom.mockImplementation(async () => { profile.getMe.mockResolvedValue(meWith(0, 'nobody')) })
    const queryClient = row()
    const group = screen.getByRole('radiogroup', { name: 'Einladungen in Anlässe' })
    expect(within(group).getByRole('radio', { name: 'Von Freunden' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(group).getByRole('radio', { name: 'Niemand' }))
    expect(within(group).getByRole('radio', { name: 'Niemand' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(api.setInvitationsFrom).toHaveBeenCalledWith('nobody', ME))
    await waitFor(() => expect(queryClient.getQueryData<Me>(queryKeys.me())?.profile.invitations_from).toBe('nobody'))
    expect(screen.getByText('Niemand lädt dich direkt ein – du kommst nur noch per Link dazu.')).toBeTruthy()
  })

  it('a failed write rolls back with a toast', async () => {
    api.setInvitationsFrom.mockRejectedValue(new AppError('network'))
    row()
    const group = screen.getByRole('radiogroup', { name: 'Einladungen in Anlässe' })
    fireEvent.click(within(group).getByRole('radio', { name: 'Niemand' }))
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'Von Freunden' }).getAttribute('aria-checked')).toBe('true'))
    expect(getToasts().some((item) => item.text === 'Die Einstellung wurde nicht gespeichert.')).toBe(true)
  })

  it('nothing without the flag', () => {
    vi.stubEnv('VITE_INVITES', '0')
    vi.stubEnv('VITE_DEMO', '0')
    row()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })
})
