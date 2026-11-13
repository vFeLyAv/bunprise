import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// «Парад» v2 — «Бременская башня» in the demo app (Felix 26.10: approved; 27.10: in the app). Firefox at phone size:
// Profil, 5 quick taps on the version line → the tower over the "Abmelden" card. Frames are frozen exactly (every
// animation of the scene paused at the same currentTime), then put together as a contact sheet; one "Weniger" frame
// (prefers-reduced-motion) and one dark frame. Screens go to SCREENS_OUT (default: the session scratchpad).

const OUT = process.env.SCREENS_OUT
  ? resolve(process.env.SCREENS_OUT)
  : 'C:/Users/Mrkol/AppData/Local/Temp/claude/E--BALLR/cda4a0c0-3e93-43ed-bab4-a6208e393f3f/scratchpad/approved-anims/tower'
mkdirSync(OUT, { recursive: true })

const TIMES = [0.3, 0.8, 1.3, 1.8, 2.3, 2.7, 3.05, 3.4, 3.75, 4.0, 4.3, 4.7]

async function signUp(page: Page) {
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Mila')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
}

async function open(browser: Browser, scheme: 'light' | 'dark', reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: scheme, reducedMotion, baseURL: 'http://localhost:5173',
  })
  const p = await context.newPage()
  // headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs
  await p.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
  return { context, page: p }
}

/** Signs up, opens Profil, scrolls to its bottom, taps the version line 5×; resolves when the tower host is there. */
async function startTower(p: Page) {
  await signUp(p)
  await p.getByRole('link', { name: /Profil/ }).first().click()
  const line = p.locator('[data-pilot-line]')
  await line.scrollIntoViewIfNeeded()
  await p.waitForTimeout(800)
  for (let i = 0; i < 5; i++) await line.click({ delay: 20 })
  await expect(p.locator('[data-tower]')).toHaveCount(1, { timeout: 10_000 })
  // the scene is its own lazy chunk: wait until it is built inside the host
  await p.waitForFunction(() => (document.querySelector('[data-tower]')?.shadowRoot?.querySelector('.stage')?.childElementCount ?? 0) > 0)
}

/** Every animation of the tower (its shadow root and the puppets' nested ones), paused at `t` seconds. */
async function freeze(p: Page, t: number) {
  await p.evaluate((ms) => {
    const host = document.querySelector('[data-tower]')
    const all: Animation[] = []
    const walk = (root: ParentNode) => {
      for (const el of root.querySelectorAll('*')) {
        all.push(...el.getAnimations())
        if (el.shadowRoot) walk(el.shadowRoot)
      }
    }
    if (host?.shadowRoot) walk(host.shadowRoot)
    for (const a of all) {
      a.pause()
      a.currentTime = ms
    }
  }, t * 1000)
  await p.waitForTimeout(120)
}

/** The band of the screen the tower lives in: from the host's top to the card's bottom (CSS px). */
async function band(p: Page) {
  const box = await p.evaluate(() => {
    const h = document.querySelector('[data-tower]')!.getBoundingClientRect()
    const card = document.querySelector('.set-logout')!.getBoundingClientRect()
    return { x: 0, y: Math.max(0, h.top - 4), width: window.innerWidth, height: Math.min(window.innerHeight, card.bottom + 30) - Math.max(0, h.top - 4) }
  })
  return box
}

test('tower: contact sheet of the show (light), one dark frame, "Weniger"', async ({ browser }) => {
  test.setTimeout(180_000)
  const shots: Array<{ t: number; file: string }> = []
  {
    const { context, page: p } = await open(browser, 'light')
    await startTower(p)
    await p.waitForTimeout(50)
    await freeze(p, 0)
    await p.screenshot({ path: `${OUT}/a-profil-start.png` })
    const clip = await band(p)
    for (const t of TIMES) {
      await freeze(p, t)
      const file = `${OUT}/frame-${t.toFixed(2)}.png`
      await p.screenshot({ path: file, clip })
      shots.push({ t, file })
    }
    await freeze(p, 3.4)
    await p.screenshot({ path: `${OUT}/b-profil-binky-3.40.png` })
    // contact sheet: the frames side by side
    const cells = shots
      .map(({ t, file }) => `<figure><img src="data:image/png;base64,${readFileSync(file).toString('base64')}"><figcaption>t = ${t.toFixed(2)} s</figcaption></figure>`)
      .join('')
    await p.setViewportSize({ width: 1260, height: 900 })
    await p.setContent(`<style>body{margin:12px;font:13px system-ui;background:#eee}h1{font-size:16px;margin:0 0 8px}
      .g{display:grid;grid-template-columns:repeat(4,300px);gap:10px}figure{margin:0;background:#fff;border-radius:8px;overflow:hidden}
      img{width:300px;display:block}figcaption{padding:4px 8px}</style><h1>«Парад» v2 — Бременская башня · Profil (demo, Firefox 390 px)</h1><div class="g">${cells}</div>`)
    await p.screenshot({ path: `${OUT}/contact-sheet.png`, fullPage: true })
    await context.close()
  }
  {
    const { context, page: p } = await open(browser, 'dark')
    await startTower(p)
    await freeze(p, 3.4)
    await p.screenshot({ path: `${OUT}/c-dark-binky-3.40.png` })
    await context.close()
  }
  {
    const { context, page: p } = await open(browser, 'light', 'reduce')
    await startTower(p)
    await p.waitForTimeout(1300)
    await p.screenshot({ path: `${OUT}/d-weniger-heads.png` })
    await context.close()
  }
})
