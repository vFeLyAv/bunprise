import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Shop icons (Felix 23.10: "Shop-Namen ohne Logos") in the demo, Firefox at phone size (390 × 844, 2× pixels): the
// list card's round dots, the square wish tiles with and without photo (icon chip on the tint, the corner badge on
// photos, the letter where a shop has no icon), the wish sheet's header tile and shop row, "Woanders finden" (real
// shops: the demo has no real logos → letters). The demo's icons are neutral placeholders (src/mocks/shopIcons.ts).
// Also asserts the privacy rule: every icon <img> shows a blob: URL and the page never requests a foreign host.
// Screens go to docs/screens/2026-10-23-shop-icons/.

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-23-shop-icons')
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

/** One own list: wishes from the demo's (fictional) shops, with and without photo, one shop without icon, one without link. */
async function seed(page: Page) {
  return page.evaluate(async () => {
    const lists = (await import(/* @vite-ignore */ '/src/lib/api/lists.ts')) as {
      newListId: () => string
      createList: (input: object) => Promise<{ id: string }>
    }
    const wishes = (await import(/* @vite-ignore */ '/src/lib/api/wishes.ts')) as {
      createWish: (listId: string, input: object) => Promise<{ id: string }>
    }
    const wishPhotos = (await import(/* @vite-ignore */ '/src/lib/api/wishPhotos.ts')) as {
      uploadWishPhoto: (wishId: string, photo: object) => Promise<unknown>
    }
    const blob = await (await fetch('/src/mocks/assets/demo-product.webp')).blob()
    const bitmap = await createImageBitmap(blob)
    const product = { mime: 'image/webp', bytes: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width, height: bitmap.height }

    const list = lists.newListId()
    await lists.createList({ id: list, title: 'Mein Geburtstag', visibility: 'followers', cover_tone: 3, cover_icon: 'cake', due_on: null })
    const add = async (input: object, withPhoto = false) => {
      const wish = await wishes.createWish(list, input)
      if (withPhoto) await wishPhotos.uploadWishPhoto(wish.id, product)
    }
    await add({ title: 'Leinen-Geschirrtücher', price_cents: 1800, url: 'https://www.hausundfaden.example/geschirrtuecher', shop_name: 'Haus & Faden', priority: 2 })
    await add({ title: 'Handkaffeemühle „Kegel“', price_cents: 4990, url: 'https://www.kuechenkontor.example/kaffeemuehle-kegel', shop_name: 'Küchenkontor', priority: 3, gtin: '2001234567893' }, true)
    await add({ title: 'Grillschürze aus Canvas', price_cents: 2500, url: 'https://grillhuette.example/schuerze', shop_name: 'Grillhütte', priority: 2 })
    await add({ title: 'Leselampe mit Klemme', price_cents: 3490, url: 'https://lichthaus.example/leselampe', shop_name: 'Lichthaus', priority: 1 })
    await add({ title: 'Kabellose Kopfhörer', price_cents: 7999, url: 'https://shop.example/kopfhoerer', priority: 2 }, true)
    await add({ title: 'Teetasse mit Untertasse', price_cents: 1450, url: 'https://kleiner-laden.example/teetasse', shop_name: 'Kleiner Laden', priority: 1 })
    await add({ title: 'Kinogutschein', price_cents: 2500, url: null, priority: 2 })
    return list
  })
}

/** Every shop icon <img> on the page shows our bytes (a blob: URL), never an address. */
async function iconSources(page: Page): Promise<string[]> {
  return page.locator('[data-shop-icon] img').evaluateAll((images) => images.map((image) => image.getAttribute('src') ?? ''))
}

test('shop icons: list card dots, wish tiles, the sheet’s shop row and “Woanders finden”', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  const foreign: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    const own = url.origin === 'http://localhost:5173' || url.hostname === 'demo.localhost'
    if (!own && url.protocol !== 'blob:' && url.protocol !== 'data:') foreign.push(url.href)
  })

  await solidMaterials(page)
  await signUp(page)
  await seed(page)

  // 1. "Listen": the card's round dots — the shops' icons inside, a photo where there is one
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await nav.getByRole('link', { name: /^Listen/ }).click()
  const card = page.getByRole('link', { name: /Mein Geburtstag/ })
  await expect(card).toBeVisible()
  await expect(card.locator('[data-shop-icon] img[data-loaded]').first()).toBeVisible({ timeout: 10_000 })
  await shot(page, '01-listen-card-dots-390')

  // 2. the list: tiles without photo get the icon chip on their tint, photo tiles the small corner badge,
  //    "Kleiner Laden" (no icon) keeps its letter, the voucher its gift
  await card.click()
  await expect(page.locator('[data-wish-id]').first()).toBeVisible()
  await expect(page.locator('.wt-fallback [data-shop-icon] img[data-loaded]').first()).toBeVisible({ timeout: 10_000 })
  await page.mouse.wheel(0, 260)
  await settle(page)
  await expect(page.locator('.wt-shop [data-shop-icon] img[data-loaded]').first()).toBeVisible({ timeout: 10_000 })
  await shot(page, '02-grid-390')
  await page.mouse.wheel(0, 500)
  await shot(page, '02b-grid-scrolled-390')
  const letterOnly = page.locator('[data-wish-id]', { hasText: 'Teetasse' })
  await expect(letterOnly.locator('.wt-letter')).toHaveText('K')
  await expect(letterOnly.locator('img')).toHaveCount(0)

  // 3. the sheet of a wish without photo (it fits on one screen): the big shop tile with its icon, the shop row,
  //    "Woanders finden" (the real shops have no icon in the demo → their letters)
  await page.locator('[data-wish-id]', { hasText: 'Geschirrtücher' }).locator('button').first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('[data-wish-shop] [data-shop-icon] img[data-loaded]')).toBeVisible({ timeout: 10_000 })
  await expect(sheet.locator('[data-wish-compare] a')).toHaveCount(4)
  await expect(sheet.locator('[data-wish-compare] img')).toHaveCount(0)
  await shot(page, '03-sheet-shop-row-woanders-finden-390')
  await page.keyboard.press('Escape')
  await settle(page)

  // 4. the sheet of a wish with photo: the shop row under the photo and the details
  await page.mouse.wheel(0, -2000)
  await page.locator('[data-wish-id]', { hasText: 'Kaffeemühle' }).locator('button').first().click()
  const photoSheet = page.getByRole('dialog')
  await photoSheet.locator('[data-wish-shop]').scrollIntoViewIfNeeded()
  await expect(photoSheet.locator('[data-wish-shop] [data-shop-icon] img[data-loaded]')).toBeVisible({ timeout: 10_000 })
  await shot(page, '04-sheet-photo-shop-row-390')
  await page.keyboard.press('Escape')
  await settle(page)

  // 5. the narrowest phone
  await page.setViewportSize({ width: 320, height: 700 })
  await page.mouse.wheel(0, -2000)
  await page.mouse.wheel(0, 260)
  await shot(page, '05-grid-320')

  const sources = await iconSources(page)
  expect(sources.length).toBeGreaterThan(0)
  for (const source of sources) expect(source).toMatch(/^blob:http:\/\/localhost:5173\//)
  expect(foreign).toEqual([])
  expect(errors).toEqual([])
})
