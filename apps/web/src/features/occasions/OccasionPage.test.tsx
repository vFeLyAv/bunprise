import type { ReactNode } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { deferred, GUEST_ID, guestScreen, HOST_ID, hostScreen, makeQueryClient, OCCASION_ID, renderWithClient } from './test-utils'

const nav = vi.hoisted(() => ({ navigate: vi.fn(), back: vi.fn(), pathname: '/occasions/x' }))
const api = vi.hoisted(() => ({
  getOccasionScreen: vi.fn(),
  getFeed: vi.fn(),
  setRsvp: vi.fn(),
  removeMember: vi.fn(),
  leaveOccasion: vi.fn(),
  deleteOccasion: vi.fn(),
  createOccasion: vi.fn(),
  updateOccasion: vi.fn(),
  newOccasionId: vi.fn(),
}))
const invites = vi.hoisted(() => ({ createInvite: vi.fn(), buildInviteUrl: vi.fn() }))
const sharing = vi.hoisted(() => ({ share: vi.fn(), copyText: vi.fn(), canNativeShare: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('@tanstack/react-router', () => {
  const mocked = {
    useNavigate: () => nav.navigate,
    useRouter: () => ({
      navigate: nav.navigate,
      subscribe: () => () => {},
      history: { back: nav.back },
      state: {
        location: {
          get pathname() {
            return nav.pathname
          },
        },
      },
    }),
    useCanGoBack: () => true,
    Link: ({ to, params, children, className, onClick }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string; onClick?: () => void }) => (
      <a href={params ? to.replace('$occasionId', params.occasionId ?? '') : to} className={className} onClick={onClick}>
        {children}
      </a>
    ),
  }
  // PressLink / MotionLink (a router link with the spring press) render the mocked Link here
  return { ...mocked, createLink: () => mocked.Link }
})
vi.mock('../../lib/api/occasions', () => api)
vi.mock('../../lib/api/invites', () => invites)
vi.mock('../../lib/share', () => sharing)
vi.mock('../../lib/toast', () => ({ toast: toasts }))
vi.mock('../mascot-ui/Mascot', () => ({ Mascot: () => null }))
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => vi.fn().mockResolvedValue(undefined) }))
// The wishes feature fills this component; here only the contract (props) matters.
vi.mock('../wishes/WishlistSection', () => ({
  WishlistSection: ({ viewer, occasionId }: { viewer: string; occasionId: string }) => (
    <div data-testid="wishlist" data-viewer={viewer} data-occasion={occasionId} />
  ),
}))

import { forgetInviteLinksForTests, rememberInviteLink } from './inviteLink'
import { OccasionPage } from './OccasionPage'
import { resetSavingForTests, setSaveState } from './saving'
import { peekInviteFocus, requestInviteFocus } from './inviteFocus'

beforeEach(() => {
  vi.clearAllMocks()
  resetSavingForTests()
  forgetInviteLinksForTests()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.getOccasionScreen.mockReturnValue(new Promise(() => {}))
  api.getFeed.mockReturnValue(new Promise(() => {}))
  nav.navigate.mockResolvedValue(undefined)
  sharing.canNativeShare.mockReturnValue(false)
  invites.buildInviteUrl.mockImplementation((token: string) => `https://app.test/i#${token}`)
})
afterEach(() => vi.restoreAllMocks())

function renderScreen(data: OccasionScreen, userId: string) {
  const client = makeQueryClient()
  client.setQueryData(qk.occasion(OCCASION_ID), data)
  return renderWithClient(<OccasionPage occasionId={OCCASION_ID} userId={userId} />, client)
}

/** "Wer kommt" › "Per Link einladen" (Felix 27.10: no invite card at the top any more) → the link sheet. */
function openLinkSheet(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /^Per Link einladen/ }))
  return screen.getByRole('dialog', { name: 'Per Link einladen' })
}

describe('occasion screen — host view (S7 owner)', () => {
  it('shows the hero and the guest list with the ways to invite on top, but nothing about reservations', () => {
    renderScreen(hostScreen(), HOST_ID)
    expect(screen.queryByRole('button', { name: /Ideen für/ })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Milas Gartenfest' })).toBeTruthy()
    expect(screen.getByText('Café am Markt')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'In Google Maps öffnen' }).getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20am%20Markt',
    )
    expect(screen.getByRole('link', { name: 'In Apple Karten öffnen' }).getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('Du lädst ein')).toBeTruthy()
    // no separate "Einladen" card any more: the invite rows sit on top of "Wer kommt"
    expect(screen.queryByRole('heading', { name: 'Einladen' })).toBeNull()
    const invite = screen.getByRole('group', { name: 'Einladen' })
    const members = screen.getByRole('heading', { name: 'Wer kommt' }).closest('section')!
    expect(members.contains(invite)).toBe(true)
    expect(invite.compareDocumentPosition(screen.getByRole('button', { name: 'Jonas entfernen' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(openLinkSheet()).getByRole('button', { name: /Einladungslink erstellen/ })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Deine Antwort' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Jonas entfernen' })).toBeTruthy()
    expect(screen.getByTestId('wishlist').getAttribute('data-viewer')).toBe('owner')
    // the owner's DOM never carries a reservation word (secrecy checklist §9.1)
    expect(document.body.textContent ?? '').not.toMatch(/reserv/i)
  })

  it('says when a link is active and offers a new one (the old token is never shown again)', () => {
    renderScreen(hostScreen({ invite: { active: true, expires_at: '2030-06-22T16:00:00.000Z' } }), HOST_ID)
    // the row already says it …
    expect(screen.getByRole('button', { name: /^Per Link einladen/ }).textContent).toMatch(/Link aktiv · gültig bis /)
    // … and the sheet explains why the token is not shown again
    const sheet = openLinkSheet()
    expect(within(sheet).getByText(/^Link aktiv · gültig bis /)).toBeTruthy()
    expect(within(sheet).getByText('Aus Sicherheitsgründen zeigen wir den Link nur direkt nach dem Erstellen. Brauchst du ihn wieder, erstelle einfach einen neuen.')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: /Neuen Link erstellen/ }))
    const dialog = screen.getByRole('dialog', { name: 'Neuen Link erstellen?' })
    expect(within(dialog).getByText('Der alte Link funktioniert dann nicht mehr. Wer schon beigetreten ist, bleibt dabei.')).toBeTruthy()
  })

  it('creates a link, shares it (here: copies it) and keeps it visible for copying again', async () => {
    invites.createInvite.mockResolvedValue('a'.repeat(64))
    sharing.share.mockResolvedValue('copied')
    renderScreen(hostScreen(), HOST_ID)
    fireEvent.click(within(openLinkSheet()).getByRole('button', { name: /Einladungslink erstellen/ }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Link kopiert – ab in den Chat!'))
    expect(invites.createInvite).toHaveBeenCalledWith(OCCASION_ID, HOST_ID)
    const [payload] = sharing.share.mock.calls[0] as [{ url: string; text: string; title: string }]
    expect(payload.url).toBe(`https://app.test/i#${'a'.repeat(64)}`)
    expect(payload.title).toBe('Milas Gartenfest')
    expect(payload.text).toContain('Ich lade dich ein: „Milas Gartenfest“')
    expect(payload.text).not.toMatch(/reserv/i)
    expect((screen.getByLabelText('Dein Einladungslink') as HTMLInputElement).value).toBe(payload.url)
    expect(screen.getByRole('button', { name: 'Kopieren' })).toBeTruthy()
  })

  it('keeps the link of this tab for its host while the share sheet is open and after coming back', async () => {
    invites.createInvite.mockResolvedValue('b'.repeat(64))
    sharing.share.mockReturnValue(new Promise(() => {})) // the share sheet stays open
    const first = renderScreen(hostScreen(), HOST_ID)
    fireEvent.click(within(openLinkSheet()).getByRole('button', { name: /Einladungslink erstellen/ }))
    const field = await screen.findByLabelText('Dein Einladungslink')
    expect((field as HTMLInputElement).value).toBe(`https://app.test/i#${'b'.repeat(64)}`)
    // the server part is done: nothing waits for the share sheet
    expect((screen.getByRole('button', { name: /Neuen Link erstellen/ }) as HTMLButtonElement).disabled).toBe(false)
    first.unmount()

    // back on the screen (the refetch reports the active link): the same link, no new one needed
    renderScreen(hostScreen({ invite: { active: true, expires_at: '2030-06-22T16:00:00.000Z' } }), HOST_ID)
    openLinkSheet()
    expect((screen.getByLabelText('Dein Einladungslink') as HTMLInputElement).value).toBe(`https://app.test/i#${'b'.repeat(64)}`)
    expect(invites.createInvite).toHaveBeenCalledTimes(1)
  })

  it('removes a guest only after the confirmation and the server answer', async () => {
    const removal = deferred()
    api.removeMember.mockReturnValue(removal.promise)
    rememberInviteLink(HOST_ID, OCCASION_ID, `https://app.test/i#${'c'.repeat(64)}`)
    renderScreen(hostScreen({ invite: { active: true, expires_at: '2030-06-22T16:00:00.000Z' } }), HOST_ID)
    expect(screen.getByRole('button', { name: /^Per Link einladen/ }).textContent).toMatch(/Link aktiv/)
    fireEvent.click(screen.getByRole('button', { name: 'Jonas entfernen' }))
    const dialog = screen.getByRole('dialog', { name: 'Jonas aus dem Anlass entfernen?' })
    expect(within(dialog).getByText(/Dein aktueller Einladungslink wird dabei ungültig/)).toBeTruthy()
    expect(api.removeMember).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Entfernen' }))
    expect(api.removeMember).toHaveBeenCalledWith(OCCASION_ID, '33333333-3333-4333-8333-333333333333', HOST_ID)
    expect(screen.getByText('Jonas')).toBeTruthy() // not optimistic: still listed while the server works

    await new Promise((resolve) => setTimeout(resolve, 5)) // the removal answers later than the link was made
    await act(async () => removal.resolve())
    await waitFor(() => expect(screen.queryByText('Jonas')).toBeNull())
    expect(toasts.success).toHaveBeenCalledWith('Jonas wurde entfernt')
    // remove_member revoked the link as well: the remembered copy is not offered any more
    expect(screen.getByRole('button', { name: /^Per Link einladen/ }).textContent).not.toMatch(/Link aktiv/)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const sheet = openLinkSheet()
    expect(within(sheet).queryByLabelText('Dein Einladungslink')).toBeNull()
    expect(within(sheet).getByRole('button', { name: /Einladungslink erstellen/ })).toBeTruthy()
  })

  it('keeps the guest and explains when removing fails; cancel sends nothing', async () => {
    api.removeMember.mockRejectedValue(new AppError('not_allowed'))
    renderScreen(hostScreen(), HOST_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Ida entfernen' }))
    // the sheet's "×" and the footer button are both "Abbrechen"
    const [cancel] = within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Abbrechen' }).slice(-1)
    fireEvent.click(cancel!)
    expect(api.removeMember).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Ida entfernen' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Entfernen' }))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Das geht hier nicht'))
    expect(screen.getAllByText('Ida').length).toBeGreaterThan(0)
  })

  it('offers edit, delete and the report mail in the menu; delete asks first and goes to the feed', async () => {
    api.deleteOccasion.mockResolvedValue(undefined)
    renderScreen(hostScreen(), HOST_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    const menu = screen.getByRole('dialog', { name: 'Optionen' })
    expect(within(menu).getByRole('link', { name: 'Bearbeiten' }).getAttribute('href')).toBe(`/occasions/${OCCASION_ID}/edit`)
    // the contact address is set since 24.10 (lib/app.ts SUPPORT_EMAIL): "Melden" writes a mail about this occasion
    expect(within(menu).getByRole('link', { name: 'Melden' }).getAttribute('href')).toMatch(/^mailto:hello@bunprise\.de\?/)
    expect(within(menu).queryByText('Der Kontakt zum Melden wird vor dem Pilotbetrieb ergänzt.')).toBeNull()
    expect(within(menu).queryByText('Anlass verlassen')).toBeNull()

    fireEvent.click(within(menu).getByRole('button', { name: 'Anlass löschen' }))
    const confirm = await screen.findByRole('dialog', { name: 'Anlass löschen?' })
    expect(api.deleteOccasion).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Löschen' }))
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', replace: true }))
    expect(api.deleteOccasion).toHaveBeenCalledWith(OCCASION_ID, HOST_ID)
    expect(toasts.success).toHaveBeenCalledWith('Anlass gelöscht')
  })

  it('celebrates a just created occasion for a moment and locks invite actions while it is saving', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      setSaveState(OCCASION_ID, 'saving')
      renderScreen(hostScreen({ wishlist: null }), HOST_ID)
      // the moment is said in "Wer kommt", next to the ways to invite (it used to be the invite card's)
      expect(screen.getByText('Wird gespeichert …').getAttribute('role')).toBe('status')
      expect((screen.getByRole('button', { name: 'Per Link einladen' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Mehr' }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.queryByTestId('wishlist')).toBeNull() // the list arrives with the real screen

      act(() => setSaveState(OCCASION_ID, 'created'))
      expect(screen.getByText('Anlass gespeichert! Jetzt Wünsche eintragen und Gäste einladen.')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Per Link einladen' }) as HTMLButtonElement).disabled).toBe(false)
      act(() => {
        vi.advanceTimersByTime(6_000)
      })
      expect(screen.queryByText('Anlass gespeichert! Jetzt Wünsche eintragen und Gäste einladen.')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the moment runs once: leaving for the wish form and coming back later does not replay it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      setSaveState(OCCASION_ID, 'created')
      const first = renderScreen(hostScreen(), HOST_ID)
      expect(screen.getByText('Anlass gespeichert! Jetzt Wünsche eintragen und Gäste einladen.')).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(2_000)
      })
      first.unmount() // e.g. "+ Wunsch" two seconds after saving
      act(() => {
        vi.advanceTimersByTime(4_000)
      })
      renderScreen(hostScreen(), HOST_ID)
      expect(screen.queryByText('Anlass gespeichert! Jetzt Wünsche eintragen und Gäste einladen.')).toBeNull()
      expect((screen.getByRole('button', { name: 'Per Link einladen' }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('"Freunde einladen" (the calendar pill, K10): the invite rows in "Wer kommt" get the focus and glow — once, not on a later visit', async () => {
    requestInviteFocus(OCCASION_ID)
    const first = renderScreen(hostScreen(), HOST_ID)
    const group = screen.getByRole('group', { name: 'Einladen' })
    await waitFor(() => expect(document.activeElement).toBe(group))
    expect(group.hasAttribute('data-spotlight')).toBe(true)
    expect(peekInviteFocus(OCCASION_ID)).toBe(false) // taken
    first.unmount()
    // back from the wish form later: no scroll, no focus, no glow
    renderScreen(hostScreen(), HOST_ID)
    const again = screen.getByRole('group', { name: 'Einladen' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(document.activeElement).not.toBe(again)
    expect(again.hasAttribute('data-spotlight')).toBe(false)
  })

  it('opens from the cache without asking again, but refreshes a screen whose save finished before it mounted', async () => {
    const view = renderScreen(hostScreen(), HOST_ID)
    expect(api.getOccasionScreen).not.toHaveBeenCalled() // fresh (just loaded) → one RPC per screen
    view.unmount()

    api.getOccasionScreen.mockResolvedValue(hostScreen())
    const client = makeQueryClient()
    client.setQueryData(qk.occasion(OCCASION_ID), hostScreen({ wishlist: null }))
    await client.invalidateQueries({ queryKey: qk.occasion(OCCASION_ID), refetchType: 'none' })
    renderWithClient(<OccasionPage occasionId={OCCASION_ID} userId={HOST_ID} />, client)
    expect(await screen.findByTestId('wishlist')).toBeTruthy()
    expect(api.getOccasionScreen).toHaveBeenCalledTimes(1)
  })
})

describe('occasion screen — guest view (S7 guest)', () => {
  it('offers gift ideas for the visible host only with a nonempty occasion wishlist', () => {
    const populated = renderScreen(guestScreen(), GUEST_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Ideen für Mila' }))
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/gifts' })
    populated.unmount()
    const empty = guestScreen()
    empty.wishlist!.wishes = []
    renderScreen(empty, GUEST_ID)
    expect(screen.queryByRole('button', { name: /Ideen für/ })).toBeNull()
  })
  it('shows RSVP instead of the invite card and passes the guest viewer to the wishlist', () => {
    renderScreen(guestScreen(), GUEST_ID)
    expect(screen.getByText('Mila lädt ein')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Deine Antwort' })).toBeTruthy()
    expect(screen.getByText('Sag Mila Bescheid')).toBeTruthy()
    for (const name of ['Zusage', 'Vielleicht', 'Absage']) {
      expect(screen.getByRole('radio', { name }).getAttribute('aria-checked')).toBe('false')
    }
    // nothing selected yet, but the group is still reachable with Tab
    expect((screen.getByRole('radio', { name: 'Zusage' }) as HTMLElement).tabIndex).toBe(0)
    expect(screen.queryByRole('heading', { name: 'Einladen' })).toBeNull()
    // a guest never gets the link; "Freunde einladen" only while the host allows it (features/invitations tests)
    expect(screen.queryByRole('button', { name: /Per Link einladen/ })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Einladen' })).toBeNull()
    expect(screen.queryByRole('button', { name: /entfernen/ })).toBeNull()
    expect(screen.getByText('Jonas (du)')).toBeTruthy()
    expect(screen.getByTestId('wishlist').getAttribute('data-viewer')).toBe('guest')
  })

  it('switches the RSVP at once (optimistic) and keeps it when the server agrees', async () => {
    const write = deferred()
    api.setRsvp.mockReturnValue(write.promise)
    const { client } = renderScreen(guestScreen(), GUEST_ID)
    fireEvent.click(screen.getByRole('radio', { name: 'Zusage' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Zusage' }).getAttribute('aria-checked')).toBe('true'))
    expect(api.setRsvp).toHaveBeenCalledWith(OCCASION_ID, 'going', GUEST_ID)
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.members.find((m) => m.profile_id === GUEST_ID)?.rsvp).toBe('going')
    await act(async () => write.resolve())
    expect(screen.getByRole('radio', { name: 'Zusage' }).getAttribute('aria-checked')).toBe('true')
    expect(toasts.error).not.toHaveBeenCalled()
  })

  it('rolls the RSVP back with a toast when the server refuses', async () => {
    const write = deferred()
    api.setRsvp.mockReturnValue(write.promise)
    renderScreen(guestScreen({ viewer: { role: 'member', rsvp: 'maybe' } }), GUEST_ID)
    fireEvent.click(screen.getByRole('radio', { name: 'Absage' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Absage' }).getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByText('Deine Reservierungen bleiben – du kannst trotzdem etwas schenken')).toBeTruthy()

    await act(async () => write.reject(new AppError('generic')))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Vielleicht' }).getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByRole('radio', { name: 'Absage' }).getAttribute('aria-checked')).toBe('false')
    expect(toasts.error).toHaveBeenCalledWith('Hat nicht geklappt – versuch es nochmal')
  })

  it('lets a guest leave after confirming, then goes to the feed', async () => {
    api.leaveOccasion.mockResolvedValue(undefined)
    renderScreen(guestScreen(), GUEST_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    const menu = screen.getByRole('dialog', { name: 'Optionen' })
    expect(within(menu).queryByRole('link', { name: 'Bearbeiten' })).toBeNull()
    fireEvent.click(within(menu).getByRole('button', { name: 'Anlass verlassen' }))
    const confirm = await screen.findByRole('dialog', { name: 'Anlass verlassen?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Anlass verlassen' }))
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', replace: true }))
    expect(api.leaveOccasion).toHaveBeenCalledWith(OCCASION_ID, GUEST_ID)
  })
})

describe('occasion screen — states', () => {
  it('shows a skeleton first and the content once the one RPC answered', async () => {
    const load = deferred<OccasionScreen>()
    api.getOccasionScreen.mockReturnValue(load.promise)
    renderWithClient(<OccasionPage occasionId={OCCASION_ID} userId={HOST_ID} />)
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
    await act(async () => load.resolve(hostScreen()))
    expect(await screen.findByRole('heading', { level: 1, name: 'Milas Gartenfest' })).toBeTruthy()
    expect(api.getOccasionScreen).toHaveBeenCalledTimes(1)
  })

  it('answers "not found" and "no access" with the same friendly page', async () => {
    for (const code of ['not_found', 'not_allowed'] as const) {
      api.getOccasionScreen.mockRejectedValueOnce(new AppError(code))
      const view = renderWithClient(<OccasionPage occasionId={OCCASION_ID} userId={GUEST_ID} />)
      expect(await screen.findByRole('heading', { name: 'Anlass nicht gefunden oder kein Zugriff' })).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Zum Start' }).getAttribute('href')).toBe('/soon')
      view.unmount()
    }
  })

  it('retries a network error once by itself, then offers a retry button', async () => {
    api.getOccasionScreen.mockRejectedValueOnce(new AppError('network')).mockRejectedValueOnce(new AppError('network'))
    renderWithClient(<OccasionPage occasionId={OCCASION_ID} userId={GUEST_ID} />)
    expect(await screen.findByText('Keine Verbindung', undefined, { timeout: 4000 })).toBeTruthy()
    expect(api.getOccasionScreen).toHaveBeenCalledTimes(2)
    api.getOccasionScreen.mockResolvedValueOnce(guestScreen())
    fireEvent.click(screen.getByRole('button', { name: 'Nochmal versuchen' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Milas Gartenfest' })).toBeTruthy()
  })

  it('does not retry final answers (one request for "not found")', async () => {
    api.getOccasionScreen.mockRejectedValue(new AppError('not_found'))
    renderWithClient(<OccasionPage occasionId={OCCASION_ID} userId={GUEST_ID} />)
    expect(await screen.findByRole('heading', { name: 'Anlass nicht gefunden oder kein Zugriff' })).toBeTruthy()
    expect(api.getOccasionScreen).toHaveBeenCalledTimes(1)
  })
})
