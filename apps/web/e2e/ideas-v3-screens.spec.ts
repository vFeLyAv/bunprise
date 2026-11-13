import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// "Ideen" v3 (Felix 27.10) in the demo, Firefox at phone size, light and dark: the first-time swipe hint (the card
// nudges, a quiet line), a sporty list of my own → "Für mich" starts with athleisure ideas (taste directions read
// on the device from the brands), a book's sheet with "Worum geht's", and the search inside a topic.
// Screens go to $SCREENS_OUT, default docs/screens/2026-10-27-ideas-v3/.

const OUT = process.env.SCREENS_OUT ?? resolve(process.cwd(), '../../docs/screens/2026-10-27-ideas-v3')
mkdirSync(OUT, { recursive: true })

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
  await page.waitForTimeout(400)
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

/** A sporty list of my own (fictional wishes; the brands are only read on the device). */
async function seedSportyList(page: Page) {
  await page.evaluate(async () => {
    const lists = (await import(/* @vite-ignore */ '/src/lib/api/lists.ts')) as {
      newListId: () => string
      createList: (input: object) => Promise<{ id: string }>
    }
    const wishes = (await import(/* @vite-ignore */ '/src/lib/api/wishes.ts')) as {
      createWish: (listId: string, input: object) => Promise<{ id: string }>
    }
    const list = lists.newListId()
    await lists.createList({ id: list, title: 'Mein Geburtstag', visibility: 'followers', cover_tone: 2, cover_icon: 'cake', due_on: null })
    await wishes.createWish(list, { title: 'Gymshark Vital Seamless Leggings', price_cents: 4500, url: 'https://de.gymshark.com/products/vital-seamless', priority: 3 })
    await wishes.createWish(list, { title: 'Laufschuhe Pegasus 41', price_cents: 13000, url: 'https://www.nike.com/de/t/pegasus-41', priority: 2 })
    await wishes.createWish(list, { title: 'Proteinshaker mit Fach', price_cents: 1500, url: null, priority: 1 })
  })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`Ideen v3 (${scheme})`, async ({ browser }) => {
    test.setTimeout(150_000)
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
    await seedSportyList(page)

    // 1. the first-time swipe hint: caught mid-nudge (the card leans left, the line is there)
    await page.getByRole('navigation').getByRole('link', { name: 'Ideen' }).click()
    await page.getByRole('radio', { name: 'Für mich' }).click()
    await expect(page.locator('.gift-swipe-hint[data-shown]')).toBeVisible({ timeout: 20_000 })
    await page.evaluate(() => window.scrollTo(0, 120))
    await page.waitForTimeout(1050)
    await page.screenshot({ path: `${OUT}/1-swipe-hint-${scheme}.png` })

    // 2. the sporty list: athleisure ideas first (after the hint has gone)
    await expect(page.locator('.gift-swipe-hint[data-shown]')).toHaveCount(0, { timeout: 12_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/2-sporty-list-deck-${scheme}.png` })
    await page.locator('section[aria-labelledby="gifts-why"]').scrollIntoViewIfNeeded()
    await settle(page)
    await page.screenshot({ path: `${OUT}/2b-ideen-anpassen-${scheme}.png` })

    // 3. books: a book's sheet with "Worum geht's"
    await page.locator('[data-topic="buecher"]').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Bücher' }).first()).toBeVisible()
    const bookCard = page.locator('.topic-card').filter({ has: page.locator('.topic-facts') }).first()
    await expect(bookCard).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/3-buecher-${scheme}.png` })
    await bookCard.locator('.topic-card-open').click()
    const sheet = page.getByRole('dialog').last()
    await expect(sheet.getByRole('heading', { name: 'Worum geht’s' })).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/3b-buch-worum-gehts-${scheme}.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Worum geht’s' })).toHaveCount(0)

    // 4. the search inside a topic (Brettspiele)
    await page.getByRole('button', { name: 'Ideen' }).first().click()
    await page.locator('[data-topic="brettspiele"]').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Brettspiele' }).first()).toBeVisible()
    await expect(page.locator('[data-idea="cat:hig-carcassonne"]')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Im Thema suchen' }).click()
    await page.getByRole('searchbox').fill('flügel')
    await page.evaluate(() => window.scrollTo(0, 420))
    await settle(page)
    await page.screenshot({ path: `${OUT}/4-suche-${scheme}.png` })

    expect([...foreign]).toEqual([])
    await context.close()
  })
}
