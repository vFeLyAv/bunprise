import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../lib/errors'

// The browser side of Web Push (features/push/device.ts) against a fake Push API: the browser prompt comes first and
// only from the tap, an endpoint of another account is replaced by a fresh subscription, the start-up check repairs
// a renewed subscription and drops one nobody here switched on. Keys here are fixtures (65 / 16 bytes), not real.

const api = vi.hoisted(() => ({
  registerPushDevice: vi.fn<(device: { endpoint: string; p256dh: string; auth: string }, lang: string, userId?: string) => Promise<{ invitations: boolean }>>(),
  unregisterPushDevice: vi.fn<(endpoint: string, userId?: string) => Promise<void>>(),
  getPushSettings: vi.fn<(endpoint: string | null, userId?: string) => Promise<{ available: boolean; device: boolean; invitations: boolean }>>(),
  fetchPushKey: vi.fn<() => Promise<string | null>>(),
}))
vi.mock('../../lib/api/push', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/api/push')>()), ...api }))

import { disablePush, dropOrphanPush, enablePush, syncPushDevice } from './device'
import { readPushMarker, writePushMarker } from './platform'

const ME = '00000000-0000-4000-8000-0000000000aa'
const KEY = `BA${'Q'.repeat(84)}A`  // canonical base64url of a 65-byte point (the last character carries 4 bits)
const keyBytes = (fill: number, length: number) => new Uint8Array(length).fill(fill)

interface FakeSubscription { endpoint: string; unsubscribe: ReturnType<typeof vi.fn>; getKey: (name: string) => ArrayBuffer; options: { applicationServerKey: ArrayBuffer } }

function fakeSubscription(endpoint: string, serverKey: Uint8Array = Uint8Array.from(atob(KEY.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0))): FakeSubscription {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => true),
    getKey: (name) => (name === 'p256dh' ? keyBytes(4, 65) : keyBytes(7, 16)).buffer,
    options: { applicationServerKey: serverKey.buffer as ArrayBuffer },
  }
}

let current: FakeSubscription | null = null
let order: string[] = []
const notifications = [{ close: vi.fn() }]
const pushManager = {
  getSubscription: vi.fn(async () => current),
  subscribe: vi.fn(async () => {
    order.push('subscribe')
    current = fakeSubscription(`https://fcm.googleapis.com/fcm/send/new-${pushManager.subscribe.mock.calls.length}`)
    return current
  }),
}
const registration = { pushManager, getNotifications: vi.fn(async () => notifications) }

beforeEach(() => {
  current = null
  order = []
  notifications[0]!.close.mockReset()
  pushManager.getSubscription.mockClear()
  pushManager.subscribe.mockClear()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: async () => registration } })
  vi.stubGlobal('PushManager', function PushManager() {})
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => { order.push('prompt'); return 'granted' }) })
  api.registerPushDevice.mockReset().mockImplementation(async () => { order.push('register'); return { invitations: true } })
  api.unregisterPushDevice.mockReset().mockResolvedValue()
  api.getPushSettings.mockReset().mockResolvedValue({ available: true, device: true, invitations: true })
  api.fetchPushKey.mockReset().mockResolvedValue(KEY)
  window.localStorage.clear()
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  vi.unstubAllGlobals()
})

describe('enablePush', () => {
  it('asks the browser first, then subscribes with our key and registers base64url keys for this account', async () => {
    expect(await enablePush(ME, 'ru')).toBe('on')
    expect(order).toEqual(['prompt', 'subscribe', 'register'])
    const options = pushManager.subscribe.mock.calls[0] as unknown as [{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }]
    expect(options[0].userVisibleOnly).toBe(true)
    expect(options[0].applicationServerKey).toHaveLength(65)
    const [device, lang, user] = api.registerPushDevice.mock.calls[0]!
    expect(lang).toBe('ru')
    expect(user).toBe(ME)
    expect(device.p256dh).toMatch(/^B[A-Za-z0-9_-]{86}$/)
    expect(device.auth).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(readPushMarker(ME)).toMatchObject({ endpoint: current!.endpoint, lang: 'ru' })
  })

  it('"no" in the browser prompt: nothing is subscribed or sent', async () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'denied') })
    expect(await enablePush(ME, 'de')).toBe('denied')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(api.registerPushDevice).not.toHaveBeenCalled()
  })

  it('push not set up on the server (no key): nothing is subscribed', async () => {
    api.fetchPushKey.mockResolvedValue(null)
    expect(await enablePush(ME, 'de')).toBe('unavailable')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('an endpoint that belongs to another account (shared device): drop it, subscribe afresh, register the new one', async () => {
    const old = fakeSubscription('https://fcm.googleapis.com/fcm/send/someone-else')
    current = old
    api.registerPushDevice.mockRejectedValueOnce(new AppError('conflict')).mockResolvedValue({ invitations: true })
    expect(await enablePush(ME, 'de')).toBe('on')
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(api.registerPushDevice.mock.calls.map(([device]) => device.endpoint)).toEqual([old.endpoint, 'https://fcm.googleapis.com/fcm/send/new-1'])
    expect(readPushMarker(ME)?.endpoint).toBe('https://fcm.googleapis.com/fcm/send/new-1')
  })

  it('a subscription made with another (old) server key is replaced', async () => {
    const old = fakeSubscription('https://fcm.googleapis.com/fcm/send/old-key', keyBytes(9, 65))
    current = old
    await enablePush(ME, 'de')
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
  })
})

describe('disablePush / the start-up check', () => {
  it('disablePush: the database forgets the device, the browser drops it, the marker goes', async () => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/mine')
    const mine = current
    writePushMarker({ user: ME, endpoint: mine.endpoint, lang: 'de', at: Date.now() })
    await disablePush(ME)
    expect(api.unregisterPushDevice).toHaveBeenCalledWith(mine.endpoint, ME)
    expect(mine.unsubscribe).toHaveBeenCalled()
    expect(notifications[0]!.close).toHaveBeenCalled() // what it showed goes too (Codex code review #3)
    expect(readPushMarker(ME)).toBeNull()
  })

  it('nothing to do: same endpoint and language, checked less than a day ago → no request at all', async () => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/mine')
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    writePushMarker({ user: ME, endpoint: current.endpoint, lang: 'de', at: Date.now() })
    await syncPushDevice(ME, 'de')
    expect(api.fetchPushKey).not.toHaveBeenCalled()
    expect(api.registerPushDevice).not.toHaveBeenCalled()
    expect(api.getPushSettings).not.toHaveBeenCalled()
  })

  it('a WNS endpoint with lower-case escapes is registered and remembered in its one spelling (upper case)', async () => {
    pushManager.subscribe.mockImplementationOnce(async () => {
      current = fakeSubscription('https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2bx%2f%3d')
      return current
    })
    await enablePush(ME, 'de')
    expect(api.registerPushDevice.mock.calls[0]![0].endpoint).toBe('https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2Bx%2F%3D')
    expect(readPushMarker(ME)?.endpoint).toBe('https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2Bx%2F%3D')
    // the next start sees the same device (no re-registration every time)
    api.registerPushDevice.mockClear()
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    await syncPushDevice(ME, 'de')
    expect(api.registerPushDevice).not.toHaveBeenCalled()
  })

  it('the browser renewed the subscription: the old endpoint is forgotten, the new one registered', async () => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/renewed')
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    writePushMarker({ user: ME, endpoint: 'https://fcm.googleapis.com/fcm/send/before', lang: 'de', at: Date.now() })
    await syncPushDevice(ME, 'de')
    expect(api.unregisterPushDevice).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/before', ME)
    expect(api.registerPushDevice.mock.calls[0]![0].endpoint).toBe('https://fcm.googleapis.com/fcm/send/renewed')
    expect(readPushMarker(ME)?.endpoint).toBe('https://fcm.googleapis.com/fcm/send/renewed')
  })

  it('a day later the device is looked up; a new session (device false) registers it again', async () => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/mine')
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    writePushMarker({ user: ME, endpoint: current.endpoint, lang: 'de', at: Date.now() - 25 * 3600_000 })
    api.getPushSettings.mockResolvedValue({ available: true, device: false, invitations: true })
    await syncPushDevice(ME, 'de')
    expect(api.registerPushDevice).toHaveBeenCalledTimes(1)
  })

  it('permission revoked in the browser settings: the database forgets the device, the marker goes', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
    writePushMarker({ user: ME, endpoint: 'https://fcm.googleapis.com/fcm/send/mine', lang: 'de', at: Date.now() })
    await syncPushDevice(ME, 'de')
    expect(api.unregisterPushDevice).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/mine', ME)
    expect(readPushMarker(ME)).toBeNull()
  })

  it('dropOrphanPush: a subscription nobody here switched on is dropped and what it shows is closed', async () => {
    current = fakeSubscription('https://fcm.googleapis.com/fcm/send/old-account')
    const orphan = current
    await dropOrphanPush()
    expect(notifications[0]!.close).toHaveBeenCalled()
    expect(orphan.unsubscribe).toHaveBeenCalled()
    // no subscription any more (switched off earlier), but a notification of the old account is still shown: it goes
    current = null
    notifications[0]!.close.mockReset()
    await dropOrphanPush()
    expect(notifications[0]!.close).toHaveBeenCalled()
  })
})
