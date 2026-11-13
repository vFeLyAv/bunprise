import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEEP_ON_SIGN_OUT, storageKeys } from './app'

// The colour theme of this device (Felix 25.10): System (default) · Hell · Dunkel, Telegram's scheme while nothing
// is chosen, the browser-bar colour in step. lib/themeBoot.ts pins it before the first frame, lib/theme.ts chooses
// and follows. Each case loads fresh modules (they keep module state: this visit's choice, the listeners).

type MediaListener = () => void
let systemDark = false
const mediaListeners = new Set<MediaListener>()

function installMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('dark') ? systemDark : !systemDark },
    media: query,
    addEventListener: (_type: string, listener: MediaListener) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: MediaListener) => mediaListeners.delete(listener),
  }))
}

function setSystemDark(dark: boolean): void {
  systemDark = dark
  for (const listener of mediaListeners) listener()
}

/** the two theme-color tags of index.html */
function addMetaTags(): void {
  document.head.innerHTML = `
    <meta name="theme-color" content="#F5EEE2" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1C1612" media="(prefers-color-scheme: dark)">`
}
const metaColors = () => Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map((m) => m.content)

async function loadTheme() {
  vi.resetModules()
  return import('./theme')
}
async function loadBoot() {
  vi.resetModules()
  return import('./themeBoot')
}

describe('colour theme', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    systemDark = false
    mediaListeners.clear()
    installMatchMedia()
    addMetaTags()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('System by default: nothing pinned on <html>, the CSS follows the system; the bar colours stay per scheme', async () => {
    const { applyTheme } = await loadBoot()
    applyTheme()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(metaColors()).toEqual(['#F5EEE2', '#1C1612'])
    const { readThemePreference, currentTheme } = await loadTheme()
    expect(readThemePreference()).toBe('system')
    expect(currentTheme()).toBe('light')
  })

  it('choosing Dunkel is stored on this device, pinned on <html> and gives both bar tags the night colour', async () => {
    const { setThemePreference, readThemePreference } = await loadTheme()
    setThemePreference('dark')
    expect(localStorage.getItem('bunprise.theme')).toBe('dark')
    expect(readThemePreference()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(metaColors()).toEqual(['#1C1612', '#1C1612'])
    // a reload: the boot module alone pins it again before anything renders
    document.documentElement.removeAttribute('data-theme')
    const { applyTheme } = await loadBoot()
    applyTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('back to System forgets the choice and unpins', async () => {
    const { setThemePreference } = await loadTheme()
    setThemePreference('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    setThemePreference('system')
    expect(localStorage.getItem('bunprise.theme')).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(metaColors()).toEqual(['#F5EEE2', '#1C1612'])
  })

  it('System follows the operating system live (listeners hear the new theme)', async () => {
    const { onThemeChange, currentTheme } = await loadTheme()
    const heard: string[] = []
    onThemeChange((theme) => heard.push(theme))
    setSystemDark(true)
    expect(currentTheme()).toBe('dark')
    expect(heard).toEqual(['dark'])
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false) // still the CSS's job
    setSystemDark(false)
    expect(heard).toEqual(['dark', 'light'])
  })

  it('a chosen theme wins over the system', async () => {
    systemDark = true
    const { setThemePreference, currentTheme } = await loadTheme()
    setThemePreference('light')
    expect(currentTheme()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it("inside Telegram, Telegram's scheme counts while nothing is chosen; a choice wins over it", async () => {
    sessionStorage.setItem(storageKeys.telegramScheme, 'dark')
    const boot = await loadBoot()
    boot.applyTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    const { setThemePreference, setTelegramScheme, currentTheme } = await loadTheme()
    setTelegramScheme('light') // Telegram switched to day
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    setThemePreference('dark')
    setTelegramScheme('light')
    expect(currentTheme()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it.each([['navy', '#131A2D'], ['ocean', '#15191F'], ['black', '#000000']] as const)('%s (Blau / Ozean / Schwarz): its stylesheet first, then pinned with its bar colour; a reload pins it before the first render', async (theme, top) => {
    const { setThemePreference, readThemePreference, currentTheme } = await loadTheme()
    setThemePreference(theme)
    expect(localStorage.getItem('bunprise.theme')).toBe(theme)
    expect(readThemePreference()).toBe(theme)
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe(theme))
    expect(metaColors()).toEqual([top, top])
    expect(currentTheme()).toBe(theme)
    document.documentElement.removeAttribute('data-theme')
    const boot = await loadBoot()
    const styles = boot.applyTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe(theme)
    await expect(styles).resolves.not.toThrow()
  })

  it('a quick change after an extra theme wins: its late stylesheet never pins it over the newer choice', async () => {
    const { setThemePreference } = await loadTheme()
    const { loadThemeStyles } = await import('./themeBoot') // the very instance lib/theme.ts uses
    setThemePreference('ocean')
    setThemePreference('light')
    await loadThemeStyles('ocean')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(metaColors()).toEqual(['#F5EEE2', '#F5EEE2'])
  })

  it('storage blocked: the choice still holds for this visit', async () => {
    const { setThemePreference, readThemePreference } = await loadTheme()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    setThemePreference('dark')
    expect(readThemePreference()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('the choice survives sign-out like the language; Telegram\'s scheme survives the session drafts cleanup', async () => {
    expect(KEEP_ON_SIGN_OUT).toContain('bunprise.theme')
    sessionStorage.setItem(storageKeys.telegramScheme, 'dark')
    sessionStorage.setItem('bunprise.loginDraft', 'x')
    const { clearSessionDrafts } = await import('./query')
    clearSessionDrafts()
    expect(sessionStorage.getItem(storageKeys.telegramScheme)).toBe('dark')
    expect(sessionStorage.getItem('bunprise.loginDraft')).toBeNull()
  })
})

// No flash of the wrong theme: CSP forbids inline scripts, so the theme goes onto <html> from public/boot.js before the
// first paint (the launch screen, lib/splash.test.ts) and again from the entry module — right after the Telegram
// detection, before anything renders.
describe('theme boot order', () => {
  interface NodeFs { readFileSync(path: string, encoding: 'utf8'): string; existsSync(path: string): boolean }
  const nodeProcess = (globalThis as { process?: { cwd(): string; getBuiltinModule?: (id: string) => unknown } }).process
  const fs = nodeProcess?.getBuiltinModule?.('node:fs') as NodeFs | undefined
  const root = [nodeProcess?.cwd() ?? '', `${nodeProcess?.cwd() ?? ''}/apps/web`].find((dir) => fs?.existsSync(`${dir}/src/main.tsx`)) ?? ''
  const read = (file: string) => fs?.readFileSync(`${root}/${file}`, 'utf8') ?? ''

  it('main.tsx: detect first, the theme boot second, and applyTheme() is the first thing boot() does', () => {
    const main = read('src/main.tsx')
    const imports = [...main.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    expect(imports.slice(0, 2)).toEqual(['./lib/telegram/detect', './lib/themeBoot'])
    const boot = main.slice(main.indexOf('async function boot()'))
    // the first statement: applyTheme() (its promise kept for later)
    const firstCall = /\n\s+(?:const themed = )?([a-zA-Z]+)\(\)/.exec(boot)?.[1]
    expect(firstCall).toBe('applyTheme')
    expect(boot.indexOf('applyTheme()')).toBeLessThan(boot.indexOf('createRoot('))
    // the Blau / Ozean stylesheet is in before the first frame
    expect(boot.indexOf('await themed')).toBeGreaterThan(0)
    expect(boot.indexOf('await themed')).toBeLessThan(boot.indexOf('createRoot('))
  })

  it('index.html: one theme-color per system scheme and color-scheme "light dark" (System works without JS)', () => {
    const html = read('index.html')
    expect(html).toMatch(/<meta name="theme-color" content="#F5EEE2" media="\(prefers-color-scheme: light\)"/)
    expect(html).toMatch(/<meta name="theme-color" content="#1C1612" media="\(prefers-color-scheme: dark\)"/)
    expect(html).toMatch(/<meta name="color-scheme" content="light dark"/)
  })

  it('tokens.css: no attribute = the system decides; data-theme pins light (no browser auto-darkening) or dark', () => {
    const tokens = read('src/styles/tokens.css')
    expect(tokens).toMatch(/:root \{ color-scheme: light dark; \}/)
    expect(tokens).toMatch(/:root\[data-theme="light"\] \{ color-scheme: only light; \}/)
    expect(tokens).toMatch(/:root\[data-theme="dark"\] \{ color-scheme: dark; \}/)
    expect(tokens).toMatch(/:root\[data-theme="navy"\] \{ color-scheme: dark; \}/)
    expect(tokens).toMatch(/:root\[data-theme="ocean"\] \{ color-scheme: dark; \}/)
    expect(tokens).toMatch(/:root\[data-theme="black"\] \{ color-scheme: dark; \}/)
  })

  it('black.css: a true-black page with no glows and no grain; bars, sheets, capsules and toast solid with no blur (it shows nothing on black)', () => {
    const css = read('src/styles/black.css')
    expect(css).toMatch(/--bg: #000;/)
    for (const token of ['--page-top', '--page-mid', '--page-bottom', '--theme-color']) expect(css).toContain(`${token}: #000;`)
    expect(css).toContain('--page-grain: none;')
    for (const material of ['--bar-bg', '--sheet-bg', '--float-bg', '--toast-bg']) expect(css).toMatch(new RegExp(`${material}: #[0-9A-F]{6};`))
    for (const blur of ['--bar-backdrop', '--sheet-backdrop', '--float-backdrop', '--toast-backdrop']) expect(css).toContain(`${blur}: none;`)
  })

  it.each(['navy', 'ocean', 'black'])('%s.css: every rule under its data-theme, loaded only through import() (never in the first screens)', (theme) => {
    const css = read(`src/styles/${theme}.css`).replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? '').trim())
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) expect(selector.startsWith(`:root[data-theme="${theme}"]`)).toBe(true)
    // one stylesheet for both extra themes, one import() for it
    expect(read('src/styles/extraThemes.css')).toContain(`@import "./${theme}.css";`)
    expect(read('src/lib/themeBoot.ts')).toContain(`import('../styles/extraThemes.css')`)
    expect(read('src/styles/index.css')).not.toContain(theme)
    expect(read('src/styles/index.css')).not.toContain('extraThemes')
  })
})
