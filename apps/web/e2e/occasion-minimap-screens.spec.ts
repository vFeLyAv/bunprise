import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// The mini map on the OCCASION SCREEN (Felix 27.10: «мини-карта в событии, просто где точка»; migration
// 20261027190000), in the demo, Firefox at phone size (390 × 844, 2× pixels), light and dark: as a guest (Anna's
// housewarming carries an invented point) and as the host of a new occasion whose place was picked with a point.
// The demo's tiles are ONE fictional placeholder (src/mocks/places.ts). Also asserts the privacy rule: the map's
// <img>s show blob: URLs and the page never requests a foreign host.
// Screens go to $OCC_MINIMAP_OUT, else docs/screens/2026-10-27-occasion-minimap/.

const OUT = process.env.OCC_MINIMAP_OUT ? resolve(process.env.OCC_MINIMAP_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-occasion-minimap')
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

const HOUSEWARMING = 'd1e0b000-0000-4000-8000-000000000001' // src/mocks/fixtures.ts DEMO_OCCASIONS

/** In-app navigation (a reload would reset the demo). */
async function go(page: Page, to: string) {
  await page.evaluate(async (target) => {
    const { router } = await import('/src/router.tsx')
    await router.navigate({ to: target })
  }, to)
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

/** The strip has loaded: scroll the place block into the middle and take the screen + the hero card. */
async function stripShots(page: Page, name: string) {
  const strip = page.locator('[data-minimap][data-variant="strip"][data-ready]')
  await expect(strip).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/© OpenStreetMap/)).toBeVisible()
  await strip.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  await page.locator('.occasion-hero').screenshot({ path: `${OUT}/${name}-card.png` })
}

test('occasion screen: the mini map under the place, guest and host, light and dark', async ({ page }) => {
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

  // 1. guest: Anna's housewarming (an invented point in the invented town)
  await page.locator(`a[href$="/occasions/${HOUSEWARMING}"]`).first().click()
  await expect(page).toHaveURL(new RegExp(HOUSEWARMING))
  await stripShots(page, '01-guest-light-390')
  await page.emulateMedia({ colorScheme: 'dark' })
  await stripShots(page, '02-guest-dark-390')

  // 2. host: a new occasion, the place picked from the suggestions (with a point)
  await page.emulateMedia({ colorScheme: 'light' })
  await go(page, '/soon')
  await page.getByRole('button', { name: 'Neu erstellen', exact: true }).click()
  await page.getByRole('dialog', { name: 'Was möchtest du erstellen?' }).getByRole('button', { name: /Anlass erstellen/ }).click()
  await page.getByLabel('Titel', { exact: true }).fill('Milas Geburtstag')
  await page.getByRole('button', { name: /^Datum/ }).click()
  await page.getByRole('button', { name: 'Morgen', exact: true }).click()
  await page.getByRole('button', { name: /^Ort hinzufügen$/ }).first().click()
  await page.getByRole('combobox', { name: 'Ort suchen' }).fill('Caf')
  await page.getByRole('option', { name: /Café Morgenrot/ }).click()
  await expect(page.locator('[data-minimap][data-ready]')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Speichern/ }).click()
  // after saving the app shows the month (?created=<id>); open the new occasion in the app
  await expect(page).toHaveURL(/created=/)
  const created = new URL(page.url()).searchParams.get('created')
  await expect(page).toHaveURL(/\/soon\?view=month$/, { timeout: 20_000 }).catch(() => undefined)
  await go(page, `/occasions/${created}`)
  await stripShots(page, '03-host-light-390')
  await page.emulateMedia({ colorScheme: 'dark' })
  await stripShots(page, '04-host-dark-390')

  const sources = await page.evaluate(() => Array.from(document.querySelectorAll('[data-minimap] img'), (image) => image.getAttribute('src') ?? ''))
  expect(sources.length).toBeGreaterThan(0)
  for (const source of sources) expect(source).toMatch(/^blob:/)
  expect(foreign).toEqual([])
  expect(errors).toEqual([])
})
