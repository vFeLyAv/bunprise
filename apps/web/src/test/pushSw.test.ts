import { describe, expect, it, vi } from 'vitest'
import source from '../../public/push-sw.js?raw'
import { IMPORTED_SCRIPTS, analyzePushWorker, analyzeServiceWorker, importedScripts } from '../../scripts/sw-rules.mjs'

// Web Push in the service worker (docs/spec/web-push-design.md §8): the generated sw.js may import exactly
// /push-sw.js, and that file (public/push-sw.js, run here as it ships) only shows notifications, focuses / opens the
// app on a tap — no network, no cache, no other listener (a sign-out is cleaned up by the app: device.ts).

const PRECACHE = 's.precacheAndRoute([{url:"index.html",revision:"r1"}],{}),s.cleanupOutdatedCaches()'
const NAVIGATION = 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//,/^\\/auth\\/callback/]}))'
const sw = (head: string) =>
  `if(!self.define){let s,e={};const i=(e,i)=>{importScripts(e)}}define(["./workbox-2fbc6a65"],function(s){"use strict";${head}self.addEventListener("message",s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()}),${PRECACHE},${NAVIGATION}});`

describe('sw.js may import the reviewed push listeners and nothing else', () => {
  it('accepts importScripts("/push-sw.js") exactly as generateSW writes it, and reports it for the file check', () => {
    const built = sw('importScripts("/push-sw.js"),')
    expect(analyzeServiceWorker(built).problems).toEqual([])
    expect(importedScripts(built)).toEqual(['/push-sw.js'])
    expect(IMPORTED_SCRIPTS).toEqual(['/push-sw.js'])
  })

  it('enumerates the imported file in any quote style the statement check accepts (so its content is always checked)', () => {
    const single = sw("importScripts('/push-sw.js'),")
    expect(analyzeServiceWorker(single).problems).toEqual([])
    expect(importedScripts(single)).toEqual(['/push-sw.js'])
  })

  it.each([
    ['another script', 'importScripts("/other.js"),'],
    ['a second script next to it', 'importScripts("/push-sw.js","/other.js"),'],
    ['another origin', 'importScripts("https://cdn.example.test/push-sw.js"),'],
    ['a computed path', 'importScripts("/push-"+"sw.js"),'],
    ['a template literal', 'importScripts(`/push-sw.js`),'],
  ])('refuses %s', (_what, head) => {
    expect(analyzeServiceWorker(sw(head)).problems.join('\n')).toMatch(/importScripts|unexpected statement/)
  })
})

describe('public/push-sw.js passes its own rules (scripts/sw-rules.mjs analyzePushWorker)', () => {
  it('the shipped file: only push and notificationclick listeners, no network, cache or storage', () => {
    expect(analyzePushWorker(source)).toEqual([])
  })

  it.each([
    ['a fetch listener', `self.addEventListener('push', () => {}); self.addEventListener('fetch', () => {})`, /listens to "fetch"/],
    ['a network request', `self.addEventListener('push', (e) => { fetch('/api/x') })`, /network request/],
    ['a cache', `self.addEventListener('push', () => { caches.open('x') })`, /Cache Storage/],
    ['another script', `importScripts('/x.js'); self.addEventListener('push', () => {})`, /importScripts/],
    ['an onfetch property', `self.onfetch = () => {}; self.addEventListener('push', () => {})`, /on<event>/],
    ['a computed event name', `const e = 'fe' + 'tch'; self.addEventListener(e, () => {}); self.addEventListener('push', () => {})`, /cannot read/],
    ['no push listener', `self.addEventListener('notificationclick', () => {})`, /no push listener/],
    ['a message listener', `self.addEventListener('push', () => {}); self.addEventListener('message', () => {})`, /listens to "message"/],
    ['client.navigate', `self.addEventListener('push', () => {}); self.addEventListener('notificationclick', (e) => { c.navigate('/') })`, /navigate/],
    ['storage', `self.addEventListener('push', () => { indexedDB.open('x') })`, /storage/],
    ['an aliased fetch', `const f = self.fetch; self.addEventListener('push', () => { f('/x') })`, /network request/],
    ['a computed addEventListener', `self['addEventListener']('fetch', () => {}); self.addEventListener('push', () => {})`, /indirect access/],
    ['an aliased addEventListener', `const on = self.addEventListener; on('fetch', () => {}); self.addEventListener('push', () => {})`, /indirect access/],
    ['globalThis', `globalThis.caches; self.addEventListener('push', () => {})`, /indirect access|Cache Storage/],
  ])('refuses %s', (_what, code, problem) => {
    expect(analyzePushWorker(code).join('\n')).toMatch(problem)
  })

  it('a word in a comment does not count', () => {
    expect(analyzePushWorker(`/* never fetch(), never caches.open */ self.addEventListener('push', () => {})`)).toEqual([])
  })
})

// ---- the file at work, in a fake service worker scope -----------------------------------------------------------

type Listener = (event: Record<string, unknown>) => void

function scope(options: { windows?: { url: string; focus: () => Promise<void>; postMessage: (m: unknown) => void }[]; subscribed?: boolean } = {}) {
  const listeners = new Map<string, Listener>()
  const shown: { title: string; options: Record<string, unknown> }[] = []
  const notifications = [{ close: vi.fn() }, { close: vi.fn() }]
  const unsubscribe = vi.fn(async () => true)
  const openWindow = vi.fn(async () => null)
  const self = {
    location: { origin: 'https://bunprise.de' },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    registration: {
      showNotification: vi.fn(async (title: string, opts: Record<string, unknown>) => { shown.push({ title, options: opts }) }),
      getNotifications: vi.fn(async () => notifications),
      pushManager: { getSubscription: vi.fn(async () => (options.subscribed === false ? null : { unsubscribe })) },
    },
    clients: { matchAll: vi.fn(async () => options.windows ?? []), openWindow },
  }
  // the file as it ships, with `self` = this fake scope
  new Function('self', source)(self)
  async function fire(type: string, event: Record<string, unknown>) {
    const waits: Promise<unknown>[] = []
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
  }
  return { listeners, shown, notifications, unsubscribe, openWindow, fire }
}

const payload = (value: unknown) => ({ data: { json: () => value } })

describe('push-sw.js at work', () => {
  it('registers exactly two listeners', () => {
    expect([...scope().listeners.keys()].sort()).toEqual(['notificationclick', 'push'])
  })

  it('push: shows what the Worker sent, with a tag that replaces the older invitation and the app path', async () => {
    const s = scope()
    await s.fire('push', payload({ title: 'Anna lädt dich ein', body: '„Grillabend“ · Tippe, um zu antworten.', url: '/soon', tag: 'invitation', lang: 'de' }))
    expect(s.shown).toEqual([{
      title: 'Anna lädt dich ein',
      options: { body: '„Grillabend“ · Tippe, um zu antworten.', lang: 'de', tag: 'invitation', renotify: true, icon: '/icons/icon-192.png', data: { path: '/soon' } },
    }])
  })

  it('push: an unreadable or hostile payload still shows a neutral notification; foreign paths become Start', async () => {
    const s = scope()
    await s.fire('push', { data: { json: () => { throw new Error('not json') } } })
    await s.fire('push', { data: null })
    await s.fire('push', payload({ title: 42, url: '//evil.example/x', tag: '<script>', lang: 'xx' }))
    await s.fire('push', payload({ title: 'x', url: 'https://evil.example/', lang: 'ru' }))
    await s.fire('push', payload({ title: 'x', url: '/\\evil.example', lang: 'uk' }))
    expect(s.shown.map((n) => [n.title, n.options.body, n.options.tag, (n.options.data as { path: string }).path, n.options.lang])).toEqual([
      ['Bunprise', 'Es gibt etwas Neues für dich.', 'bunprise', '/soon', 'de'],
      ['Bunprise', 'Es gibt etwas Neues für dich.', 'bunprise', '/soon', 'de'],
      ['Bunprise', 'Es gibt etwas Neues für dich.', 'bunprise', '/soon', 'de'],
      ['x', 'Для тебя есть что-то новое.', 'bunprise', '/soon', 'ru'],
      ['x', 'Для тебе є щось нове.', 'bunprise', '/soon', 'uk'],
    ])
  })

  it('notificationclick: focuses an open Bunprise window and tells it where to go; no window → opens one', async () => {
    const focus = vi.fn(async () => undefined)
    const postMessage = vi.fn()
    const foreign = { url: 'https://other.example/', focus: vi.fn(async () => undefined), postMessage: vi.fn() }
    const s = scope({ windows: [foreign, { url: 'https://bunprise.de/lists', focus, postMessage }] })
    const close = vi.fn()
    await s.fire('notificationclick', { notification: { close, data: { path: '/soon' } } })
    expect(close).toHaveBeenCalled()
    expect(foreign.focus).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith({ type: 'bunprise:open', path: '/soon' })
    expect(s.openWindow).not.toHaveBeenCalled()

    const empty = scope({ windows: [] })
    await empty.fire('notificationclick', { notification: { close: vi.fn(), data: { path: '//evil.example' } } })
    expect(empty.openWindow).toHaveBeenCalledWith('/soon')
  })
})
