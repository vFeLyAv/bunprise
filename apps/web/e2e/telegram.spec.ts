import { expect, test, type Page } from '@playwright/test'

// Bunprise as a Telegram Mini App in the demo (docs/spec/telegram-mini-app.md §7, steps 3, 4, 6). The Telegram
// client is faked: TelegramWebviewProxy records what the page sends (window.__tg); incoming events are calls of
// window.Telegram.WebView.receiveEvent, as the iOS / Android apps make them. FIXTURES ONLY — the launch data below
// is made up, never real Telegram data.

const LAUNCH =
  '#tgWebAppData=query_id%3DFAKE%26user%3D%257B%2522id%2522%253A1%257D%26auth_date%3D1%26hash%3Dfake' +
  '&tgWebAppVersion=9.6&tgWebAppPlatform=ios'

type Sent = [type: string, data: unknown]

/** Everything the page sent to the fake client so far, the data parsed back from JSON. */
function sent(page: Page): Promise<Sent[]> {
  return page.evaluate(() =>
    ((window as unknown as { __tg?: [string, string | undefined][] }).__tg ?? []).map(
      ([type, data]): [string, unknown] => [type, typeof data === 'string' ? JSON.parse(data) : null],
    ),
  )
}

async function lastOf(page: Page, type: string): Promise<unknown> {
  return (await sent(page)).filter(([t]) => t === type).at(-1)?.[1]
}

/** The client's header Back button was tapped. */
function telegramBack(page: Page): Promise<void> {
  return page.evaluate(() => {
    ;(window as unknown as { Telegram: { WebView: { receiveEvent: (type: string) => void } } }).Telegram.WebView.receiveEvent(
      'back_button_pressed',
    )
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __tg?: unknown[]; TelegramWebviewProxy?: unknown }
    w.TelegramWebviewProxy = {
      postEvent(type: string, data?: string) {
        ;(w.__tg ||= []).push([type, data])
      },
    }
  })
})

test('Telegram Mini App: ready + expand, Telegram Back = our "Zurück", shop links open outside', async ({ page, context }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  // 1. launch: the launch data leaves the address bar, the bridge says ready + expand after the first screen
  await page.goto(`/login?mode=signup&method=email&frame=0${LAUNCH}`)
  await expect.poll(async () => (await sent(page)).map(([type]) => type)).toEqual(expect.arrayContaining(['web_app_expand', 'web_app_ready']))
  expect(await page.evaluate(() => location.href)).not.toContain('tgWebApp')
  expect(await lastOf(page, 'web_app_set_header_color')).toEqual({ color: '#F5EEE2' })

  // sign up in the demo (any e-mail, code 123456)
  await page.getByLabel('E-Mail', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Mila')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()

  // 2. a main tab has no "Zurück": Telegram's Back is hidden (its header shows "Close")
  const annas = page.getByRole('link', { name: /Annas Einweihung/ }).first()
  await expect(annas).toBeVisible()
  await expect.poll(() => lastOf(page, 'web_app_setup_back_button')).toEqual({ is_visible: false })
  const startUrl = page.url()

  // 3. the occasion screen has a "Zurück": Telegram's Back shows, our own glass one hides (no two back buttons)
  await annas.click()
  await expect(page).not.toHaveURL(startUrl)
  const occasionUrl = page.url()
  await expect.poll(() => lastOf(page, 'web_app_setup_back_button')).toEqual({ is_visible: true })
  await expect(page.locator('header [data-tg-back]')).toBeHidden()

  // 4. a shop link in Anna's wish: web_app_open_link, no navigation and no new tab inside the Mini App
  const grinder = page.locator('[data-wish-id]', { hasText: 'Kaffeemühle mit Handkurbel' })
  await grinder.scrollIntoViewIfNeeded()
  await grinder.locator('button').first().click()
  const sheet = page.getByRole('dialog')
  const shop = sheet.locator('[data-wish-shop] a')
  await shop.scrollIntoViewIfNeeded()
  const shopHref = await shop.getAttribute('href')
  expect(shopHref).toMatch(/^https:\/\//)
  await shop.click()
  await expect.poll(() => lastOf(page, 'web_app_open_link')).toEqual({ url: new URL(shopHref ?? '').href })
  expect(page.url()).toBe(occasionUrl)
  expect(context.pages()).toHaveLength(1)

  // 5. Telegram's Back closes the open sheet first, the screen stays …
  await telegramBack(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(page.url()).toBe(occasionUrl)

  // … and then runs our "Zurück": back to the previous screen
  await telegramBack(page)
  await expect(page).toHaveURL(startUrl)
  await expect(page.getByRole('link', { name: /Annas Einweihung/ }).first()).toBeVisible()
  await expect.poll(() => lastOf(page, 'web_app_setup_back_button')).toEqual({ is_visible: false })

  expect(errors).toEqual([])
})
