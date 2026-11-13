import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToasts, toast } from '../../lib/toast'

// Web Push in the client (docs/spec/web-push-design.md §3): the platform rules, the device marker, the sheet in its
// states (prompt / switches / iPhone in Safari / blocked) and the flag. The browser part (device.ts) and the RPCs are
// mocked; no real prompt, no real push. Invented data only.

const device = vi.hoisted(() => ({
  enablePush: vi.fn<(userId: string, lang: string) => Promise<'on' | 'denied' | 'unavailable' | 'unsupported'>>(),
  disablePush: vi.fn<(userId: string) => Promise<void>>(),
  currentEndpoint: vi.fn<(userId: string) => Promise<string | null>>(),
}))
const api = vi.hoisted(() => ({
  getPushSettings: vi.fn<(endpoint: string | null, userId?: string) => Promise<{ available: boolean; device: boolean; invitations: boolean }>>(),
  setPushInvitations: vi.fn<(on: boolean, userId?: string) => Promise<boolean>>(),
}))
const where = vi.hoisted(() => ({ platform: 'ready' as string, permission: 'default' as string }))
vi.mock('./device', () => device)
vi.mock('../../lib/api/push', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/push')>()), ...api }))
vi.mock('./platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('./platform')>()
  return { ...real, pushPlatform: () => where.platform, notificationPermission: () => where.permission }
})

import PushSheet from './PushSheet'
import { pushEnabled } from './flag'
import { isAppleMobile, readPushMarker, writePushMarker } from './platform'

const { pushPlatform: realPlatform } = await vi.importActual<typeof import('./platform')>('./platform')

const ME = '00000000-0000-4000-8000-0000000000aa'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  where.platform = 'ready'
  where.permission = 'default'
  device.enablePush.mockReset().mockResolvedValue('on')
  device.disablePush.mockReset().mockResolvedValue()
  device.currentEndpoint.mockReset().mockResolvedValue(null)
  api.getPushSettings.mockReset().mockResolvedValue({ available: true, device: false, invitations: true })
  api.setPushInvitations.mockReset().mockImplementation(async (on) => on)
  toast.clear()
  window.localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('flag and platform', () => {
  it('shows push only with VITE_PUSH=1 or in the demo', () => {
    expect(pushEnabled({})).toBe(false)
    expect(pushEnabled({ VITE_PUSH: '1' })).toBe(true)
    expect(pushEnabled({ VITE_DEMO: '1' })).toBe(true)
    expect(pushEnabled({ VITE_PUSH: 'true' })).toBe(false)
  })

  it('Telegram first, then the demo, then iPhone/iPad outside the home screen, then the Push API', () => {
    const base = { telegram: false, demo: false, userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140', platform: 'Linux armv8l', maxTouchPoints: 5, standalone: false, supported: true }
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
    expect(realPlatform(base)).toBe('ready')
    expect(realPlatform({ ...base, telegram: true })).toBe('telegram')
    expect(realPlatform({ ...base, demo: true })).toBe('demo')
    expect(realPlatform({ ...base, userAgent: iphone, supported: false })).toBe('ios-browser')
    expect(realPlatform({ ...base, userAgent: iphone, standalone: true })).toBe('ready')
    expect(realPlatform({ ...base, userAgent: iphone, standalone: true, supported: false })).toBe('unsupported')
    expect(realPlatform({ ...base, supported: false })).toBe('unsupported')
    // an iPad in desktop mode says MacIntel but has a touch screen; a Mac does not
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })

  it('the device marker belongs to one account', () => {
    writePushMarker({ user: ME, endpoint: 'https://fcm.googleapis.com/fcm/send/x', lang: 'de', at: 1 })
    expect(readPushMarker(ME)).toMatchObject({ endpoint: 'https://fcm.googleapis.com/fcm/send/x' })
    expect(readPushMarker('00000000-0000-4000-8000-0000000000bb')).toBeNull()
    writePushMarker(null)
    expect(readPushMarker(ME)).toBeNull()
  })
})

describe('the sheet', () => {
  it('prompt mode: our explanation and preview first; only "Benachrichtigungen erlauben" asks the browser', async () => {
    const onClose = vi.fn()
    const onChanged = vi.fn()
    render(wrap(<PushSheet userId={ME} open mode="prompt" onClose={onClose} onChanged={onChanged} />))
    expect(screen.getByText('So sieht eine Benachrichtigung aus')).toBeTruthy()
    expect(screen.getByText('Anna lädt dich ein')).toBeTruthy()
    expect(screen.getByText(/Über Reservierungen gibt es nie Benachrichtigungen/)).toBeTruthy()
    expect(device.enablePush).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen erlauben' }))
    await waitFor(() => expect(device.enablePush).toHaveBeenCalledWith(ME, 'de'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onChanged).toHaveBeenCalledWith(true)
    expect(getToasts().map((x) => x.text)).toContain('Benachrichtigungen sind an')
  })

  it('a "no" in the browser prompt shows where to allow it later', async () => {
    device.enablePush.mockImplementation(async () => {
      where.permission = 'denied'
      return 'denied'
    })
    render(wrap(<PushSheet userId={ME} open mode="prompt" onClose={vi.fn()} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Benachrichtigungen erlauben' }))
    expect(await screen.findByText('Im Browser blockiert')).toBeTruthy()
  })

  it('settings mode: the device switch and the per-person "Einladungen" switch', async () => {
    api.getPushSettings.mockResolvedValue({ available: true, device: true, invitations: true })
    render(wrap(<PushSheet userId={ME} open onClose={vi.fn()} />))
    const deviceSwitch = await screen.findByRole('switch', { name: /Auf diesem Gerät/ })
    expect(deviceSwitch.getAttribute('aria-checked')).toBe('true')
    const invites = screen.getByRole('switch', { name: /^Einladungen/ })
    fireEvent.click(invites)
    await waitFor(() => expect(api.setPushInvitations).toHaveBeenCalledWith(false, ME))
    await waitFor(() => expect(invites.getAttribute('aria-checked')).toBe('false'))
    fireEvent.click(deviceSwitch)
    await waitFor(() => expect(device.disablePush).toHaveBeenCalledWith(ME))
    await waitFor(() => expect(getToasts().map((x) => x.text)).toContain('Benachrichtigungen sind aus'))
  })

  it('iPhone in Safari: how to add Bunprise to the home screen, no switch, no browser prompt', () => {
    where.platform = 'ios-browser'
    render(wrap(<PushSheet userId={ME} open mode="prompt" onClose={vi.fn()} />))
    expect(screen.getByText('Nur aus der App auf dem Home-Bildschirm')).toBeTruthy()
    expect(screen.getByText('Wähle „Zum Home-Bildschirm“.')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Benachrichtigungen erlauben' })).toBeNull()
    expect(api.getPushSettings).not.toHaveBeenCalled()
  })

  it('a browser without the Push API says so', () => {
    where.platform = 'unsupported'
    render(wrap(<PushSheet userId={ME} open onClose={vi.fn()} />))
    expect(screen.getByText('In diesem Browser nicht möglich')).toBeTruthy()
  })
})
