import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// «Pompons Sammlung» + Pompon's fluffy cheeks in the demo app (31.10, docs/handoffs/2026-10-31-sammlung-in-app.md).
// Firefox at phone size, light and dark: the Profil row, a hidden scene found for real (the tower: 5 taps on the
// version line) and counted, the collection page (Szenen with the replay sheet, Garderobe), Pompon with his cheeks in
// several places, and the season's outfits on other dates (the browser's clock: 6.12 → Nikolaus hat, 15.1 → winter hat).
// Screens: docs/screens/2026-10-31-sammlung-in-app/ (or SCREENS_OUT).

// run from apps/web (npx playwright test e2e/sammlung-in-app-screens.spec.ts)
const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-31-sammlung-in-app')
mkdirSync(OUT, { recursive: true })

async function open(browser: Browser, scheme: 'light' | 'dark', date?: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: scheme, baseURL: 'http://localhost:5173' })
  const page = await context.newPage()
  if (date) await page.clock.setFixedTime(new Date(date))
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

async function signUp(page: Page, shotWelcome?: string) {
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Mila')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  if (shotWelcome) {
    await page.waitForTimeout(2500)
    await shotMascot(page, '[data-mascot="bunny"]', shotWelcome, 40)
  }
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible()
}

/** A screenshot around the first element matching `sel` (with `pad` px around it). */
async function shotMascot(page: Page, sel: string, file: string, pad = 24) {
  const el = page.locator(sel).first()
  await el.waitFor({ state: 'attached', timeout: 15_000 })
  await el.scrollIntoViewIfNeeded().catch(() => undefined)
  await page.waitForTimeout(400)
  const box = await el.boundingBox()
  if (!box) throw new Error(`no box for ${sel}`)
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad - 30)
  await page.screenshot({ path: `${OUT}/${file}`, clip: { x, y, width: Math.min(390 - x, box.width + pad * 2), height: box.height + pad * 2 + 30 } })
}

/** A new account has no lists (the empty card's own Pompon shows and the buddy steps aside): make one (as e2e/buddy-vs-swipe). */
async function toListsWithAList(page: Page) {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Listen/ }).click()
  await page.waitForURL('**/lists')
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

/** The Lists buddy (Pompon): scrolled into view, a picture around him. */
async function shotBuddy(page: Page, file: string) {
  await expect(page.locator('.bd-hit').first()).toBeAttached({ timeout: 15_000 })
  await page.evaluate(() => {
    const hit = document.querySelector('.bd-hit')
    if (hit) window.scrollTo({ top: window.scrollY + hit.getBoundingClientRect().top - 260, behavior: 'instant' })
  })
  await page.waitForTimeout(1500)
  const r = await page.evaluate(() => {
    const b = document.querySelector('.bd-host')!.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height }
  })
  const x = Math.max(0, r.x - 60)
  const y = Math.max(0, r.y - 90)
  await page.screenshot({ path: `${OUT}/${file}`, clip: { x, y, width: Math.min(390 - x, r.w + 120), height: r.h + 130 } })
}

async function toProfil(page: Page) {
  await page.getByRole('link', { name: /Profil/ }).first().click()
  await page.waitForTimeout(900)
}

async function rowText(page: Page): Promise<string> {
  return (await page.locator('[data-sammlung-count]').first().innerText()).trim()
}

/** The tower easter egg, for real: 5 quick taps on the version line; waits until it has played. */
async function findTower(page: Page) {
  const line = page.locator('[data-pilot-line]')
  await line.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  for (let i = 0; i < 5; i++) await line.click({ delay: 20 })
  await expect(page.locator('[data-tower]')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.locator('[data-tower]')).toHaveCount(0, { timeout: 15_000 })
}

async function openSammlung(page: Page) {
  const row = page.locator('a[href="/settings/sammlung"]')
  await row.scrollIntoViewIfNeeded()
  await row.click()
  await expect(page.getByRole('heading', { name: 'Pompons Sammlung', level: 1 })).toBeVisible()
  // the posters: every card's scene is built and frozen (lazy chunks)
  await page.waitForTimeout(3500)
}

test('Sammlung: Profil row, a real find, both tabs, the replay sheet (light)', async ({ browser }) => {
  test.setTimeout(240_000)
  const { context, page, errors } = await open(browser, 'light', '2026-10-31T11:00:00')
  await signUp(page, 'cheeks-welcome-onboarding-light.png')
  await toProfil(page)
  const row = page.locator('a[href="/settings/sammlung"]')
  await row.scrollIntoViewIfNeeded()
  expect(await rowText(page)).toContain('0/8')
  await page.screenshot({ path: `${OUT}/profil-row-before-light.png` })

  await findTower(page)
  await row.scrollIntoViewIfNeeded()
  await expect(page.locator('[data-sammlung-new]')).toHaveCount(1)
  expect(await rowText(page)).toContain('1/8')
  await page.screenshot({ path: `${OUT}/profil-row-after-tower-light.png` })

  await openSammlung(page)
  await page.screenshot({ path: `${OUT}/szenen-light.png` })
  await page.screenshot({ path: `${OUT}/szenen-full-light.png`, fullPage: true })
  // the dot is gone once the collection was looked at
  await page.locator('[data-scene="tower"]').click()
  await page.waitForTimeout(2600)
  await page.screenshot({ path: `${OUT}/szenen-replay-tower-light.png` })
  await page.getByRole('button', { name: 'Schließen' }).last().click()
  await page.waitForTimeout(600)

  await page.getByRole('radio', { name: 'Garderobe' }).or(page.getByRole('button', { name: 'Garderobe' })).first().click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/garderobe-31-10-light.png` })
  await page.screenshot({ path: `${OUT}/garderobe-full-light.png`, fullPage: true })

  // a tap on a locked tile only says how many finds are missing
  await page.locator('[data-outfit="daisy"]').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/garderobe-locked-note-light.png`, fullPage: true })

  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})

test('Sammlung + cheeks in the dark theme; Pompon with cheeks: Ideen, Listen buddy, "+" menu', async ({ browser }) => {
  test.setTimeout(240_000)
  const { context, page, errors } = await open(browser, 'dark', '2026-10-31T11:00:00')
  await signUp(page)
  // "+" menu: the first opening is the fawn bunny = Pompon (the wave forced: the dev hook of e2e/plus-menu-bunny-screens)
  await page.waitForTimeout(9000) // the moment budget's quiet time after the sign-up's own moments
  await page.evaluate(() => { (window as Window & { __bunpriseMenuMoment?: unknown }).__bunpriseMenuMoment = { preset: 'wave' } })
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Neu erstellen' }).click()
  const t0 = Date.now()
  for (const ms of [700, 1200, 1800, 2600]) {
    await page.waitForTimeout(Math.max(0, t0 + ms - Date.now()))
    // the band over the panel's top edge, where he climbs out
    await page.screenshot({ path: `${OUT}/cheeks-plus-menu-dark-${ms}.png`, clip: { x: 0, y: 250, width: 390, height: 330 } })
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)

  await page.getByRole('link', { name: /Ideen/ }).first().click()
  await page.waitForTimeout(2500)
  await shotMascot(page, '[data-mascot="bunny"]', 'cheeks-ideen-dark.png')

  await toListsWithAList(page)
  await shotBuddy(page, 'cheeks-listen-buddy-dark.png')

  await toProfil(page)
  await openSammlung(page)
  await page.screenshot({ path: `${OUT}/szenen-dark.png` })
  await page.getByRole('radio', { name: 'Garderobe' }).or(page.getByRole('button', { name: 'Garderobe' })).first().click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/garderobe-dark.png` })
  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})

for (const [date, name, scheme] of [['2026-12-06T11:00:00', 'nikolaus-6-12', 'light'], ['2027-01-15T11:00:00', 'winterhat-15-01', 'light'], ['2027-01-15T11:00:00', 'winterhat-15-01', 'dark']] as const) {
  test(`the season's outfit in the app: ${name} (${scheme})`, async ({ browser }) => {
    test.setTimeout(180_000)
    const { context, page, errors } = await open(browser, scheme, date)
    await signUp(page)
    await page.getByRole('link', { name: /Ideen/ }).first().click()
    await page.waitForTimeout(3000)
    await shotMascot(page, '[data-mascot="bunny"]', `outfit-ideen-${name}-${scheme}.png`, 40)
    await toListsWithAList(page)
    await shotBuddy(page, `outfit-listen-buddy-${name}-${scheme}.png`)
    await toProfil(page)
    await openSammlung(page)
    await page.getByRole('radio', { name: 'Garderobe' }).or(page.getByRole('button', { name: 'Garderobe' })).first().click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/garderobe-${name}-${scheme}.png` })
    expect(errors, errors.join('\n')).toEqual([])
    await context.close()
  })
}
