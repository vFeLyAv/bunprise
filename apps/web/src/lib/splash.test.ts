import { describe, expect, it } from 'vitest'

// The launch screen in the app (Felix 26.10, docs/design/2026-10-26-splash.md): index.html carries the gallery's
// snippet verbatim, public/boot.js pins the theme before it paints, main.tsx lets it leave. The gallery keeps
// identical copies of the snippet, boot.js and lib/splash.ts — the behaviour tests run there
// (packages/mascot/test/splash.test.ts), so these copies must not drift apart.

interface NodeFs { readFileSync(path: string, encoding: 'utf8'): string; existsSync(path: string): boolean }
const nodeProcess = (globalThis as { process?: { cwd(): string; getBuiltinModule?: (id: string) => unknown } }).process
const fs = nodeProcess?.getBuiltinModule?.('node:fs') as NodeFs | undefined
const root = [nodeProcess?.cwd() ?? '', `${nodeProcess?.cwd() ?? ''}/apps/web`].find((dir) => fs?.existsSync(`${dir}/src/main.tsx`)) ?? ''
const read = (file: string) => fs?.readFileSync(`${root}/${file}`, 'utf8') ?? ''
const GALLERY = '../../packages/mascot/demo/splash'

describe('launch screen in the app', () => {
  const html = read('index.html')
  const snippet = read(`${GALLERY}/splash.html`)
  const cut = snippet.indexOf('</style>') + '</style>'.length
  const style = snippet.slice(0, cut)
  const markup = snippet.slice(cut).replace(/^\n/, '')

  it('index.html: the gallery snippet verbatim — its <style> in <head>, its element first in <body>', () => {
    expect(snippet).toContain('id="bp-splash"')
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toContain(style)
    // the tag itself, not the words "<body>" in the snippet's comment
    const body = html.slice(html.indexOf('\n  <body>\n') + '\n  <body>\n'.length)
    expect(body.startsWith(markup)).toBe(true)
    expect(body.indexOf('<div id="root">')).toBeGreaterThan(markup.length - 1)
  })

  it('index.html: boot.js is a classic same-origin script before the splash styles; no inline script (CSP)', () => {
    expect(html).toMatch(/<script src="\/boot\.js"><\/script>/)
    expect(html.indexOf('/boot.js')).toBeLessThan(html.indexOf('<style>'))
    // every <script> has a src (the CSP allows only files of our own origin)
    for (const tag of html.match(/<script[^>]*>/g) ?? []) expect(tag).toMatch(/\ssrc="\//)
    expect(read('public/_headers')).toContain("script-src 'self';")
  })

  it('public/boot.js and lib/splash.ts are the gallery copies, byte for byte', () => {
    expect(read('public/boot.js')).not.toBe('')
    expect(read('public/boot.js')).toBe(read(`${GALLERY}/boot.js`))
    expect(read('src/lib/splash.ts')).not.toBe('')
    expect(read('src/lib/splash.ts')).toBe(read(`${GALLERY}/controller.ts`))
  })

  // "Schwarz" (27.10): boot.js pins it before the first paint, with a black browser bar; the splash knows its colours
  it('public/boot.js: "black" pins the theme and a black browser bar; other themes leave the bar to lib/theme.ts', () => {
    expect(html).not.toContain('boot-black')
    expect(html.slice(0, html.indexOf('</head>'))).toMatch(/:root\[data-theme=black\] #bp-splash\{--t:#000;--m:#000;--b:#000;/)
    const run = new Function(read('public/boot.js')) as () => void
    document.head.innerHTML = '<meta name="theme-color" content="#F5EEE2" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1C1612" media="(prefers-color-scheme: dark)">'
    const colours = () => Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((meta) => meta.getAttribute('content'))
    try {
      localStorage.setItem('bunprise.theme', 'navy')
      document.documentElement.setAttribute('data-theme', 'navy')
      run()
      expect(document.documentElement.getAttribute('data-theme')).toBe('navy')
      expect(colours()).toEqual(['#F5EEE2', '#1C1612'])
      localStorage.setItem('bunprise.theme', 'black')
      run()
      expect(document.documentElement.getAttribute('data-theme')).toBe('black')
      expect(colours()).toEqual(['#000000', '#000000'])
    } finally {
      localStorage.removeItem('bunprise.theme')
      document.documentElement.removeAttribute('data-theme')
      document.head.innerHTML = ''
    }
  })

  it('main.tsx: the splash leaves after the first screen is painted, and drops at once on a boot error', () => {
    const main = read('src/main.tsx')
    const boot = main.slice(main.indexOf('async function boot()'), main.indexOf('boot().catch('))
    expect(boot).toContain('void exitSplashWhenReady({ painted: firstScreen })')
    expect(boot.indexOf('const firstScreen = whenFirstScreenPainted()')).toBeLessThan(boot.indexOf('exitSplashWhenReady('))
    const onError = main.slice(main.indexOf('boot().catch('))
    expect(onError.indexOf('removeSplashNow()')).toBeGreaterThan(0)
    expect(onError.indexOf('removeSplashNow()')).toBeLessThan(onError.indexOf('container.textContent'))
  })

  it('the feed cover placeholder counts as loading before its lazy half is there', () => {
    expect(read('src/features/feed/FeedCover.tsx')).toContain('<span aria-hidden="true" className="feed-cover" data-state="loading" />')
  })

  it('the tab bar is no view-transition layer while the splash is up (a named layer is painted above it)', () => {
    expect(read('src/features/nav/nav.css')).toContain('html:has(#bp-splash) .tabbar { view-transition-name: none; }')
  })
})
