import { expect, test, type Page } from '@playwright/test'

// The whole pilot in one demo session (docs/demo-mode.md): sign up → profile → onboarding → feed →
// guest view → secret reservation and cancel → own occasion with two wishes → invite link →
// the fixed demo link for "Bens Grillabend" → explicit "Beitreten" → settings → export.
// The demo world lives in page memory, so the spec never reloads after signing up: the invite
// link is opened in-app (history.pushState), like tapping it while the app is open.

const INVITE = '6772696c6c6162656e642d62656e2d64656d6f2d696e766974652d6c696e6b21'
const HOUSEWARMING = 'd1e0b000-0000-4000-8000-000000000001'
const BARBECUE = 'd1e0b000-0000-4000-8000-000000000002'

async function closeSheet(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('the pilot end to end: guest reservation, own occasion, invite, join, export', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  // sign up with an invented address, code 123456
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill('walk@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Walk')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()

  // onboarding: the bunny greets by name, two choices, skip → feed
  await expect(page.getByRole('heading', { name: 'Hallo Walk! Ich bin Pompon.' })).toBeVisible()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await expect(page.getByText('Ersten Anlass anlegen')).toBeVisible()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
  await expect(page).toHaveURL(/\/soon$/)

  // guest view: anonymous "Reserviert", never a name
  await page.getByRole('link', { name: /Annas Einweihung/ }).click()
  await expect(page).toHaveURL(new RegExp(`/occasions/${HOUSEWARMING}$`))
  await expect(page.getByRole('button', { name: /Kaffeemühle mit Handkurbel/ }).getByText('Reserviert', { exact: true })).toBeVisible()
  await expect(page.getByText(/Reserviert von/)).toHaveCount(0)

  // reserve (not optimistic: the confirmation comes with the server's answer) and cancel
  await page.getByRole('button', { name: /Kinogutschein/ }).click()
  await page.getByRole('button', { name: 'Ich schenke das', exact: true }).click()
  // the reward moment: the hamster's line says it (the "Von dir reserviert" chip is back on the row and
  // the next time the sheet opens — design pass, blocker 15)
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('erfährt nichts')
  await closeSheet(page)
  await expect(page.getByRole('button', { name: /Kinogutschein/ }).getByText('Von dir reserviert')).toBeVisible()
  await page.getByRole('button', { name: /Kinogutschein/ }).click()
  await page.getByRole('button', { name: 'Reservierung aufheben', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Kinogutschein/ }).getByText('Von dir reserviert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Zurück', exact: true }).first().click()
  await expect(page).toHaveURL(/\/soon$/)

  // own occasion + two wishes; the host view never mentions reservations
  // (wave 1: the tab bar's "+" opens the create menu — it replaced the feed's FAB)
  await page.getByRole('button', { name: 'Neu erstellen', exact: true }).click()
  await page.getByRole('dialog', { name: 'Was möchtest du erstellen?' }).getByRole('button', { name: /Anlass erstellen/ }).click()
  await page.getByLabel('Titel', { exact: true }).fill('Walks Geburtstag')
  // our own pickers (wave 1, no native date input): the calendar's "Samstag" chip, the place from the sheet
  await page.getByRole('button', { name: /^Datum/ }).click()
  await page.getByRole('button', { name: 'Samstag', exact: true }).click()
  await page.getByRole('button', { name: 'Ort hinzufügen', exact: true }).click()
  await page.getByRole('combobox', { name: 'Ort suchen' }).fill('Biergarten am See')
  await page.getByRole('option', { name: /„Biergarten am See“ übernehmen/ }).click()
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  // K10 (wave 1): the bunny files the new occasion onto the calendar — since wave 2 Start's "Monat" view
  // (/calendar redirects there); "Freunde einladen" opens it
  await expect(page).toHaveURL(/\/soon\?view=month/)
  await page.getByRole('link', { name: 'Freunde zu „Walks Geburtstag“ einladen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Walks Geburtstag' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Deine Wünsche' })).toBeVisible()
  for (const title of ['Kopfhörer', 'Bücher-Gutschein']) {
    await page.getByRole('link', { name: /Wunsch/ }).first().click()
    // link first (wave 1): a wish without a link goes through "Ohne Link hinzufügen"
    await page.getByRole('button', { name: 'Ohne Link hinzufügen', exact: true }).click()
    await page.getByLabel('Titel', { exact: true }).fill(title)
    await page.getByRole('button', { name: 'Wunsch hinzufügen', exact: true }).click()
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible()
  }
  expect(await page.locator('main').innerText()).not.toMatch(/reserv/i)

  // invite link: shown in memory only, never in the address bar ("Wer kommt" › "Per Link einladen" since 27.10)
  await page.getByRole('button', { name: /^Per Link einladen/ }).click()
  await page.getByRole('button', { name: 'Einladungslink erstellen', exact: true }).click()
  await expect(page.getByLabel('Dein Einladungslink', { exact: true })).toHaveValue(/\/i#[0-9a-f]{64}$/)
  expect(page.url()).not.toContain('#')

  // the fixed demo link → explicit "Beitreten" → guest of "Bens Grillabend"
  await page.evaluate((token) => { history.pushState({ __TSR_index: 99, key: 'e2e', __TSR_key: 'e2e' }, '', `/i#${token}`) }, INVITE)
  await expect(page).toHaveURL(/\/i$/)
  await page.getByRole('button', { name: 'Beitreten', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/occasions/${BARBECUE}$`), { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Bens Grillabend' })).toBeVisible()

  // feed with all three, settings, export
  await page.evaluate(() => { history.pushState({ __TSR_index: 100, key: 'e2e-2', __TSR_key: 'e2e-2' }, '', '/soon') })
  await expect(page.getByRole('link', { name: /Bens Grillabend/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Walks Geburtstag/ })).toBeVisible()
  // wave 1: the settings are the tab bar's Profil tab (no gear in the feed any more)
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Profil/ }).click()
  // the address shows in the profile header and in the "Konto" group
  await expect(page.getByRole('region', { name: 'Konto' }).getByText('walk@example.test', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Meine Daten herunterladen', exact: true }).click()
  await page.getByRole('button', { name: 'Datei erstellen', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Herunterladen', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
