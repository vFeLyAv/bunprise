import { expect, test, type Page } from '@playwright/test'

// Selection mode on the owner's wish grid (Felix 30.10, request #4 — docs/handoffs/2026-10-30-multi-select.md):
// in the demo at phone size, a long press on a tile → all tiles wobble with circles → three selected → "Verschieben"
// into another own list. Also: back only ends selection mode, reduced motion = a calm outline, a friend's list has
// no selection. Screens + a few frames of the wobble into docs/screens/2026-10-30-multi-select/.

const OUT = '../../docs/screens/2026-10-30-multi-select'

async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
  })
  await page.waitForTimeout(400)
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

/** Two own lists: "Mein Geburtstag" with four wishes, "Bücher" with one. */
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
    const birthday = lists.newListId()
    await lists.createList({ id: birthday, title: 'Mein Geburtstag', visibility: 'followers', cover_tone: 3, cover_icon: 'cake', due_on: null })
    const books = lists.newListId()
    await lists.createList({ id: books, title: 'Bücher', visibility: 'private', cover_tone: 1, cover_icon: 'book', due_on: null })
    const add = async (listId: string, input: object, withPhoto: boolean) => {
      const wish = await wishes.createWish(listId, input)
      if (withPhoto) await wishPhotos.uploadWishPhoto(wish.id, product)
    }
    await add(birthday, { title: 'Kaffeemühle', price_cents: 8990, url: 'https://www.amazon.de/dp/B000TEST01', priority: 3 }, true)
    await add(birthday, { title: 'Kinogutschein', price_cents: 2500, url: null, priority: 2 }, false)
    await add(birthday, { title: 'Wanderrucksack 30 l', price_cents: 12900, url: 'https://www.zalando.de/rucksack-test', priority: 2 }, true)
    await add(birthday, { title: 'Pflanze für den Balkon', price_cents: null, url: null, priority: 1 }, false)
    await add(books, { title: 'Der Hobbit', price_cents: 1400, url: null, priority: 2 }, false)
  })
}

/** Mouse down on the tile's picture, resting 650 ms, up (the long press). */
async function longPress(page: Page, title: string) {
  const tile = page.locator('[data-wish-id]').filter({ hasText: title }).first()
  const box = await tile.locator('.wt-media').boundingBox()
  if (!box) throw new Error(`no tile ${title}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
}

const tile = (page: Page, title: string) => page.locator('[data-wish-id]').filter({ hasText: title }).first()
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Aktionen für die ausgewählten Wünsche' })
const count = (page: Page) => page.locator('[data-wish-selection-count]')

async function openOwnList(page: Page, title: string) {
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  if (await nav.count()) await nav.getByRole('link', { name: /^Listen/ }).click()
  await page.getByRole('link', { name: new RegExp(title) }).first().click()
  await page.waitForURL((url) => /\/lists\/[^/]+$/.test(url.pathname))
  await expect(page.locator('[data-wish-id]').first()).toBeVisible()
}

test('multi-select: long press, select 3, move to another list; back, reduced motion, friend view', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signUp(page)
  await seed(page)

  await openOwnList(page, 'Mein Geburtstag')
  await expect(page.locator('[data-wish-id]')).toHaveCount(4)
  await shot(page, 'a-list-before')

  // long press → selection mode: one selected, all wobbling, circles, the bars
  await longPress(page, 'Kaffeemühle')
  await expect(bar(page)).toBeVisible()
  await expect(count(page)).toHaveText('1 ausgewählt')
  await expect(page.locator('.wt[data-select="jiggle"]')).toHaveCount(4)
  await expect(page.getByRole('dialog')).toHaveCount(0) // the release opened no sheet
  await shot(page, 'b-selection-mode')
  // a few frames of the wobble (real time; the rotation differs frame to frame)
  const angles: string[] = []
  for (let i = 0; i < 5; i++) {
    await page.screenshot({ path: `${OUT}/c-jiggle-${String(i).padStart(2, '0')}.png`, clip: { x: 0, y: 140, width: 390, height: 420 } })
    angles.push(await page.locator('.wt-card').first().evaluate((el) => getComputedStyle(el).rotate))
    await page.waitForTimeout(70)
  }
  console.log('rotate per frame', angles.join(' | '))
  expect(new Set(angles).size).toBeGreaterThan(1)

  // two more: 3 selected
  // (force: a wobbling tile is never "stable" for Playwright's click check — a finger does not care)
  await tile(page, 'Kinogutschein').locator('.wt-open').click({ force: true })
  await tile(page, 'Wanderrucksack').locator('.wt-open').click({ force: true })
  await expect(count(page)).toHaveText('3 ausgewählt')
  await shot(page, 'd-three-selected')

  // Verschieben → the picker → "Bücher"
  await bar(page).getByRole('button', { name: 'In andere Liste verschieben' }).click()
  const picker = page.getByRole('dialog', { name: 'Wohin verschieben?' })
  await expect(picker).toBeVisible()
  await expect(picker.getByText('3 Wünsche verschieben nach …')).toBeVisible()
  await shot(page, 'e-move-picker')
  await picker.getByRole('button', { name: /^Bücher/ }).click()
  await expect(page.locator('[data-wish-id]')).toHaveCount(1)
  await expect(bar(page)).toHaveCount(0)
  await expect(page.getByText('3 Wünsche nach „Bücher“ verschoben')).toBeVisible()
  await shot(page, 'f-moved-toast')

  // "Bücher" has them now (navigate by clicking: a reload would reset the demo)
  await page.getByRole('button', { name: 'Zurück' }).first().click()
  await page.waitForURL((url) => url.pathname.replace(/\/$/, '').endsWith('/lists'))
  await openOwnList(page, 'Bücher')
  await expect(page.locator('[data-wish-id]')).toHaveCount(4)
  await shot(page, 'g-books-after')

  // back only ends selection mode: still on "Bücher"
  const here = page.url()
  await longPress(page, 'Der Hobbit')
  await expect(bar(page)).toBeVisible()
  await page.goBack()
  await expect(bar(page)).toHaveCount(0)
  await expect(page.locator('.wt[data-select]')).toHaveCount(0)
  expect(page.url()).toBe(here)
  await expect(page.locator('[data-wish-id]')).toHaveCount(4)
  // (the router puts the held-back entry back: let that settle before the next press)
  await page.waitForTimeout(1000)
  // Escape too
  await longPress(page, 'Der Hobbit')
  await expect(bar(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bar(page)).toHaveCount(0)

  // reduced motion: no wobble, a calm outline
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await longPress(page, 'Der Hobbit')
  await expect(bar(page)).toBeVisible()
  await expect(page.locator('.wt[data-select="calm"]')).toHaveCount(4)
  await expect(page.locator('.wt[data-select="jiggle"]')).toHaveCount(0)
  expect(await page.locator('.wt-card').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  await shot(page, 'h-reduced-motion-calm')
  await bar(page).page().getByRole('button', { name: 'Auswahl beenden' }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // a friend's list: a long press is just a press (its sheet), never selection mode
  await page.getByRole('button', { name: 'Zurück' }).first().click()
  await page.waitForURL((url) => url.pathname.replace(/\/$/, '').endsWith('/lists'))
  await page.getByRole('radio', { name: 'Freunde', exact: true }).click()
  const friendCard = page.locator('a[href^="/lists/"]').filter({ hasText: 'Anna' }).first()
  await friendCard.click()
  await page.waitForURL((url) => /\/lists\/[^/]+$/.test(url.pathname))
  await expect(page.locator('[data-wish-id]').first()).toBeVisible()
  const first = await page.locator('[data-wish-id]').first().innerText()
  await longPress(page, first.split('\n')[0] ?? '')
  await expect(page.locator('[data-wish-selection-bar]')).toHaveCount(0)
  await expect(page.locator('.wt[data-select]')).toHaveCount(0)
  await shot(page, 'i-friend-long-press')

  expect(errors).toEqual([])
})
