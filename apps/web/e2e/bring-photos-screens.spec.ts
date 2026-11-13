import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

// "Aus meinen Listen holen" with the wishes' photos (Felix 27.10: "das Foto des Wunsches muss sichtbar sein"), in the
// demo, Firefox at 390 px, light + dark. Seeds one own list (wishes with and without photo) and an own occasion, opens
// the occasion's "Aus meinen Listen holen", picks the list. Asserts: photo rows show an <img> with a blob: URL (our
// bytes), rows without photo keep the letter tile, the page never requests a foreign host.
// Screens go to docs/screens/2026-10-27-bring-photos/.

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-27-bring-photos')
mkdirSync(OUT, { recursive: true })

test.use({ deviceScaleFactor: 2 })

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
    const occasions = (await import(/* @vite-ignore */ '/src/lib/api/occasions.ts')) as {
      createOccasion: (input: object) => Promise<{ occasionId: string }>
    }
    async function photo(path: string) {
      const blob = await (await fetch(path)).blob()
      const bitmap = await createImageBitmap(blob)
      return { mime: 'image/webp', bytes: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width, height: bitmap.height }
    }
    const product = await photo('/src/mocks/assets/demo-product.webp')
    const other = await photo('/src/mocks/assets/demo-list-birthday.webp')

    const list = lists.newListId()
    await lists.createList({ id: list, title: 'Meine Wünsche', visibility: 'followers', cover_tone: 3, cover_icon: 'star', due_on: null })
    const add = async (input: object, picture?: object) => {
      const wish = await wishes.createWish(list, input)
      if (picture) await wishPhotos.uploadWishPhoto(wish.id, picture)
    }
    await add({ title: 'Handkaffeemühle „Kegel“', price_cents: 4990, url: 'https://www.kuechenkontor.example/kaffeemuehle-kegel', shop_name: 'Küchenkontor', priority: 3 }, product)
    await add({ title: 'Kinogutschein', price_cents: 2500, url: null, priority: 2 })
    await add({ title: 'Geburtstagskuchen-Backform', price_cents: 1990, url: 'https://www.hausundfaden.example/backform', priority: 2 }, other)
    await add({ title: 'Leselampe mit Klemme', price_cents: 3490, url: 'https://lichthaus.example/leselampe', priority: 1 })

    const inFiveDays = new Date(Date.now() + 5 * 86_400_000)
    inFiveDays.setUTCHours(16, 0, 0, 0)
    const { occasionId } = await occasions.createOccasion({ title: 'Milas Geburtstag', starts_at: inFiveDays.toISOString(), tz: 'Europe/Berlin', all_day: false, place_text: null })
    const query = (await import(/* @vite-ignore */ '/src/lib/query.ts')) as { queryClient: { invalidateQueries: () => Promise<void> } }
    await query.queryClient.invalidateQueries()
    return occasionId
  })
}

/** For each thumb: its photo covers the whole tile (the same box ±1 px). */
async function coverage(thumbs: Locator): Promise<boolean[]> {
  return thumbs.evaluateAll((elements) => elements.map((thumb) => {
    const box = thumb.getBoundingClientRect()
    const img = thumb.querySelector('img')?.getBoundingClientRect()
    if (!img) return false
    return Math.abs(img.top - box.top) <= 1 && Math.abs(img.left - box.left) <= 1 && Math.abs(img.width - box.width) <= 1 && Math.abs(img.height - box.height) <= 1
  }))
}

for (const scheme of ['light', 'dark'] as const) {
  test(`bring from my lists: wish photos in the rows (${scheme})`, async ({ page }) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    const foreign: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      const own = url.origin === 'http://localhost:5173' || url.hostname === 'demo.localhost'
      if (!own && url.protocol !== 'blob:' && url.protocol !== 'data:') foreign.push(url.href)
    })
    await page.emulateMedia({ colorScheme: scheme })
    await solidMaterials(page)
    await signUp(page)
    await seed(page)

    // (a reload would reset the demo world: in-app navigation only)
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
    await nav.getByRole('link', { name: /^Start/ }).click()
    await page.getByRole('link', { name: /Milas Geburtstag/ }).first().click()
    const bring = page.getByRole('button', { name: 'Aus meinen Listen holen' })
    await bring.scrollIntoViewIfNeeded()
    await bring.click()
    const lists = page.getByRole('dialog', { name: 'Aus meinen Listen holen' })
    await lists.getByRole('button', { name: /^Meine Wünsche/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Meine Wünsche' })
    await expect(sheet.getByRole('checkbox', { name: /Kaffeemühle/i })).toBeAttached()
    await expect(sheet.locator('[data-wish-thumb] img[data-loaded]')).toHaveCount(2, { timeout: 10_000 })
    await sheet.getByText('Handkaffeemühle „Kegel“').click()
    await settle(page)
    await page.screenshot({ path: `${OUT}/bring-photos-390-${scheme}.png` })

    const sources = await sheet.locator('[data-wish-thumb] img').evaluateAll((images) => images.map((image) => image.getAttribute('src') ?? ''))
    for (const source of sources) expect(source).toMatch(/^blob:http:\/\/localhost:5173\//)
    // the rows without photo keep their letter tile (and no <img>)
    const letterRow = sheet.locator('label', { hasText: 'Kinogutschein' })
    await expect(letterRow.locator('img')).toHaveCount(0)
    await expect(letterRow).toContainText('K')
    // the photo really lies over the tile (same box) — it was in the DOM before too, but cut off below the letter
    expect(await coverage(sheet.locator('[data-wish-thumb]:has(img)'))).toEqual([true, true])

    // the new-occasion form picks through the same sheet; the picked rows show the photo too
    await page.keyboard.press('Escape')
    await settle(page)
    await page.evaluate(async () => {
      const { router } = (await import(/* @vite-ignore */ '/src/router.tsx')) as { router: { navigate: (to: { to: string }) => Promise<void> } }
      await router.navigate({ to: '/occasions/new' })
    })
    await page.getByRole('button', { name: /Wünsche gleich eintragen/ }).click()
    await page.getByRole('button', { name: 'Aus meinen Listen holen' }).click()
    await page.getByRole('dialog', { name: 'Aus meinen Listen holen' }).getByRole('button', { name: /^Meine Wünsche/ }).click()
    const picker = page.getByRole('dialog', { name: 'Meine Wünsche' })
    await expect(picker.locator('[data-wish-thumb] img[data-loaded]')).toHaveCount(2, { timeout: 10_000 })
    await picker.getByText('Handkaffeemühle „Kegel“').click()
    await picker.getByText('Kinogutschein').click()
    await picker.getByText('Geburtstagskuchen-Backform').click()
    await picker.getByRole('button', { name: /^3 Wünsche/ }).click()
    await expect(picker).toBeHidden()
    const rows = page.locator('.ox-list-wishes')
    await expect(rows.locator('[data-wish-thumb] img[data-loaded]')).toHaveCount(2, { timeout: 10_000 })
    expect(await coverage(rows.locator('[data-wish-thumb]:has(img)'))).toEqual([true, true])
    await rows.scrollIntoViewIfNeeded()
    await settle(page)
    await page.screenshot({ path: `${OUT}/create-form-picked-390-${scheme}.png` })

    expect(foreign).toEqual([])
    expect(errors).toEqual([])
  })
}
