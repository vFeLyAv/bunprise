import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InviteEmailSettings } from '../../lib/api/inviteEmail'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { AppError } from '../../lib/errors'
import { getToasts, toast } from '../../lib/toast'
import { createDemoInviteEmail } from '../../mocks/inviteEmail'
import { DEMO_SUPABASE_URL } from '../../mocks/rest'

// Profil › Privatsphäre › "Bei neuen Einladungen eine E-Mail schicken" (docs/spec/invite-email-design.md §11, §14):
// hidden without the flags / the database switch / the migration; optimistic switch with rollback; disabled without a
// confirmed address; the demo server answers like the database. Invented ids only.

const api = vi.hoisted(() => ({
  getInviteEmailSettings: vi.fn<(userId?: string) => Promise<InviteEmailSettings>>(),
  setInviteEmail: vi.fn<(on: boolean, lang: string, userId?: string) => Promise<boolean>>(),
}))
vi.mock('../../lib/api/inviteEmail', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/inviteEmail')>()), ...api }))

import { InviteEmailRow, inviteEmailKey } from './InviteEmailRow'
import { inviteEmailEnabled } from './flag'

const ME = '00000000-0000-4000-8000-0000000000aa'
// the kit switch's accessible name is its label text plus the description inside the same <label>
const LABEL = /^Bei neuen Einladungen eine E-Mail schicken/

function renderRow(settings: InviteEmailSettings | Error = { available: true, enabled: false, address: true }) {
  if (settings instanceof Error) api.getInviteEmailSettings.mockRejectedValue(settings)
  else api.getInviteEmailSettings.mockResolvedValue(settings)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict><ul><InviteEmailRow userId={ME} /></ul></LazyMotion>
    </QueryClientProvider>,
  )
  return queryClient
}

beforeEach(() => {
  vi.stubEnv('VITE_INVITES', '1')
  vi.stubEnv('VITE_INVITE_EMAIL', '1')
  vi.stubEnv('VITE_DEMO', '0')
  setRenderedAccount(ME)
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
  for (const item of getToasts()) toast.dismiss(item.id)
})

describe('the flag', () => {
  it('on with VITE_INVITE_EMAIL=1 or in the demo, off otherwise', () => {
    expect(inviteEmailEnabled({ VITE_INVITE_EMAIL: '1' })).toBe(true)
    expect(inviteEmailEnabled({ VITE_DEMO: '1' })).toBe(true)
    expect(inviteEmailEnabled({ VITE_INVITE_EMAIL: '0' })).toBe(false)
    expect(inviteEmailEnabled({})).toBe(false)
  })

  it('no row (and no call) without the flag or without the invitations', () => {
    vi.stubEnv('VITE_INVITE_EMAIL', '0')
    renderRow()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(api.getInviteEmailSettings).not.toHaveBeenCalled()
    vi.stubEnv('VITE_INVITE_EMAIL', '1')
    vi.stubEnv('VITE_INVITES', '0')
    renderRow()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(api.getInviteEmailSettings).not.toHaveBeenCalled()
  })

  it('no row while the database switch is off', async () => {
    renderRow({ available: false, enabled: false, address: true })
    await waitFor(() => expect(api.getInviteEmailSettings).toHaveBeenCalledWith(ME))
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('no row when the call fails', async () => {
    renderRow(new AppError('network'))
    await waitFor(() => expect(api.getInviteEmailSettings).toHaveBeenCalledWith(ME))
    expect(screen.queryByRole('switch')).toBeNull()
  })
})

describe('the switch', () => {
  it('starts OFF; ON is optimistic and sends the app language; the answer lands in the in-memory query', async () => {
    api.setInviteEmail.mockResolvedValue(true)
    const queryClient = renderRow()
    const toggle = await screen.findByRole('switch', { name: LABEL })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(/ohne Namen und Anlass/)).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(api.setInviteEmail).toHaveBeenCalledWith(true, 'de', ME))
    await waitFor(() => expect(queryClient.getQueryData<InviteEmailSettings>(inviteEmailKey(ME))?.enabled).toBe(true))
  })

  it('OFF again', async () => {
    api.setInviteEmail.mockResolvedValue(false)
    renderRow({ available: true, enabled: true, address: true })
    const toggle = await screen.findByRole('switch', { name: LABEL })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(api.setInviteEmail).toHaveBeenCalledWith(false, 'de', ME))
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('a failed write rolls back with a toast', async () => {
    api.setInviteEmail.mockRejectedValue(new AppError('network'))
    renderRow()
    const toggle = await screen.findByRole('switch', { name: LABEL })
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    expect(getToasts().some((item) => item.text === 'Die Einstellung wurde nicht gespeichert.')).toBe(true)
  })

  it('without a confirmed address: disabled with a hint', async () => {
    renderRow({ available: true, enabled: false, address: false })
    const toggle = await screen.findByRole('switch', { name: LABEL })
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Für dein Konto ist keine bestätigte E-Mail-Adresse hinterlegt.')).toBeTruthy()
  })

  it('an existing opt-in can be switched off even without an address', async () => {
    api.setInviteEmail.mockResolvedValue(false)
    renderRow({ available: true, enabled: true, address: false })
    const toggle = await screen.findByRole('switch', { name: LABEL })
    expect((toggle as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() => expect(api.setInviteEmail).toHaveBeenCalledWith(false, 'de', ME))
  })

  it('offline: disabled', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    renderRow()
    expect(((await screen.findByRole('switch', { name: LABEL })) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the demo server (src/mocks/inviteEmail.ts)', () => {
  const server = setupServer()
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterAll(() => server.close())

  async function call(name: string, args: Record<string, unknown>) {
    const response = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }

  it('answers like the database: off by default, ru -> de, validation, export without an address', async () => {
    const demo = createDemoInviteEmail({ now: () => Date.parse('2026-10-28T10:00:00Z') })
    server.resetHandlers(...demo.handlers(() => ME))
    expect((await call('get_invite_email_settings', {})).body).toEqual({ available: true, enabled: false, address: true })
    expect((await call('set_invite_email', { p_enabled: true, p_lang: 'ru', p_consent: 'invite-email-2026-10-28' })).body).toEqual({ ok: true, enabled: true })
    expect(demo.optInOf(ME)).toMatchObject({ lang: 'de', consent: 'invite-email-2026-10-28' })
    expect((await call('set_invite_email', { p_enabled: true, p_lang: 'fr', p_consent: 'invite-email-2026-10-28' })).status).toBe(400)
    expect((await call('export_my_invite_email', {})).body).toMatchObject({ enabled: true, lang: 'de', unsubscribe_links: 0 })
    expect((await call('set_invite_email', { p_enabled: false, p_lang: null, p_consent: null })).body).toEqual({ ok: true, enabled: false })
    expect((await call('get_invite_email_settings', {})).body).toMatchObject({ enabled: false })
  })
})
