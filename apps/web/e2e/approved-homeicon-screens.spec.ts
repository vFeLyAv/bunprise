import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// «Здесь я буду жить» (Felix 27.10: approved, in the app): the onboarding step "Zum Home-Bildschirm" in the demo,
// Firefox at phone size, emulating iPhone Safari (the step exists only there). A frame sequence of the scene
// (its animations paused and set to the same time t, the package's timeline is deterministic) → a contact sheet,
// the end state (light + dark), "Weniger" (the still icon) and the second visit of the step (the still icon).
// Screens go to SCREENS_OUT (default: the session scratchpad, approved-anims/homeicon).

const OUT = process.env.SCREENS_OUT
  ? resolve(process.env.SCREENS_OUT)
  : 'C:/Users/Mrkol/AppData/Local/Temp/claude/E--BALLR/cda4a0c0-3e93-43ed-bab4-a6208e393f3f/scratchpad/approved-anims/homeicon'
mkdirSync(OUT, { recursive: true })

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

async function open(browser: Browser, scheme: 'light' | 'dark', reduced = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: scheme, baseURL: 'http://localhost:5173',
    userAgent: IPHONE_SAFARI, reducedMotion: reduced ? 'reduce' : 'no-preference',
  })
  const p = await context.newPage()
  await p.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 })
    Object.defineProperty(navigator, 'standalone', { get: () => false })
    // headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
  return { context, page: p }
}

async function toHomeScreenStep(page: Page) {
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Mila')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  // the onboarding: greeting → wishes ("Später") → a card → "Los geht's!" → the Home Screen step (iOS Safari)
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await page.getByRole('button', { name: 'Später', exact: true }).click()
  await page.getByRole('button', { name: /^Geburtstag/ }).click()
  await page.getByRole('button', { name: 'Los geht’s!', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Zum Home.Bildschirm hinzufügen$/ })).toBeVisible()
}

/** Every animation of the icon scene (its shadow root and the nested puppet's), set to `t` s and paused. */
async function seekScene(page: Page, t: number): Promise<number> {
  return page.evaluate((ms) => {
    const host = document.querySelector('[data-home-icon]')
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
    return all.length
  }, t * 1000)
}

/** The scene stage and the card's top (the region a contact-sheet cell shows), page px. */
async function sceneBox(page: Page) {
  const box = await page.locator('[data-home-icon]').boundingBox()
  if (!box) throw new Error('no icon scene')
  return { x: 0, y: Math.max(0, box.y - 8), width: 390, height: box.height + 90 }
}

test('home icon: the scene frame by frame, the end, light + dark', async ({ browser }) => {
  test.setTimeout(120_000)
  for (const scheme of ['light', 'dark'] as const) {
    const { context, page } = await open(browser, scheme)
    await toHomeScreenStep(page)
    const host = page.locator('[data-home-icon]')
    await expect(host).toBeAttached({ timeout: 10_000 })
    // the seated Pompon stepped aside (faded out, inert)
    await expect(page.locator('.wl-seat-away')).toHaveCount(1)
    await page.waitForTimeout(3200)
    await page.screenshot({ path: `${OUT}/end-${scheme}.png` })
    if (scheme === 'light') {
      const clip = await sceneBox(page)
      const times = [0, 0.3, 0.5, 0.66, 0.8, 0.96, 1.2, 1.4, 1.6, 1.8, 1.95, 2.1, 2.25, 2.42]
      const cells: Array<{ t: number; png: string }> = []
      for (const t of times) {
        const n = await seekScene(page, t)
        expect(n).toBeGreaterThan(10)
        await page.waitForTimeout(120)
        const buf = await page.screenshot({ clip })
        cells.push({ t, png: buf.toString('base64') })
      }
      // the contact sheet: the cells in a grid on a plain page
      const sheet = await context.newPage()
      await sheet.setViewportSize({ width: 1600, height: 900 })
      await sheet.setContent(`<!doctype html><html><body style="margin:0;padding:16px;background:#ece6dc;font:13px system-ui">
        <h3 style="margin:0 0 10px">«Здесь я буду жить» — demo app, Firefox, iPhone Safari emulated (390 px), frames t (s)</h3>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">${cells
          .map((c) => `<figure style="margin:0"><img style="width:100%;border-radius:10px;display:block" src="data:image/png;base64,${c.png}"><figcaption>t = ${c.t.toFixed(2)} s</figcaption></figure>`)
          .join('')}</div></body></html>`)
      await sheet.screenshot({ path: `${OUT}/contact-sheet.png`, fullPage: true })
      await sheet.close()
      // the second visit of the step (back, forward): the still icon fades in, the show is not repeated
      await page.getByRole('button', { name: 'Zurück', exact: true }).click()
      await expect(host).toHaveCount(0)
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/back-pompon-again.png` })
      await page.getByRole('button', { name: 'Los geht’s!', exact: true }).click()
      await expect(page.locator('[data-home-icon]')).toBeAttached()
      await page.waitForTimeout(900)
      const running = await page.evaluate(() => {
        let n = 0
        const walk = (root: ParentNode) => {
          for (const el of root.querySelectorAll('*')) {
            n += el.getAnimations().filter((a) => a.playState === 'running').length
            if (el.shadowRoot) walk(el.shadowRoot)
          }
        }
        const h = document.querySelector('[data-home-icon]')
        if (h?.shadowRoot) walk(h.shadowRoot)
        return n
      })
      expect(running).toBe(0)
      await page.screenshot({ path: `${OUT}/second-visit-still.png` })
    }
    await context.close()
  }
})

test('home icon: "Weniger" (reduced motion) = the still icon', async ({ browser }) => {
  test.setTimeout(90_000)
  const { context, page } = await open(browser, 'light', true)
  await toHomeScreenStep(page)
  await expect(page.locator('[data-home-icon]')).toBeAttached({ timeout: 10_000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/weniger-still.png` })
  await context.close()
})

