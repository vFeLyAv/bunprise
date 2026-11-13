import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// «Помпон в открытом списке» in the demo app (31.10, docs/handoffs/2026-10-31-list-play-in-app.md): Firefox at phone
// size, German. An own list with seven wishes: Pompon in the header, a boop, the ear, the shake (`__bunpriseShake()`,
// dev / demo only — a desktop has no sensor), «Erhalten» (the stamp), Löschen (bye), selection mode (holding his ears),
// «Verschieben» (he hops after the tiles), the end of the list; an empty list (the closed gift box, the peek, "+" = he
// jumps out, then the new-wish screen), the new wish (he pats it into place); at night (?night=1) he sleeps on his seat.
// Screens: docs/screens/2026-10-31-list-play-in-app/ (or SCREENS_OUT). Run from apps/web:
//   npx playwright test e2e/list-play-in-app-screens.spec.ts

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-31-list-play-in-app')
mkdirSync(OUT, { recursive: true })

async function open(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', baseURL: 'http://localhost:5173' })
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

async function signUp(page: Page, query = '') {
  await page.goto(`/login?mode=signup&method=email&frame=0${query}`)
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

/** "Mein Geburtstag" with ten wishes, "Bücher" with one, "Für später" empty. */
async function seed(page: Page) {
  await page.evaluate(async () => {
    const lists = (await import(/* @vite-ignore */ '/src/lib/api/lists.ts')) as { newListId: () => string; createList: (input: object) => Promise<{ id: string }> }
    const wishes = (await import(/* @vite-ignore */ '/src/lib/api/wishes.ts')) as { createWish: (listId: string, input: object) => Promise<{ id: string }> }
    const birthday = lists.newListId()
    await lists.createList({ id: birthday, title: 'Mein Geburtstag', visibility: 'followers', cover_tone: 3, cover_icon: 'cake', due_on: '2026-12-12' })
    const books = lists.newListId()
    await lists.createList({ id: books, title: 'Bücher', visibility: 'private', cover_tone: 1, cover_icon: 'book', due_on: null })
    const later = lists.newListId()
    await lists.createList({ id: later, title: 'Für später', visibility: 'followers', cover_tone: 2, cover_icon: 'star', due_on: null })
    for (const [title, price, priority] of [['Kaffeemühle', 8990, 3], ['Kinogutschein', 2500, 2], ['Wanderrucksack', 12900, 2], ['Teekanne', 3400, 2], ['Pflanze für den Balkon', null, 1], ['Puzzle 1000 Teile', 1900, 1], ['Socken mit Hasen', 900, 1], ['Kerze', 1200, 1], ['Brettspiel', 3900, 2], ['Thermobecher', 2200, 1]] as const) {
      await wishes.createWish(birthday, { title, price_cents: price, url: null, priority })
    }
    await wishes.createWish(books, { title: 'Der Hobbit', price_cents: 1400, url: null, priority: 2 })
  })
}

async function openOwnList(page: Page, title: string) {
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await nav.getByRole('link', { name: /^Listen/ }).click()
  await page.getByRole('link', { name: new RegExp(title) }).first().click()
  await page.waitForURL((url) => /\/lists\/[^/]+$/.test(url.pathname))
}

async function shot(page: Page, file: string, clip?: { x: number; y: number; width: number; height: number }) {
  await page.screenshot({ path: `${OUT}/${file}`, ...(clip ? { clip } : {}) })
}

/** His feet (client px) from his body's hit box (52 × 58, the feet 54 px below its top). */
async function feet(page: Page) {
  const hit = page.locator('.lp-hit').first()
  await hit.waitFor({ state: 'attached', timeout: 15_000 })
  const b = await hit.boundingBox()
  if (!b) throw new Error('no Pompon')
  return { x: b.x + 26, y: b.y + 54 }
}

const around = (p: { x: number; y: number }) => ({ x: Math.max(0, p.x - 150), y: Math.max(0, p.y - 120), width: 190, height: 150 })

test('the list Pompon by day', async ({ browser }) => {
  test.setTimeout(240_000)
  const { context, page, errors } = await open(browser)
  await signUp(page)
  await seed(page)
  await openOwnList(page, 'Mein Geburtstag')
  await expect(page.locator('[data-wish-id]')).toHaveCount(10)
  const f = await feet(page)
  await page.waitForTimeout(800)
  await shot(page, '01-header.png')
  await shot(page, '01b-header-closeup.png', around(f))

  // boop: a tap on his nose
  await page.mouse.click(f.x, f.y - 25)
  await page.waitForTimeout(230)
  await shot(page, '02-boop.png', around(f))
  await page.waitForTimeout(1400)

  // the ear: press its tip and pull sideways
  await page.mouse.move(f.x + 19, f.y - 36)
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.move(f.x + 30, f.y - 32, { steps: 6 })
  await shot(page, '03-ear-pulled.png', around(f))
  await page.mouse.up()
  await page.waitForTimeout(1900)

  // the shake (dev / demo: no sensor on a desktop)
  expect(await page.evaluate(() => (globalThis as { __bunpriseShake?: () => boolean }).__bunpriseShake?.() ?? false)).toBe(true)
  await page.waitForTimeout(1000)
  await shot(page, '04-dizzy.png', around(f))
  await page.waitForTimeout(2200)

  // «Erhalten» from the ⋯: he hops over and stamps it
  await page.getByRole('button', { name: 'Mehr zu „Kinogutschein“' }).click()
  await page.getByRole('dialog', { name: 'Kinogutschein' }).getByRole('button', { name: 'Als erhalten markieren' }).click()
  await page.waitForTimeout(1350)
  await shot(page, '05-received-stamp.png')
  await page.waitForTimeout(700)
  await shot(page, '05b-received-binky.png')
  await page.waitForTimeout(2500)
  await expect(page.locator('[data-wish-id]').filter({ hasText: 'Kinogutschein' })).toHaveCount(0)

  // Löschen: he waves "bye"
  await page.getByRole('button', { name: 'Mehr zu „Teekanne“' }).click()
  await page.getByRole('dialog', { name: 'Teekanne' }).getByRole('button', { name: /Wunsch löschen/ }).click()
  await page.waitForTimeout(600)
  await shot(page, '06-delete-bye.png')
  await page.waitForTimeout(1500)
  await shot(page, '06b-delete-dust.png', around(f))
  await page.waitForTimeout(1000)

  // selection mode: a long press — he holds his ears
  const media = await page.locator('[data-wish-id]').filter({ hasText: 'Wanderrucksack' }).locator('.wt-media').boundingBox()
  if (!media) throw new Error('no tile')
  await page.mouse.move(media.x + media.width / 2, media.y + media.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
  await page.waitForTimeout(1600)
  await shot(page, '07-select-ears.png')
  // «Verschieben» → Bücher: the tile flies to the edge, he hops after it
  await page.getByRole('toolbar', { name: 'Aktionen für die ausgewählten Wünsche' }).getByRole('button', { name: 'In andere Liste verschieben' }).click()
  await page.getByRole('dialog', { name: 'Wohin verschieben?' }).getByRole('button', { name: /^Bücher/ }).click()
  await page.waitForTimeout(450)
  await shot(page, '08-move-fly.png')
  await page.waitForTimeout(700)
  await shot(page, '08b-move-look.png', around(f))
  await page.waitForTimeout(1500)

  // the end of the list: he is found there and waves «Das war’s!»
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(1500)
  await shot(page, '09-end.png')
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(250)
  await shot(page, '09b-end-bounce.png')

  expect(errors).toEqual([])
  await context.close()
})

test('the empty list: the gift box, "+" and the new wish', async ({ browser }) => {
  test.setTimeout(180_000)
  const { context, page, errors } = await open(browser)
  await signUp(page)
  await seed(page)
  await openOwnList(page, 'Für später')
  const box = page.locator('[data-pompon-box]')
  await expect(box).toBeVisible()
  await shot(page, '10-empty-closed.png')
  // the first peek ≈ 1 s after the screen opened
  await page.waitForTimeout(1200)
  await shot(page, '11-empty-peek.png')
  await page.waitForTimeout(2500)
  // "+": he knocks the lid off and jumps out, then the new-wish screen opens
  await page.getByRole('link', { name: /Wunsch hinzufügen/ }).click()
  await page.waitForTimeout(800)
  await shot(page, '12-empty-pop.png')
  await page.waitForURL((url) => url.pathname.endsWith('/wishes/new'), { timeout: 8000 })
  // the new wish: back in the list he pats it into place
  await page.getByRole('button', { name: 'Ohne Link hinzufügen', exact: true }).click()
  await page.getByLabel('Titel', { exact: true }).fill('Sofortbildkamera')
  await page.getByRole('button', { name: 'Wunsch hinzufügen', exact: true }).click()
  await page.waitForURL((url) => /\/lists\/[^/]+$/.test(url.pathname))
  await expect(page.locator('[data-wish-id]')).toHaveCount(1)
  await page.waitForTimeout(1500)
  await shot(page, '13-new-wish-pat.png')
  await page.waitForTimeout(2500)
  await shot(page, '13b-new-wish-after.png')
  expect(errors).toEqual([])
  await context.close()
})

test('at night he sleeps on his seat; a tap wakes him', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page, errors } = await open(browser)
  await signUp(page, '&night=1')
  await seed(page)
  await openOwnList(page, 'Mein Geburtstag')
  const sleeper = page.locator('[data-night="bunny"]')
  await expect(sleeper).toBeAttached({ timeout: 15_000 })
  await page.waitForTimeout(800)
  await shot(page, '14-night-asleep.png')
  const hit = await sleeper.locator('.nt-hit').boundingBox()
  if (!hit) throw new Error('no sleeper')
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2)
  await page.waitForTimeout(800)
  await shot(page, '15-night-woken.png')
  // the day's Pompon takes over on his seat
  await expect(page.locator('.lp-actor')).toBeAttached({ timeout: 8000 })
  await expect(sleeper).toHaveCount(0)
  await page.waitForTimeout(500)
  await shot(page, '16-night-awake.png')
  expect(errors).toEqual([])
  await context.close()
})
