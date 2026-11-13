import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Felix 30.10: "So wird gespielt" was German for everyone. The demo in Russian (the language as the app stores it,
// bunprise.lang = ru, like Профиль → Настройки → Язык), Firefox at phone size: Идеи → Настольные игры → Carcassonne,
// the sheet scrolled to «Как играть» — the rules in Russian, without the "auf Deutsch" note.
// Screens go to $SCREENS_OUT, default docs/screens/2026-10-30-ideas-languages/.

const OUT = process.env.SCREENS_OUT ?? resolve(process.cwd(), '../../docs/screens/2026-10-30-ideas-languages')
mkdirSync(OUT, { recursive: true })

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

test('Russian: Идеи → Настольные игры → Carcassonne → «Как играть»', async ({ browser }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', baseURL: 'http://localhost:5173' })
  const page = await context.newPage()
  await page.addInitScript(() => {
    // the language as the settings store it; headless Firefox paints no backdrop-filter: the app's solid material
    window.localStorage.setItem('bunprise.lang', 'ru')
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
  const bodies: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/gift-ideas') bodies.push(request.postData() ?? '')
  })

  await page.goto('/login?mode=signup&method=email&frame=0')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await page.getByLabel('Эл. почта', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Отправить код', exact: true }).click()
  await page.getByLabel('Шестизначный код', { exact: true }).fill('123456')
  await page.getByLabel('Имя', { exact: true }).fill('Мила')
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await page.getByRole('button', { name: 'Пропустить', exact: true }).click()

  await page.getByRole('navigation').getByRole('link', { name: /^Идеи/ }).click()
  await expect(page.locator('[data-topic="brettspiele"]')).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-topic="brettspiele"]').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Настольные игры' }).first()).toBeVisible()
  await expect(page.locator('[data-idea="cat:hig-carcassonne"]')).toBeVisible({ timeout: 20_000 })
  await shot(page, '1-nastolnye-igry-ru')

  await page.locator('[data-idea="cat:hig-carcassonne"]').scrollIntoViewIfNeeded()
  await page.locator('[data-idea="cat:hig-carcassonne"] .topic-card-open').click()
  const sheet = page.getByRole('dialog', { name: 'Carcassonne' })
  await expect(sheet).toBeVisible()
  const howTo = sheet.getByRole('heading', { name: 'Как играть' })
  await expect(howTo).toBeVisible()
  await shot(page, '2-sheet-top-ru')
  const rules = sheet.locator('.topic-howto p[lang="ru"]')
  await expect(rules).toBeVisible()
  // the whole text above the sheet's button
  await rules.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await expect(sheet.getByText('Правила кратко — на немецком')).toHaveCount(0)
  await shot(page, '3-kak-igrat-ru')

  // the shelf was asked in Russian
  expect(bodies.some((body) => body.includes('"topic":"brettspiele"') && body.includes('"lang":"ru"'))).toBe(true)
  await context.close()
})
