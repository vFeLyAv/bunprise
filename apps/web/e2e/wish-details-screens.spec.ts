import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Wish details (2026-10-22) in the demo: paste a product link → photo + details; the owner's list with photo
// thumbnails; the wish sheet (photo, text, colour, brand, "Aus dem Shop", "Woanders finden"); a friend's view of
// the same demo product (Anna's coffee grinder, reserved by Ben). Firefox at phone size (390 × 844, playwright
// config). Screens go to docs/screens/2026-10-22-wish-details/. Also asserts the privacy rule on the way: the page
// never requests anything from a shop host (only our own origin; the demo answers /api/* in the browser).

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-22-wish-details')

// Headless Firefox does not paint backdrop-filter (checked 2026-10-22: the blur is simply missing, the list shows
// through the sheet). The screens therefore use the app's own solid material (<html data-transparency="reduce">,
// the 'reduce transparency' mode): what a real Firefox shows frosted is solid here.
async function solidMaterials(page: Page) {
  await page.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
}

/** Waits until the native view transition (if any) and running animations of the page have finished. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  })
  await page.waitForTimeout(600)
}

async function shot(page: Page, name: string, fullPage = false) {
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

async function addWish(page: Page, link: string, { photo }: { photo: boolean }) {
  const field = page.getByLabel('Link zu deinem Wunsch', { exact: true })
  await field.fill(link)
  await field.press('Enter')
  await expect(page.getByText('Aus dem Link gelesen')).toBeVisible()
  if (photo) await expect(page.locator('[data-card-photo="shown"] img[data-loaded]')).toBeVisible()
}

test('wish details: new wish with photo, list thumbnails, the sheet, a friend’s view', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  const foreign: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    // our own origin, or the demo's stand-in for Supabase (demo.localhost, answered inside the page by MSW)
    const own = url.origin === 'http://localhost:5173' || url.hostname === 'demo.localhost'
    if (!own && url.protocol !== 'blob:' && url.protocol !== 'data:') foreign.push(url.href)
  })

  await solidMaterials(page)
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Mila')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()

  // a first own list ("Meine Wünsche", only me) and its new-wish screen
  await page.getByRole('button', { name: 'Neu erstellen', exact: true }).click()
  await page.getByRole('button', { name: /Wunsch hinzufügen/ }).click()
  await page.getByRole('button', { name: '„Meine Wünsche“ anlegen' }).click()

  // 1. paste the demo product link: Pompon reads it, the photo comes through our Worker
  await addWish(page, 'https://www.kuechenkontor.example/kaffeemuehle-kegel', { photo: true })
  await page.locator('[data-card-state]').scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(page, '01-new-wish-photo-390')
  await page.locator('[data-wish-detail-fields]').scrollIntoViewIfNeeded()
  await shot(page, '01b-new-wish-details-390')
  await page.getByRole('button', { name: 'Wunsch hinzufügen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Meine Wünsche', exact: true })).toBeVisible()
  await page.waitForTimeout(2500) // Pompon carries the new wish in

  // two more: a product without a picture (letter tile) and one whose picture cannot be fetched (calm fallback)
  for (const [link, photo] of [['https://shop.example/kopfhoerer', false], ['https://lichthaus.example/lampe', false]] as const) {
    await page.getByRole('link', { name: 'Wunsch hinzufügen' }).first().click()
    await addWish(page, link, { photo })
    if (link.includes('lampe')) await page.waitForTimeout(1200) // the picture request fails → the tile stays
    await page.getByRole('button', { name: 'Wunsch hinzufügen', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Meine Wünsche', exact: true })).toBeVisible()
    await page.waitForTimeout(2500)
  }

  // 2. the owner's list: the photo thumbnail for the grinder, letter tiles for the others
  const grinderRow = page.locator('[data-wish-id]', { hasText: 'Handkaffeemühle' })
  await expect(grinderRow.locator('img[data-loaded]')).toBeVisible()
  await shot(page, '02-owner-list-thumbnails-390')

  // 3. the wish sheet: big photo, price, "Wie sehr?", text, colour, brand, note, the shop
  await grinderRow.locator('button').first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('[data-wish-photo] img[data-loaded]')).toBeVisible()
  await shot(page, '03-owner-sheet-top-390')
  await sheet.getByRole('button', { name: 'Mehr lesen' }).click()
  await sheet.locator('[data-wish-shop]').scrollIntoViewIfNeeded()
  await shot(page, '03b-owner-sheet-shop-390')
  await sheet.locator('[data-wish-compare]').scrollIntoViewIfNeeded()
  await shot(page, '04-owner-sheet-compare-390')
  await expect(sheet.locator('[data-wish-compare] a')).toHaveCount(4)
  await page.keyboard.press('Escape')

  // 4. a friend's view of the same product: Anna's list (Mila is her guest in the demo world), the grinder
  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /^Start/ }).click()
  await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
  const annaGrinder = page.locator('[data-wish-id]', { hasText: 'Kaffeemühle mit Handkurbel' })
  await annaGrinder.scrollIntoViewIfNeeded()
  await expect(annaGrinder.locator('img[data-loaded]')).toBeVisible()
  await shot(page, '05-friend-list-390')
  await annaGrinder.locator('button').first().click()
  const guestSheet = page.getByRole('dialog')
  await expect(guestSheet.locator('[data-wish-photo] img[data-loaded]')).toBeVisible()
  await shot(page, '06-friend-sheet-top-390')
  await guestSheet.locator('[data-wish-compare]').scrollIntoViewIfNeeded()
  await shot(page, '07-friend-sheet-compare-390')

  expect(foreign).toEqual([])
  expect(errors).toEqual([])
})
