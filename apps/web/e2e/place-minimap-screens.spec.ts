import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// The place thumbnail (Felix 26.10: "a mini map about the size of a list's icon"), in the demo, Firefox at phone size
// (390 × 844, 2× pixels), light and dark: the place sheet with suggestions, then the form row with the chosen place's
// small map and "Karte © OpenStreetMap". The demo's tiles are ONE fictional placeholder (src/mocks/places.ts).
// Also asserts the privacy rule: the map's <img>s show blob: URLs and the page never requests a foreign host.
// Screens go to $MINIMAP_OUT, else docs/screens/2026-10-27-place-minimap/.

const OUT = process.env.MINIMAP_OUT ? resolve(process.env.MINIMAP_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-place-minimap')
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

/** Opens the place sheet from the row, types, waits for the suggestions. */
async function search(page: Page, row: RegExp, query: string, expected: RegExp) {
  await page.getByRole('button', { name: row }).first().click()
  const input = page.getByRole('combobox', { name: 'Ort suchen' })
  await input.fill(query)
  await expect(page.getByRole('option', { name: expected })).toBeVisible()
}

/** Picks a suggestion and waits until its small map has loaded. */
async function pick(page: Page, name: RegExp) {
  await page.getByRole('option', { name }).click()
  await expect(page.getByRole('dialog', { name: 'Wo feiert ihr?' })).toHaveCount(0)
  await expect(page.locator('[data-minimap][data-ready]')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Karte © OpenStreetMap')).toBeVisible()
}

async function rowShot(page: Page, name: string) {
  await settle(page)
  const row = page.locator('.of-row-split').filter({ has: page.locator('[data-minimap]') })
  await row.scrollIntoViewIfNeeded()
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  await row.screenshot({ path: `${OUT}/${name}-row.png` })
}

test('place thumbnail: suggestions, the chosen place with its small map, light and dark', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Neu erstellen', exact: true }).click()
  await page.getByRole('dialog', { name: 'Was möchtest du erstellen?' }).getByRole('button', { name: /Anlass erstellen/ }).click()
  await page.getByLabel('Titel', { exact: true }).fill('Milas Geburtstag')

  // 1. light: the sheet's suggestions, then a café at street level
  await search(page, /^Ort hinzufügen$/, 'Caf', /Café Morgenrot/)
  await shot(page, '01-sheet-suggestions-light-390')
  await pick(page, /Café Morgenrot/)
  await rowShot(page, '02-form-minimap-cafe-light-390')

  // 2. dark (the system theme): the sheet again, then a park (one zoom step out)
  await page.emulateMedia({ colorScheme: 'dark' })
  await search(page, /Café Morgenrot/, 'Ros', /Rosengarten am Fluss/)
  await shot(page, '03-sheet-suggestions-dark-390')
  await pick(page, /Rosengarten am Fluss/)
  await rowShot(page, '04-form-minimap-park-dark-390')

  // 3. dark, the town itself (z 11)
  await search(page, /Rosengarten am Fluss/, 'Beisp', /^Beispielstadt/)
  await pick(page, /^Beispielstadt/)
  await rowShot(page, '05-form-minimap-town-dark-390')

  // 4. clearing the place brings the plain pin tile back
  await page.getByRole('button', { name: 'Ort entfernen', exact: true }).click()
  await expect(page.locator('[data-minimap]')).toHaveCount(0)
  await expect(page.getByText('Karte © OpenStreetMap')).toHaveCount(0)

  const sources = await page.evaluate(() => Array.from(document.querySelectorAll('img'), (image) => image.getAttribute('src') ?? ''))
  for (const source of sources.filter((src) => src.includes('tile'))) expect(source).toMatch(/^blob:/)
  expect(foreign).toEqual([])
  expect(errors).toEqual([])
})
