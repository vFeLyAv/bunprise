import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// «Ночью маскоты спят» in the demo app (31.10, docs/handoffs/2026-10-31-night-in-app.md). The daytime check: the URL
// parameter ?night=1 (dev / demo only) sets the mascots' clock to 23:30 for this tab. Firefox at phone size, light and
// dark: Start (Pompon asleep on the first card's corner; a tap wakes him), Listen (the buddy asleep on the stats row),
// Freunde (Tapsi asleep, binoculars on his tummy), the "+" menu (`sleepy`), Einstellungen → Bewegung («Nachts schlafen»).
// Screens: docs/screens/2026-10-31-night-in-app/ (or SCREENS_OUT). Run from apps/web:
//   npx playwright test e2e/night-in-app-screens.spec.ts

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-31-night-in-app')
mkdirSync(OUT, { recursive: true })

async function open(browser: Browser, scheme: 'light' | 'dark') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: scheme, baseURL: 'http://localhost:5173' })
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

async function signUp(page: Page) {
  // ?night=1: the mascots' clock shows 23:30 in this tab (src/dev/nightOverride.ts — read once at boot)
  await page.goto('/login?mode=signup&method=email&frame=0&night=1')
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
  await el.scrollIntoViewIfNeeded().catch(() => undefined)
  await page.waitForTimeout(500)
  const box = await el.boundingBox()
  if (!box) throw new Error(`no box for ${sel}`)
  const x = Math.max(0, box.x - pad - 120)
  const y = Math.max(0, box.y - pad - 60)
  await page.screenshot({ path: `${OUT}/${file}`, clip: { x, y, width: Math.min(390 - x, box.width + pad * 2 + 240), height: box.height + pad * 2 + 140 } })
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

for (const scheme of ['light', 'dark'] as const) {
  test(`night in the app (${scheme})`, async ({ browser }) => {
    test.setTimeout(120_000)
    const { context, page, errors } = await open(browser, scheme)
    await signUp(page)

    // Start: Pompon asleep on the first card's right corner (opened at night: already asleep). A new account sees
    // «Erste Schritte», which keeps the card corner free (as for the day's hop) — closed first, like a returning person
    const firstSteps = page.getByRole('button', { name: 'Erste Schritte ausblenden' })
    await firstSteps.waitFor({ timeout: 5000 }).catch(() => undefined)
    if (await firstSteps.count()) await firstSteps.click()
    const startSleeper = page.locator('[data-night-host="bunny"] [data-night="bunny"]')
    await startSleeper.waitFor({ state: 'attached', timeout: 15_000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/01-start-night-${scheme}.png` })
    await shotAround(page, '[data-night-host="bunny"] .nt-actor', `02-start-corner-${scheme}.png`)
    if (scheme === 'light') {
      // a tap on him wakes him: the startle, he rubs one eye, a yawn, he waves (2 s)
      await page.locator('[data-night-host="bunny"] .nt-hit').first().click()
      await page.waitForTimeout(700)
      await shotAround(page, '[data-night-host="bunny"] .nt-actor', '03-start-tap-waking.png')
      await page.waitForTimeout(2000)
      await shotAround(page, '[data-night-host="bunny"] .nt-actor', '04-start-awake.png')
      // the card under him still opens: his hit box ends at his feet
      const hit = await page.locator('[data-night-host="bunny"] .nt-hit').first().boundingBox()
      const card = await page.locator('main li').first().boundingBox()
      expect(hit && card ? hit.y + hit.height : 0).toBeLessThanOrEqual((card?.y ?? 0) + 3)
    }

    // "+" menu at night: the approved `sleepy` (he peeks, yawns, nods off on the edge)
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Neu erstellen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Was möchtest du erstellen?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-welcome="sleepy"]')).toHaveCount(1, { timeout: 10_000 })
    await page.waitForTimeout(3800)
    await page.screenshot({ path: `${OUT}/05-plus-sleepy-${scheme}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // nobody followed (the demo account follows three people: unfollow them before the first visit of Listen, as
    // e2e/approved-tapsi-screens.spec.ts) — for the empty «Freunde» card below
    await page.evaluate(async (path) => {
      const api = (await import(/* @vite-ignore */ path)) as { unfollow: (id: string) => Promise<void> }
      for (const id of ['d1e0a000-0000-4000-8000-000000000001', 'd1e0a000-0000-4000-8000-000000000002', 'd1e0a000-0000-4000-8000-000000000004']) await api.unfollow(id)
    }, '/src/lib/api/lists.ts')

    // Listen → Meine with a list: the buddy (Pompon) asleep on the stats row instead of roaming
    await toLists(page)
    await makeAList(page)
    await page.locator('[data-night="bunny"]').first().waitFor({ state: 'attached', timeout: 15_000 })
    await page.waitForTimeout(1500)
    expect(await page.locator('.bd-layer').count()).toBe(0)
    await page.locator('[data-night="bunny"]').first().evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/06-lists-buddy-asleep-${scheme}.png` })
    if (scheme === 'light') {
      // a tap wakes him: the buddy takes over on that very spot
      await page.locator('[data-night="bunny"] .nt-hit').first().click()
      await page.waitForTimeout(2600)
      expect(await page.locator('.bd-layer').count()).toBe(1)
      await page.screenshot({ path: `${OUT}/07-lists-buddy-woken.png` })
    }

    // Listen → Freunde with nobody followed: Tapsi asleep, binoculars on his tummy
    await page.getByRole('radio', { name: 'Freunde', exact: true }).click()
    await expect(page.locator('.lf-empty')).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-night-host="hamster"] .nt-actor').waitFor({ state: 'attached', timeout: 15_000 })
    await page.waitForTimeout(1200)
    await shotAround(page, '[data-night-host="hamster"]', `08-friends-tapsi-asleep-${scheme}.png`, 20)

    // Einstellungen → Bewegung: «Nachts schlafen» under «Kaninchen zeigen»
    if (scheme === 'light') {
      await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Profil/ }).click()
      const night = page.getByRole('switch', { name: /Nachts schlafen/ })
      await night.waitFor({ timeout: 15_000 })
      await night.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      const row = await night.boundingBox()
      await page.screenshot({ path: `${OUT}/09-settings-switch.png`, clip: { x: 0, y: Math.max(0, (row?.y ?? 0) - 260), width: 390, height: 420 } })
      await expect(night).toHaveAttribute('aria-checked', 'true')
    }

    expect(errors).toEqual([])
    await context.close()
  })
}
