import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Profil (Felix 27.10, docs/handoffs/2026-10-27-settings-code-language.md) in the demo, Firefox at phone size
// (390 × 844, 2× pixels), light and dark: the ONE row "Mein Code & Link" (Privatsphäre) and its sheet — QR + code
// first, "Oder als Link" below, "Eingeben" as the second tab — and the row "Sprache" with its list sheet (a pick
// switches the app's language and closes the list). Screens go to docs/screens/2026-10-27-settings-code-language/
// (or SCREENS_OUT).

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-settings-code-language')
mkdirSync(OUT, { recursive: true })

test.use({ deviceScaleFactor: 2 })

// Headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs;
// the theme of this device is pinned before the first paint (lib/theme.ts reads bunprise.theme)
async function prepare(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    try { localStorage.setItem('bunprise.theme', value) } catch { /* private mode */ }
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  }, theme)
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

for (const theme of ['light', 'dark'] as const) {
  test(`Profil: "Mein Code & Link" and the language list (${theme})`, async ({ page }) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await prepare(page, theme)
    await signUp(page)
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Profil/ }).click()
    await page.waitForURL('**/settings')

    // Privatsphäre: one row instead of "Mein Folgen-Link" + "Mein Code (QR)"
    const privacy = page.getByRole('region', { name: 'Privatsphäre' })
    const mine = privacy.getByRole('button', { name: 'Mein Code & Link', exact: true })
    await expect(mine).toBeVisible()
    await expect(privacy.getByRole('button', { name: 'Mein Folgen-Link', exact: true })).toHaveCount(0)
    await expect(privacy.getByRole('button', { name: /Mein Code \(QR\)/ })).toHaveCount(0)
    await privacy.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await settle(page)
    await page.screenshot({ path: `${OUT}/a-privacy-row-${theme}-390.png` })

    // the merged sheet: QR + code on top (the default), the link as a section below
    await mine.click()
    const sheet = page.getByRole('dialog', { name: 'Freunde hinzufügen' })
    await expect(sheet.getByRole('radio', { name: 'Mein Code', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet.getByRole('radio')).toHaveCount(2)
    await expect(sheet.locator('.pp-code-text')).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    await expect(sheet.getByRole('img', { name: /QR-Code mit deinem Code/ })).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/b-code-sheet-${theme}-390.png` })
    const link = sheet.getByRole('region', { name: 'Oder als Link' })
    await link.evaluate((node) => node.scrollIntoView({ block: 'end' }))
    await expect(link.getByRole('button', { name: 'Link kopieren', exact: true })).toBeVisible()
    await expect(link.getByRole('button', { name: 'Alle Links deaktivieren', exact: true })).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/c-code-sheet-link-section-${theme}-390.png` })
    await sheet.getByRole('radio', { name: 'Eingeben', exact: true }).click()
    await expect(sheet.getByLabel('Code', { exact: true })).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/d-code-sheet-enter-${theme}-390.png` })
    await sheet.getByRole('button', { name: 'Schließen', exact: true }).click()
    await expect(sheet).toHaveCount(0)

    // Darstellung › Sprache: one row with the current language, a tap opens the list
    const appearance = page.getByRole('region', { name: 'Darstellung' })
    const languageRow = appearance.getByRole('button', { name: /^Sprache/ })
    await expect(languageRow.locator('[data-language-name]')).toHaveText('Deutsch')
    await expect(appearance.getByRole('radiogroup', { name: 'Sprache' })).toHaveCount(0)
    await appearance.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await settle(page)
    await page.screenshot({ path: `${OUT}/e-language-row-${theme}-390.png` })
    await languageRow.click()
    const list = page.getByRole('dialog', { name: 'Sprache' })
    const radios = list.getByRole('radio')
    await expect(radios).toHaveText(['Deutsch', 'English', 'Русский', 'Українська'])
    await expect(list.getByRole('radio', { name: 'Deutsch', exact: true })).toHaveAttribute('aria-checked', 'true')
    await settle(page)
    await page.screenshot({ path: `${OUT}/f-language-list-${theme}-390.png` })

    // a pick: the app speaks it, the list closes, the row names it by its own name
    await list.getByRole('radio', { name: 'Українська', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const ukRow = page.getByRole('region', { name: 'Оформлення' }).getByRole('button', { name: /^Мова/ })
    await expect(ukRow.locator('[data-language-name]')).toHaveText('Українська')
    await settle(page)
    await page.screenshot({ path: `${OUT}/g-language-row-uk-${theme}-390.png` })
    await ukRow.click()
    const ukList = page.getByRole('dialog', { name: 'Мова' })
    await expect(ukList.getByRole('radio', { name: 'Українська', exact: true })).toHaveAttribute('aria-checked', 'true')
    await settle(page)
    await page.screenshot({ path: `${OUT}/h-language-list-uk-${theme}-390.png` })
    await ukList.getByRole('radio', { name: 'Deutsch', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    expect(errors).toEqual([])
  })
}
