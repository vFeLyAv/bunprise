import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ICONS, APP_ICON_VARIANTS, appIconLinks, appIconManifestIcons, isAppIcon, variantManifest } from './appIconVariants'
import { APP_ICON_KEY, appIconHint, applyAppIcon, readAppIcon, setAppIcon } from './appIconChoice'
import { AppIconPicker } from './AppIconPicker'

// Einstellungen → App-Symbol (Felix 27.10, docs/handoffs/2026-10-27-app-icons.md): the variants and their files, the
// stored choice, public/boot.js linking it on every load, the picker, and what never changes for everyone else.

interface NodeFs {
  readFileSync(path: string, encoding?: 'utf8'): string & { readUInt32BE?: never }
  existsSync(path: string): boolean
  readdirSync(path: string): string[]
}
interface NodeBuffer { length: number; toString(encoding: string, start: number, end: number): string; readUInt32BE(offset: number): number }
const nodeProcess = (globalThis as { process?: { cwd(): string; getBuiltinModule?: (id: string) => unknown } }).process
const fs = nodeProcess?.getBuiltinModule?.('node:fs') as (NodeFs & { readFileSync(path: string): NodeBuffer }) | undefined
const root = [nodeProcess?.cwd() ?? '', `${nodeProcess?.cwd() ?? ''}/apps/web`].find((dir) => fs?.existsSync(`${dir}/src/main.tsx`)) ?? ''
const read = (file: string): string => (fs ? String(fs.readFileSync(`${root}/${file}`, 'utf8')) : '')

/** width × height from a PNG's IHDR chunk */
function pngSize(file: string): string | null {
  const bytes = fs?.readFileSync(`${root}/${file}`) as NodeBuffer | undefined
  if (!bytes || bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') return null
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

/** The page's three links as index.html has them (the default icon). */
function defaultLinks(): void {
  document.head.querySelectorAll('link').forEach((link) => link.remove())
  document.head.insertAdjacentHTML('beforeend', '<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">')
}
const href = (rel: string): string | null => document.querySelector(`link[rel="${rel}"]`)?.getAttribute('href') ?? null

beforeEach(() => {
  localStorage.clear()
  defaultLinks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('the variants and their files', () => {
  it('twelve choices, the classic one first; eleven with files of their own', () => {
    expect(APP_ICONS).toHaveLength(12)
    expect(APP_ICONS[0]).toBe('classic')
    expect(new Set(APP_ICONS).size).toBe(APP_ICONS.length)
    expect(APP_ICON_VARIANTS).toEqual(APP_ICONS.slice(1))
    expect(isAppIcon('night')).toBe(true)
    expect(isAppIcon('pink')).toBe(false)
    expect(isAppIcon(null)).toBe(false)
  })

  it('every variant has its vector, its four manifest PNGs and a 180 px Apple touch icon (and nothing stale is left)', () => {
    expect(fs).toBeDefined()
    expect(fs?.readdirSync(`${root}/public/icons/variants`).sort()).toEqual([...APP_ICON_VARIANTS].sort())
    for (const id of APP_ICON_VARIANTS) {
      for (const icon of appIconManifestIcons(id)) expect(pngSize(`public${icon.src}`), icon.src).toBe(icon.sizes)
      expect(pngSize(`public${appIconLinks(id).appleTouchIcon}`)).toBe('180x180')
      expect(read(`public${appIconLinks(id).icon}`)).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1024 1024"/)
    }
  })

  it('the classic choice is exactly what index.html links (choosing it back restores the default)', () => {
    const html = read('index.html')
    const classic = appIconLinks('classic')
    expect(html).toContain(`<link rel="icon" href="${classic.icon}" type="image/svg+xml" />`)
    expect(html).toContain(`<link rel="apple-touch-icon" href="${classic.appleTouchIcon}" />`)
    expect(classic.manifest).toBe('/manifest.webmanifest')
  })

  it('a variant manifest is the default one with only the icons swapped: the same id, start_url and scope', () => {
    const base = { name: 'Bunprise', id: '/', start_url: '/', scope: '/', display: 'standalone', theme_color: '#F5EEE2', icons: [{ src: '/icons/icon-192.png' }] }
    const night = variantManifest(base, 'night')
    expect({ ...night, icons: base.icons }).toEqual(base)
    expect(night.icons).toEqual(appIconManifestIcons('night'))
    expect(appIconManifestIcons('night').map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable'])
    expect(appIconLinks('night').manifest).toBe('/icons/variants/night/manifest.webmanifest')
  })

  it('the service worker never precaches them (vite.config.ts globIgnores; scripts/check-sw.mjs fails the build otherwise)', () => {
    const config = read('vite.config.ts')
    expect(config).toMatch(/globIgnores: \[[^\]]*'icons\/variants\/\*\*'/)
    expect(config).toContain('appIconManifests()')
    expect(read('scripts/check-sw.mjs')).toContain('icons\\/variants\\/')
    expect(read('package.json')).toContain('node scripts/check-app-icons.mjs')
  })
})

describe('the stored choice (localStorage, outside the account prefix)', () => {
  it('saves a variant, forgets the classic one, ignores anything unknown', () => {
    expect(readAppIcon()).toBe('classic')
    setAppIcon('ocean')
    expect(localStorage.getItem(APP_ICON_KEY)).toBe('ocean')
    expect(readAppIcon()).toBe('ocean')
    setAppIcon('classic')
    expect(localStorage.getItem(APP_ICON_KEY)).toBeNull()
    localStorage.setItem(APP_ICON_KEY, 'pink')
    expect(readAppIcon()).toBe('classic')
  })

  it('links the chosen manifest, Apple touch icon and tab icon at once, and the default ones back', () => {
    setAppIcon('christmas')
    expect(href('manifest')).toBe('/icons/variants/christmas/manifest.webmanifest')
    expect(href('apple-touch-icon')).toBe('/icons/variants/christmas/apple-touch-icon.png')
    expect(href('icon')).toBe('/icons/variants/christmas/icon.svg')
    setAppIcon('classic')
    expect(href('manifest')).toBe('/manifest.webmanifest')
    expect(href('apple-touch-icon')).toBe('/apple-touch-icon.png')
    expect(href('icon')).toBe('/icons/icon.svg')
  })

  it('a page without a manifest link (dev server) only gets the links it has', () => {
    document.querySelector('link[rel="manifest"]')?.remove()
    applyAppIcon('mono')
    expect(document.querySelector('link[rel="manifest"]')).toBeNull()
    expect(href('icon')).toBe('/icons/variants/mono/icon.svg')
  })

  it('blocked storage: the choice holds for this visit', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => setAppIcon('night')).not.toThrow()
    expect(readAppIcon()).toBe('night')
    expect(href('manifest')).toBe('/icons/variants/night/manifest.webmanifest')
    vi.restoreAllMocks()
    setAppIcon('classic')
  })

  it('survives sign-out, like the theme (the key is not under bunprise.)', async () => {
    const { clearLocalState } = await import('../../lib/query')
    setAppIcon('summer')
    localStorage.setItem('bunprise.haptics', '1')
    clearLocalState()
    expect(localStorage.getItem('bunprise.haptics')).toBeNull()
    expect(localStorage.getItem(APP_ICON_KEY)).toBe('summer')
    expect(APP_ICON_KEY.startsWith('bunprise.')).toBe(false)
  })
})

describe('public/boot.js (links the choice on every page load)', () => {
  const BOOT = read('public/boot.js')
  const run = (): void => {
    new Function(BOOT)()
    document.dispatchEvent(new Event('DOMContentLoaded'))
  }

  it('knows exactly the variants of appIconVariants.ts', () => {
    const list = /\/\^\(([a-z|]+)\)\$\/\.test\(icon/.exec(BOOT)?.[1]
    expect(list?.split('|')).toEqual([...APP_ICON_VARIANTS])
    expect(BOOT).toContain(`localStorage.getItem('${APP_ICON_KEY}')`)
  })

  it('swaps the three links once the document is parsed; nothing for the classic or an unknown value', () => {
    localStorage.setItem(APP_ICON_KEY, 'halloween')
    run()
    expect(href('manifest')).toBe('/icons/variants/halloween/manifest.webmanifest')
    expect(href('apple-touch-icon')).toBe('/icons/variants/halloween/apple-touch-icon.png')
    expect(href('icon')).toBe('/icons/variants/halloween/icon.svg')
    for (const value of ['classic', '../../evil', 'night/../x', 'NIGHT']) {
      defaultLinks()
      localStorage.setItem(APP_ICON_KEY, value)
      run()
      expect(href('manifest')).toBe('/manifest.webmanifest')
      expect(href('apple-touch-icon')).toBe('/apple-touch-icon.png')
    }
  })

  it('the variant boot.js links is the one the picker links (same paths)', () => {
    for (const id of APP_ICON_VARIANTS) {
      defaultLinks()
      localStorage.setItem(APP_ICON_KEY, id)
      run()
      const links = appIconLinks(id)
      expect([href('manifest'), href('apple-touch-icon'), href('icon')]).toEqual([links.manifest, links.appleTouchIcon, links.icon])
    }
  })

  it('blocked storage: no error, the default icon', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(run).not.toThrow()
    expect(href('manifest')).toBe('/manifest.webmanifest')
  })
})

describe('the honest hint', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
  const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0'
  const at = (userAgent: string, more: Partial<{ maxTouchPoints: number; standalone: boolean; displayModeStandalone: boolean }> = {}) =>
    appIconHint({ userAgent, maxTouchPoints: 0, standalone: false, displayModeStandalone: false, ...more })

  it('iPhone / iPad: when it is added; the installed app says to do it in Safari and add it again', () => {
    expect(at(IPHONE)).toBe('ios')
    expect(at(IPHONE, { standalone: true })).toBe('ios_installed')
    expect(at(IPAD_DESKTOP, { maxTouchPoints: 5 })).toBe('ios')
    expect(at(IPAD_DESKTOP)).toBe('other')
  })

  it('Android: when installed; the installed app may update by itself', () => {
    expect(at(ANDROID)).toBe('android')
    expect(at(ANDROID, { displayModeStandalone: true })).toBe('android_installed')
    expect(at(DESKTOP)).toBe('other')
  })
})

describe('AppIconPicker (Einstellungen → Darstellung)', () => {
  const picker = () => render(<ul><AppIconPicker /></ul>)

  it('twelve icons in a radio group, the chosen one checked and named; lazy pictures of the icons themselves', () => {
    setAppIcon('dark')
    picker()
    const group = screen.getByRole('radiogroup', { name: 'App-Symbol' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(12)
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Klassisch', 'Dunkel', 'Nacht', 'Ozean', 'Schlicht', 'Mit Tapsi', 'Geburtstag', 'Ostern', 'Sommer', 'Herbst', 'Halloween', 'Weihnachten'])
    expect(screen.getByRole('radio', { name: 'Dunkel' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Klassisch' }).getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('[data-app-icon-name]')?.textContent).toBe('Dunkel')
    const images = group.querySelectorAll('img')
    expect([...images].map((img) => img.getAttribute('src'))).toEqual(APP_ICONS.map((id) => appIconLinks(id).icon))
    for (const img of images) expect(img.getAttribute('loading')).toBe('lazy')
    // roving tabindex: only the chosen one is in the tab order
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1)
  })

  it('choosing one saves it, links it and moves the check; arrow keys move along', () => {
    picker()
    fireEvent.click(screen.getByRole('radio', { name: 'Nacht' }))
    expect(localStorage.getItem(APP_ICON_KEY)).toBe('night')
    expect(href('apple-touch-icon')).toBe('/icons/variants/night/apple-touch-icon.png')
    expect(screen.getByRole('radio', { name: 'Nacht' }).getAttribute('aria-checked')).toBe('true')
    expect(document.querySelector('[data-app-icon-name]')?.textContent).toBe('Nacht')
    screen.getByRole('radio', { name: 'Nacht' }).focus()
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' })
    expect(localStorage.getItem(APP_ICON_KEY)).toBe('ocean')
    expect(screen.getByRole('radio', { name: 'Ozean' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Klassisch' }))
    expect(localStorage.getItem(APP_ICON_KEY)).toBeNull()
    expect(href('manifest')).toBe('/manifest.webmanifest')
  })

  it('says honestly when a phone takes the icon (here: an installed iPhone app)', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    try {
      picker()
      const hint = document.querySelector('[data-app-icon-hint]')
      expect(hint?.getAttribute('data-app-icon-hint')).toBe('ios_installed')
      expect(hint?.textContent).toContain('Safari')
      expect(hint?.textContent).toContain('neu hinzufügen')
    } finally {
      Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true })
    }
  })

  it('is not there inside Telegram (a Mini App has no home-screen icon)', async () => {
    vi.resetModules()
    vi.doMock('../../lib/telegram/detect', () => ({ IN_TELEGRAM: true }))
    try {
      const { AppIconPicker: InTelegram } = await import('./AppIconPicker')
      const { container } = render(<ul><InTelegram /></ul>)
      expect(container.querySelector('li')).toBeNull()
      expect(screen.queryByRole('radiogroup')).toBeNull()
    } finally {
      vi.doUnmock('../../lib/telegram/detect')
      vi.resetModules()
    }
  })
})
