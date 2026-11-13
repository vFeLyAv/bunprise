import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// The twelve costumes of «Pompons Sammlung» in the demo app (31.10, docs/handoffs/2026-10-31-costumes-in-app.md).
// Firefox at phone size: a REAL milestone (a new list → «Leseratte»), the dot at the Profil row, the page opening on
// the Garderobe, the new tile «opening», wearing it, a locked tile's hint, the demo button (everything at once), the
// laptop's put-on + typing in the shop window, Pompon in costumes on «Ideen» and as the Lists buddy, dark theme,
// reduced motion (the still typing pose). Screens: docs/screens/2026-10-31-costumes-in-app/ (or SCREENS_OUT).
// run from apps/web: npx playwright test e2e/costumes-in-app-screens.spec.ts

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-31-costumes-in-app')
mkdirSync(OUT, { recursive: true })

async function open(browser: Browser, scheme: 'light' | 'dark', reduced = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: scheme, baseURL: 'http://localhost:5173',
    ...(reduced ? { reducedMotion: 'reduce' as const } : {}),
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-31T11:00:00'))
  // headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs
  await page.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { context, page, errors }
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
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible()
}

/** A new list from a template (CreateListSheet: the person's own list → the milestone «list»). */
async function toListsWithAList(page: Page) {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Listen/ }).click()
  await page.waitForURL('**/lists')
  const template = page.getByRole('group', { name: 'Vorlagen' }).getByRole('button', { name: 'Weihnachten' })
  if (await template.count()) await template.first().click()
  else await page.getByRole('button', { name: 'Neue Liste' }).first().click()
  const sheet = page.getByRole('dialog')
  const title = sheet.getByLabel('Titel')
  if ((await title.inputValue()) === '') await title.fill('Weihnachten')
  await sheet.getByRole('button', { name: 'Anlegen', exact: true }).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  const inList = (url: URL) => /\/lists\/[^/]+$/.test(url.pathname)
  await page.waitForURL(inList, { timeout: 8000 }).catch(() => undefined)
  if (inList(new URL(page.url()))) {
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Zurück' }).first().click()
    await page.waitForURL((url) => url.pathname.replace(/\/$/, '').endsWith('/lists'), { timeout: 5000 })
  }
}

/** The Sammlung is a sub-page without the tab bar: back to Profil first. */
async function leaveSammlung(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Profil' }).click()
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible()
  await page.waitForTimeout(500)
}

async function toProfil(page: Page) {
  await page.getByRole('link', { name: /Profil/ }).first().click()
  await page.waitForTimeout(900)
}

async function openSammlung(page: Page) {
  const row = page.locator('a[href="/settings/sammlung"]')
  await row.scrollIntoViewIfNeeded()
  await row.click()
  await expect(page.getByRole('heading', { name: 'Pompons Sammlung', level: 1 })).toBeVisible()
  await page.waitForTimeout(2500)
}

async function toGarderobe(page: Page) {
  await page.getByRole('radio', { name: 'Garderobe' }).or(page.getByRole('button', { name: 'Garderobe' })).first().click()
  await expect(page.locator('[data-costumes]')).toBeVisible()
  await page.waitForTimeout(2500)
}

/** The shop window (Pompon in what he wears). */
async function shotWindow(page: Page, file: string) {
  const box = await page.locator('.sam-dressing').boundingBox()
  if (!box) throw new Error('no shop window')
  await page.screenshot({ path: `${OUT}/${file}`, clip: { x: 0, y: Math.max(0, box.y - 8), width: 390, height: box.height + 16 } })
}

async function shotMascot(page: Page, sel: string, file: string, pad = 40) {
  const el = page.locator(sel).first()
  await el.waitFor({ state: 'attached', timeout: 15_000 })
  await el.scrollIntoViewIfNeeded().catch(() => undefined)
  await page.waitForTimeout(600)
  const box = await el.boundingBox()
  if (!box) throw new Error(`no box for ${sel}`)
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad - 30)
  await page.screenshot({ path: `${OUT}/${file}`, clip: { x, y, width: Math.min(390 - x, box.width + pad * 2), height: box.height + pad * 2 + 30 } })
}

async function shotBuddy(page: Page, file: string) {
  await expect(page.locator('.bd-hit').first()).toBeAttached({ timeout: 15_000 })
  await page.evaluate(() => {
    const hit = document.querySelector('.bd-hit')
    if (hit) window.scrollTo({ top: window.scrollY + hit.getBoundingClientRect().top - 260, behavior: 'instant' })
  })
  await page.waitForTimeout(1800)
  const r = await page.evaluate(() => {
    const b = document.querySelector('.bd-host')!.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height }
  })
  const x = Math.max(0, r.x - 60)
  const y = Math.max(0, r.y - 90)
  await page.screenshot({ path: `${OUT}/${file}`, clip: { x, y, width: Math.min(390 - x, r.w + 120), height: r.h + 130 } })
}

/** Back to the top of the page (the shop window) after a tap on a tile further down. */
async function toTop(page: Page) {
  await page.locator('.sam-dressing').scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}

test('a real milestone (a new list) → dot → Garderobe → the new tile opens → wear it; locked hint; demo: everything; the laptop types (light)', async ({ browser }) => {
  test.setTimeout(300_000)
  const { context, page, errors } = await open(browser, 'light')
  await signUp(page)

  await toListsWithAList(page)
  await toProfil(page)
  const row = page.locator('a[href="/settings/sammlung"]')
  await row.scrollIntoViewIfNeeded()
  await expect(page.locator('[data-sammlung-new]')).toHaveCount(1)
  await page.screenshot({ path: `${OUT}/profil-row-new-costume-light.png` })

  // the page opens on the Garderobe (a new costume waits there)
  await row.click()
  await expect(page.locator('[data-costumes]')).toBeVisible()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/garderobe-opens-light.png` })
  const tile = page.locator('button[data-costume="reading"]')
  await expect(tile).toHaveAttribute('data-fresh', '')
  // scrolled to the costumes: the new tile «opens» (cover fades, he grows in)
  await page.locator('h2.sam-h').scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy({ top: 120, behavior: 'instant' }))
  await expect(tile).toHaveAttribute('data-reveal', '', { timeout: 5000 })
  const grid = await page.locator('[data-costumes]').boundingBox()
  if (!grid) throw new Error('no grid')
  for (const ms of [250, 500, 1200]) {
    await page.waitForTimeout(ms === 250 ? 250 : ms === 500 ? 250 : 700)
    await page.screenshot({ path: `${OUT}/reveal-${ms}-light.png`, clip: { x: 0, y: Math.max(0, grid.y - 60), width: 390, height: Math.min(560, grid.height + 140) } })
  }
  await expect(page.locator('.sam-note').last()).toContainText('Neu für dich: Leseratte')

  // wear it
  await tile.click()
  await toTop(page)
  await page.waitForTimeout(2200)
  await shotWindow(page, 'garderobe-wears-reading-light.png')
  await expect(page.locator('.sam-cap')).toContainText('Leseratte')

  // a locked one only says what to do
  await page.locator('button[data-costume="knight"]').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/garderobe-costumes-locked-light.png`, fullPage: true })

  // the new costume was seen: no dot any more (the record says so)
  const saw = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bunprise-sammlung.')).map((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as { saw?: string[]; got?: string[] }))
  expect(saw[0]?.got).toEqual(['list'])
  expect(saw[0]?.saw).toEqual(['reading'])

  // demo: everything at once
  await page.locator('[data-demo-unlock]').click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/garderobe-all-unlocked-light.png`, fullPage: true })

  // spa (approved last): towel turban, cucumber mask, eyes closed
  await page.locator('button[data-costume="spa"]').click()
  await toTop(page)
  await page.waitForTimeout(2200)
  await shotWindow(page, 'garderobe-wears-spa-light.png')
  await expect(page.locator('.sam-cap')).toContainText('Wellness')

  // the laptop: it lands, he hops, then he types — Enter, and a heart pops out of the screen
  await page.locator('button[data-costume="laptop"]').click()
  const t0 = Date.now()
  await toTop(page)
  for (const ms of [300, 1300, 2300, 3200, 4200, 4800, 5300, 6400]) {
    await page.waitForTimeout(Math.max(0, t0 + ms - Date.now()))
    await shotWindow(page, `laptop-typing-${String(ms).padStart(4, '0')}-light.png`)
  }
  await expect(page.locator('.sam-cap')).toContainText('Im Homeoffice')
  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})

test('Pompon in costumes elsewhere: Ideen (laptop, knight), the Lists buddy (knight; laptop = away from the desk) — dark', async ({ browser }) => {
  test.setTimeout(300_000)
  const { context, page, errors } = await open(browser, 'dark')
  await signUp(page)
  await toListsWithAList(page)
  await toProfil(page)
  await openSammlung(page)
  if (!(await page.locator('[data-costumes]').isVisible())) await toGarderobe(page)
  await page.locator('[data-demo-unlock]').click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/garderobe-all-unlocked-dark.png`, fullPage: true })

  await page.locator('button[data-costume="knight"]').click()
  await page.waitForTimeout(2500)
  await toTop(page)
  await shotWindow(page, 'garderobe-wears-knight-dark.png')

  await leaveSammlung(page)
  await page.getByRole('link', { name: /Ideen/ }).first().click()
  await page.waitForTimeout(3000)
  await shotMascot(page, '[data-mascot="bunny"]', 'ideen-knight-dark.png')
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Listen/ }).click()
  await page.waitForURL('**/lists')
  await shotBuddy(page, 'listen-buddy-knight-dark.png')

  await toProfil(page)
  await openSammlung(page)
  if (!(await page.locator('[data-costumes]').isVisible())) await toGarderobe(page)
  await page.locator('button[data-costume="laptop"]').click()
  await page.waitForTimeout(1500)
  await leaveSammlung(page)
  await page.getByRole('link', { name: /Ideen/ }).first().click()
  await page.waitForTimeout(3000)
  await shotMascot(page, '[data-mascot="bunny"]', 'ideen-laptop-dark.png')
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Listen/ }).click()
  await page.waitForURL('**/lists')
  await shotBuddy(page, 'listen-buddy-laptop-away-dark.png')
  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})

test('reduced motion: no reveal animation, no drop, the laptop\'s still typing pose (light)', async ({ browser }) => {
  test.setTimeout(240_000)
  const { context, page, errors } = await open(browser, 'light', true)
  await signUp(page)
  await toProfil(page)
  await openSammlung(page)
  await toGarderobe(page)
  await page.locator('[data-demo-unlock]').click()
  await page.waitForTimeout(2500)
  await page.locator('button[data-costume="laptop"]').click()
  await toTop(page)
  await page.waitForTimeout(1500)
  await shotWindow(page, 'laptop-still-reduced-light.png')
  // nothing runs in the shop window (no animations on his puppet)
  const running = await page.evaluate(() => {
    const host = document.querySelector('.sam-pompon')
    return host?.shadowRoot?.querySelector('svg')?.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length ?? -1
  })
  expect(running).toBe(0)
  expect(errors, errors.join('\n')).toEqual([])
  await context.close()
})
