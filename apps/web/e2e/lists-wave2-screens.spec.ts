import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Lists wave 2 (Felix 22.10) in the demo, Firefox at phone size (390 × 844, 2× pixels): "Listen" without occasions,
// list cards with a cover photo and the graphic count, the list screen's cover hero (frames of the card → header
// transition), the square wish tiles (owner and friend), the ⋯ of a wish (move picker, "Erhalten"), the list's ⋯,
// and the same at 320 px. Screens go to docs/screens/2026-10-22-lists-wave2/.
// The demo resets on reload: everything below navigates inside the app after seeding through the app's own API
// modules (the same module instances the app uses, served by Vite).

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-22-lists-wave2')
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

/** Frames in real time while something moves (no settling). */
async function frames(page: Page, name: string, count: number, everyMs: number) {
  for (let i = 0; i < count; i++) {
    await page.screenshot({ path: `${OUT}/${name}-${String(i).padStart(2, '0')}.png` })
    await page.waitForTimeout(everyMs)
  }
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

/** Two own lists (one with a cover), wishes with and without photo, one occasion (must not show in "Listen"). */
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
    const listPhotos = (await import(/* @vite-ignore */ '/src/lib/api/listPhotos.ts')) as {
      uploadListPhoto: (listId: string, photo: object) => Promise<unknown>
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

    const made: string[] = []
    const add = async (listId: string, input: object, withPhoto: boolean) => {
      const wish = await wishes.createWish(listId, input)
      if (withPhoto) await wishPhotos.uploadWishPhoto(wish.id, product)
      made.push(wish.id)
    }
    await add(birthday, { title: 'Kaffeemühle mit Keramik-Mahlwerk', price_cents: 8990, url: 'https://www.amazon.de/dp/B000TEST01', priority: 3, brand: 'Kegel', color: 'Walnuss', description: 'Handkaffeemühle aus Walnussholz mit Keramik-Mahlwerk. Der Mahlgrad lässt sich stufenlos von fein (Espresso) bis grob (French Press) einstellen. Die Schublade fasst etwa 30 g Kaffee. Das Mahlwerk ist rostfrei und lässt sich ohne Werkzeug zum Reinigen herausnehmen.' }, true)
    await add(birthday, { title: 'Kinogutschein', price_cents: 2500, url: null, priority: 2 }, false)
    await add(birthday, { title: 'Wanderrucksack 30 l', price_cents: 12900, url: 'https://www.zalando.de/rucksack-test', priority: 2 }, true)
    await add(birthday, { title: 'Pflanze für den Balkon', price_cents: null, url: 'https://www.ikea.com/de/de/p/test', priority: 1 }, false)
    await add(books, { title: 'Der Hobbit', price_cents: 1400, url: null, priority: 2 }, false)
    return { birthday, books, made }
  })
}

test('lists wave 2: Listen, covers, hero transition, wish tiles, menus', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await solidMaterials(page)
  await signUp(page)
  const seeded = await seed(page)
  console.log('seeded', JSON.stringify(seeded))

  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await nav.getByRole('link', { name: /^Listen/ }).click()
  await expect(page.getByRole('link', { name: /Mein Geburtstag/ })).toBeVisible()
  await shot(page, 'a-listen-meine-390')

  // a list card's ⋯
  await page.getByRole('button', { name: 'Einstellungen für „Mein Geburtstag“' }).click()
  await shot(page, 'b-list-card-menu-390')
  await page.keyboard.press('Escape')
  await settle(page)

  // Freunde: the people the demo account follows (Anna's "Geburtstag" has a cover)
  await page.getByRole('radio', { name: 'Freunde', exact: true }).click()
  await shot(page, 'c-listen-freunde-390')
  await page.mouse.wheel(0, 600)
  await shot(page, 'c-listen-freunde-scrolled-390')

  // open a friend's list with a cover: frames of the card → hero transition
  const friendCard = page.locator('a[href^="/lists/"]').filter({ hasText: 'Anna' }).filter({ hasText: 'Geburtstag' }).first()
  await friendCard.scrollIntoViewIfNeeded()
  await friendCard.click()
  await frames(page, 'd-friend-open', 8, 60)
  await shot(page, 'd-friend-list-390')
  // the hero as Felix sees it (with transparency: the photo dissolves into the paper)
  await page.evaluate(() => document.documentElement.removeAttribute('data-transparency'))
  await shot(page, 'd-friend-list-glass-390')
  await page.evaluate(() => document.documentElement.setAttribute('data-transparency', 'reduce'))
  await page.mouse.wheel(0, 500)
  await shot(page, 'd-friend-list-grid-390')
  const received = page.getByRole('button', { name: /Schon erhalten/ })
  if (await received.count()) {
    await received.first().scrollIntoViewIfNeeded()
    await received.first().click()
    await shot(page, 'd-friend-received-open-390')
  }

  // my list with a cover (inside a list there is no tab bar: back through the history, no reload)
  await page.goBack()
  await expect(page.getByRole('radio', { name: 'Meine', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'Meine', exact: true }).click()
  await settle(page)
  await page.getByRole('link', { name: /Mein Geburtstag/ }).click()
  await frames(page, 'e-owner-open', 8, 60)
  await shot(page, 'e-owner-list-390')
  await page.evaluate(() => document.documentElement.removeAttribute('data-transparency'))
  await shot(page, 'e-owner-list-glass-390')
  await page.evaluate(() => document.documentElement.setAttribute('data-transparency', 'reduce'))
  await page.mouse.wheel(0, 400)
  await shot(page, 'e-owner-grid-390')

  // the list screen's own ⋯
  const headerMenu = page.getByRole('button', { name: /^(Mehr|Einstellungen für „Mein Geburtstag“)$/ }).first()
  if (await headerMenu.count()) {
    await headerMenu.click()
    await shot(page, 'f-list-screen-menu-390')
    await page.keyboard.press('Escape')
    await settle(page)
  }

  // a wish's ⋯ → menu, move picker, priority, received
  await page.getByRole('button', { name: 'Mehr zu „Kinogutschein“' }).click()
  await shot(page, 'g-wish-menu-390')
  await page.getByRole('button', { name: 'In andere Liste verschieben' }).click()
  // a lazy chunk: wait for the picker itself, then for its rows
  await expect(page.locator('[data-move-picker]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-move-picker]').getByText('Bücher')).toBeVisible({ timeout: 15_000 })
  await shot(page, 'h-move-picker-390')
  await page.keyboard.press('Escape')
  await settle(page)

  await page.getByRole('button', { name: 'Mehr zu „Kinogutschein“' }).click()
  await page.getByRole('button', { name: 'Wie sehr wünschst du es dir?' }).click()
  await shot(page, 'i-priority-picker-390')
  await page.keyboard.press('Escape')
  await settle(page)

  await page.getByRole('button', { name: 'Mehr zu „Kinogutschein“' }).click()
  await page.getByRole('button', { name: 'Als erhalten markieren' }).click()
  await frames(page, 'j-received-anim', 6, 80)
  await shot(page, 'j-after-received-390')
  const ownReceived = page.getByRole('button', { name: /^Erhalten/ })
  if (await ownReceived.count()) {
    await ownReceived.first().scrollIntoViewIfNeeded()
    await ownReceived.first().click()
    await shot(page, 'j-received-open-390')
  }

  // the wish sheet (tap a tile)
  await page.getByRole('button', { name: /Kaffeemühle/ }).first().click()
  await shot(page, 'k-owner-wish-sheet-390')
  // the end of the sheet: the shop's product text comes last (Felix 23.10)
  await page.locator('[data-wish-description]').scrollIntoViewIfNeeded()
  await shot(page, 'k-owner-wish-sheet-end-390')
  await page.keyboard.press('Escape')
  await settle(page)

  // 320 px
  await page.setViewportSize({ width: 320, height: 700 })
  await page.mouse.wheel(0, -2000)
  await shot(page, 'l-owner-list-320')
  await page.mouse.wheel(0, 400)
  await shot(page, 'l-owner-grid-320')
  await page.goBack()
  await expect(page.getByRole('radio', { name: 'Meine', exact: true })).toBeVisible()
  await shot(page, 'l-listen-meine-320')

  console.log('page errors:', errors.length ? errors.join(' | ') : 'none')
})
