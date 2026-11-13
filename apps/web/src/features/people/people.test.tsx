import type { ReactNode } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PeopleScreen, PersonCard } from '../../lib/api/follows.types'
import type { ListsOverview } from '../../lib/api/lists.types'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { getToasts, toast } from '../../lib/toast'

// The people screens in jsdom (follows-design W03, W06, W13, W01 at runtime): "Follower & Anfragen" with the context
// of a request (the highlighted "Kennst du … persönlich?"), the accept sheet (which of MY lists the person will see,
// then "Auch folgen"), the decline toast with its 5 s undo (the RPC goes out after the pause), the block sheet (its
// switch ON by default → revoke_follow_links() with the SAME account), the static removal sentence, the person card
// in every relation state, the follow-link sheet (the 5-links warning, the toast after sharing) — and late answers
// after an account switch do nothing. The API is mocked; fictional data only.

const api = vi.hoisted(() => ({
  getPeopleScreen: vi.fn<(expectedUserId?: string) => Promise<PeopleScreen>>(),
  getProfileCard: vi.fn<(profileId: string, expectedUserId?: string) => Promise<PersonCard>>(),
  respondFollow: vi.fn<(profileId: string, accept: boolean, expectedUserId?: string) => Promise<void>>(),
  removeFollower: vi.fn<(profileId: string, expectedUserId?: string) => Promise<void>>(),
  blockPerson: vi.fn<(profileId: string, expectedUserId?: string) => Promise<void>>(),
  unblockPerson: vi.fn<(profileId: string, expectedUserId?: string) => Promise<void>>(),
  revokeFollowLinks: vi.fn<(expectedUserId?: string) => Promise<void>>(),
  createFollowLink: vi.fn<(expectedUserId?: string) => Promise<{ token: string; expires_at: string }>>(),
  createFriendCode: vi.fn<(replace: boolean, expectedUserId?: string) => Promise<{ code: string; expires_at: string }>>(),
  peekFriendCode: vi.fn<(code: string, expectedUserId?: string) => Promise<unknown>>(),
  requestFollow: vi.fn<(profileId: string, expectedUserId?: string) => Promise<'requested' | 'following'>>(),
  unfollow: vi.fn<(profileId: string, expectedUserId?: string) => Promise<void>>(),
  getListsOverview: vi.fn<(expectedUserId?: string) => Promise<ListsOverview>>(),
  navigate: vi.fn(() => Promise.resolve()),
  share: vi.fn<(payload: { title?: string; text?: string; url?: string }) => Promise<'shared' | 'copied' | 'cancelled' | 'failed'>>(),
}))

vi.mock('../../lib/api/follows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/follows')>()),
  getPeopleScreen: api.getPeopleScreen,
  getProfileCard: api.getProfileCard,
  respondFollow: api.respondFollow,
  removeFollower: api.removeFollower,
  blockPerson: api.blockPerson,
  unblockPerson: api.unblockPerson,
  revokeFollowLinks: api.revokeFollowLinks,
  createFollowLink: api.createFollowLink,
  createFriendCode: api.createFriendCode,
  peekFriendCode: api.peekFriendCode,
  requestFollow: api.requestFollow,
  unfollow: api.unfollow,
}))
vi.mock('../../lib/api/lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/lists')>()),
  getListsOverview: api.getListsOverview,
}))
vi.mock('../../lib/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/share')>()),
  canNativeShare: () => true,
  share: api.share,
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, params, children, className, ...rest }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    const aria = rest as { 'aria-label'?: string }
    return <a href={href} className={className} aria-label={aria['aria-label']}>{children}</a>
  }
  return {
    Link,
    createLink: () => Link,
    useNavigate: () => api.navigate,
    useRouter: () => ({ history: { back: vi.fn() } }),
    useCanGoBack: () => false,
  }
})
vi.mock('../mascot-ui/Mascot', () => ({ Mascot: ({ kind }: { kind: string }) => <div data-testid="mascot" data-kind={kind} />, preloadMascot: () => undefined }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: ({ kind, pick, onEnd }: { kind: string; pick?: { preset: string }; onEnd?: () => void }) => <button type="button" data-testid="bunny-moment" data-kind={kind} data-preset={pick?.preset} onClick={onEnd}>Finish scene</button> }))

import { PeoplePage } from './PeoplePage'
import { PersonPage } from './PersonPage'
import FollowLinkSheet from './FollowLinkSheet'
import { forgetFollowLinksForTests, rememberedFollowLink } from './followLinkMemory'
import { forgetFriendCodesForTests, rememberedFriendCode } from './friendCodeMemory'
import { DECLINE_UNDO_MS, resetPendingDeclines } from './pendingDeclines'
import { listsKeys } from '../lists/queries'

const ME = '00000000-0000-4000-8000-0000000000aa'
const ANNA = 'd1e0a000-0000-4000-8000-000000000001'
const BEN = 'd1e0a000-0000-4000-8000-000000000002'
const FINN = 'd1e0a000-0000-4000-8000-000000000005'
const GRETA = 'd1e0a000-0000-4000-8000-000000000006'
const ROSA = 'd1e0a000-0000-4000-8000-000000000007'
const MAMA = 'd1e0a000-0000-4000-8000-000000000009'
const TOKEN = '6b'.repeat(32)

const profile = (id: string, name: string) => ({ id, display_name: name, banner: null })
/** n calendar days back at this time of day — not n × 24 h, which breaks on a DST day (25.10.2026 had 25 hours) */
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString() }

function peopleData(patch: Partial<PeopleScreen> = {}): PeopleScreen {
  return {
    requests_in: [
      { profile: profile(GRETA, 'Greta Lindner'), requested_at: new Date().toISOString(), shared_occasions: [{ id: 'o1', title: 'Annas Einweihung', starts_at: '2026-10-23T16:00:00Z' }], i_follow: 'none' },
      { profile: profile(BEN, 'Ben Mustermann'), requested_at: daysAgo(2), shared_occasions: [], i_follow: 'following' },
      { profile: profile(MAMA, 'Mama'), requested_at: daysAgo(3), shared_occasions: [], i_follow: 'none' },
    ],
    requests_out: [{ profile: profile(FINN, 'Finn Weber'), requested_at: daysAgo(1), expires_at: new Date(Date.now() + 29 * 86_400_000).toISOString() }],
    followers: [
      { profile: profile(ANNA, 'Anna Beispiel'), accepted_at: '2026-09-10T10:00:00Z', i_follow: 'following' },
      { profile: profile(ROSA, 'Rosa Klein'), accepted_at: '2026-10-10T10:00:00Z', i_follow: 'none' },
    ],
    following: [{ profile: profile(ANNA, 'Anna Beispiel'), accepted_at: '2026-09-10T10:00:00Z', follows_me: 'following' }],
    blocked: [],
    links: [],
    ...patch,
  }
}

function overview(patch: Partial<ListsOverview['me']> = {}, followerLists: string[] = ['Meine Wünsche', 'Weihnachten']): ListsOverview {
  return {
    me: { id: ME, display_name: 'Mila Sommer', banner: null, live_links: 0, ...patch },
    stats: { my_wishes: 3, my_lists: followerLists.length + 1, friends_lists: 0, followers: 2, following: 1, requests: 3 },
    my_lists: [
      ...followerLists.map((title, n) => ({ id: `l${n}`, title, kind: 'standalone' as const, visibility: 'followers' as const, cover_tone: null, cover_icon: null, due_on: null, wish_count: 1, occasion: null, created_at: '2026-10-01T10:00:00Z' })),
      { id: 'lp', title: 'Geheim', kind: 'standalone', visibility: 'private', cover_tone: null, cover_icon: null, due_on: null, wish_count: 2, occasion: null, created_at: '2026-10-02T10:00:00Z' },
    ],
    following: [], upcoming: [], suggestions: [],
  }
}

function personCard(patch: Partial<Omit<PersonCard, 'relation'>> & { relation?: Partial<PersonCard['relation']> } = {}): PersonCard {
  const { relation, ...rest } = patch
  return {
    profile: profile(ANNA, 'Anna Beispiel'),
    relation: { self: false, i_follow: 'none', follows_me: 'none', mutual: false, ...relation },
    can_request: false,
    can_find_gift: false,
    lists: [],
    shared_occasions: [],
    ...rest,
  }
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
}

function renderWith(ui: ReactNode, queryClient: QueryClient = client()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </QueryClientProvider>
  )
  return { queryClient, ...render(<>{ui}</>, { wrapper }) }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const toastTexts = () => getToasts().map((item) => item.text)

beforeEach(() => {
  vi.stubEnv('VITE_LISTS', '1')
  setRenderedAccount(ME)
  api.getPeopleScreen.mockResolvedValue(peopleData())
  api.getListsOverview.mockResolvedValue(overview())
  api.respondFollow.mockResolvedValue(undefined)
  api.removeFollower.mockResolvedValue(undefined)
  api.blockPerson.mockResolvedValue(undefined)
  api.unblockPerson.mockResolvedValue(undefined)
  api.revokeFollowLinks.mockResolvedValue(undefined)
  api.requestFollow.mockResolvedValue('requested')
  api.unfollow.mockResolvedValue(undefined)
  api.createFollowLink.mockResolvedValue({ token: TOKEN, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() })
  api.share.mockResolvedValue('shared')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
  resetPendingDeclines()
  forgetFollowLinksForTests()
  for (const item of getToasts()) toast.dismiss(item.id)
})

describe('"Follower & Anfragen" (§2.10)', () => {
  it('shows MY sections; every request carries its context — the unknown one highlighted', async () => {
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Greta Lindner')
    expect(api.getPeopleScreen).toHaveBeenCalledWith(ME)
    for (const title of ['Anfragen', 'Follower', 'Du folgst', 'Angefragt', 'Blockiert']) expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getByText('Gemeinsam in: Annas Einweihung')).toBeTruthy()
    expect(screen.getByText('Du folgst Ben Mustermann')).toBeTruthy()
    const unknown = screen.getByText('Ihr habt keinen gemeinsamen Anlass. Kennst du Mama persönlich?')
    expect(unknown.className).toMatch(/pp-unknown/)
    expect(screen.getByText('vor 2 Tagen')).toBeTruthy()
    expect(screen.getByText('Angefragt gestern')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zurückziehen' })).toBeTruthy()
    // "Auch folgen" only where I do not follow back
    expect(screen.getAllByRole('button', { name: 'Auch folgen' })).toHaveLength(1)
    // a row with a button stacks it under the name at 320 px (people.css .pp-row[data-stack]), like a request
    expect(screen.getByRole('button', { name: 'Auch folgen' }).closest('li')?.hasAttribute('data-stack')).toBe(true)
    expect(screen.getByRole('button', { name: 'Zurückziehen' }).closest('li')?.hasAttribute('data-stack')).toBe(true)
    expect(screen.getByText('Du hast niemanden blockiert.')).toBeTruthy()
  })

  it('the row menu of a request: Ablehnen · Ablehnen und blockieren · Melden', async () => {
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Mama')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Mama' }))
    const menu = await screen.findByRole('dialog', { name: 'Mama' })
    expect(within(menu).getByRole('button', { name: 'Ablehnen' })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: 'Ablehnen und blockieren' })).toBeTruthy()
    expect(within(menu).getByText('Melden')).toBeTruthy()
  })

  it('the accept sheet names which of MY lists the person will see, highlights the unknown, then offers "Auch folgen"', async () => {
    const gate = deferred()
    api.respondFollow.mockReturnValue(gate.promise)
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Mama')
    const rows = screen.getAllByRole('button', { name: 'Annehmen' })
    fireEvent.click(rows[2] as HTMLElement) // Mama's request (the third)
    const sheet = await screen.findByRole('dialog', { name: 'Anfrage von Mama' })
    expect(within(sheet).getByText('Ihr habt keinen gemeinsamen Anlass. Kennst du Mama persönlich?')).toBeTruthy()
    expect(await within(sheet).findByText('Mama sieht dann: Meine Wünsche, Weihnachten')).toBeTruthy()
    expect(within(sheet).queryByText(/Geheim/)).toBeNull() // a "Nur ich" list is never named
    fireEvent.click(within(sheet).getByRole('button', { name: 'Annehmen' }))
    await waitFor(() => expect(api.respondFollow).toHaveBeenCalledWith(MAMA, true, ME))
    expect(within(sheet).queryByTestId('bunny-moment')).toBeNull()
    await act(async () => gate.resolve())
    const also = await screen.findByRole('dialog', { name: 'Mama folgt dir jetzt' })
    expect(within(also).getByTestId('bunny-moment').getAttribute('data-preset')).toBe('meet')
    fireEvent.click(within(also).getByTestId('bunny-moment'))
    expect(within(also).queryByTestId('bunny-moment')).toBeNull()
    expect(within(also).getByRole('heading', { name: 'Möchtest du Mama auch folgen?' })).toBeTruthy()
    fireEvent.click(within(also).getByRole('button', { name: 'Auch folgen' }))
    await waitFor(() => expect(api.requestFollow).toHaveBeenCalledWith(MAMA, ME))
  })

  it('W06: an "Annehmen" answer that arrives after the account switch shows nothing and offers nothing', async () => {
    const gate = deferred()
    api.respondFollow.mockReturnValue(gate.promise)
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Mama')
    fireEvent.click(screen.getAllByRole('button', { name: 'Annehmen' })[2] as HTMLElement)
    const sheet = await screen.findByRole('dialog', { name: 'Anfrage von Mama' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Annehmen' }))
    await waitFor(() => expect(api.respondFollow).toHaveBeenCalledWith(MAMA, true, ME))
    endAccountEpoch()
    gate.resolve()
    await new Promise((done) => setTimeout(done, 20))
    expect(screen.queryByRole('dialog', { name: 'Mama folgt dir jetzt' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Möchtest du Mama auch folgen?' })).toBeNull()
    expect(api.requestFollow).not.toHaveBeenCalled()
    expect(toastTexts()).toEqual([])
  })

  it('no list for followers: "Du teilst gerade keine Liste mit Followern" — and no highlight with a shared occasion', async () => {
    api.getListsOverview.mockResolvedValue(overview({}, []))
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Greta Lindner')
    fireEvent.click(screen.getAllByRole('button', { name: 'Annehmen' })[0] as HTMLElement)
    const sheet = await screen.findByRole('dialog', { name: 'Anfrage von Greta Lindner' })
    expect(await within(sheet).findByText('Du teilst gerade keine Liste mit Followern.')).toBeTruthy()
    expect(within(sheet).queryByText(/Kennst du/)).toBeNull()
  })

  it('declining: hidden at once, the toast tells the 30 days, the RPC goes out only after the 5 s undo', async () => {
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Mama')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Mama' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Mama' })).getByRole('button', { name: 'Ablehnen' }))
    await waitFor(() => expect(screen.queryByText('Ihr habt keinen gemeinsamen Anlass. Kennst du Mama persönlich?')).toBeNull())
    expect(toastTexts()).toContain('Abgelehnt. Mama erfährt davon nichts. Neue Anfragen von Mama siehst du 30 Tage lang nicht.')
    expect(api.respondFollow).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(DECLINE_UNDO_MS + 10)
    })
    await waitFor(() => expect(api.respondFollow).toHaveBeenCalledWith(MAMA, false, ME))
  })

  it('"Rückgängig" within the pause sends nothing and brings the request back', async () => {
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Mama')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Mama' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Mama' })).getByRole('button', { name: 'Ablehnen' }))
    const declined = getToasts().find((item) => item.text.startsWith('Abgelehnt'))
    act(() => {
      declined?.onAction?.()
    })
    await act(async () => {
      vi.advanceTimersByTime(DECLINE_UNDO_MS + 10)
    })
    expect(api.respondFollow).not.toHaveBeenCalled()
    expect(screen.getByText('Ihr habt keinen gemeinsamen Anlass. Kennst du Mama persönlich?')).toBeTruthy()
  })

  it('W06: the account ends during the pause → the decline is never sent', async () => {
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Mama')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Mama' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Mama' })).getByRole('button', { name: 'Ablehnen' }))
    endAccountEpoch()
    await act(async () => {
      vi.advanceTimersByTime(DECLINE_UNDO_MS + 10)
    })
    expect(api.respondFollow).not.toHaveBeenCalled()
  })

  it('the static removal sentence — whatever the follower may have planned; a late answer does nothing (W06)', async () => {
    const gate = deferred()
    api.removeFollower.mockReturnValue(gate.promise)
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Rosa Klein')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Rosa Klein' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Rosa Klein' })).getByRole('button', { name: 'Als Follower entfernen' }))
    const confirm = await screen.findByRole('dialog', { name: 'Rosa Klein als Follower entfernen?' })
    expect(within(confirm).getByText('Rosa Klein bekommt keine Nachricht, sieht deine Listen aber nicht mehr. Was Rosa Klein für dich heimlich geplant hat, wird dabei aufgehoben – ob es so etwas gibt, erfährst du nie.')).toBeTruthy()
    expect(confirm.textContent).not.toMatch(/reserv/i)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Entfernen' }))
    await waitFor(() => expect(api.removeFollower).toHaveBeenCalledWith(ROSA, ME))
    endAccountEpoch()
    gate.resolve()
    await new Promise((done) => setTimeout(done, 20))
    expect(toastTexts()).toEqual([])
  })
})

describe('the block sheet (§2.10)', () => {
  it('a successful block still refreshes access when disabling links fails, and says what remains', async () => {
    const { AppError } = await import('../../lib/errors')
    api.revokeFollowLinks.mockRejectedValueOnce(new AppError('network'))
    const queryClient = client()
    queryClient.setQueryData(['feed'], { fixture: true })
    renderWith(<PeoplePage userId={ME} />, queryClient)
    await screen.findByText('Rosa Klein')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Rosa Klein' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Rosa Klein' })).getByRole('button', { name: 'Blockieren' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Rosa Klein blockieren?' })).getByRole('button', { name: 'Blockieren' }))
    await waitFor(() => expect(api.revokeFollowLinks).toHaveBeenCalledWith(ME))
    await waitFor(() => expect(toastTexts()).toContain('Rosa Klein ist blockiert. Deine Folgen-Links konnten nicht deaktiviert werden. Versuch es unter „Privatsphäre“ erneut.'))
    expect(queryClient.getQueryState(['feed'])?.isInvalidated).toBe(true)
    expect(toastTexts()).not.toContain('Rosa Klein ist blockiert – deine Folgen-Links sind deaktiviert')
  })

  it('says exactly what the database does; the links switch is ON → revoke_follow_links() with the same account', async () => {
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Rosa Klein')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Rosa Klein' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Rosa Klein' })).getByRole('button', { name: 'Blockieren' }))
    const sheet = await screen.findByRole('dialog', { name: 'Rosa Klein blockieren?' })
    for (const text of [
      'Ihr seht euch nicht mehr – weder in Anfragen noch in Listen oder Gästelisten.',
      'Rosa Klein ist kein Gast mehr in deinen Anlässen und du nicht mehr in denen von Rosa Klein.',
      'In Anlässen anderer Personen bleibt ihr beide Gäste, seht euch dort aber nicht.',
      'Rosa Klein bekommt keine Nachricht, sieht deine Listen aber nicht mehr.',
      'Was Rosa Klein für dich heimlich geplant hat, wird aufgehoben – ob es so etwas gibt, erfährst du nie.',
    ]) expect(within(sheet).getByText(text)).toBeTruthy()
    const toggle = within(sheet).getByRole('switch', { name: /Auch alle meine Folgen-Links deaktivieren/ })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Blockieren' }))
    await waitFor(() => expect(api.revokeFollowLinks).toHaveBeenCalledWith(ME))
    expect(api.blockPerson).toHaveBeenCalledWith(ROSA, ME)
    expect(api.blockPerson.mock.invocationCallOrder[0]).toBeLessThan(api.revokeFollowLinks.mock.invocationCallOrder[0] ?? 0)
    await waitFor(() => expect(toastTexts()).toContain('Rosa Klein ist blockiert – deine Folgen-Links sind deaktiviert'))
  })

  it('switched off: only block_user', async () => {
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Rosa Klein')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Rosa Klein' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Rosa Klein' })).getByRole('button', { name: 'Blockieren' }))
    const sheet = await screen.findByRole('dialog', { name: 'Rosa Klein blockieren?' })
    fireEvent.click(within(sheet).getByRole('switch', { name: /Folgen-Links/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Blockieren' }))
    await waitFor(() => expect(api.blockPerson).toHaveBeenCalledWith(ROSA, ME))
    expect(api.revokeFollowLinks).not.toHaveBeenCalled()
  })

  it('"Ablehnen und blockieren": the silence first, then the block; a late answer after an account switch does nothing (W06)', async () => {
    const gate = deferred()
    api.blockPerson.mockReturnValue(gate.promise)
    renderWith(<PeoplePage userId={ME} />)
    await screen.findByText('Mama')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Mama' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Mama' })).getByRole('button', { name: 'Ablehnen und blockieren' }))
    // a short title (clamped to two lines, the verb stays visible at 320 px); the decline is the first point
    const sheet = await screen.findByRole('dialog', { name: 'Mama blockieren?' })
    expect(within(sheet).getAllByRole('listitem')[0]?.textContent).toBe('Die Anfrage wird abgelehnt.')
    // the default-ON links switch sits with the buttons, never below the fold behind them
    const footer = within(sheet).getByRole('button', { name: 'Ablehnen und blockieren' }).parentElement as HTMLElement
    expect(within(footer).getByRole('switch', { name: /Folgen-Links/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ablehnen und blockieren' }))
    await waitFor(() => expect(api.blockPerson).toHaveBeenCalledWith(MAMA, ME))
    expect(api.respondFollow).toHaveBeenCalledWith(MAMA, false, ME)
    endAccountEpoch()
    gate.resolve()
    await new Promise((done) => setTimeout(done, 20))
    expect(api.revokeFollowLinks).not.toHaveBeenCalled() // the account ended between the two calls: nothing more is sent
    expect(toastTexts()).toEqual([])
  })
})

describe('the person card (§2.8)', () => {
  it('"Folgen anfragen" when allowed — the server decides; never anybody else\'s followers', async () => {
    api.getProfileCard.mockResolvedValue(personCard({ can_request: true, shared_occasions: [{ id: 'o1', title: 'Annas Einweihung', starts_at: 'x' }] }))
    renderWith(<PersonPage profileId={ANNA} userId={ME} />)
    await screen.findByRole('heading', { name: 'Anna Beispiel' })
    expect(api.getProfileCard).toHaveBeenCalledWith(ANNA, ME)
    expect(screen.getByText('Folgt dir nicht')).toBeTruthy()
    expect(screen.getByText('Gemeinsam in: Annas Einweihung')).toBeTruthy()
    expect(screen.queryByText(/Ideen für/)).toBeNull() // no can_find_gift
    fireEvent.click(screen.getByRole('button', { name: 'Folgen anfragen' }))
    await waitFor(() => expect(api.requestFollow).toHaveBeenCalledWith(ANNA, ME))
    await waitFor(() => expect(toastTexts()).toContain('Angefragt – Anna Beispiel entscheidet selbst.'))
    expect(document.body.textContent).not.toMatch(/\d+ Follower/)
  })

  it('"Angefragt ✓" → "Anfrage zurückziehen"; "Du folgst ✓" → "Nicht mehr folgen" (the giver side may mention its own reservations)', async () => {
    api.getProfileCard.mockResolvedValue(personCard({ relation: { i_follow: 'requested' } }))
    const { unmount } = renderWith(<PersonPage profileId={ANNA} userId={ME} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Angefragt' }))
    const withdraw = await screen.findByRole('dialog', { name: 'Anfrage an Anna Beispiel zurückziehen?' })
    fireEvent.click(within(withdraw).getByRole('button', { name: 'Anfrage zurückziehen' }))
    await waitFor(() => expect(api.unfollow).toHaveBeenCalledWith(ANNA, ME))
    unmount()

    api.getProfileCard.mockResolvedValue(personCard({ relation: { i_follow: 'following', follows_me: 'following', mutual: true }, can_find_gift: true,
      lists: [{ id: 'l1', title: 'Annas Wünsche', cover_tone: 2, cover_icon: 'star', due_on: null, wish_count: 6, new_wish_count: 2 }] }))
    renderWith(<PersonPage profileId={ANNA} userId={ME} />)
    expect(await screen.findByText('Ihr folgt euch')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Listen von Anna Beispiel' })).toBeTruthy()
    expect(screen.getByText('Annas Wünsche')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ideen für Anna Beispiel' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Du folgst' }))
    const unfollow = await screen.findByRole('dialog', { name: 'Anna Beispiel nicht mehr folgen?' })
    expect(within(unfollow).getByText('Du siehst die Listen von Anna Beispiel dann nicht mehr. Deine Reservierungen dort enden.')).toBeTruthy()
  })

  it('an incoming request: Annehmen / Ablehnen and the highlighted question; lists stay hidden', async () => {
    api.getProfileCard.mockResolvedValue(personCard({ profile: profile(MAMA, 'Mama'), relation: { follows_me: 'requested' } }))
    renderWith(<PersonPage profileId={MAMA} userId={ME} />)
    expect(await screen.findByText('Mama möchte dir folgen')).toBeTruthy()
    expect(screen.getByText('Ihr habt keinen gemeinsamen Anlass. Kennst du Mama persönlich?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Annehmen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeTruthy()
    expect(screen.queryByText('Folgt dir nicht')).toBeNull()
    expect(screen.getByText('Die Listen siehst du, sobald du Mama folgst.')).toBeTruthy()
  })

  it('⋯: "Als Follower entfernen" only for a follower; Blockieren; Melden', async () => {
    api.getProfileCard.mockResolvedValue(personCard({ profile: profile(ROSA, 'Rosa Klein'), relation: { follows_me: 'following' }, can_request: true }))
    renderWith(<PersonPage profileId={ROSA} userId={ME} />)
    await screen.findByText('Folgt dir')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    const menu = await screen.findByRole('dialog', { name: 'Rosa Klein' })
    expect(within(menu).getByRole('button', { name: 'Als Follower entfernen' })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: 'Blockieren' })).toBeTruthy()
    expect(within(menu).getByText('Melden')).toBeTruthy()
  })

  it('unknown, blocked or gone: one page', async () => {
    const { AppError } = await import('../../lib/errors')
    api.getProfileCard.mockRejectedValue(new AppError('not_found'))
    renderWith(<PersonPage profileId={BEN} userId={ME} />)
    expect(await screen.findByRole('heading', { name: 'Diese Person ist nicht verfügbar' })).toBeTruthy()
  })
})

describe('the follow-link sheet (§2.9)', () => {
  it('does not let an invalidated lists overview hide a newer five-link warning from the people screen', async () => {
    const queryClient = client()
    queryClient.setQueryData(listsKeys.overview(), overview({ live_links: 0 }))
    await queryClient.invalidateQueries({ queryKey: listsKeys.overview(), refetchType: 'none' })
    api.getPeopleScreen.mockResolvedValueOnce(peopleData({ links: Array.from({ length: 5 }, () => ({ created_at: '2026-10-20T10:00:00Z', expires_at: '2026-11-19T10:00:00Z' })) }))
    renderWith(<FollowLinkSheet open userId={ME} onClose={() => undefined} />, queryClient)
    expect(await screen.findByText('Du hast 5 aktive Links – beim Teilen wird der älteste deaktiviert.')).toBeTruthy()
  })

  it('warns in advance at 5 live links; shares a new code once and remembers it for this account; the toast', async () => {
    const queryClient = client()
    queryClient.setQueryData(listsKeys.overview(), overview({ live_links: 5 }))
    renderWith(<FollowLinkSheet open userId={ME} onClose={() => undefined} />, queryClient)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    expect(within(sheet).getByText('Du hast 5 aktive Links – beim Teilen wird der älteste deaktiviert.')).toBeTruthy()
    expect(within(sheet).getByText('Wer den Link hat, kann dich nur anfragen. Du entscheidest, wer deine Listen sieht.')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Link teilen' }))
    await waitFor(() => expect(api.share).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(new RegExp(`/f#${TOKEN}$`)) })))
    expect(api.createFollowLink).toHaveBeenCalledWith(ME)
    await waitFor(() => expect(toastTexts()).toContain('Wer ihn öffnet, schickt dir eine Anfrage – du bestätigst sie unter „Anfragen“.'))
    expect(rememberedFollowLink(ME)?.url).toMatch(/\/f#/)
    expect(await within(sheet).findByLabelText('Dein Folgen-Link')).toBeTruthy()
    expect(within(sheet).queryByText(/beim Teilen wird der älteste/)).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Link teilen' }))
    await waitFor(() => expect(api.share).toHaveBeenCalledTimes(2))
    expect(api.createFollowLink).toHaveBeenCalledTimes(1) // the same link again
  })

  it('W06: a code created for an account that ended meanwhile is never remembered, shared or toasted', async () => {
    const gate = deferred<{ token: string; expires_at: string }>()
    api.createFollowLink.mockReturnValue(gate.promise)
    renderWith(<FollowLinkSheet open userId={ME} onClose={() => undefined} />)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Link kopieren' }))
    await waitFor(() => expect(api.createFollowLink).toHaveBeenCalled())
    endAccountEpoch()
    gate.resolve({ token: TOKEN, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() })
    await new Promise((done) => setTimeout(done, 20))
    expect(rememberedFollowLink(ME)).toBeNull()
    expect(api.share).not.toHaveBeenCalled()
    expect(toastTexts()).toEqual([])
  })

  it('from Profil › Privatsphäre: "Alle Links deaktivieren" (confirm) → revoke_follow_links()', async () => {
    const queryClient = client()
    queryClient.setQueryData(listsKeys.overview(), overview({ live_links: 2 }))
    renderWith(<FollowLinkSheet open manage userId={ME} onClose={() => undefined} />, queryClient)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    expect(within(sheet).getByText('2 aktive Links')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Alle Links deaktivieren' }))
    const confirm = await screen.findByRole('dialog', { name: 'Alle Folgen-Links deaktivieren?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Deaktivieren' }))
    await waitFor(() => expect(api.revokeFollowLinks).toHaveBeenCalledWith(ME))
    await waitFor(() => expect(toastTexts()).toContain('Alle deine Folgen-Links und Codes sind jetzt deaktiviert'))
  })

  it('without VITE_FRIEND_CODES: only the link (no tabs, no code request); never a Telegram link (Felix 27.10)', async () => {
    vi.stubEnv('VITE_FRIEND_CODES', '')
    renderWith(<FollowLinkSheet open tab="code" userId={ME} onClose={() => undefined} />)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    expect(within(sheet).queryByRole('radiogroup')).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /Telegram/ })).toBeNull()
    expect(api.createFriendCode).not.toHaveBeenCalled()
  })

  // add-friends-design §2.1: "Freunde hinzufügen" — Link · QR-Code · Code eingeben
  it('QR-Code: a code is created once when the tab is shown, the QR and K7M4-QX2P; "Neuer Code" replaces it', async () => {
    vi.stubEnv('VITE_FRIEND_CODES', '1')
    forgetFriendCodesForTests()
    const expires = new Date(Date.now() + 24 * 3_600_000).toISOString()
    api.createFriendCode.mockResolvedValueOnce({ code: 'K7M4QX2P', expires_at: expires }).mockResolvedValueOnce({ code: 'ANNA2026', expires_at: expires })
    renderWith(<FollowLinkSheet open tab="code" userId={ME} onClose={() => undefined} />)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    expect(await within(sheet).findByText('K7M4-QX2P')).toBeTruthy()
    expect(api.createFriendCode).toHaveBeenCalledTimes(1)
    expect(api.createFriendCode).toHaveBeenCalledWith(false, ME)
    expect(await within(sheet).findByRole('img', { name: 'QR-Code mit deinem Code K7M4-QX2P' })).toBeTruthy()
    expect(rememberedFriendCode(ME)?.code).toBe('K7M4QX2P')
    // back to "Link" and again "QR-Code": the same code, no second request
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Link' }))
    fireEvent.click(within(sheet).getByRole('radio', { name: 'QR-Code' }))
    expect(await within(sheet).findByText('K7M4-QX2P')).toBeTruthy()
    expect(api.createFriendCode).toHaveBeenCalledTimes(1)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Neuer Code' }))
    expect(await within(sheet).findByText('ANNA-2026')).toBeTruthy()
    expect(api.createFriendCode).toHaveBeenLastCalledWith(true, ME)
    await waitFor(() => expect(toastTexts()).toContain('Neuer Code – die bisherigen gelten nicht mehr.'))
  })

  it('Code eingeben: a wrong shape asks nothing; a dead code says so in place; a live one opens the gate /f#<code>', async () => {
    vi.stubEnv('VITE_FRIEND_CODES', '1')
    const { AppError } = await import('../../lib/errors')
    renderWith(<FollowLinkSheet open tab="enter" userId={ME} onClose={() => undefined} />)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    const field = within(sheet).getByLabelText('Code')
    fireEvent.change(field, { target: { value: 'k7m4' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Weiter' }))
    expect(await within(sheet).findByText('Ein Code hat 8 Zeichen – Buchstaben und Ziffern.')).toBeTruthy()
    expect(api.peekFriendCode).not.toHaveBeenCalled()
    api.peekFriendCode.mockRejectedValueOnce(new AppError('invite_invalid'))
    fireEvent.change(field, { target: { value: 'zzzz-zzzz' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Weiter' }))
    expect(await within(sheet).findByText('Dieser Code stimmt nicht oder ist abgelaufen. Frag nach dem aktuellen.')).toBeTruthy()
    expect(api.peekFriendCode).toHaveBeenLastCalledWith('ZZZZZZZZ', ME)
    api.peekFriendCode.mockResolvedValueOnce({ profile: profile(ANNA, 'Anna Beispiel'), relation: { self: false, i_follow: 'none' } })
    // what people type: lower case, a space, O for 0 and l for 1
    fireEvent.change(field, { target: { value: 'anna 2O26' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Weiter' }))
    await waitFor(() => expect(api.navigate).toHaveBeenCalledWith({ to: '/f', hash: 'ANNA2026' }))
  })
})

// Felix 27.10: Profil's ONE row "Mein Code & Link" — the sheet with `manage`: QR + code first, the link a secondary
// section below (share / copy / "Alle Links deaktivieren"), "Eingeben" still a tab; without the codes the link alone
describe('Profil › "Mein Code & Link" (the merged sheet, Felix 27.10)', () => {
  it('opens on the QR and the code; two tabs (Mein Code · Eingeben); the link below as "Oder als Link"', async () => {
    vi.stubEnv('VITE_FRIEND_CODES', '1')
    forgetFriendCodesForTests()
    const queryClient = client()
    queryClient.setQueryData(listsKeys.overview(), overview({ live_links: 2 }))
    api.createFriendCode.mockResolvedValueOnce({ code: 'K7M4QX2P', expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString() })
    // an opening that asks for the Link tab (the old "Mein Folgen-Link") lands on the merged code view as well
    renderWith(<FollowLinkSheet open manage tab="link" userId={ME} onClose={() => undefined} />, queryClient)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    const tabs = within(sheet).getByRole('radiogroup', { name: 'Wie möchtest du jemanden hinzufügen?' })
    expect(within(tabs).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Mein Code', 'Eingeben'])
    expect(within(tabs).getByRole('radio', { name: 'Mein Code' }).getAttribute('aria-checked')).toBe('true')
    // the QR and the code first …
    expect(await within(sheet).findByText('K7M4-QX2P')).toBeTruthy()
    expect(await within(sheet).findByRole('img', { name: 'QR-Code mit deinem Code K7M4-QX2P' })).toBeTruthy()
    expect(api.createFriendCode).toHaveBeenCalledTimes(1)
    expect(within(sheet).getByRole('button', { name: 'Code kopieren' })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Neuer Code' })).toBeTruthy()
    // … the link under it, secondary
    const link = within(sheet).getByRole('region', { name: 'Oder als Link' })
    const order = sheet.querySelector('.pp-code')?.compareDocumentPosition(link) ?? 0
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(link).getByText('Wer den Link hat, kann dich nur anfragen. Du entscheidest, wer deine Listen sieht.')).toBeTruthy()
    expect(within(link).getByText('2 aktive Links')).toBeTruthy()
    // "Alle Links deaktivieren" stays where the link is
    fireEvent.click(within(link).getByRole('button', { name: 'Alle Links deaktivieren' }))
    const confirm = await screen.findByRole('dialog', { name: 'Alle Folgen-Links deaktivieren?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Deaktivieren' }))
    await waitFor(() => expect(api.revokeFollowLinks).toHaveBeenCalledWith(ME))
    fireEvent.click(within(link).getByRole('button', { name: 'Link teilen' }))
    await waitFor(() => expect(api.share).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(new RegExp(`/f#${TOKEN}$`)) })))
    expect(await within(link).findByLabelText('Dein Folgen-Link')).toBeTruthy()
  })

  it('"Eingeben" is still reachable from the merged sheet', async () => {
    vi.stubEnv('VITE_FRIEND_CODES', '1')
    forgetFriendCodesForTests()
    api.createFriendCode.mockResolvedValue({ code: 'K7M4QX2P', expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString() })
    renderWith(<FollowLinkSheet open manage tab="code" userId={ME} onClose={() => undefined} />)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Eingeben' }))
    expect(within(sheet).getByLabelText('Code')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Weiter' })).toBeTruthy()
    expect(within(sheet).queryByRole('region', { name: 'Oder als Link' })).toBeNull()
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Mein Code' }))
    expect(within(sheet).getByRole('region', { name: 'Oder als Link' })).toBeTruthy()
  })

  it('without VITE_FRIEND_CODES: the link is the main thing (no tabs, no code request, no "Oder als Link")', async () => {
    vi.stubEnv('VITE_DEMO', '')
    vi.stubEnv('VITE_FRIEND_CODES', '')
    renderWith(<FollowLinkSheet open manage tab="code" userId={ME} onClose={() => undefined} />)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    expect(within(sheet).queryByRole('radiogroup')).toBeNull()
    expect(within(sheet).queryByRole('region', { name: 'Oder als Link' })).toBeNull()
    expect(within(sheet).getByText('Wer den Link hat, kann dich nur anfragen. Du entscheidest, wer deine Listen sieht.')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Link teilen' })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Alle Links deaktivieren' })).toBeTruthy()
    expect(api.createFriendCode).not.toHaveBeenCalled()
  })

  it('other ways in (lists, Freunde) keep the three tabs and the Link tab first', async () => {
    vi.stubEnv('VITE_FRIEND_CODES', '1')
    renderWith(<FollowLinkSheet open userId={ME} onClose={() => undefined} />)
    const sheet = await screen.findByRole('dialog', { name: 'Freunde hinzufügen' })
    const tabs = within(sheet).getByRole('radiogroup', { name: 'Wie möchtest du jemanden hinzufügen?' })
    expect(within(tabs).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Link', 'QR-Code', 'Eingeben'])
    expect(within(tabs).getByRole('radio', { name: 'Link' }).getAttribute('aria-checked')).toBe('true')
    expect(api.createFriendCode).not.toHaveBeenCalled()
  })
})

describe('the flag (§00 p. 9)', () => {
  it('off: the person card asks nothing', () => {
    vi.stubEnv('VITE_LISTS', '')
    renderWith(<PersonPage profileId={ANNA} userId={ME} />)
    expect(api.getProfileCard).not.toHaveBeenCalled()
  })
})
