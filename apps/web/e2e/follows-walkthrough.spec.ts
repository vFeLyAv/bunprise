import { expect, test, type Page } from '@playwright/test'

// The follows flow end to end in ONE demo session (follows-design W11): Anna's follow link → sign up → "Folgen
// anfragen" → Anna says yes (the demo's script, src/mocks/follows.ts) → a secret reservation in "Annas Wünsche" →
// the own profile header of the lists tab (banner + counters) → my own follow link → Ben's request arrives → accept.
// Network: only our origin — the demo API (http://demo.localhost) is answered inside the page by MSW.
// The demo seeds its circle around the FIRST account of a page load (handlers.ts DEMO_USER_ID — it already follows
// Anna); this walkthrough is about a newcomer, so that first account is created through the demo's own auth
// endpoints before the visitor signs up. The world lives in page memory: after the first load the spec never
// reloads (links are opened in-app).

const ANNA_LINK = '616e6e61732d666f6c67656e2d6c696e6b2d667565722d6469652d64656d6f21'
const ANNAS_WISHES = 'd1e0c000-0000-4000-8000-0000000000a1'
const DEMO_API = 'http://demo.localhost'

async function closeSheet(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** The demo's first account (with the seeded circle), signed up through its auth endpoints — never shown here. */
async function createTheFirstAccount(page: Page) {
  const status = await page.evaluate(async (api) => {
    const post = (path: string, body: unknown) => fetch(`${api}${path}`, { method: 'POST', headers: { apikey: 'demo', 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await post('/auth/v1/otp', { email: 'circle@example.test', create_user: true })
    return (await post('/auth/v1/verify', { email: 'circle@example.test', token: '123456', type: 'email' })).status
  }, DEMO_API)
  expect(status).toBe(200)
}

test('follows end to end: link → request → yes → reserve → own profile → accept Ben', async ({ page, baseURL }) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  const foreign: string[] = []
  const ours = new URL(baseURL ?? 'http://localhost:5173').origin
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const origin = new URL(request.url()).origin
    if (origin !== ours && origin !== DEMO_API && !request.url().startsWith('data:')) foreign.push(request.url())
  })

  // 1. Anna's link: the code goes into this tab, the URL is clean, nobody is named before sign-in
  await page.goto(`/f#${ANNA_LINK}`)
  await expect(page).toHaveURL(/\/f$/)
  await expect(page.getByRole('heading', { name: 'Jemand möchte Wunschlisten mit dir teilen.' })).toBeVisible()
  await expect(page.getByText(/Anna/)).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('bunprise.demo.pendingFollow'))).toBe(ANNA_LINK)
  await createTheFirstAccount(page)

  // 2. sign up from the gate (in-app: the world stays)
  await page.getByRole('link', { name: 'Konto erstellen', exact: true }).click()
  await page.getByRole('link', { name: 'Mit E-Mail fortfahren' }).or(page.getByRole('button', { name: 'Mit E-Mail fortfahren' })).first().click()
  await page.getByLabel('E-Mail', { exact: true }).fill('walk@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Walk')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await expect(page).toHaveURL(/\/f$/)

  // 3. the gate: a fresh peek names Anna and says what the request shares; opening the link sent nothing
  await expect(page.getByRole('heading', { name: 'Anna Beispiel folgen?' })).toBeVisible()
  await expect(page.getByText('Mit deiner Anfrage sieht Anna Beispiel deinen Namen „Walk“.')).toBeVisible()
  await page.getByRole('button', { name: 'Folgen anfragen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Angefragt' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('bunprise.demo.pendingFollow'))).toBeNull()

  // 4. Anna says yes after a moment (the demo's script); her card shows it — with her lists
  await page.waitForTimeout(3_000)
  await page.getByRole('link', { name: 'Zum Profil von Anna Beispiel' }).click()
  await expect(page.getByRole('button', { name: 'Du folgst', exact: true })).toBeVisible()
  await expect(page.getByText('Folgt dir nicht')).toBeVisible() // one way: Anna does not follow the newcomer
  await expect(page.getByRole('heading', { name: 'Listen von Anna Beispiel' })).toBeVisible()

  // 5. a secret reservation in "Annas Wünsche": "Reserviert" without a name, mine "Von dir reserviert"
  await page.getByRole('link', { name: /Annas Wünsche/ }).click()
  await expect(page).toHaveURL(new RegExp(`/lists/${ANNAS_WISHES}$`))
  await expect(page.getByRole('button', { name: /Wanderrucksack/ }).getByText('Reserviert', { exact: true })).toBeVisible()
  await expect(page.getByText(/Reserviert von/)).toHaveCount(0)
  await page.getByRole('button', { name: /Kopfhörer mit Geräuschunterdrückung/ }).click()
  await page.getByRole('button', { name: 'Ich schenke das', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('erfährt nichts')
  await closeSheet(page)
  await expect(page.getByRole('button', { name: /Kopfhörer mit Geräuschunterdrückung/ }).getByText('Von dir reserviert')).toBeVisible()

  // 6. the own profile in the lists tab: counters only about me, then a banner (a list's screen is a pushed screen
  //    without the tab bar: in-app to Start, then the tab bar's "Listen")
  await page.evaluate(() => { history.pushState({ __TSR_index: 100, key: 'e2e-start', __TSR_key: 'e2e-start' }, '', '/soon') })
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Listen/ }).click()
  await expect(page).toHaveURL(/\/lists$/)
  await expect(page.getByRole('button', { name: '0 Wünsche – zu deinen Listen' })).toBeVisible()
  await expect(page.getByRole('button', { name: '3 Listen mit dir geteilt – zu den Freunden' })).toBeVisible() // Anna's 2 + the occasion
  await expect(page.getByText('0 Follower · Du folgst 1')).toBeVisible()
  await page.getByRole('button', { name: 'Banner ändern', exact: true }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'Wiese' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Übernehmen', exact: true }).click()
  await expect(page.getByText('Banner gespeichert')).toBeVisible()

  // 7. my own follow link: copied — and a moment later Ben asks through it (the demo's script)
  await page.getByRole('button', { name: 'Deinen Folgen-Link teilen' }).click()
  const sheet = page.getByRole('dialog', { name: 'Dein Folgen-Link' })
  await expect(sheet.getByText('Wer den Link hat, kann dich nur anfragen. Du entscheidest, wer deine Listen sieht.')).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined)
  await sheet.getByRole('button', { name: 'Link kopieren', exact: true }).click()
  await expect(page.getByText('Wer ihn öffnet, schickt dir eine Anfrage – du bestätigst sie unter „Anfragen“.')).toBeVisible()
  await expect(sheet.getByLabel('Dein Folgen-Link')).toHaveValue(/\/f#[0-9a-f]{64}$/)
  expect(page.url()).not.toContain('#')
  await closeSheet(page)
  await page.waitForTimeout(4_500)

  // 8. "Follower & Anfragen": Ben's request with its context → accept → "Auch folgen?" → later
  await page.getByText('0 Follower · Du folgst 1').click()
  await expect(page).toHaveURL(/\/people$/)
  await expect(page.getByText('Ben Mustermann')).toBeVisible()
  await expect(page.getByText('Gemeinsam in: Annas Einweihung')).toBeVisible()
  await page.getByRole('button', { name: 'Annehmen', exact: true }).first().click()
  const accept = page.getByRole('dialog', { name: 'Anfrage von Ben Mustermann' })
  await expect(accept.getByText('Du teilst gerade keine Liste mit Followern.')).toBeVisible()
  await accept.getByRole('button', { name: 'Annehmen', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Ben Mustermann folgt dir jetzt' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Möchtest du Ben Mustermann auch folgen?' })).toBeVisible()
  await page.getByRole('button', { name: 'Später', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Follower' }).or(page.getByRole('heading', { name: 'Follower' })).first()).toBeVisible()
  await expect(page.getByText('Gerade keine Anfragen.')).toBeVisible()

  expect(errors).toEqual([])
  expect(foreign).toEqual([])
})
