import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'

const nav = vi.hoisted(() => ({ navigate: vi.fn(), preloadRoute: vi.fn() }))
const api = vi.hoisted(() => ({ markOnboardingDone: vi.fn(), assertCurrentAccount: vi.fn() }))
const pompon = vi.hoisted(() => ({
  outfits: [] as string[],
  catchWish: [] as string[],
  celebrate: 0,
}))
const telegram = vi.hoisted(() => ({ on: false }))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => nav.navigate,
  useRouter: () => ({ preloadRoute: nav.preloadRoute }),
}))
vi.mock('../../lib/api/profile', () => ({ markOnboardingDone: api.markOnboardingDone }))
vi.mock('../../lib/api/identity', () => ({ assertCurrentAccount: api.assertCurrentAccount }))
// opened as a Telegram Mini App or not (lib/telegram/detect.ts decides once at startup; here switchable)
vi.mock('../../lib/telegram/detect', () => ({ get IN_TELEGRAM() { return telegram.on } }))
// Pompon himself (outfits, flights, hearts) is tested in WelcomePompon.test.tsx; here only what the page asks of
// him: what he wears on each step, which bubble he catches, the celebration — and that he stays one Pompon.
vi.mock('./WelcomePompon', async () => {
  const { useEffect, useImperativeHandle } = await import('react')
  function WelcomePompon({ outfit, label, onPet, ref }: { outfit: string; label: string; onPet?: () => void; ref?: import('react').Ref<unknown> }) {
    useImperativeHandle(ref, () => ({
      pet: () => onPet?.(),
      catchWish: (bubble: HTMLElement) => {
        pompon.catchWish.push(bubble.textContent ?? '')
        return Promise.resolve()
      },
      celebrate: () => {
        pompon.celebrate += 1
      },
    }))
    useEffect(() => {
      pompon.outfits.push(outfit)
    }, [outfit])
    return <div data-testid="welcome-pompon" data-outfit={outfit}><button type="button" aria-label={label} onClick={() => onPet?.()} /></div>
  }
  return { default: WelcomePompon }
})

// «Здесь я буду жить» (Felix 27.10): the icon scene of the Home Screen step — the package stage is a stand-in that
// records how it was built (the scene itself: packages/mascot/test/homeicon.test.ts)
const icon = vi.hoisted(() => ({ built: [] as Array<{ still?: boolean; reducedMotion?: string; label?: string | null }>, played: 0, destroyed: 0 }))
vi.mock('@bunprise/mascot/homeicon', () => ({
  HomeIconStage: class {
    readonly isStatic: boolean
    readonly duration = 2.4
    busy = false
    isDestroyed = false
    suspended = false
    constructor(host: HTMLElement, options: { still?: boolean; reducedMotion?: string; label?: string | null }) {
      icon.built.push(options)
      this.isStatic = Boolean(options.still) || options.reducedMotion === 'force'
      host.dataset['still'] = String(this.isStatic)
    }
    play() {
      icon.played += 1
      this.busy = !this.isStatic
    }
    seek() {
      this.busy = false
    }
    destroy() {
      this.isDestroyed = true
      icon.destroyed += 1
    }
  },
}))

import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'
import { GIFT_START_KEY, readStartInterests, resetStartInterestsForTests } from '../gifts/startInterests'
import { consumePendingInvite, getPendingInvite, setPendingInvite } from '../invite/pending'
import { WelcomePage } from './WelcomePage'

// Invented fixture account (no real data).
const USER_ID = '7a1c0d2e-3f4b-4c5d-8e6f-000000000001'
const ME: Me = {
  profile: { id: USER_ID, display_name: 'Mila', locale: 'de', onboarding_done_at: null },
  consents_ok: true,
  legal_versions: { terms: 'terms-1', privacy: 'privacy-1', age: 'age-1' },
}
const INVITE_TOKEN = 'a1'.repeat(32)
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
/** The DE texts keep "Home-Bildschirm" together with a non-breaking hyphen (U+2011). */
const HOME_SCREEN_TITLE = /^Zum Home.Bildschirm hinzufügen$/
const withPlainHyphens = (text: string | null) => text?.replaceAll(String.fromCharCode(0x2011), '-')

function renderPage(me: Me | null = ME) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (me) client.setQueryData(qk.me(), me)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </QueryClientProvider>
  )
  return render(<WelcomePage userId={USER_ID} />, { wrapper })
}

function asIphoneSafari({ standalone = false } = {}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI)
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const heading = (name: string | RegExp) => screen.getByRole('heading', { level: 1, name })
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const skipButton = () => button('Überspringen')
const card = (name: RegExp) => button(name)
const birthdayCard = () => card(/^Geburtstag/)
const inviteCard = () => card(/^Ich habe eine Einladung/)
const goButton = () => button('Los geht’s!')
/** greeting → wish box ("Später") → the occasion cards */
function toOccasions() {
  fireEvent.click(button('Weiter'))
  fireEvent.click(button('Später'))
}
/** the one real action of step 3: a card, then "Los geht's!" */
function createOccasion() {
  toOccasions()
  fireEvent.click(birthdayCard())
  fireEvent.click(goButton())
}

beforeEach(() => {
  vi.clearAllMocks()
  pompon.outfits.length = 0
  pompon.catchWish.length = 0
  pompon.celebrate = 0
  icon.built.length = 0
  icon.played = 0
  icon.destroyed = 0
  localStorage.clear()
  resetStartInterestsForTests()
  telegram.on = false
  consumePendingInvite()
  sessionStorage.clear()
  api.markOnboardingDone.mockResolvedValue(undefined)
  api.assertCurrentAccount.mockResolvedValue(undefined)
  nav.navigate.mockResolvedValue(undefined)
  nav.preloadRoute.mockResolvedValue(undefined)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'standalone')
  delete document.documentElement.dataset['motion']
  delete document.documentElement.dataset['bunnies']
})

describe('/welcome onboarding (product-pilot S4/F3; Felix 25.10: three screens)', () => {
  it('step 1: Pompon greets by name with the slogan, "Überspringen" is there from the first frame', async () => {
    renderPage()
    expect(heading('Hallo Mila! Ich bin Pompon.')).toBeTruthy()
    // Felix 25.10: a slogan instead of the feature sentence, one phrase per line
    for (const line of ['Träumen.', 'Wünschen.', 'Freude schenken.']) expect(screen.getByText(line)).toBeTruthy()
    expect(skipButton().disabled).toBe(false)
    expect(screen.getByRole('img', { name: 'Schritt 1 von 3' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull()
    // one Pompon, lazy, wearing nothing yet; he can be petted
    expect((await screen.findByTestId('welcome-pompon')).getAttribute('data-outfit')).toBe('none')
    expect(screen.getByRole('button', { name: 'Pompon streicheln' })).toBeTruthy()
    expect(document.title).toBe('Willkommen · Bunprise')
  })

  it('the greeting whispers "streichel mich mal" after a while — until Pompon has been petted', async () => {
    renderPage()
    await screen.findByTestId('welcome-pompon')
    const hint = () => document.querySelector('[data-pet-hint]')?.getAttribute('data-pet-hint')
    expect(hint()).toBe('hidden')
    await waitFor(() => expect(hint()).toBe('shown'), { timeout: 4500 })
    fireEvent.click(button('Pompon streicheln'))
    expect(hint()).toBe('hidden')
  }, 8000)

  it('preloads the feed (chunk + data) once the screen is idle: the tap later only switches screens', async () => {
    renderPage()
    expect(nav.preloadRoute).not.toHaveBeenCalled()
    await waitFor(() => expect(nav.preloadRoute).toHaveBeenCalledWith({ to: '/soon' }), { timeout: 3000 })
    expect(nav.preloadRoute).toHaveBeenCalledTimes(1)
  })

  it('greets without a name when no fresh profile of this account is cached', () => {
    renderPage({ ...ME, profile: { ...ME.profile, id: 'another-account' } })
    expect(heading('Hallo! Ich bin Pompon.')).toBeTruthy()
  })

  it('"Weiter" slides to the wish box: Pompon holds the gift box, focus follows; "Zurück" returns', async () => {
    renderPage()
    await screen.findByTestId('welcome-pompon')
    fireEvent.click(button('Weiter'))
    expect(heading('Was wünschst du dir?')).toBeTruthy()
    expect(screen.getByText('Träum ruhig groß!')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Schritt 2 von 3' })).toBeTruthy()
    expect(screen.getByTestId('welcome-pompon').getAttribute('data-outfit')).toBe('box')
    // the same Pompon stays (no new mascot): only what he holds changed
    expect(screen.getAllByTestId('welcome-pompon')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: /Hallo Mila/ })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(heading('Was wünschst du dir?')))
    expect(api.markOnboardingDone).not.toHaveBeenCalled()

    fireEvent.click(button('Zurück'))
    expect(heading('Hallo Mila! Ich bin Pompon.')).toBeTruthy()
    expect(screen.getByTestId('welcome-pompon').getAttribute('data-outfit')).toBe('none')
    await waitFor(() => expect(document.activeElement).toBe(heading('Hallo Mila! Ich bin Pompon.')))
    // "Zurück" fades out with the step it belonged to and can no longer be pressed meanwhile
    const leaving = screen.queryByRole('button', { name: 'Zurück' })
    if (leaving) fireEvent.click(leaving)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull())
  })

  it('wish bubbles go into the box: device-only interests for "Ideen", no server call at all', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderPage()
    fireEvent.click(button('Weiter'))
    expect(screen.getByText('Pompon merkt sich das für „Ideen“ – nur auf diesem Gerät.')).toBeTruthy()
    const books = button(/^Bücher$/)
    expect(books.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(books)
    expect(pompon.catchWish).toEqual(['Bücher'])
    expect(button(/^Bücher$/).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Dein erster Wunsch ist in der Box!')).toBeTruthy()
    fireEvent.click(button(/^Pflanzen$/))
    expect(screen.getByText('Schon 2 Wünsche in der Box')).toBeTruthy()
    // kept on this device for this account: interest ids only
    expect(readStartInterests(USER_ID)).toEqual(['books', 'plants'])
    expect(JSON.parse(localStorage.getItem(GIFT_START_KEY) ?? 'null')).toEqual({ v: 1, owner: USER_ID, interests: ['books', 'plants'] })
    // a second tap takes it out again (no flight)
    fireEvent.click(button(/^Bücher$/))
    expect(pompon.catchWish).toEqual(['Bücher', 'Pflanzen'])
    expect(readStartInterests(USER_ID)).toEqual(['plants'])
    // "Später" became "Weiter"; nothing was sent anywhere
    fireEvent.click(button('Weiter'))
    expect(heading('Was feierst du als Nächstes?')).toBeTruthy()
    expect(api.markOnboardingDone).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('coming back to the wish box shows what is already in it', () => {
    renderPage()
    fireEvent.click(button('Weiter'))
    fireEvent.click(button(/^Spiele$/))
    fireEvent.click(button('Zurück'))
    fireEvent.click(button('Weiter'))
    expect(button(/^Spiele$/).getAttribute('aria-pressed')).toBe('true')
  })

  it('step 3: a card dresses Pompon; "Los geht’s!" waits for a card, celebrates and opens the new-occasion form', async () => {
    renderPage()
    toOccasions()
    expect(screen.getByRole('img', { name: 'Schritt 3 von 3' })).toBeTruthy()
    expect(screen.getByText('Pompon zieht sich schon mal um.')).toBeTruthy()
    expect(goButton().disabled).toBe(true)
    fireEvent.click(card(/^Weihnachten/))
    expect(screen.getByTestId('welcome-pompon').getAttribute('data-outfit')).toBe('christmas')
    fireEvent.click(birthdayCard())
    expect(birthdayCard().getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('welcome-pompon').getAttribute('data-outfit')).toBe('birthday')
    expect(api.markOnboardingDone).not.toHaveBeenCalled()
    fireEvent.click(goButton())
    expect(pompon.celebrate).toBe(1)
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/occasions/new', replace: true }))
    expect(api.markOnboardingDone).toHaveBeenCalledWith(USER_ID)
    expect(screen.queryByRole('heading', { name: HOME_SCREEN_TITLE })).toBeNull()
  })

  it('"Überspringen" records onboarding_done_at for this account, then replaces /welcome with the feed', async () => {
    renderPage()
    fireEvent.click(skipButton())
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', replace: true }))
    expect(api.markOnboardingDone).toHaveBeenCalledWith(USER_ID)
    expect(api.assertCurrentAccount).toHaveBeenCalledWith(USER_ID)
    expect(api.markOnboardingDone.mock.invocationCallOrder[0]).toBeLessThan(nav.navigate.mock.invocationCallOrder[0] ?? 0)
  })

  it('locks every control while the server write runs; a second tap does nothing', async () => {
    const write = deferred()
    api.markOnboardingDone.mockReturnValue(write.promise)
    renderPage()
    const skip = skipButton()
    fireEvent.click(skip)
    fireEvent.click(skip)
    // the write starts right after the tap's frame is painted (INP); the second tap started nothing
    await waitFor(() => expect(api.markOnboardingDone).toHaveBeenCalledTimes(1))
    fireEvent.click(skip)
    expect(api.markOnboardingDone).toHaveBeenCalledTimes(1)
    expect(skip.getAttribute('aria-busy')).toBe('true')
    expect(button('Weiter').disabled).toBe(true)
    expect(nav.navigate).not.toHaveBeenCalled()
    await act(async () => write.resolve())
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledTimes(1))
  })

  it('iOS Safari in the browser: a fourth step explains "Zum Home-Bildschirm", "Fertig" then finishes', async () => {
    asIphoneSafari()
    renderPage()
    expect(screen.getByRole('img', { name: 'Schritt 1 von 4' })).toBeTruthy()
    createOccasion()
    expect(api.markOnboardingDone).not.toHaveBeenCalled()
    expect(heading(HOME_SCREEN_TITLE)).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Schritt 4 von 4' })).toBeTruthy()
    // Pompon keeps the costume of the chosen occasion
    expect(screen.getByTestId('welcome-pompon').getAttribute('data-outfit')).toBe('birthday')
    const steps = within(screen.getByRole('list')).getAllByRole('listitem').map((item) => withPlainHyphens(item.textContent))
    expect(steps).toEqual([
      'Tipp auf „Teilen“ – in der Leiste oder im Menü „…“',
      'Wähle „Zum Home-Bildschirm“',
      'Tipp oben rechts auf „Hinzufügen“',
    ])
    expect(screen.getByText(/^Wenn du Bunprise zum ersten Mal vom Home.Bildschirm öffnest, meldest du dich noch einmal an\.$/)).toBeTruthy()

    fireEvent.click(button('Fertig'))
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/occasions/new', replace: true }))
    expect(api.markOnboardingDone).toHaveBeenCalledTimes(1)
  })

  it('iOS app opened from the Home Screen (standalone): no hint step', async () => {
    asIphoneSafari({ standalone: true })
    renderPage()
    expect(screen.getByRole('img', { name: 'Schritt 1 von 3' })).toBeTruthy()
    createOccasion()
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/occasions/new', replace: true }))
    expect(screen.queryByRole('heading', { name: HOME_SCREEN_TITLE })).toBeNull()
  })

  it('inside Telegram (a web view that reports itself like Safari): three steps, no Home Screen hint', async () => {
    telegram.on = true
    asIphoneSafari()
    renderPage()
    expect(screen.getByRole('img', { name: 'Schritt 1 von 3' })).toBeTruthy()
    createOccasion()
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/occasions/new', replace: true }))
    expect(api.markOnboardingDone).toHaveBeenCalledWith(USER_ID)
    expect(screen.queryByRole('heading', { name: HOME_SCREEN_TITLE })).toBeNull()
  })

  it('"Ich habe eine Einladung" without a waiting invite: the envelope, how the link works (no input field), then the feed', async () => {
    renderPage()
    toOccasions()
    fireEvent.click(inviteCard())
    expect(screen.getByTestId('welcome-pompon').getAttribute('data-outfit')).toBe('invite')
    fireEvent.click(goButton())
    expect(heading('Öffne einfach den Link')).toBeTruthy()
    expect(screen.getByTestId('welcome-pompon').getAttribute('data-outfit')).toBe('invite')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(api.markOnboardingDone).not.toHaveBeenCalled()
    fireEvent.click(button('Verstanden'))
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', replace: true }))
    expect(api.markOnboardingDone).toHaveBeenCalledWith(USER_ID)
  })

  it('a waiting invite: the envelope card is already chosen and opens /i, the token stays for "Beitreten"', async () => {
    setPendingInvite(INVITE_TOKEN)
    renderPage()
    toOccasions()
    expect(inviteCard().getAttribute('aria-pressed')).toBe('true')
    expect(inviteCard().textContent).toContain('Wartet schon auf dich')
    expect(screen.getByTestId('welcome-pompon').getAttribute('data-outfit')).toBe('invite')
    fireEvent.click(goButton())
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/i', replace: true }))
    expect(api.markOnboardingDone).toHaveBeenCalledWith(USER_ID)
    expect(getPendingInvite()).toBe(INVITE_TOKEN) // joining is the invite screen's explicit step
  })

  it('iOS Safari with a waiting invite: straight to the invite, no Home Screen step in between', async () => {
    asIphoneSafari()
    setPendingInvite(INVITE_TOKEN)
    renderPage()
    toOccasions()
    fireEvent.click(goButton())
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/i', replace: true }))
    expect(screen.queryByRole('heading', { name: HOME_SCREEN_TITLE })).toBeNull()
  })

  it('skipping with a waiting invite goes to the invite instead of the feed', async () => {
    setPendingInvite(INVITE_TOKEN)
    renderPage()
    fireEvent.click(skipButton())
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/i', replace: true }))
    expect(api.markOnboardingDone).toHaveBeenCalledWith(USER_ID)
  })

  it('keeps the person here with the error when the write fails; the next tap tries again', async () => {
    api.markOnboardingDone.mockRejectedValueOnce(new AppError('network'))
    renderPage()
    fireEvent.click(skipButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Keine Verbindung')
    expect(nav.navigate).not.toHaveBeenCalled()
    expect(skipButton().disabled).toBe(false)
    fireEvent.click(skipButton())
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', replace: true }))
    expect(api.markOnboardingDone).toHaveBeenCalledTimes(2)
  })

  it('forgets an old error once the person moves on to another step', async () => {
    api.markOnboardingDone.mockRejectedValueOnce(new AppError('generic'))
    renderPage()
    fireEvent.click(skipButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Hat nicht geklappt – versuch es nochmal')
    fireEvent.click(button('Weiter'))
    expect(heading('Was wünschst du dir?')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not navigate when the account changed while the write was running', async () => {
    api.assertCurrentAccount.mockRejectedValueOnce(new AppError('session_expired'))
    renderPage()
    fireEvent.click(skipButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Bitte melde dich nochmal an')
    expect(nav.navigate).not.toHaveBeenCalled()
  })

  it('offline: finishing waits for the network and says why; the wish box and the cards still work', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderPage()
    expect(skipButton().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Zum Abschließen brauchst du Netz.')
    fireEvent.click(button('Weiter'))
    fireEvent.click(button(/^Bücher$/)) // device only: works offline
    expect(readStartInterests(USER_ID)).toEqual(['books'])
    fireEvent.click(button('Weiter'))
    expect(heading('Was feierst du als Nächstes?')).toBeTruthy()
    fireEvent.click(birthdayCard())
    expect(goButton().disabled).toBe(true) // would finish now
    fireEvent.click(inviteCard())
    expect(goButton().disabled).toBe(false) // only explains the link
    fireEvent.click(goButton())
    expect(button('Verstanden').disabled).toBe(true)
    expect(api.markOnboardingDone).not.toHaveBeenCalled()
  })

  it('an onboarding finished earlier is not written again (the first time stays)', async () => {
    renderPage({ ...ME, profile: { ...ME.profile, onboarding_done_at: '2026-10-19T10:00:00.000Z' } })
    fireEvent.click(skipButton())
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/soon', replace: true }))
    expect(api.markOnboardingDone).not.toHaveBeenCalled()
  })

  it('a pull that ends on a button is a swipe, not a tap on it', () => {
    renderPage()
    const next = button('Weiter')
    fireEvent.pointerDown(next, { clientX: 40, clientY: 300, pointerId: 1, isPrimary: true })
    fireEvent.click(next, { clientX: 160, clientY: 300, detail: 1 })
    expect(heading('Hallo Mila! Ich bin Pompon.')).toBeTruthy()
    // a real tap (and a keyboard click) still works
    fireEvent.pointerDown(next, { clientX: 40, clientY: 300, pointerId: 1, isPrimary: true })
    fireEvent.click(next, { clientX: 42, clientY: 301, detail: 1 })
    expect(heading('Was wünschst du dir?')).toBeTruthy()
  })
})

describe('«Здесь я буду жить»: Pompon becomes the app icon on the Home Screen step (Felix 27.10)', () => {
  const PLAYED_KEY = `${ACTIVE_STORAGE_PREFIX}homeIconPlayed`
  const seat = () => screen.getByTestId('welcome-pompon').closest<HTMLElement>('.wl-seat')
  /** greeting → wishes → a card → "Los geht’s!" → the Home Screen step (iOS Safari) */
  function toHomeScreen() {
    toOccasions()
    fireEvent.click(birthdayCard())
    fireEvent.click(goButton())
    expect(heading(HOME_SCREEN_TITLE)).toBeTruthy()
  }

  it('the icon scene replaces the seated Pompon (he fades out, inert) and plays once; back = Pompon again', async () => {
    asIphoneSafari()
    renderPage()
    expect(document.querySelector('[data-home-icon]')).toBeNull()
    expect(seat()?.classList.contains('wl-seat-away')).toBe(false)
    toHomeScreen()
    await waitFor(() => expect(icon.played).toBe(1))
    const host = document.querySelector<HTMLElement>('[data-home-icon]')
    expect(host?.getAttribute('aria-hidden')).toBe('true')
    expect(host?.dataset['still']).toBe('false')
    expect(icon.built).toEqual([{ reducedMotion: 'auto', still: false, label: 'Bunprise' }])
    expect(localStorage.getItem(PLAYED_KEY)).toBe('1')
    await waitFor(() => expect(seat()?.classList.contains('wl-seat-away')).toBe(true))
    expect(seat()?.hasAttribute('inert')).toBe(true)
    // back to the occasion cards: the scene leaves, Pompon (still in his costume) is back
    fireEvent.click(button('Zurück'))
    await waitFor(() => expect(document.querySelector('[data-home-icon]')).toBeNull())
    expect(icon.destroyed).toBe(1)
    expect(seat()?.classList.contains('wl-seat-away')).toBe(false)
    expect(seat()?.hasAttribute('inert')).toBe(false)
    // and forward again: the still icon now (once per device)
    fireEvent.click(goButton())
    await waitFor(() => expect(icon.built).toHaveLength(2))
    expect(icon.built[1]).toMatchObject({ still: true })
  })

  it('already played on this device: the still icon from the start', async () => {
    localStorage.setItem(PLAYED_KEY, '1')
    asIphoneSafari()
    renderPage()
    toHomeScreen()
    await waitFor(() => expect(icon.built).toHaveLength(1))
    expect(icon.built[0]).toMatchObject({ still: true })
    expect(document.querySelector<HTMLElement>('[data-home-icon]')?.dataset['still']).toBe('true')
  })

  it('"Weniger": the still icon (reduced motion forced), the show is not used up', async () => {
    document.documentElement.dataset['motion'] = 'reduce'
    asIphoneSafari()
    renderPage()
    toHomeScreen()
    await waitFor(() => expect(icon.built).toHaveLength(1))
    expect(icon.built[0]).toMatchObject({ reducedMotion: 'force' })
    expect(document.querySelector<HTMLElement>('[data-home-icon]')?.dataset['still']).toBe('true')
    expect(localStorage.getItem(PLAYED_KEY)).toBeNull()
  })

  it('"Kaninchen zeigen" off or Animationen "Aus": no icon scene (and no Pompon, as on every step)', async () => {
    for (const set of [() => (document.documentElement.dataset['bunnies'] = 'off'), () => (document.documentElement.dataset['motion'] = 'off')]) {
      set()
      asIphoneSafari()
      const view = renderPage()
      toHomeScreen()
      await act(async () => {
        await Promise.resolve()
      })
      expect(document.querySelector('[data-home-icon]')).toBeNull()
      expect(icon.built).toHaveLength(0)
      view.unmount()
      delete document.documentElement.dataset['motion']
      delete document.documentElement.dataset['bunnies']
    }
  })

  it('not iOS Safari: there is no Home Screen step, so never an icon scene', async () => {
    renderPage()
    createOccasion()
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ to: '/occasions/new', replace: true }))
    expect(icon.built).toHaveLength(0)
  })
})
