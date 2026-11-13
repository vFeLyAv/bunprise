import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import headers from '../../../public/_headers?raw'
import wrangler from '../../../../../workers/edge/wrangler.jsonc?raw'
import { analyzeServiceWorker } from '../../../scripts/sw-rules.mjs'

// ADVERSARIAL ROUND 2 — Codex review 2, M4 (built service worker) and L6 (framing), after round 1's
// repair made scripts/sw-rules.mjs "fail closed".
// (1) The CLI itself (node scripts/check-sw.mjs → exit code) on crafted dist/sw.js files: unmodified
//     copies of check-sw.mjs + sw-rules.mjs in a temp folder, a crafted dist/sw.js next to them.
// (2) What a fail-closed check must still refuse: code that answers or caches requests although it
//     sits inside a statement the check accepts by NAME (precacheAndRoute's options), and a runtime regex
//     that matches real project URLs but none of the check's samples. A passing problem list = a finding.
// (3) The framing headers reach every page (Workers static assets apply _headers only to asset
//     responses, not to responses of Worker code).
// No Node types in the app tsconfig: the CLI is reached through process.getBuiltinModule (Node ≥ 22.3).

interface SpawnResult { status: number | null; stdout: string; stderr: string }
interface NodeBuiltins {
  getBuiltinModule(id: 'node:child_process'): { spawnSync(command: string, args: string[], options: { encoding: 'utf8' }): SpawnResult }
  getBuiltinModule(id: 'node:fs'): {
    mkdtempSync(prefix: string): string
    mkdirSync(path: string, options: { recursive: true }): void
    copyFileSync(from: string, to: string): void
    writeFileSync(path: string, data: string): void
    rmSync(path: string, options: { recursive: true; force: true }): void
  }
  getBuiltinModule(id: 'node:os'): { tmpdir(): string }
  getBuiltinModule(id: 'node:path'): { join(...parts: string[]): string }
  execPath: string
  /** vitest runs with the web app as working directory (apps/web) */
  cwd(): string
}

const node = (globalThis as unknown as { process: NodeBuiltins }).process
const fs = node.getBuiltinModule('node:fs')
const path = node.getBuiltinModule('node:path')
const { spawnSync } = node.getBuiltinModule('node:child_process')

const PRECACHE = 's.precacheAndRoute([{url:"index.html",revision:"r1"},{url:"assets/shell-a1.js",revision:null}],{})'
const NAVIGATION = 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//,/^\\/auth\\/callback/]}))'

/** dist/sw.js as Workbox (generateSW, minified) writes it; `statements` replace the default body parts. */
function sw({ precache = PRECACHE, navigation = NAVIGATION, extra = [] as string[] } = {}): string {
  const body = [precache, 's.cleanupOutdatedCaches()', ...extra, navigation].join(',')
  return `if(!self.define){let s,e={};}define(["./workbox-2fbc6a65"],function(s){"use strict";self.addEventListener("message",s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()}),${body}});`
}

// ---- (1) the CLI on crafted files ---------------------------------------------------------------

let sandbox = ''

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(node.getBuiltinModule('node:os').tmpdir(), 'bunprise-sw-check-'))
  fs.mkdirSync(path.join(sandbox, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(sandbox, 'dist'), { recursive: true })
  for (const file of ['check-sw.mjs', 'sw-rules.mjs']) {
    fs.copyFileSync(path.join(node.cwd(), 'scripts', file), path.join(sandbox, 'scripts', file))
  }
})

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true })
})

function runCli(source: string): SpawnResult {
  fs.writeFileSync(path.join(sandbox, 'dist', 'sw.js'), source)
  return spawnSync(node.execPath, [path.join(sandbox, 'scripts', 'check-sw.mjs')], { encoding: 'utf8' })
}

describe('node scripts/check-sw.mjs on crafted dist/sw.js files', () => {
  it('passes what the pilot ships (control)', () => {
    const result = runCli(sw())
    expect(result.status).toBe(0)
  })

  it.each([
    ['runtimeCaching for Supabase REST (vite.config urlPattern on the project URL)', sw({ extra: ['s.registerRoute(/^https:\\/\\/abcdefghijklmnopqrst\\.supabase\\.co\\/rest\\/v1\\/.*/i,new s.NetworkFirst({cacheName:"api",plugins:[]}),"GET")'] }), /runtime route mentions Supabase REST\/auth/],
    ['navigateFallbackDenylist without /auth/callback', sw({ navigation: 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//]}))' }), /denylist does not exclude \/auth\/callback/],
    ['a "tightened" callback rule that misses ?code= (/^\\/auth\\/callback$/)', sw({ navigation: 's.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\\/api\\//,/^\\/auth\\/callback$/]}))' }), /denylist does not exclude \/auth\/callback/],
    ['importScripts option (code the check cannot see)', sw({ extra: ['importScripts("sw-extra.js")'] }), /unexpected statement in sw\.js.*importScripts/],
    ['additionalManifestEntries with an absolute Supabase URL', sw({ precache: 's.precacheAndRoute([{url:"index.html",revision:"r1"},{url:"https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/get_feed",revision:"1"}],{})' }), /precached URL of another origin/],
    ['a truncated file', sw().slice(0, 200), /could not read/],
  ])('fails (exit 1) for %s — for that very reason, not a parse error of the crafted file', (_name, source, reason) => {
    const result = runCli(source)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(reason)
  })
})

// ---- (2) inside statements the check accepts by name ------------------------------------------

describe('fail closed also inside the reviewed statements (hand-edited sw.js)', () => {
  it("precacheAndRoute's options with a urlManipulation that maps every URL — /auth/callback?code=… and /api/* included — to the precached index.html", () => {
    // Workbox tries the URL variations of urlManipulation BEFORE the navigation route sees the request:
    // the OAuth return is answered from the cache although the denylist names it.
    const precache = 's.precacheAndRoute([{url:"index.html",revision:"r1"}],{urlManipulation:({url:e})=>[new URL("/index.html",e.href)]})'
    expect(analyzeServiceWorker(sw({ precache })).problems).not.toEqual([])
  })

  it('a runtime regex that matches a real (20-character) Supabase project ref from the first character', () => {
    // the samples use a 16-character ref, so this pattern matches none of them — but every real project URL;
    // Workbox serves a cross-origin request through it because the match starts at index 0 (REST GETs such as
    // getWish / getMyConsents would land in Cache Storage, which sign-out never clears)
    const route = 's.registerRoute(/^\\w+:\\W\\W\\w{20}\\.\\w+\\.co\\//,new s.StaleWhileRevalidate({cacheName:"x"}),"GET")'
    const pattern = /^\w+:\W\W\w{20}\.\w+\.co\//
    expect(pattern.test('https://abcdefghijklmnopqrst.supabase.co/rest/v1/wishes?select=id')).toBe(true) // control
    expect(analyzeServiceWorker(sw({ extra: [route] })).problems).not.toEqual([])
  })
})

// ---- (3) framing headers on every page -------------------------------------------------------------

// Felix 24.10: the app also runs as a Telegram Mini App; Telegram Web shows it in an iframe, so exactly Telegram
// Web's origins may frame it (docs/spec/telegram-mini-app.md §3.1). Every other ancestor is still refused.
// The same line carries the rest of the first-deploy CSP (scripts only from our origin; Codex review 24.10).
const TELEGRAM_FRAME_ANCESTORS =
  "Content-Security-Policy: frame-ancestors https://web.telegram.org https://webk.telegram.org https://weba.telegram.org; script-src 'self'; object-src 'none'; base-uri 'none'"

describe('L6: framing is refused on every page the app serves, except by Telegram Web', () => {
  const lines = headers.split(/\r?\n/)

  function headersFor(urlPath: string): string[] {
    const result: string[] = []
    let active = false
    for (const line of lines) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue
      if (!/^\s/.test(line)) {
        const escaped = line.trim().replace(/[.+?^$()|[\]\\{}]/g, '\\$&').replace(/\*/g, '.*')
        active = new RegExp('^' + escaped + '$').test(urlPath)
        continue
      }
      if (active) result.push(line.trim())
    }
    return result
  }

  it.each(['/', '/soon', '/i', '/auth/callback', '/assets/shell-a1.js', '/sw.js', '/manifest.webmanifest', '/legal/impressum'])(
    '%s: frame-ancestors = exactly Telegram Web, one policy line, no rule that loosens or detaches it',
    (urlPath) => {
      const applied = headersFor(urlPath)
      // one CSP line only: Cloudflare joins duplicate headers from several rules with a comma (two policies)
      expect(applied.filter((line) => line.startsWith('Content-Security-Policy'))).toEqual([TELEGRAM_FRAME_ANCESTORS])
      // only the frame-ancestors directive itself (up to the next ";"): no wildcard, no 'self', no plain http
      expect(applied.join('\n')).not.toMatch(/frame-ancestors[^;\n]*(\*|'self'|http:)/)
      expect(applied.filter((line) => line.startsWith('X-Frame-Options'))).toEqual([])
      expect(applied.filter((line) => line.startsWith('!'))).toEqual([])
    },
  )

  it('pages never run through Worker code (where _headers does not apply): run_worker_first stays /api/* only', () => {
    const config = wrangler.replace(/^\s*\/\/.*$/gm, '')
    const match = /"run_worker_first"\s*:\s*(\[[^\]]*\]|true|false)/.exec(config)
    expect(match?.[1]?.replace(/\s/g, '')).toBe('["/api/*"]')
    expect(config).toMatch(/"not_found_handling"\s*:\s*"single-page-application"/)
  })
})
