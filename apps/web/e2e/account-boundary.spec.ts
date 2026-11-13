import { expect, test, type Page } from '@playwright/test'

// The account boundary across tabs (Codex review 2, H3; lib/session.ts, docs/contract.md §5.5) in a real
// browser: two tabs of one browser profile share localStorage and BroadcastChannel. The second "tab" opens a
// static file of the same origin (no app code, so the demo start does not wipe the session) and plays the
// other tab's part. Verified in the system Edge (2026-10-20).

const HOUSEWARMING = 'd1e0b000-0000-4000-8000-000000000001'

async function signUp(page: Page, email: string, name: string): Promise<void> {
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill(email)
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await expect(page).toHaveURL(/\/login\/code/)
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await expect(page).toHaveURL(/\/welcome\/profile/)
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await expect(page).not.toHaveURL(/\/welcome\/profile/)
}

async function guestScreen(page: Page): Promise<string> {
  await signUp(page, 'tabs@example.test', 'Tabs')
  // in-app navigation (a reload would reset the demo world)
  await page.evaluate((id) => { window.history.pushState({}, '', `/occasions/${id}?frame=0`); window.dispatchEvent(new PopStateEvent('popstate')) }, HOUSEWARMING)
  await expect(page.getByText('Reserviert', { exact: true }).first()).toBeVisible()
  return page.evaluate(() => (JSON.parse(localStorage.getItem('bunprise.demo.auth') ?? '{}') as { user: { id: string } }).user.id)
}

async function otherTab(page: Page): Promise<Page> {
  const tab = await page.context().newPage()
  await tab.goto('/icons/icon.svg')
  return tab
}

test("another tab's 'account-cleared' for this account: the guest screen is gone, reload to /login", async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const userId = await guestScreen(page)
  const tab = await otherTab(page)
  await tab.evaluate((id) => new BroadcastChannel('bunprise.demo.session').postMessage({ type: 'account-cleared', userId: id }), userId)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Reserviert', { exact: true })).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('style', /hidden/) // the new page is visible again
  expect(errors).toEqual([])
})

test("'account-cleared' for another account changes nothing", async ({ page }) => {
  await guestScreen(page)
  const tab = await otherTab(page)
  await tab.evaluate(() => new BroadcastChannel('bunprise.demo.session').postMessage({ type: 'account-cleared', userId: 'someone-else' }))
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(new RegExp(`/occasions/${HOUSEWARMING}`))
  await expect(page.getByText('Reserviert', { exact: true }).first()).toBeVisible()
})

test('another tab removes the stored session (manual sign-out path): reload to /login', async ({ page }) => {
  await guestScreen(page)
  const tab = await otherTab(page)
  await tab.evaluate(() => localStorage.removeItem('bunprise.demo.auth'))
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Reserviert', { exact: true })).toHaveCount(0)
})

test('sign-out in this tab announces it to the other tabs before reloading', async ({ page }) => {
  await guestScreen(page)
  const tab = await otherTab(page)
  await tab.evaluate(() => {
    const received: unknown[] = []
    ;(window as unknown as { received: unknown[] }).received = received
    new BroadcastChannel('bunprise.demo.session').onmessage = (event) => { received.push(event.data) }
  })
  await page.evaluate(() => { window.history.pushState({}, '', '/settings?frame=0'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.getByRole('button', { name: 'Abmelden (auf allen Geräten)', exact: true }).click()
  await expect(page).toHaveURL(/\/$|\/\?/)
  const received = await tab.evaluate(() => (window as unknown as { received: unknown[] }).received)
  expect(received).toEqual([expect.objectContaining({ type: 'account-cleared' })])
})
