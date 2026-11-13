import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// "Anzahl" + "Passt zusammen" (Felix 30.10, 20261030120000) in the demo (both flags on there), Firefox at phone size
// (390 × 844, playwright config): (1) the wish form with the − n + stepper, (2) the owner's sheet ("4 Stück",
// "Passt zusammen mit"), (3) the owner's ⋯ and the "Passt gut zu …" picker, (4) a friend's sheet in Anna's list with
// "Passt zusammen mit: Duftkerze" and "Beides reservieren", (5) after the joint reservation. Screens go to
// docs/screens/2026-10-30-quantity-together/. Also asserts on the way: no page errors, nothing from foreign hosts.

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-30-quantity-together')
mkdirSync(OUT, { recursive: true })

// Headless Firefox does not paint backdrop-filter: the screens use the app's own solid material (as in
// wish-details-screens.spec.ts).
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
  await page.waitForTimeout(600)
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

/** Mila's own list: 4 AirTags, a steering wheel linked with a handbrake, a book (through the app's own API modules). */
async function seed(page: Page) {
  await page.evaluate(async () => {
    const lists = (await import(/* @vite-ignore */ '/src/lib/api/lists.ts')) as {
      newListId: () => string
      createList: (input: object) => Promise<{ id: string }>
    }
    const wishes = (await import(/* @vite-ignore */ '/src/lib/api/wishes.ts')) as {
      createWish: (listId: string, input: object) => Promise<{ id: string }>
    }
    const extras = (await import(/* @vite-ignore */ '/src/lib/api/wishExtras.ts')) as {
      setWishLinks: (wishId: string, ids: string[]) => Promise<unknown>
    }
    const list = lists.newListId()
    await lists.createList({ id: list, title: 'Sim-Racing', visibility: 'followers', cover_tone: 2, cover_icon: 'game', due_on: null })
    await wishes.createWish(list, { title: 'AirTag', price_cents: 3500, url: null, priority: 2, quantity: 4 })
    const wheel = await wishes.createWish(list, { title: 'Lenkrad mit Pedalen', price_cents: 29900, url: null, priority: 3 })
    const brake = await wishes.createWish(list, { title: 'Handbremse', price_cents: 8900, url: null, priority: 2 })
    await wishes.createWish(list, { title: 'Rennspiel', price_cents: 5900, url: null, priority: 1 })
    await extras.setWishLinks(wheel.id, [brake.id])
    const query = (await import(/* @vite-ignore */ '/src/lib/query.ts')) as { queryClient: { invalidateQueries: () => Promise<void> } }
    await query.queryClient.invalidateQueries()
  })
}

test('quantity and "Passt zusammen": form, owner sheet and picker, friend sheet and the joint reservation', async ({ page }) => {
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

  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await nav.getByRole('link', { name: /^Listen/ }).click()
  await page.getByRole('link', { name: /Sim-Racing/ }).click()
  await expect(page.getByRole('button', { name: /AirTag/ }).first()).toBeVisible({ timeout: 15_000 })
  await shot(page, '00-owner-list-390')

  // 1. the form: the AirTag's edit screen, the stepper under "Wie sehr?"
  await page.getByRole('button', { name: 'Mehr zu „AirTag“' }).click()
  await page.getByRole('link', { name: 'Bearbeiten', exact: true }).click()
  const stepper = page.locator('[data-quantity-stepper]')
  await expect(stepper).toBeVisible({ timeout: 15_000 })
  await expect(stepper.locator('output')).toHaveText('4')
  await stepper.scrollIntoViewIfNeeded()
  // by keyboard (the form may still be settling under the pointer): focus + Enter, like a keyboard user
  await stepper.getByRole('button', { name: 'Eins mehr' }).focus()
  await page.keyboard.press('Enter')
  await expect(stepper.locator('output')).toHaveText('5')
  await stepper.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await shot(page, '01-form-stepper-390')
  await stepper.getByRole('button', { name: 'Eins weniger' }).focus()
  await page.keyboard.press('Enter') // back to 4: leave without changes
  await expect(stepper.locator('output')).toHaveText('4')
  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await expect(page.getByRole('button', { name: /AirTag/ }).first()).toBeVisible()

  // 2. the owner's sheets: "4 Stück", and the wheel with "Passt zusammen mit: Handbremse"
  await page.getByRole('button', { name: /AirTag/ }).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('[data-fact="quantity"]')).toContainText('4 Stück')
  await shot(page, '02-owner-sheet-quantity-390')
  await page.keyboard.press('Escape')
  await settle(page)
  await page.getByRole('button', { name: /Lenkrad mit Pedalen/ }).first().click()
  await expect(page.getByRole('dialog').locator('[data-wish-together]')).toContainText('Handbremse')
  await shot(page, '03-owner-sheet-together-390')
  // a tap on the partner opens its sheet (the link back)
  await page.getByRole('dialog').locator('[data-wish-together] button', { hasText: 'Handbremse' }).click()
  await expect(page.getByRole('dialog').locator('[data-wish-together]')).toContainText('Lenkrad mit Pedalen')
  await page.keyboard.press('Escape')
  await settle(page)

  // 3. the owner's ⋯ → "Passt gut zu …" → the picker
  await page.getByRole('button', { name: 'Mehr zu „Lenkrad mit Pedalen“' }).click()
  await expect(page.getByRole('button', { name: /Passt gut zu/ })).toBeVisible()
  await shot(page, '04-owner-menu-390')
  await page.getByRole('button', { name: /Passt gut zu/ }).click()
  const picker = page.locator('[data-together-picker]')
  await expect(picker.getByRole('checkbox', { name: /Handbremse/ })).toHaveAttribute('aria-checked', 'true')
  await shot(page, '05-owner-picker-390')
  await page.keyboard.press('Escape')
  await settle(page)

  // 4. a friend's view: Anna's list, the board game linked with the candle; the voucher asks for 2
  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await nav.getByRole('link', { name: /^Start/ }).click()
  await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
  const game = page.getByRole('button', { name: /Brettspiel für zwei/ }).first()
  await game.scrollIntoViewIfNeeded()
  await game.click()
  const guestSheet = page.getByRole('dialog')
  await expect(guestSheet.locator('[data-wish-together]')).toContainText('Duftkerze')
  await expect(guestSheet.getByRole('button', { name: 'Beides reservieren' })).toBeVisible()
  await shot(page, '06-friend-sheet-together-390')
  await guestSheet.locator('[data-reserve-together]').scrollIntoViewIfNeeded()
  await shot(page, '06b-friend-sheet-buttons-390')

  // 5. "Beides reservieren": one server call, both reserved by Mila
  await guestSheet.getByRole('button', { name: 'Beides reservieren' }).click()
  await expect(page.getByText('Versteckt! Alle 2 sind von dir reserviert.').first()).toBeVisible({ timeout: 10_000 })
  await shot(page, '07-friend-reserved-both-390')
  await page.keyboard.press('Escape')
  await settle(page)
  await shot(page, '08-friend-list-after-390')

  const voucher = page.getByRole('button', { name: /Kinogutschein/ }).first()
  await voucher.scrollIntoViewIfNeeded()
  await voucher.click()
  await expect(page.getByRole('dialog').locator('[data-fact="quantity"]')).toContainText('2 Stück')
  await shot(page, '09-friend-sheet-quantity-390')

  expect(foreign).toEqual([])
  expect(errors).toEqual([])
})
