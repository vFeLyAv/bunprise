import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// Web Push in the demo (docs/spec/web-push-design.md §3), Firefox at phone size, light and dark: the hint under
// Paula's invitation on Start, the explanation sheet it opens ("Benachrichtigungen erlauben" — simulated in the demo,
// no browser prompt), and Profil › Auf diesem Gerät › Benachrichtigungen with its sheet (the two switches).
// Screens go to SCREENS_OUT (default: docs/screens/2026-10-27-web-push).

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-web-push')
mkdirSync(OUT, { recursive: true })

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
  await page.getByLabel('Name', { exact: true }).fill('Mila')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
}

async function page(browser: Browser, scheme: 'light' | 'dark') {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: scheme, baseURL: 'http://localhost:5173',
  })
  const p = await context.newPage()
  // headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs
  await p.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
  return { context, page: p }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`push: hint, explanation and settings (${scheme})`, async ({ browser }) => {
    test.setTimeout(90_000)
    const { context, page: p } = await page(browser, scheme)
    await signUp(p)

    // Start: Paula's invitation and, under it, the question
    const hint = p.locator('[data-push-hint]')
    await expect(hint).toBeVisible({ timeout: 15_000 })
    await hint.scrollIntoViewIfNeeded()
    await shot(p, `a-start-hint-${scheme}`)

    // the explanation sheet (prompt mode)
    await hint.getByRole('button', { name: 'Ja, gerne' }).click()
    const sheet = p.getByRole('dialog', { name: 'Benachrichtigungen' })
    await expect(sheet.getByRole('button', { name: 'Benachrichtigungen erlauben' })).toBeVisible()
    await shot(p, `b-prompt-sheet-${scheme}`)
    await sheet.getByRole('button', { name: 'Benachrichtigungen erlauben' }).click()
    await expect(sheet).toBeHidden()
    await expect(hint).toBeHidden()
    await shot(p, `c-start-after-allow-${scheme}`)

    // Profil › Auf diesem Gerät › Benachrichtigungen · An
    await p.getByRole('link', { name: /Profil/ }).first().click()
    const row = p.getByRole('button', { name: /Benachrichtigungen/ })
    await row.scrollIntoViewIfNeeded()
    await expect(row).toContainText('An')
    await shot(p, `d-profile-row-${scheme}`)
    await row.click()
    const settings = p.getByRole('dialog', { name: 'Benachrichtigungen' })
    await expect(settings.getByRole('switch', { name: /Auf diesem Gerät/ })).toHaveAttribute('aria-checked', 'true')
    await shot(p, `e-settings-sheet-${scheme}`)
    await settings.getByRole('switch', { name: /^Einladungen/ }).click()
    await expect(settings.getByRole('switch', { name: /^Einladungen/ })).toHaveAttribute('aria-checked', 'false')
    await shot(p, `f-settings-invitations-off-${scheme}`)
    await context.close()
  })
}
