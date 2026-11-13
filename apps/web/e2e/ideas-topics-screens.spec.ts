import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// "Stöbern nach Thema" (Felix 26.10: the approved gallery prototype brought into the app) in the demo, Firefox at
// phone size (390 × 844, 2× pixels), light and dark: the Ideen tab with the topic row under the deck, the
// "Brettspiele" screen (after the moment «Кубик»), a game's sheet on its animation and on its photo slide (the
// demo's local placeholder — the demo never contacts a shop). Also asserts that the page asks no foreign host.
// Screens go to $SCREENS_OUT, default docs/screens/2026-10-27-ideas-topics/.

const OUT = process.env.SCREENS_OUT ?? resolve(process.cwd(), '../../docs/screens/2026-10-27-ideas-topics')
mkdirSync(OUT, { recursive: true })

test.use({ deviceScaleFactor: 2 })

// Headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs.
async function solidMaterials(page: Page) {
  await page.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
  })
  await page.waitForTimeout(500)
}

async function shot(page: Page, name: string) {
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

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

for (const scheme of ['light', 'dark'] as const) {
  test(`Ideen → Brettspiele → a game (${scheme})`, async ({ browser }) => {
    test.setTimeout(90_000)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: scheme, baseURL: 'http://localhost:5173' })
    const page = await context.newPage()
    const foreign = new Set<string>()
    page.on('request', (request) => {
      const host = new URL(request.url()).hostname
      // our dev server and the demo's own Supabase stand-in (MSW, never on the network)
      if (host !== 'localhost' && host !== 'demo.localhost') foreign.add(host)
    })
    await solidMaterials(page)
    await signUp(page)

    await page.getByRole('navigation').getByRole('link', { name: 'Ideen' }).click()
    const row = page.getByRole('heading', { name: 'Stöbern nach Thema' })
    await expect(row).toBeVisible({ timeout: 20_000 })
    // the whole tab: the deck without the round ✕ / ♥ (Felix 26.10: the swipe decides), the row below
    await page.evaluate(() => window.scrollTo(0, 0))
    await shot(page, `0-ideen-top-${scheme}`)
    await page.screenshot({ path: `${OUT}/0b-ideen-full-${scheme}.png`, fullPage: true })
    await page.locator('section[aria-labelledby="topic-row-title"]').scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, -120))
    await expect(page.locator('[data-topic="brettspiele"]')).toBeVisible()
    await shot(page, `1-ideen-row-${scheme}`)

    // without a swipe: the card's "Wo erhältlich" sheet decides with one tap (WCAG 2.5.1)
    await page.getByRole('button', { name: /^Wo erhältlich:/ }).first().click()
    const offers = page.getByRole('dialog', { name: 'Wo erhältlich' })
    await expect(offers.getByRole('button', { name: 'Merken für Anna' })).toBeVisible()
    await shot(page, `1b-wo-erhaeltlich-${scheme}`)
    await page.keyboard.press('Escape')
    await expect(offers).toHaveCount(0)

    await page.locator('[data-topic="brettspiele"]').click()
    // (during the page transition the old and the new screen may both be there for a moment)
    await expect(page.getByRole('heading', { level: 1, name: 'Brettspiele' }).first()).toBeVisible()
    await expect(page.locator('[data-idea="cat:hig-carcassonne"]')).toBeVisible({ timeout: 20_000 })
    await shot(page, `2-brettspiele-${scheme}`)
    await page.evaluate(() => window.scrollTo(0, 460))
    await shot(page, `2b-brettspiele-grid-${scheme}`)

    // a filter: zu zweit
    await page.getByRole('button', { name: 'Spieler', exact: true }).click()
    await page.getByRole('radio', { name: 'Zu zweit' }).click()
    await expect(page.getByRole('button', { name: 'Spieler: Zu zweit' })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 300))
    await shot(page, `2c-filter-zu-zweit-${scheme}`)
    await page.getByRole('button', { name: 'Spieler: Zu zweit' }).click()
    await page.getByRole('radio', { name: 'Egal' }).click()

    // a game: the animation slide (end pose), then the photo slide
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.locator('[data-idea="cat:hig-carcassonne"] .topic-card-open').click()
    const sheet = page.getByRole('dialog', { name: 'Carcassonne' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'So wird gespielt' })).toBeVisible()
    await shot(page, `3-sheet-animation-${scheme}`)
    await sheet.getByRole('button', { name: 'Nächstes Bild' }).click()
    await expect(sheet.locator('.topic-slide[data-kind="photo"] img')).toBeVisible()
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.topic-slide[data-kind="photo"] img')
      return Boolean(img?.complete && img.naturalWidth > 0)
    })
    await shot(page, `4-sheet-photo-${scheme}`)

    expect([...foreign]).toEqual([])
    await context.close()
  })
}
