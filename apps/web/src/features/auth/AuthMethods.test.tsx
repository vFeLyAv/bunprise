import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  send: vi.fn(), oauth: vi.fn(), available: vi.fn(), navigate: vi.fn(), forget: vi.fn(),
  consent: vi.fn(), attempt: vi.fn(),
}))
const flags = vi.hoisted(() => ({ demo: false, google: false, telegram: false }))
vi.mock('../../lib/app', async (original) => ({
  ...await original<typeof import('../../lib/app')>(),
  get DEMO_MODE() { return flags.demo }, get GOOGLE_ENABLED() { return flags.google },
}))
// opened as a Telegram Mini App or not (lib/telegram/detect.ts decides once at startup; here switchable)
vi.mock('../../lib/telegram/detect', () => ({ get IN_TELEGRAM() { return flags.telegram } }))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, search, children, className }: { to: string; search?: Record<string, string | undefined>; children: ReactNode; className?: string }) => {
    const query = new URLSearchParams(Object.entries(search ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined))
    return <a href={`${to}${query.size ? `?${query}` : ''}`} className={className}>{children}</a>
  }
  // the method links press like buttons (a router link rendered as a motion anchor): the same plain link here
  return { useNavigate: () => auth.navigate, Link, createLink: () => Link }
})
vi.mock('../../lib/api/auth', () => ({
  requestEmailCode: auth.send, signInWithProvider: auth.oauth, isOAuthProviderAvailable: auth.available,
}))
vi.mock('./Turnstile', () => ({ Turnstile: () => null }))
vi.mock('./flow', () => ({
  readEmailAttempt: () => null, readLoginDraft: () => null, rememberLoginDraft: vi.fn(),
  rememberEmailAttempt: auth.attempt, forgetPendingConsent: auth.forget, rememberPendingConsent: auth.consent,
  signInTarget: (next?: string) => next ?? '/soon',
}))
import { LoginForm } from './LoginForm'
import { AuthMethods } from './AuthMethods'

beforeEach(() => {
  vi.clearAllMocks()
  flags.demo = false
  flags.google = false
  flags.telegram = false
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  auth.send.mockResolvedValue(undefined)
  auth.oauth.mockResolvedValue(undefined)
  auth.available.mockReturnValue(false)
})
afterEach(() => vi.restoreAllMocks())

function fillEmail() { fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'fixture@example.org' } }) }
function acceptSignup() { screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox)) }

describe('account modes and auth methods', () => {
  it('keeps all three choices visible, preserving mode and destination', () => {
    render(<AuthMethods mode="signup" next="/i" />)
    for (const [label, method] of [['Mit Google fortfahren', 'google'], ['Mit Apple fortfahren', 'apple'], ['Mit E-Mail fortfahren', 'email']]) {
      const url = new URL(screen.getByRole('link', { name: label }).getAttribute('href') ?? '', 'https://fixture.invalid')
      expect(Object.fromEntries(url.searchParams)).toEqual({ mode: 'signup', method, next: '/i' })
    }
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('preserves provider choices in both real and demo builds without triggering OAuth', () => {
    flags.google = true
    const view = render(<AuthMethods mode="signin" />)
    expect(screen.getByRole('link', { name: 'Mit Google fortfahren' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Mit Apple fortfahren' })).toBeTruthy()
    flags.demo = true
    view.rerender(<AuthMethods mode="signin" />)
    expect(screen.getByRole('link', { name: 'Mit Google fortfahren' })).toBeTruthy()
    expect(auth.oauth).not.toHaveBeenCalled()
  })

  it('allows switching methods and exposes demo instructions only in demo', () => {
    const view = render(<LoginForm mode="signin" method="email" />)
    expect(screen.getByRole('link', { name: 'Andere Methode wählen' })).toBeTruthy()
    expect(screen.queryByText(/Demo:/)).toBeNull()
    flags.demo = true
    view.rerender(<LoginForm mode="signin" method="email" />)
    // the text is unchanged; "E-Mail" sits in a nowrap span (never "E-|Mail" at a line end, QA ACCOUNT-12)
    const notice = screen.getByText(/^Demo:/)
    expect(notice.textContent).toBe('Demo: erfundene Adresse, Code 123456. Es wird keine E-Mail verschickt.')
    expect(notice.querySelector('.whitespace-nowrap')?.textContent).toBe('E-Mail')
  })

  // QA ACCOUNT-8: the consent links flow with their sentence (no 44 px inline-flex box inside the text)
  it('the terms and privacy links inside the consent text are inline text links', () => {
    render(<LoginForm mode="signup" method="email" />)
    for (const name of ['Nutzungsbedingungen für den Pilotbetrieb', 'Datenschutzerklärung']) {
      const link = screen.getByRole('link', { name })
      expect(link.className).not.toMatch(/inline-flex|min-h-11/)
      expect(link.className).toMatch(/underline/)
    }
  })

  // QA ACCOUNT-14: with the bunnies off there is no empty room reserved above the card
  it('reserves the bunny\'s room above the card only while bunnies are shown', () => {
    const view = render(<LoginForm mode="signup" method="email" />)
    const intro = () => screen.getByRole('heading', { level: 1, name: 'Konto erstellen' }).parentElement!
    expect(intro().className).toContain('mb-24')
    document.documentElement.dataset.bunnies = 'off'
    view.rerender(<LoginForm mode="signup" method="email" />)
    expect(intro().className).not.toContain('mb-24')
    delete document.documentElement.dataset.bunnies
  })

  it('signs in by email without repeat checkboxes and forgets any signup draft', async () => {
    render(<LoginForm mode="signin" method="email" next="/i" />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    fillEmail()
    fireEvent.click(screen.getByRole('button', { name: 'Code schicken' }))
    await waitFor(() => expect(auth.navigate).toHaveBeenCalled())
    expect(auth.send).toHaveBeenCalledWith('fixture@example.org', expect.objectContaining({ mode: 'signin' }))
    expect(auth.attempt).toHaveBeenCalledWith('fixture@example.org', undefined, 'signin')
    expect(auth.forget.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(auth.consent).not.toHaveBeenCalled()
    expect(auth.navigate).toHaveBeenCalledWith({ to: '/login/code', search: { next: '/i', mode: 'signin' } })
  })

  it('requires signup checkboxes and records them only after a successful code request', async () => {
    let finish: (() => void) | undefined
    auth.send.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<LoginForm mode="signup" method="email" />)
    expect(screen.getByRole('heading', { name: 'Konto erstellen' })).toBeTruthy()
    fillEmail()
    const submit = screen.getByRole('button', { name: 'Code schicken' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    acceptSignup()
    fireEvent.click(submit)
    expect(auth.consent).not.toHaveBeenCalled()
    await act(async () => { finish?.() })
    expect(auth.send).toHaveBeenCalledWith('fixture@example.org', expect.objectContaining({ mode: 'signup' }))
    expect(auth.consent).toHaveBeenCalledWith('de')
    expect(auth.attempt).toHaveBeenCalledWith('fixture@example.org', undefined, 'signup')
  })

  it('does not record signup checkboxes after a failed email request', async () => {
    auth.send.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<LoginForm mode="signup" method="email" />)
    fillEmail()
    acceptSignup()
    fireEvent.click(screen.getByRole('button', { name: 'Code schicken' }))
    await screen.findByRole('alert')
    expect(auth.consent).not.toHaveBeenCalled()
    expect(auth.navigate).not.toHaveBeenCalled()
  })

  it.each(['google', 'apple'] as const)('explains an unavailable %s option and offers email without attempting OAuth', (provider) => {
    render(<LoginForm mode="signup" method={provider} next="/i" />)
    expect(screen.getByRole('status').textContent).toContain(provider === 'google' ? 'Google' : 'Apple')
    const submit = screen.getByRole('button', { name: provider === 'google' ? 'Mit Google fortfahren' : 'Mit Apple fortfahren' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(screen.getByRole('link', { name: 'Mit E-Mail fortfahren' }).getAttribute('href')).toContain('method=email')
    expect(auth.oauth).not.toHaveBeenCalled()
    expect(auth.consent).not.toHaveBeenCalled()
  })

  it('ignores a late signup response after the form changes to sign-in mode', async () => {
    let finish: (() => void) | undefined
    auth.send.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const view = render(<LoginForm key="signup" mode="signup" method="email" />)
    fillEmail()
    acceptSignup()
    fireEvent.click(screen.getByRole('button', { name: 'Code schicken' }))
    view.rerender(<LoginForm key="signin" mode="signin" method="email" />)
    await act(async () => { finish?.() })
    expect(auth.consent).not.toHaveBeenCalled()
    expect(auth.attempt).not.toHaveBeenCalled()
    expect(auth.navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Anmelden' })).toBeTruthy()
  })

  it.each(['signup', 'signin'] as const)('starts enabled OAuth with the correct %s consent behavior', async (mode) => {
    auth.available.mockReturnValue(true)
    render(<LoginForm mode={mode} method="apple" next="/i" />)
    const submit = screen.getByRole('button', { name: 'Mit Apple fortfahren' }) as HTMLButtonElement
    if (mode === 'signup') {
      expect(submit.disabled).toBe(true)
      acceptSignup()
    } else expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(submit)
    await waitFor(() => expect(auth.oauth).toHaveBeenCalledWith('apple', '/i'))
    expect(auth.consent).toHaveBeenCalledTimes(mode === 'signup' ? 1 : 0)
  })

  it('in the browser "/login" without a method is still the chooser, and "Zurück" from a method returns to it', () => {
    const view = render(<LoginForm mode="signin" next="/i" />)
    expect(screen.getAllByRole('link', { name: /^Mit (Google|Apple|E-Mail) fortfahren$/ })).toHaveLength(3)
    expect(screen.queryByLabelText('E-Mail')).toBeNull()
    view.unmount()
    render(<LoginForm mode="signin" method="email" next="/i" />)
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(auth.navigate).toHaveBeenCalledWith({ to: '/login', search: { mode: 'signin', next: '/i' } })
  })
})

// docs/spec/telegram-mini-app.md §3.5: Google refuses OAuth in embedded web views and Apple is not set up,
// so inside Telegram the only way in is the e-mail code — and a link to a provider must not dead-end.
describe('inside a Telegram Mini App: e-mail code only', () => {
  beforeEach(() => { flags.telegram = true })

  it('the start and sign-in choices show only "Mit E-Mail fortfahren"', () => {
    flags.google = true
    render(<AuthMethods mode="signup" next="/i" />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]?.textContent).toBe('Mit E-Mail fortfahren')
    const url = new URL(links[0]?.getAttribute('href') ?? '', 'https://fixture.invalid')
    expect(Object.fromEntries(url.searchParams)).toEqual({ mode: 'signup', method: 'email', next: '/i' })
    expect(screen.queryByText(/Google|Apple/)).toBeNull()
  })

  it('"/login" without a method opens the e-mail form directly (a choice of one is no choice)', () => {
    render(<LoginForm mode="signin" next="/i" />)
    expect(screen.getByLabelText('E-Mail')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Code schicken' })).toBeTruthy()
    expect(screen.queryByText(/Google|Apple/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Andere Methode wählen' })).toBeNull()
    // "Zurück" leaves the sign-in screens instead of walking into the same form again
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(auth.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('the e-mail page offers no other method and "Zurück" goes to the start', () => {
    render(<LoginForm mode="signup" method="email" />)
    expect(screen.queryByRole('link', { name: 'Andere Methode wählen' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(auth.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('signs in by e-mail code as in the browser', async () => {
    render(<LoginForm mode="signin" next="/i" />)
    fillEmail()
    fireEvent.click(screen.getByRole('button', { name: 'Code schicken' }))
    await waitFor(() => expect(auth.navigate).toHaveBeenCalledWith({ to: '/login/code', search: { next: '/i', mode: 'signin' } }))
    expect(auth.send).toHaveBeenCalledWith('fixture@example.org', expect.objectContaining({ mode: 'signin' }))
  })

  it.each([['google', 'Google'], ['apple', 'Apple']] as const)('a link to ?method=%s explains why not and offers the e-mail code (even when configured)', (provider, name) => {
    auth.available.mockReturnValue(true)
    flags.google = true
    render(<LoginForm mode="signup" method={provider} next="/i" />)
    expect(screen.getByRole('status').textContent)
      .toBe(`Mit ${name} kannst du dich in Telegram nicht anmelden. Hier geht es mit dem Code aus der E-Mail.`)
    expect(screen.queryByRole('button', { name: new RegExp(name) })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    const email = screen.getByRole('link', { name: 'Mit E-Mail fortfahren' })
    const url = new URL(email.getAttribute('href') ?? '', 'https://fixture.invalid')
    expect(Object.fromEntries(url.searchParams)).toEqual({ mode: 'signup', method: 'email', next: '/i' })
    // switching to "Anmelden" lands on the e-mail form too, not on the same explanation again
    const signin = new URL(screen.getByRole('link', { name: 'Bereits ein Konto? Anmelden' }).getAttribute('href') ?? '', 'https://fixture.invalid')
    expect(signin.searchParams.get('method')).toBe('email')
    expect(screen.queryByRole('link', { name: 'Andere Methode wählen' })).toBeNull()
    expect(auth.available).not.toHaveBeenCalled()
    expect(auth.oauth).not.toHaveBeenCalled()
    expect(auth.consent).not.toHaveBeenCalled()
  })
})
