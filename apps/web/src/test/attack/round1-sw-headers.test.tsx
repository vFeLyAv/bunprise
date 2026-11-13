import { describe, expect, it } from 'vitest'
import headers from '../../../public/_headers?raw'
import { analyzeServiceWorker } from '../../../scripts/sw-rules.mjs'

// ADVERSARIAL ROUND 1 — Codex review 2, M4 (built service worker) and L6 (framing).
// scripts/check-sw.mjs promises (contract §9.9, storage-registry "Cache Storage"): no runtime route /
// cache for Supabase REST/auth, nothing queued offline, /auth/callback and /api/ outside the navigation
// fallback. Below: shapes a misconfigured vite.config.ts / Workbox build would really write into
// dist/sw.js that cache or queue Supabase traffic WITHOUT naming it. The SECURE expectation is that the
// check reports every one of them; a passing problem list = the check lets it through (a finding).
// The CLI itself (dist/sw.js → exit code) is exercised outside vitest on crafted files (see the report).

const PRECACHE = 's.precacheAndRoute([{url:"index.html",revision:"r1"},{url:"assets/shell-a1.js",revision:null}],{}),s.cleanupOutdatedCaches()'
const NAVIGATION = 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//,/^\\/auth\\/callback/]}))'

/** dist/sw.js as Workbox (generateSW, minified) writes it, with extra statements in the define body. */
function sw(...statements: string[]): string {
  return `if(!self.define){let s,e={};}define(["./workbox-2fbc6a65"],function(s){"use strict";self.addEventListener("message",s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()}),${[PRECACHE, ...statements, NAVIGATION].join(',')}});`
}

describe('the service worker check catches Supabase caching that does not name Supabase', () => {
  it.each([
    // runtimeCaching: [{ urlPattern: () => true, handler: 'NetworkFirst' }] — every GET, Supabase REST selects included
    ['a catch-all function matcher', 's.registerRoute((()=>!0),new s.NetworkFirst({cacheName:"all",plugins:[]}),"GET")'],
    // urlPattern: ({ url }) => url.origin !== self.location.origin — exactly the Supabase API in this app
    ['a "every other origin" function matcher', 's.registerRoute((({url:e})=>e.origin!==self.location.origin),new s.StaleWhileRevalidate({cacheName:"cross-origin",plugins:[]}),"GET")'],
    ['a RegExp built from a string', 's.registerRoute(new RegExp(".*"),new s.NetworkFirst({cacheName:"all"}),"GET")'],
    ['a Route object with a method matcher', 's.registerRoute(new s.Route((({request:e})=>"GET"===e.method),new s.CacheFirst({cacheName:"get"})))'],
  ])('%s', (_name, route) => {
    expect(analyzeServiceWorker(sw(route)).problems).not.toEqual([])
  })

  it('a background-sync queue for POSTs (would replay reserve_wish / cancel_reservation offline) is reported', () => {
    const queue = 's.registerRoute((()=>!0),new s.NetworkOnly({plugins:[new s.BackgroundSyncPlugin("rpc-queue",{maxRetentionTime:1440})]}),"POST")'
    expect(analyzeServiceWorker(sw(queue)).problems).not.toEqual([])
  })

  it('a default handler (caches every request no route matched — Supabase included) is reported', () => {
    expect(analyzeServiceWorker(sw('s.setDefaultHandler(new s.NetworkFirst({cacheName:"default"}))')).problems).not.toEqual([])
  })

  it('a precached Supabase REST URL (additionalManifestEntries) is reported', () => {
    const extra = 's.precacheAndRoute([{url:"https://abcdefghijklmnop.supabase.co/rest/v1/rpc/get_feed",revision:"1"}],{})'
    expect(analyzeServiceWorker(sw(extra)).problems).not.toEqual([])
  })

  it('a hand-written fetch handler that puts responses into Cache Storage is reported', () => {
    const handler = 'self.addEventListener("fetch",e=>{e.respondWith(caches.open("api").then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(n=>(c.put(e.request,n.clone()),n)))))})'
    expect(analyzeServiceWorker(sw(handler)).problems).not.toEqual([])
  })

  it('still accepts what the pilot ships (control)', () => {
    expect(analyzeServiceWorker(sw()).problems).toEqual([])
  })
})

// Felix 24.10: only Telegram Web may frame the app (Telegram Mini App, docs/spec/telegram-mini-app.md §3.1).
const TELEGRAM_WEB = 'frame-ancestors https://web.telegram.org https://webk.telegram.org https://weba.telegram.org'

describe('public/_headers refuses framing on every page, except by Telegram Web', () => {
  const lines = headers.split(/\r?\n/)

  /** header lines (trimmed) of every block whose path pattern matches `path` */
  function headersFor(path: string): string[] {
    const result: string[] = []
    let active = false
    for (const line of lines) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue
      if (!/^\s/.test(line)) {
        // a path block: Cloudflare's `*` splat matches any characters
        const escaped = line.trim().replace(/[.+?^$()|[\]\\{}]/g, '\\$&').replace(/\*/g, '.*')
        active = new RegExp('^' + escaped + '$').test(path)
        continue
      }
      if (active) result.push(line.trim())
    }
    return result
  }

  it.each(['/', '/i', '/soon', '/occasions/0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10', '/settings/export', '/legal/datenschutz', '/index.html'])(
    '%s gets frame-ancestors = Telegram Web only, and no block detaches or loosens it',
    (path) => {
      const applied = headersFor(path)
      // the policy line goes on with more directives (script-src …), so the frame-ancestors one ends at its ";"
      expect(applied.filter((line) => line.startsWith(`Content-Security-Policy: ${TELEGRAM_WEB};`))).toHaveLength(1)
      expect(applied.filter((line) => /^!\s*(Content-Security-Policy|X-Frame-Options)/i.test(line))).toEqual([])
      expect(applied.filter((line) => /^X-Frame-Options:/i.test(line))).toEqual([])
      expect(applied.filter((line) => /frame-ancestors/i.test(line) && !line.includes(`${TELEGRAM_WEB};`))).toEqual([])
    },
  )
})
