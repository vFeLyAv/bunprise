import { expect, test, type Page } from '@playwright/test'

// Signing in inside a Telegram Mini App (docs/spec/telegram-mini-app.md §3.5, plan step 5): Google refuses OAuth in
// embedded web views and Apple is not set up, so in Telegram the only way in is the e-mail code. "Telegram" is
// imitated like in the spec's plan (§7): a fake TelegramWebviewProxy and the launch fragment Telegram appends.
// Fixtures only — the launch data below is invented and never real Telegram data.
const LAUNCH_DATA = encodeURIComponent('query_id=fixture-query&auth_date=1700000000&hash=fixture-hash')
const TELEGRAM_FRAGMENT = `#tgWebAppPlatform=ios&tgWebAppVersion=9.6&tgWebAppData=${LAUNCH_DATA}`
const PROVIDER_LINKS = 'a[href*="method=google"], a[href*="method=apple"]'

async function openInTelegram(page: Page, path: string) {
  await page.addInitScript(() => {
    const events: unknown[] = []
    Object.assign(window, {
      __tg: events,
      TelegramWebviewProxy: { postEvent(type: string, data: string) { events.push([type, data]) } },
    })
  })
  await page.goto(`${path}${TELEGRAM_FRAGMENT}`)
}

/** Every request to the provider sign-in endpoint (none may happen in Telegram). */
function watchProviderRequests(page: Page): string[] {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/v1/authorize') requests.push(request.url())
  })
  return requests
}

test('in Telegram the start screen offers only the e-mail code; "Anmelden" opens the e-mail form directly', async ({ page }, testInfo) => {
  const providerRequests = watchProviderRequests(page)
  await openInTelegram(page, '/?frame=0')
  const email = page.locator('a[href*="method=email"]')
  await expect(email).toBeVisible()
  await expect(email).toHaveText('Mit E-Mail fortfahren')
  await expect(page.locator(PROVIDER_LINKS)).toHaveCount(0)
  await expect(page.getByText(/Google|Apple/)).toHaveCount(0)
  // the launch data left the address bar before the router read it (lib/telegram/detect.ts)
  expect(page.url()).not.toContain('tgWebApp')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('telegram-start.png'), fullPage: false, animations: 'disabled' })

  await page.locator('a[href*="mode=signin"]').click()
  await expect(page).toHaveURL(/\/login\?.*mode=signin/)
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible()
  await expect(page.locator(PROVIDER_LINKS)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Andere Methode wählen' })).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('telegram-signin.png'), fullPage: false, animations: 'disabled' })
  expect(providerRequests).toEqual([])
})

test('in Telegram the demo sign-up by e-mail code still works (code 123456)', async ({ page }) => {
  await openInTelegram(page, '/?frame=0')
  await page.locator('a[href*="method=email"]').click()
  await page.getByLabel('E-Mail', { exact: true }).fill('telegram-fixture@example.test')
  const send = page.getByRole('button', { name: 'Code schicken', exact: true })
  await expect(send).toBeDisabled()
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await send.click()
  await expect(page).toHaveURL(/\/login\/code/)
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await expect(page).toHaveURL(/\/welcome\/profile\?next=%2Fsoon/)
  // still the Mini App after the in-app navigation (the flag lives in sessionStorage)
  expect(await page.evaluate(() => sessionStorage.getItem('bunprise.tg'))).toBe('ios 9.6')
})

test('in Telegram a link to Google sign-in explains why not and leads to the e-mail code', async ({ page }, testInfo) => {
  const providerRequests = watchProviderRequests(page)
  await openInTelegram(page, '/login?mode=signup&method=google&frame=0')
  await expect(page.getByText('Mit Google kannst du dich in Telegram nicht anmelden. Hier geht es mit dem Code aus der E-Mail.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('telegram-google-link.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('link', { name: 'Mit E-Mail fortfahren' }).click()
  await expect(page).toHaveURL(/\/login\?.*method=email/)
  await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible()
  expect(providerRequests).toEqual([])
})
