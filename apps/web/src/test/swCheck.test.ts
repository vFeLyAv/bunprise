import { describe, expect, it } from 'vitest'
import headers from '../../public/_headers?raw'
import { analyzeServiceWorker, registerRouteCalls } from '../../scripts/sw-rules.mjs'

// The rules of scripts/check-sw.mjs (run on dist/sw.js after every build in `npm run check`) and the
// static response headers (Codex review 2: M4, L6). Inputs are written the way Workbox minifies sw.js.

const PRECACHE = 's.precacheAndRoute([{url:"index.html",revision:"r1"},{url:"assets/shell-a1.js",revision:null}],{}),s.cleanupOutdatedCaches()'
const NAVIGATION = 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//,/^\\/auth\\/callback/]}))'

function sw(...routes: string[]): string {
  return `if(!self.define){let s,e={};}define(["./workbox-2fbc6a65"],function(s){"use strict";self.addEventListener("message",s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()}),${[PRECACHE, ...routes].join(',')}});`
}

describe('service worker rules (scripts/sw-rules.mjs)', () => {
  it('accepts what the pilot ships: no runtime caching, /api/ and /auth/callback outside the fallback', () => {
    const result = analyzeServiceWorker(sw(NAVIGATION))
    expect(result.problems).toEqual([])
    expect(result.runtimeRoutes).toBe(0)
    expect(result.denylist).toEqual(['/^\\/api\\//', '/^\\/auth\\/callback/'])
    expect(registerRouteCalls(sw(NAVIGATION))).toHaveLength(1)
  })

  it('accepts a harmless runtime route (static images)', () => {
    const images = 's.registerRoute(/\\.(?:png|webp)$/,new s.CacheFirst({cacheName:"images",plugins:[]}),"GET")'
    expect(analyzeServiceWorker(sw(images, NAVIGATION)).problems).toEqual([])
  })

  it.each([
    ['a regex for the Supabase project', 's.registerRoute(/^https:\\/\\/[a-z]+\\.supabase\\.co\\/.*/i,new s.NetworkFirst({cacheName:"api",plugins:[]}),"GET")'],
    ['a regex for REST paths on any host', 's.registerRoute(/\\/rest\\/v1\\//,new s.StaleWhileRevalidate({cacheName:"rest"}),"GET")'],
    ['a catch-all regex', 's.registerRoute(/.*/,new s.NetworkFirst({cacheName:"all"}),"GET")'],
    ['a function matching the auth API', 's.registerRoute(({url:e})=>e.pathname.startsWith("/auth/v1"),new s.NetworkOnly,"POST")'],
    ['a string route under /rest/', 's.registerRoute("/rest/v1/rpc/get_feed",new s.NetworkFirst({cacheName:"feed"}),"POST")'],
  ])('fails for a runtime route that would cache Supabase REST/auth: %s', (_case, route) => {
    const { problems } = analyzeServiceWorker(sw(route, NAVIGATION))
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toMatch(/runtime route/)
  })

  it.each([
    ['without /auth/callback', 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//]}))', '/auth/callback'],
    ['without /api/', 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/auth\\/callback/]}))', '/api/'],
    ['without any denylist', 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html")))', 'no denylist'],
  ])('fails for a navigation fallback %s', (_case, navigation, expected) => {
    expect(analyzeServiceWorker(sw(navigation)).problems.join('\n')).toContain(expected)
  })

  it('fails closed when the fallback is missing or the file cannot be read', () => {
    expect(analyzeServiceWorker(sw()).problems.join('\n')).toMatch(/exactly one navigation fallback/)
    expect(analyzeServiceWorker('s.registerRoute(new s.NavigationRoute("/index.html",{denylist:[/^\\/api').problems.join('\n'))
      .toMatch(/could not read/)
  })
})

describe('service worker rules fail closed (adversarial round 1; more shapes in attack/round1-sw-headers)', () => {
  it.each([
    ['a third-party script', 'importScripts("https://cdn.example.test/sw-extra.js")'],
    ['offline Google Analytics (queues hits for later)', 's.initialize({})'],
    ['navigation preload (not reviewed yet)', 's.enable()'],
    ['a catch handler', 's.setCatchHandler(({request:e})=>caches.match(e))'],
  ])('refuses a statement outside the reviewed Workbox setup: %s', (_case, statement) => {
    expect(analyzeServiceWorker(sw(statement, NAVIGATION)).problems.join('\n')).toMatch(/unexpected statement/)
  })

  it('refuses code outside the Workbox define(…) block', () => {
    expect(analyzeServiceWorker(`${sw(NAVIGATION)}self.importScripts("x.js");`).problems.join('\n')).toMatch(/code after the Workbox define/)
    expect(analyzeServiceWorker(`self.foo=1;${sw(NAVIGATION)}`).problems.join('\n')).toMatch(/code before the Workbox define/)
  })

  it('accepts a same-origin path route (GET) and refuses the same route for an absolute URL', () => {
    const local = 's.registerRoute("/manifest.webmanifest",new s.NetworkFirst({cacheName:"manifest"}),"GET")'
    expect(analyzeServiceWorker(sw(local, NAVIGATION)).problems).toEqual([])
    const remote = 's.registerRoute("https://cdn.example.test/lib.js",new s.CacheFirst({cacheName:"cdn"}),"GET")'
    expect(analyzeServiceWorker(sw(remote, NAVIGATION)).problems.join('\n')).toMatch(/absolute URL/)
  })

  it.each([
    ['matches other origins from their first character', 's.registerRoute(/.*\\.png$/,new s.CacheFirst({cacheName:"png"}),"GET")', /another origin/],
    ['names a host', 's.registerRoute(/^https:\\/\\/cdn\\.example\\.test\\//,new s.CacheFirst({cacheName:"cdn"}),"GET")', /absolute URL/],
    ['is registered for POST', 's.registerRoute(/\\.(?:png|webp)$/,new s.NetworkOnly,"POST")', /POST/],
  ])('refuses a regex runtime route that %s', (_case, route, expected) => {
    expect(analyzeServiceWorker(sw(route, NAVIGATION)).problems.join('\n')).toMatch(expected)
  })

  it('accepts the build files of this origin in the precache and refuses a protocol-relative URL', () => {
    const own = 's.precacheAndRoute([{url:"assets/supabaseClient-x1.js",revision:null},{url:"auth.callback-x2.js",revision:"r"}],{})'
    expect(analyzeServiceWorker(sw(own, NAVIGATION)).problems).toEqual([]) // chunk names are not Supabase traffic
    const other = 's.precacheAndRoute([{url:"//abcdefghijklmnop.supabase.co/auth/v1/user",revision:"1"}],{})'
    expect(analyzeServiceWorker(sw(other, NAVIGATION)).problems.join('\n')).toMatch(/precached URL of another origin/)
  })
})

describe('static response headers (public/_headers)', () => {
  /** The header lines of one path block. */
  function block(path: string): string[] {
    const lines = headers.split(/\r?\n/)
    const start = lines.findIndex((line) => line.trim() === path && !line.startsWith(' '))
    if (start === -1) return []
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((line) => line.trim() !== '' && !line.startsWith(' '))
    return (end === -1 ? rest : rest.slice(0, end)).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  }

  it('allows framing on every page only for Telegram Web (clickjacking): CSP frame-ancestors, no X-Frame-Options', () => {
    expect(block('/*')).toEqual(expect.arrayContaining([
      "Content-Security-Policy: frame-ancestors https://web.telegram.org https://webk.telegram.org https://weba.telegram.org; script-src 'self'; object-src 'none'; base-uri 'none'",
      'X-Content-Type-Options: nosniff',
      'Referrer-Policy: no-referrer',
    ]))
    expect(block('/*').filter((line) => line.startsWith('X-Frame-Options'))).toEqual([])
  })
})
