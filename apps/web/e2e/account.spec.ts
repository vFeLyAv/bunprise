import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, email = 'mila@example.test') {
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill(email)
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await expect(page).toHaveURL(/\/login\/code/)
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await expect(page).toHaveURL(/\/welcome\/profile/)
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
}

test('profile records, own JSON export, typed deletion and cache cleanup work through the demo server', async ({ page }, testInfo) => {
  const legalWrites: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/consents') legalWrites.push(request.postDataJSON())
  })
  await signIn(page)
  expect(legalWrites).toHaveLength(0)
  await expect(page.getByRole('checkbox')).toHaveCount(2)
  await expect(page.getByRole('checkbox').nth(0)).toBeChecked()
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked()
  await page.getByLabel('Name', { exact: true }).fill('Mila Demo')
  await page.getByRole('link', { name: 'Nutzungsbedingungen für den Pilotbetrieb', exact: true }).click()
  await expect(page).toHaveURL(/\/legal\/nutzung\?/)
  await page.goBack()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Mila Demo')
  await expect(page.getByRole('checkbox').nth(0)).toBeChecked()
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked()
  expect(legalWrites).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await expect(page).toHaveURL(/\/welcome$/)
  expect(legalWrites).toHaveLength(1)
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
  await expect(page).toHaveURL(/\/soon$/)
  // wave 1: the settings are the tab bar's Profil tab (no gear in the feed any more)
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Profil/ }).click()
  await expect(page).toHaveURL(/\/settings$/)
  // name and address show in the profile header and in the "Konto" group (wave 1)
  const account = page.getByRole('region', { name: 'Konto' })
  await expect(account.getByText('Mila Demo', { exact: true })).toBeVisible()
  await expect(account.getByText('mila@example.test', { exact: true })).toBeVisible()
  const offline = page.getByRole('switch', { name: /Schnellstart/ })
  await expect(offline).toHaveAttribute('aria-checked', 'false')
  await offline.click()
  await expect(offline).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('bunprise.demo.query')))).toBe(true)
  await page.evaluate(() => {
    // Invented unrelated account sentinels prove demo cleanup stays in its own namespace.
    localStorage.setItem('bunprise.auth', 'fixture-real-session')
    localStorage.setItem('bunprise.query', 'fixture-real-cache')
  })
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true, animations: 'disabled' })

  await page.getByRole('link', { name: 'Meine Daten herunterladen', exact: true }).click()
  await page.getByRole('button', { name: 'Datei erstellen', exact: true }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Herunterladen', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/^bunprise-export-\d{4}-\d{2}-\d{2}\.json$/)
  const exportedPath = testInfo.outputPath('own-export.json')
  await download.saveAs(exportedPath)
  const exportedText = await readFile(exportedPath, 'utf8')
  const exported: unknown = JSON.parse(exportedText)
  expect(exported).toMatchObject({
    format: 'bunprise-export-v1', account: { email: 'mila@example.test' },
    profile: { display_name: 'Mila Demo', onboarding_done_at: expect.any(String) },
    consents: expect.arrayContaining([
      { kind: 'terms', version: 'terms-2026-10-pilot-2', locale: 'de', accepted_at: expect.any(String) },
      { kind: 'privacy_notice', version: 'privacy-2026-10-pilot-2', locale: 'de', accepted_at: expect.any(String) },
      { kind: 'age_18plus', version: 'age-18plus-2026-10-pilot-1', locale: 'de', accepted_at: expect.any(String) },
    ]),
    reservations_made_by_me: [],
  })
  expect(exportedText).not.toMatch(/reserver_id|reserved_by_name|wish_title_snapshot|last_seen_at/)
  await page.screenshot({ path: testInfo.outputPath('export.png'), fullPage: true, animations: 'disabled' })

  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await page.getByRole('link', { name: 'Konto löschen', exact: true }).click()
  const confirm = page.getByRole('button', { name: 'Endgültig löschen', exact: true })
  const word = page.getByLabel('Gib zur Bestätigung „LÖSCHEN“ ein', { exact: true })
  await expect(confirm).toBeDisabled()
  await word.fill('DELETE')
  await expect(confirm).toBeDisabled()
  await word.fill('LÖSCHEN')
  await expect(confirm).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('delete-confirm.png'), fullPage: true, animations: 'disabled' })
  await confirm.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('a[href*="mode=signin"]')).toBeVisible()
  const storage = await page.evaluate(() => ({
    demoLocal: Object.keys(localStorage).filter((key) => key.startsWith('bunprise.demo.')),
    // the start screen the deletion lands on writes its own once-per-visit flag ("the bunnies' welcome was
    // shown", '1', no account data — docs/storage-registry.md welcomeSeen.*): that one may be there
    demoSession: Object.keys(sessionStorage).filter((key) => key.startsWith('bunprise.demo.') && key !== 'bunprise.demo.welcomeSeen.start'),
    realAuth: localStorage.getItem('bunprise.auth'), realCache: localStorage.getItem('bunprise.query'),
  }))
  expect(storage.demoLocal).toEqual([])
  expect(storage.demoSession).toEqual([])
  expect(storage.realAuth).toBe('fixture-real-session')
  expect(storage.realCache).toBe('fixture-real-cache')
})

test('export and delete stay available before completing the profile or recording legal versions', async ({ page }, testInfo) => {
  await signIn(page, 'rights@example.test')
  await page.getByRole('link', { name: 'Meine Daten herunterladen', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/export$/)
  await page.getByRole('button', { name: 'Datei erstellen', exact: true }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Herunterladen', exact: true }).click()
  const downloaded = await downloadEvent
  const exportPath = testInfo.outputPath('before-setup-export.json')
  await downloaded.saveAs(exportPath)
  const exported: unknown = JSON.parse(await readFile(exportPath, 'utf8'))
  expect(exported).toMatchObject({ account: { email: 'rights@example.test' }, profile: { display_name: null }, consents: [] })
  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await page.getByRole('link', { name: 'Konto löschen', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/delete$/)
  await page.getByLabel('Gib zur Bestätigung „LÖSCHEN“ ein', { exact: true }).fill('LÖSCHEN')
  await page.getByRole('button', { name: 'Endgültig löschen', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('footer').getByRole('link')).toHaveCount(3)
})

test('public legal texts stay reachable before signing in', async ({ page }, testInfo) => {
  await page.goto('/login?mode=signup&method=email&frame=0')
  for (const [label, path] of [['Impressum', '/legal/impressum'], ['Datenschutz', '/legal/datenschutz'], ['Nutzungsbedingungen', '/legal/nutzung']] as const) {
    await page.locator('footer').getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Code schicken', exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`${path.split('/').pop()}.png`), fullPage: true, animations: 'disabled' })
    await page.goBack()
    await expect(page.getByLabel('E-Mail', { exact: true })).toBeVisible()
  }
})
