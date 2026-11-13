import { expect, test, type Page } from '@playwright/test'

// The shared demo world (src/mocks, docs/demo-mode.md) through MSW's service worker in a real browser.
// Only the sign-up screens are driven through the UI; the world itself is read with in-page requests,
// exactly like the app's own supabase-js calls, so this spec does not depend on unfinished screens.

const INVITE_TOKEN = '6772696c6c6162656e642d62656e2d64656d6f2d696e766974652d6c696e6b21'
const HOUSEWARMING = 'd1e0b000-0000-4000-8000-000000000001'
const BARBECUE = 'd1e0b000-0000-4000-8000-000000000002'
const FREE_WISH = 'd1e0d000-0000-4000-8000-000000000103'

interface Answer {
  status: number
  json: unknown
}

interface ScreenWishes {
  wishlist: { wishes: { id: string; title: string; reserved: boolean; reserved_by_me: boolean }[] }
}

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

/** A request from inside the page with the stored demo session (goes through the MSW worker). */
function api(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  return page.evaluate(async ({ method, path, body, headers }) => {
    const session = JSON.parse(localStorage.getItem('bunprise.demo.auth') ?? 'null') as { access_token: string } | null
    const init: RequestInit = {
      method,
      headers: { apikey: 'demo', 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.access_token}` } : {}), ...headers },
    }
    if (body !== undefined) init.body = JSON.stringify(body) // only POST/PATCH carry a body
    const response = await fetch(`http://demo.localhost${path}`, init)
    const text = method === 'HEAD' ? '' : await response.text()
    return { status: response.status, json: text ? JSON.parse(text) as unknown : null }
  }, { method, path, body, headers })
}

test('a finished profile is a guest of "Annas Einweihung": anonymous "Reserviert", own reservation, own occasion', async ({ page }) => {
  await signUp(page, 'mila@example.test', 'Mila Demo')
  const feed = await api(page, 'POST', '/rest/v1/rpc/get_feed', {})
  expect(feed.json).toMatchObject({
    upcoming: [{ id: HOUSEWARMING, title: 'Annas Einweihung', role: 'member', host_name: 'Anna Beispiel', member_count: 4, wish_count: 6, my_reservation_count: 0 }],
    past: [],
  })
  const screen = await api(page, 'POST', '/rest/v1/rpc/get_occasion_screen', { p_occasion_id: HOUSEWARMING })
  const wishes = (screen.json as ScreenWishes).wishlist.wishes
  expect(wishes).toHaveLength(6)
  expect(wishes.filter((wish) => wish.reserved).map((wish) => [wish.title, wish.reserved_by_me])).toEqual([['Kaffeemühle mit Handkurbel', false]])
  expect(JSON.stringify(screen.json)).not.toContain('reserved_by_name')

  expect((await api(page, 'POST', '/rest/v1/rpc/reserve_wish', { p_wish_id: FREE_WISH })).json).toEqual({ ok: true })
  const after = await api(page, 'POST', '/rest/v1/rpc/get_occasion_screen', { p_occasion_id: HOUSEWARMING })
  expect((after.json as ScreenWishes).wishlist.wishes.find((wish) => wish.id === FREE_WISH)).toMatchObject({ reserved: true, reserved_by_me: true })

  const me = await page.evaluate(() => (JSON.parse(localStorage.getItem('bunprise.demo.auth') ?? '{}') as { user: { id: string } }).user.id)
  const occasionId = await page.evaluate(() => crypto.randomUUID())
  const created = await api(page, 'POST', '/rest/v1/occasions?select=id',
    { id: occasionId, host_id: me, title: 'Milas Geburtstag', starts_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), tz: 'Europe/Berlin', all_day: true },
    { prefer: 'return=representation', accept: 'application/vnd.pgrst.object+json' })
  expect(created).toEqual({ status: 201, json: { id: occasionId } })
  const host = await api(page, 'POST', '/rest/v1/rpc/get_occasion_screen', { p_occasion_id: occasionId })
  expect(host.json).toMatchObject({ viewer: { role: 'host', rsvp: 'going' }, invite: null, wishlist: { owner_id: me, wishes: [] } })
  expect((await api(page, 'HEAD', '/rest/v1/reservations?select=*')).status).toBe(403)
})

test('the fixed demo link keeps its token out of the URL and joins "Bens Grillabend" only on accept_invite', async ({ page }) => {
  await page.goto(`/i#${INVITE_TOKEN}`)
  await expect(page).toHaveURL(/\/i$/)
  expect(await page.evaluate(() => sessionStorage.getItem('bunprise.demo.pendingInvite'))).toBe(INVITE_TOKEN)
  await signUp(page, 'jonas@example.test', 'Jonas')
  expect(await page.evaluate(() => sessionStorage.getItem('bunprise.demo.pendingInvite'))).toBe(INVITE_TOKEN)
  const closed = await api(page, 'POST', '/rest/v1/rpc/get_occasion_screen', { p_occasion_id: BARBECUE })
  expect(closed).toMatchObject({ status: 400, json: { code: 'P0001', message: 'not_found' } })
  expect((await api(page, 'POST', '/rest/v1/rpc/accept_invite', { p_token: INVITE_TOKEN })).json).toEqual({ occasion_id: BARBECUE })
  const feed = await api(page, 'POST', '/rest/v1/rpc/get_feed', {})
  expect((feed.json as { upcoming: { title: string }[] }).upcoming.map((row) => row.title)).toEqual(['Annas Einweihung', 'Bens Grillabend'])
})
