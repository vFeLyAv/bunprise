import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Calendar (Felix 27.10, docs/handoffs/2026-10-27-calendar.md) in the demo, Firefox at phone size (390 × 844, 2×
// pixels), light and dark: "Zum Kalender hinzufügen" on the occasion screen and its choice, the Kalender-Abo sheet
// (off → the address once), the birthday suggestion on Start (host, then guest after "×") and the prefilled form.
// Screens go to docs/screens/2026-10-27-calendar/ (or SCREENS_OUT).

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-calendar')
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
  await page.waitForTimeout(500)
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

for (const scheme of ['light', 'dark'] as const) {
  test(`calendar screens (${scheme})`, async ({ page }) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.emulateMedia({ colorScheme: scheme })
    await solidMaterials(page)
    await signUp(page)

    // 1. Start: the birthday suggestion (lazy, after the first paint) — the own birthday first
    const hint = page.locator('[data-birthday-hint]')
    await expect(hint).toHaveAttribute('data-birthday-hint', 'host', { timeout: 20_000 })
    await expect(hint).toContainText('„Mein Geburtstag“ ist am')
    await hint.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await settle(page)
    await page.screenshot({ path: `${OUT}/c1-start-birthday-host-${scheme}-390.png` })
    // "×" → the next one: Clara's, as a guest
    await hint.getByRole('button', { name: 'Vorschlag ausblenden' }).click()
    await expect(hint).toHaveAttribute('data-birthday-hint', 'guest')
    await expect(hint).toContainText('„Claras Geburtstag“ naht')
    await hint.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await settle(page)
    await page.screenshot({ path: `${OUT}/c2-start-birthday-guest-${scheme}-390.png` })

    // 2. the occasion screen: "Zu Google Kalender hinzufügen" — one tap opens Google (Felix 27.10: no choice, no file)
    await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
    await page.waitForURL('**/occasions/**')
    const add = page.getByRole('button', { name: 'Zu Google Kalender hinzufügen' })
    await expect(add).toBeVisible()
    await add.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await settle(page)
    await page.screenshot({ path: `${OUT}/a1-occasion-button-${scheme}-390.png` })
    const [google] = await Promise.all([page.waitForEvent('popup'), add.click()])
    expect(google.url()).toMatch(/^https:\/\/(calendar\.google\.com|accounts\.google\.com)\//)
    await google.close()

    // 3. Profil › Kalender-Abo: off → create → the address once
    await page.getByRole('button', { name: 'Zurück' }).first().click()
    await page.waitForURL('**/soon')
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Profil/ }).click()
    await page.waitForURL('**/settings')
    const row = page.getByRole('button', { name: /Kalender-Abo/ })
    await row.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await settle(page)
    await page.screenshot({ path: `${OUT}/b1-profile-row-${scheme}-390.png` })
    await row.click()
    await expect(page.getByRole('button', { name: 'Abo-Adresse erstellen' })).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/b2-feed-off-${scheme}-390.png` })
    await page.getByRole('button', { name: 'Abo-Adresse erstellen' }).click()
    await expect(page.getByLabel('Deine Abo-Adresse')).toHaveValue(/\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/)
    await settle(page)
    await page.screenshot({ path: `${OUT}/b3-feed-address-${scheme}-390.png` })
    await page.locator('[data-calendar-feed-sheet]').evaluate((node) => {
      const scroller = node.closest('[role="dialog"]')?.querySelector('[data-sheet-scroll]') ?? node.parentElement
      scroller?.scrollTo({ top: 10_000 })
      node.querySelector('[role="note"]')?.scrollIntoView({ block: 'center' })
    })
    await settle(page)
    await page.screenshot({ path: `${OUT}/b4-feed-google-${scheme}-390.png` })
    // closed and opened again: only the status, never the address
    await page.keyboard.press('Escape')
    await row.click()
    await expect(page.getByText(/^Abo aktiv seit/)).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/b5-feed-active-${scheme}-390.png` })
    await page.keyboard.press('Escape')

    // 4. back to Start: "wieder feiern?" is dismissed only for Mein Geburtstag — the guest one shows; the host one is gone
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Start/ }).click()
    await page.waitForURL('**/soon')
    await expect(page.locator('[data-birthday-hint]')).toHaveAttribute('data-birthday-hint', 'guest', { timeout: 20_000 })

    expect(errors).toEqual([])
  })
}

test('birthday suggestion: "Neuen Anlass anlegen" opens the form with title + this year’s date only', async ({ page }) => {
  test.setTimeout(120_000)
  await solidMaterials(page)
  await signUp(page)
  const hint = page.locator('[data-birthday-hint="host"]')
  await expect(hint).toBeVisible({ timeout: 20_000 })
  await hint.getByRole('button', { name: 'Neuen Anlass anlegen' }).click()
  await page.waitForURL('**/occasions/new')
  await expect(page.getByLabel('Titel', { exact: true })).toHaveValue('Mein Geburtstag')
  await settle(page)
  await page.screenshot({ path: `${OUT}/c3-new-occasion-prefilled-light-390.png` })
})
