import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// The very dark theme "Schwarz" (Felix 27.10, docs/handoffs/2026-10-27-black-theme.md) in the demo, Firefox at phone
// size (390 × 844, 2× pixels): the launch screen, the landing, Start, Listen, a list with wish tiles, a wish sheet,
// the "+" menu, an occasion, the Ideen deck and Profil (Farbschema) — in "Schwarz" and, for comparison, "Dunkel".
// Headless Firefox does not paint backdrop-filter, so the screens use the app's solid materials (as the other screen
// specs do); one extra "glass" run in "Schwarz" keeps the translucent materials (= what a browser without blur shows).
// Screens go to docs/screens/2026-10-27-black-theme/ (or SCREENS_OUT).

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-black-theme')
mkdirSync(OUT, { recursive: true })

test.use({ deviceScaleFactor: 2 })

type Theme = 'black' | 'dark'

async function prepare(page: Page, theme: Theme, solid = true) {
  await page.addInitScript(([value, reduce]) => {
    try { localStorage.setItem('bunprise.theme', value) } catch { /* private mode */ }
    if (!reduce) return
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  }, [theme, solid] as const)
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
    await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)))
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
  await page.getByLabel('Name', { exact: true }).fill('Mila Sommer')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
  await page.waitForURL('**/soon')
}

/** An own list with a cover photo and wishes with and without photo, and an own occasion in a few days. */
async function seed(page: Page) {
  await page.evaluate(async () => {
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
    const listPhotos = (await import(/* @vite-ignore */ '/src/lib/api/listPhotos.ts')) as {
      uploadListPhoto: (listId: string, photo: object) => Promise<unknown>
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
    const cover = await photo('/src/mocks/assets/demo-list-christmas.webp')
    const birthday = lists.newListId()
    await lists.createList({ id: birthday, title: 'Mein Geburtstag', visibility: 'followers', cover_tone: 3, cover_icon: 'cake', due_on: null })
    await listPhotos.uploadListPhoto(birthday, cover)
    const books = lists.newListId()
    await lists.createList({ id: books, title: 'Bücher', visibility: 'private', cover_tone: 1, cover_icon: 'book', due_on: null })
    const add = async (listId: string, input: object, withPhoto: boolean) => {
      const wish = await wishes.createWish(listId, input)
      if (withPhoto) await wishPhotos.uploadWishPhoto(wish.id, product)
    }
    await add(birthday, { title: 'Kaffeemühle mit Keramikmahlwerk', price_cents: 8990, url: 'https://www.amazon.de/dp/B000TEST01', priority: 3, brand: 'Kegel', color: 'Nuss', description: 'Handmühle aus Nussholz, Mahlgrad von Espresso bis French Press.' }, true)
    await add(birthday, { title: 'Kinogutschein', price_cents: 2500, url: null, priority: 2 }, false)
    await add(birthday, { title: 'Wanderrucksack 30 l', price_cents: 12900, url: 'https://www.zalando.de/rucksack-test', priority: 2 }, true)
    await add(birthday, { title: 'Pflanze für den Balkon', price_cents: null, url: 'https://www.ikea.com/de/de/p/test', priority: 1 }, false)
    await add(books, { title: 'Der Hobbit', price_cents: 1400, url: null, priority: 2 }, false)
    const inFiveDays = new Date(Date.now() + 5 * 86_400_000)
    inFiveDays.setUTCHours(16, 0, 0, 0)
    await occasions.createOccasion({ title: 'Milas Geburtstag', starts_at: inFiveDays.toISOString(), tz: 'Europe/Berlin', all_day: false, place_text: 'Café am Markt' })
    const query = (await import(/* @vite-ignore */ '/src/lib/query.ts')) as { queryClient: { invalidateQueries: () => Promise<void> } }
    await query.queryClient.invalidateQueries()
  })
}

async function begin(page: Page, theme: Theme, solid = true) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await prepare(page, theme, solid)
  await signUp(page)
  await seed(page)
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await nav.getByRole('link', { name: /^Start/ }).click()
  await expect(page.getByText('Milas Geburtstag').first()).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  return { nav, errors }
}

for (const theme of ['black', 'dark'] as const) {
  test(`launch screen and landing (${theme})`, async ({ page }) => {
    await prepare(page, theme)
    await page.goto('/?frame=0', { waitUntil: 'commit' })
    await page.locator('#bp-splash').waitFor({ state: 'attached' })
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${OUT}/a-splash-${theme}-390.png` })
    await expect(page.locator('#bp-splash')).toHaveCount(0, { timeout: 10_000 })
    await shot(page, `b-landing-${theme}-390`)
  })

  test(`Start, Listen, a list, a wish sheet, the "+" menu, an occasion (${theme})`, async ({ page }) => {
    test.setTimeout(180_000)
    const { nav, errors } = await begin(page, theme)
    await shot(page, `c-start-${theme}-390`)
    await page.mouse.wheel(0, 500)
    await shot(page, `c-start-scrolled-${theme}-390`)

    await nav.getByRole('link', { name: /^Listen/ }).click()
    await expect(page.getByRole('link', { name: /Mein Geburtstag/ })).toBeVisible()
    await shot(page, `d-lists-${theme}-390`)
    await page.getByRole('link', { name: /Mein Geburtstag/ }).click()
    await expect(page.getByRole('button', { name: /Kaffeemühle/ }).first()).toBeVisible({ timeout: 15_000 })
    await shot(page, `e-list-${theme}-390`)
    await page.mouse.wheel(0, 400)
    await shot(page, `e-list-tiles-${theme}-390`)
    await page.getByRole('button', { name: /Kaffeemühle/ }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await shot(page, `f-wish-sheet-${theme}-390`)
    await page.keyboard.press('Escape')
    await settle(page)
    // a list has no tab bar: back to Listen for the "+"
    await page.goBack()
    await expect(page.getByRole('link', { name: /Mein Geburtstag/ })).toBeVisible()
    await settle(page)

    await page.getByRole('button', { name: 'Neu erstellen', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Was möchtest du erstellen?' })).toBeVisible()
    await shot(page, `g-plus-menu-${theme}-390`)
    await page.keyboard.press('Escape')
    await settle(page)

    await nav.getByRole('link', { name: /^Start/ }).click()
    await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
    await expect(page.getByRole('radiogroup', { name: 'Deine Antwort' })).toBeAttached({ timeout: 15_000 })
    await shot(page, `h-occasion-${theme}-390`)
    await page.mouse.wheel(0, 700)
    await shot(page, `h-occasion-scrolled-${theme}-390`)
    console.log(`[${theme}] page errors:`, errors.length ? errors.join(' | ') : 'none')
  })

  test(`Ideen deck and Profil with the Farbschema (${theme})`, async ({ page }) => {
    test.setTimeout(180_000)
    const { nav, errors } = await begin(page, theme)
    await nav.getByRole('link', { name: /^Ideen/ }).click()
    await expect(page.getByRole('region', { name: 'Geschenkideen' }).getByRole('article').first()).toBeVisible({ timeout: 30_000 })
    await shot(page, `i-ideas-${theme}-390`)

    await nav.getByRole('link', { name: /^Profil/ }).click()
    await page.waitForURL('**/settings')
    await shot(page, `j-profile-${theme}-390`)
    const scheme = page.getByRole('radiogroup', { name: 'Farbschema' })
    await scheme.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await shot(page, `j-profile-scheme-${theme}-390`)
    console.log(`[${theme}] page errors:`, errors.length ? errors.join(' | ') : 'none')
  })
}

// "Schwarz" with the translucent materials (no reduce-transparency): what shows through the bars, the tab capsules and
// the sheet when nothing blurs (headless Firefox paints no backdrop-filter)
test('Schwarz without solid materials: top bar over content, tab bar, a sheet', async ({ page }) => {
  test.setTimeout(180_000)
  const { nav } = await begin(page, 'black', false)
  await nav.getByRole('link', { name: /^Listen/ }).click()
  await page.getByRole('link', { name: /Mein Geburtstag/ }).click()
  await expect(page.getByRole('button', { name: /Kaffeemühle/ }).first()).toBeVisible({ timeout: 15_000 })
  await page.mouse.wheel(0, 500)
  await shot(page, 'k-glass-list-scrolled-black-390')
  await page.getByRole('button', { name: /Kaffeemühle/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await shot(page, 'k-glass-wish-sheet-black-390')
})
