import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// The automatic cover motifs (Felix 26.10: an occasion without a photo gets one of OUR pictures when its title says
// what it is), in the demo, Firefox at phone size (390 × 844, 2× pixels): the form shows the motif BEFORE saving
// ("Automatisch"), the Start card shows it after saving; "Training im Gym", "Spieleabend"; a title without a motif
// stays as before; light, dark and "Blau". Also asserts: no page error, no request to a foreign host.
// Screens go to $COVERS_OUT, else docs/screens/2026-10-27-occasion-covers/.

const OUT = process.env.COVERS_OUT ? resolve(process.env.COVERS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-occasion-covers')
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
  await page.getByLabel('Name', { exact: true }).fill('Mila')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
  await expect(page).toHaveURL(/\/soon/)
}

/** In-app navigation (a reload would reset the demo world). */
async function go(page: Page, to: string) {
  await page.evaluate(async (target) => {
    const { router } = await import('/src/router.tsx')
    await router.navigate({ to: target })
  }, to)
}

const photoGroup = (page: Page) => page.getByRole('group', { name: 'Titelfoto' })

/** "Neuer Anlass" with a title; the form scrolled to the cover group (the motif ready, when there is one). */
async function formWith(page: Page, title: string, motif: string | null, name: string) {
  await go(page, '/occasions/new')
  await expect(page).toHaveURL(/\/occasions\/new/)
  await page.getByLabel('Titel', { exact: true }).fill(title)
  if (motif) await expect(photoGroup(page).locator(`.of-cover-frame svg.cv-art[data-cover="${motif}"][data-state="ready"]`)).toBeVisible({ timeout: 10_000 })
  else await expect(photoGroup(page).getByRole('button', { name: /Motiv wählen/ })).toBeVisible({ timeout: 10_000 })
  await photoGroup(page).evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

/** Tomorrow, "Speichern", then Start's list: the new card (with its motif, when there is one). */
async function saveAndShowCard(page: Page, title: string, motif: string | null, name: string) {
  await page.getByRole('button', { name: /^Datum/ }).click()
  await page.getByRole('button', { name: 'Morgen', exact: true }).click()
  await page.getByRole('button', { name: /Speichern/ }).click()
  await expect(page).toHaveURL(/\/soon/)
  // the bunny files the new occasion onto its day (the K10 landing), then the month view drops `created` — only then
  // to the list (earlier, the landing's own navigation would switch back to the month)
  await expect(page).toHaveURL(/\/soon\?view=month$/, { timeout: 20_000 }).catch(() => undefined)
  await go(page, '/soon')
  const card = page.locator('a.feed-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  if (motif) await expect(card.locator(`svg.cv-art[data-cover="${motif}"][data-state="ready"]`)).toBeVisible({ timeout: 10_000 })
  else await expect(card.locator('.feed-cover')).toHaveCount(0)
  // the list keeps moving a little (entrance springs): scroll by hand, let it settle, then cut the card out
  await card.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  const box = await card.boundingBox({ timeout: 5_000 }).catch(() => null)
  if (box) await page.screenshot({ path: `${OUT}/${name}-card.png`, clip: box })
}

function watch(page: Page) {
  const errors: string[] = []
  const foreign: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['localhost', '127.0.0.1', 'demo.localhost'].includes(url.hostname) && !url.protocol.startsWith('blob') && !url.protocol.startsWith('data')) foreign.push(url.href)
  })
  return { errors, foreign }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`cover motifs: form and Start card (${scheme})`, async ({ page }) => {
    test.setTimeout(240_000)
    const seen = watch(page)
    await solidMaterials(page)
    await page.emulateMedia({ colorScheme: scheme })
    await signUp(page)

    await formWith(page, 'Geburtstag von Anna', 'birthday', `01-form-birthday-auto-${scheme}`)
    await expect(photoGroup(page).getByText('Automatisch')).toBeVisible()
    await expect(photoGroup(page).getByText('Motiv: Geburtstag')).toBeVisible()
    await saveAndShowCard(page, 'Geburtstag von Anna', 'birthday', `02-start-birthday-${scheme}`)

    await formWith(page, 'Training im Gym', 'sport', `03-form-gym-${scheme}`)
    await saveAndShowCard(page, 'Training im Gym', 'sport', `04-start-gym-${scheme}`)

    await formWith(page, 'Spieleabend', 'gamenight', `05-form-spieleabend-${scheme}`)
    await saveAndShowCard(page, 'Spieleabend', 'gamenight', `06-start-spieleabend-${scheme}`)

    await formWith(page, 'Steuererklärung', null, `07-form-no-motif-${scheme}`)
    await saveAndShowCard(page, 'Steuererklärung', null, `08-start-no-motif-${scheme}`)

    // the occasion screen of the birthday: the motif in the hero
    await go(page, (await page.locator('a.feed-card').filter({ hasText: 'Geburtstag von Anna' }).first().getAttribute('href')) ?? '/soon')
    await expect(page).toHaveURL(/\/occasions\//)
    await expect(page.locator('.occ-cover svg.cv-art[data-cover="birthday"][data-state="ready"]')).toBeVisible({ timeout: 10_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/09-hero-birthday-${scheme}.png` })

    expect(seen.errors).toEqual([])
    expect(seen.foreign).toEqual([])
  })
}

test('cover motifs: the strip, a motif picked by hand, "Kein Motiv" (light)', async ({ page }) => {
  test.setTimeout(180_000)
  const seen = watch(page)
  await solidMaterials(page)
  await signUp(page)
  await formWith(page, 'Freitag bei mir', null, '10-form-nothing-found-light')
  await photoGroup(page).getByRole('button', { name: /Motiv wählen/ }).click()
  await page.getByRole('radio', { name: 'Grillen' }).click()
  await expect(photoGroup(page).locator('svg.cv-art[data-cover="bbq"][data-state="ready"]').first()).toBeVisible()
  await expect(photoGroup(page).getByText('Von dir gewählt.')).toBeVisible()
  await photoGroup(page).evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await settle(page)
  await page.screenshot({ path: `${OUT}/11-form-picked-by-hand-light.png` })
  await page.getByLabel('Titel', { exact: true }).fill('Geburtstag von Anna')
  await page.getByRole('radio', { name: 'Kein Motiv' }).click()
  await expect(photoGroup(page).getByText('Kein Titelbild')).toBeVisible()
  await photoGroup(page).evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await settle(page)
  await page.screenshot({ path: `${OUT}/12-form-switched-off-light.png` })
  expect(seen.errors).toEqual([])
  expect(seen.foreign).toEqual([])
})

test('cover motifs: "Blau" theme', async ({ page }) => {
  test.setTimeout(120_000)
  await solidMaterials(page)
  await page.addInitScript(() => localStorage.setItem('bunprise.theme', 'navy'))
  await signUp(page)
  await formWith(page, 'Spieleabend', 'gamenight', '13-form-spieleabend-navy')
  await saveAndShowCard(page, 'Spieleabend', 'gamenight', '14-start-spieleabend-navy')
})

// a short dark run for the last two pictures (the long one above is the full walk)
test('cover motifs: no motif and the hero (dark)', async ({ page }) => {
  test.setTimeout(150_000)
  const seen = watch(page)
  await solidMaterials(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await signUp(page)
  await formWith(page, 'Steuererklärung', null, '07-form-no-motif-dark')
  await saveAndShowCard(page, 'Steuererklärung', null, '08-start-no-motif-dark')
  await formWith(page, 'Geburtstag von Anna', 'birthday', '01-form-birthday-auto-dark')
  await saveAndShowCard(page, 'Geburtstag von Anna', 'birthday', '02-start-birthday-dark')
  await go(page, (await page.locator('a.feed-card').filter({ hasText: 'Geburtstag von Anna' }).first().getAttribute('href')) ?? '/soon')
  await expect(page.locator('.occ-cover svg.cv-art[data-cover="birthday"][data-state="ready"]')).toBeVisible({ timeout: 10_000 })
  await settle(page)
  await page.screenshot({ path: `${OUT}/09-hero-birthday-dark.png` })
  expect(seen.errors).toEqual([])
  expect(seen.foreign).toEqual([])
})
