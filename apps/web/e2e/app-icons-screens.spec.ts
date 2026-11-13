import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Einstellungen → App-Symbol (Felix 27.10, docs/handoffs/2026-10-27-app-icons.md) in the demo, Firefox at phone size
// (390 × 844, 2× pixels): the picker in the light and the dark theme, a choice that re-links the page (and stays
// linked after a reload — public/boot.js), and the gallery page with every icon on mock home screens (5180).
// Screens go to docs/screens/2026-10-27-app-icons/ (or SCREENS_OUT).

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-app-icons')
const GALLERY = process.env.GALLERY_URL ?? 'http://localhost:5180'
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
    await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)))
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
  await page.getByLabel('Name', { exact: true }).fill('Mila Sommer')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
  await page.waitForURL('**/soon')
}

/** The Apple touch icon and the tab icon the page links, and its manifest (absent on the dev server: vite-plugin-pwa adds it at build time). */
const linked = (page: Page) => page.evaluate(() => ['apple-touch-icon', 'icon', 'manifest'].map((rel) => document.querySelector(`link[rel="${rel}"]`)?.getAttribute('href') ?? null))
const variant = (id: string, manifest: string | null) => [`/icons/variants/${id}/apple-touch-icon.png`, `/icons/variants/${id}/icon.svg`, manifest === null ? null : `/icons/variants/${id}/manifest.webmanifest`]

test('App-Symbol: the picker (light + dark), a choice re-links the page and survives a reload', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await solidMaterials(page)
  await signUp(page)
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Profil/ }).click()
  await page.waitForURL('**/settings')
  const picker = page.getByRole('radiogroup', { name: 'App-Symbol' })
  await picker.scrollIntoViewIfNeeded()
  await expect(picker.getByRole('radio')).toHaveCount(12)
  await expect(picker.getByRole('radio', { name: 'Klassisch', exact: true })).toHaveAttribute('aria-checked', 'true')
  // the section: the theme row above, the hint below
  await page.locator('[data-app-icon-picker]').evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await settle(page)
  await page.screenshot({ path: `${OUT}/a-picker-light-390.png` })

  await picker.getByRole('radio', { name: 'Nacht', exact: true }).click()
  await expect(picker.getByRole('radio', { name: 'Nacht', exact: true })).toHaveAttribute('aria-checked', 'true')
  const [, , manifest] = await linked(page)
  expect(await linked(page)).toEqual(variant('night', manifest ?? null))
  await settle(page)
  await page.screenshot({ path: `${OUT}/b-picker-night-chosen-light-390.png` })

  await page.getByRole('radiogroup', { name: 'Farbschema' }).getByRole('radio', { name: 'Dunkel', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.locator('[data-app-icon-picker]').evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await settle(page)
  await page.screenshot({ path: `${OUT}/c-picker-dark-390.png` })
  await picker.getByRole('radio', { name: 'Mit Tapsi', exact: true }).click()
  await settle(page)
  await page.screenshot({ path: `${OUT}/d-picker-tapsi-chosen-dark-390.png` })

  // a reload (the demo signs out): boot.js links the stored choice before anything can read the links
  await page.reload()
  await expect.poll(async () => { const now = await linked(page); return JSON.stringify(now) === JSON.stringify(variant('tapsi', now[2] ?? null)) }).toBe(true)
  const icon = await page.evaluate(async () => (await fetch('/icons/variants/tapsi/apple-touch-icon.png')).headers.get('content-type'))
  expect(icon).toBe('image/png')
  expect(errors).toEqual([])
})

test('gallery: every icon on mock home screens (light + dark wallpaper), Android circles, small sizes', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1240, height: 900 })
  await page.goto(`${GALLERY}/?screens=icons`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1', { timeout: 20_000 })
  await page.screenshot({ path: `${OUT}/e-gallery-full.png`, fullPage: true })
  await page.goto(`${GALLERY}/?screens=icons&view=phones`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1', { timeout: 20_000 })
  await page.locator('.ai-phones').screenshot({ path: `${OUT}/f-home-screens-light-dark.png` })
  await page.goto(`${GALLERY}/?screens=icons&theme=dark`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1', { timeout: 20_000 })
  await page.locator('.ai-android').screenshot({ path: `${OUT}/g-android-circles.png` })
})
