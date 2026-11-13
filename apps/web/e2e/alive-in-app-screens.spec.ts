import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// «Живые анимации» in the demo app (31.10, docs/handoffs/2026-10-31-alive-in-app.md). The quick check: ?alive=fast
// (dev / demo only: the first moment after 3 s, then every 9–14 s) and `__bunpriseAlive('<id>')` in the console. Firefox
// at phone size, light and dark: the Lists buddy (his deeds), Pompon awake on the Start corner (?night=1, a tap wakes
// him), and «Weniger» (reduced motion): nothing plays. Screens: docs/screens/2026-10-31-alive-in-app/ (or SCREENS_OUT).
// Run from apps/web:  npx playwright test e2e/alive-in-app-screens.spec.ts

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-31-alive-in-app')
mkdirSync(OUT, { recursive: true })

async function open(browser: Browser, scheme: 'light' | 'dark', reduced = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference', baseURL: 'http://localhost:5173' })
  const page = await context.newPage()
  // headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs
  await page.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { context, page, errors }
}

async function signUp(page: Page, query: string) {
  await page.goto(`/login?mode=signup&method=email&frame=0&${query}`)
  await page.getByLabel('E-Mail', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Mila')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible()
}

async function shotAround(page: Page, sel: string, file: string, pad = 28) {
  const el = page.locator(sel).first()
  await el.waitFor({ state: 'attached', timeout: 15_000 })
  const box = await el.boundingBox()
  if (!box) throw new Error(`no box for ${sel}`)
  const x = Math.max(0, box.x - pad - 60)
  const y = Math.max(0, box.y - pad - 40)
  await page.screenshot({ path: `${OUT}/${file}`, clip: { x, y, width: Math.min(390 - x, box.width + pad * 2 + 120), height: box.height + pad * 2 + 80 } })
}

async function toLists(page: Page) {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Listen/ }).click()
  await page.waitForURL('**/lists')
}

async function makeAList(page: Page) {
  const template = page.getByRole('group', { name: 'Vorlagen' }).getByRole('button', { name: 'Weihnachten' })
  if (await template.count()) await template.first().click()
  else await page.getByRole('button', { name: 'Neue Liste' }).first().click()
  const sheet = page.getByRole('dialog')
  const title = sheet.getByLabel('Titel')
  if ((await title.inputValue()) === '') await title.fill('Weihnachten')
  await sheet.getByRole('button', { name: 'Anlegen', exact: true }).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  const inList = (url: URL) => /\/lists\/[^/]+$/.test(url.pathname)
  await page.waitForURL(inList, { timeout: 8000 }).catch(() => undefined)
  if (inList(new URL(page.url()))) {
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Zurück' }).first().click()
    await page.waitForURL((url) => url.pathname.replace(/\/$/, '').endsWith('/lists'), { timeout: 5000 })
  }
}

/** Back to the top of the page (the buddy lives on the stats row; the sticky header must not cover him). */
const toTop = (page: Page) => page.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('main, [data-layer-root]')]) el?.scrollTo?.(0, 0) })

/** A moment runs on the puppet inside `host` (the class `al` on its `.hm`, inside the shadow root). */
const running = (page: Page, host: string) => page.locator(`${host} .hm.al`)

for (const scheme of ['light', 'dark'] as const) {
  test(`living moments in the app (${scheme})`, async ({ browser }) => {
    test.setTimeout(150_000)
    const { context, page, errors } = await open(browser, scheme)
    await signUp(page, 'alive=fast')

    // Listen: the buddy — a due moment is his next deed (fast: the first after ≈ 3 s)
    await toLists(page)
    await makeAList(page)
    await toTop(page)
    await page.locator('.bd-host').first().waitFor({ state: 'attached', timeout: 15_000 })
    await running(page, '.bd-host').first().waitFor({ state: 'attached', timeout: 30_000 })
    await page.waitForTimeout(900)
    await shotAround(page, '.bd-actor', `01-lists-buddy-moment-${scheme}.png`)
    // it ends in the rest pose: nothing of it stays
    await expect(running(page, '.bd-host')).toHaveCount(0, { timeout: 8000 })
    if (scheme === 'light') {
      // each one on demand (the console helper), a frame from the middle of each
      for (const id of ['groom', 'periscope', 'stretch', 'loaf', 'sneeze', 'dig'] as const) {
        await toTop(page)
        await page.waitForTimeout(400)
        await page.evaluate((m) => globalThis.__bunpriseAlive?.(m), id)
        await running(page, '.bd-host').first().waitFor({ state: 'attached', timeout: 25_000 })
        await page.waitForTimeout(id === 'loaf' ? 1500 : 1100)
        await shotAround(page, '.bd-actor', `02-buddy-${id}.png`)
        // a tap during a moment: it ends at once (his own answer follows), nothing breaks
        if (id === 'groom') {
          await page.locator('.bd-hit').first().click()
          await expect(running(page, '.bd-host')).toHaveCount(0, { timeout: 1000 })
        } else await expect(running(page, '.bd-host')).toHaveCount(0, { timeout: 8000 })
      }
    }
    expect(errors).toEqual([])
    await context.close()
  })
}

test('Start corner at night: awake after a tap, his living moments; asleep: none', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page, errors } = await open(browser, 'light')
  await signUp(page, 'night=1&alive=fast')
  const firstSteps = page.getByRole('button', { name: 'Erste Schritte ausblenden' })
  await firstSteps.waitFor({ timeout: 5000 }).catch(() => undefined)
  if (await firstSteps.count()) await firstSteps.click()
  const corner = '[data-night-host="bunny"]'
  await page.locator(`${corner} [data-night="bunny"]`).waitFor({ state: 'attached', timeout: 15_000 })
  // asleep: nothing (well past the fast first moment)
  await page.waitForTimeout(6000)
  await expect(running(page, corner)).toHaveCount(0)
  expect(await page.evaluate(() => globalThis.__bunpriseAlive?.('sneeze') ?? false)).toBe(false)
  // a tap wakes him (2 s); then the first moment ≈ 3 s later (fast)
  await page.locator(`${corner} .nt-hit`).first().click()
  await running(page, corner).first().waitFor({ state: 'attached', timeout: 20_000 })
  await page.waitForTimeout(1000)
  await shotAround(page, `${corner} .nt-actor`, '03-start-corner-awake-moment.png')
  await expect(running(page, corner)).toHaveCount(0, { timeout: 8000 })
  expect(errors).toEqual([])
  await context.close()
})

test('«Weniger» / reduced motion: no living moment at all', async ({ browser }) => {
  test.setTimeout(90_000)
  const { context, page, errors } = await open(browser, 'light', true)
  await signUp(page, 'alive=fast')
  await toLists(page)
  await makeAList(page)
  await page.locator('.bd-host').first().waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForTimeout(8000)
  await page.evaluate(() => globalThis.__bunpriseAlive?.('groom'))
  await page.waitForTimeout(6000)
  await expect(running(page, '.bd-host')).toHaveCount(0)
  expect(await page.locator('.bd-host .al-floor').count()).toBe(0)
  expect(errors).toEqual([])
  await context.close()
})
