import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

// The two approved Tapsi moments in the demo app (27.10; Felix 26.10 «Psst … оставляем», «Пылинка … нравится»),
// Firefox at phone size, 2× pixels: (1) the reservation moment with the «Psst» ending in the guest's wish sheet —
// frozen frames of the scene (the puppet's own animations paused and seeked: the same frame every time) + a contact
// sheet, the end, and "Weniger"; (2) «Пылинка на линзе» on the empty "Freunde" card, started mid look-around —
// frames + contact sheet, and the "Weniger" pose. Output: SCREENS_OUT (default: the session scratchpad).

const OUT = process.env.SCREENS_OUT
  ? resolve(process.env.SCREENS_OUT)
  : 'C:/Users/Mrkol/AppData/Local/Temp/claude/E--BALLR/cda4a0c0-3e93-43ed-bab4-a6208e393f3f/scratchpad/approved-anims/tapsi'
mkdirSync(OUT, { recursive: true })

async function open(browser: Browser, reduced = false): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', baseURL: 'http://localhost:5173',
    ...(reduced ? { reducedMotion: 'reduce' as const } : {}),
  })
  const page = await context.newPage()
  // headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs
  await page.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
  return page
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
}

async function crop(page: Page, target: Locator, file: string, margin = 24) {
  const box = await target.boundingBox()
  if (!box) throw new Error(`no box for ${file}`)
  const vp = page.viewportSize() ?? { width: 390, height: 844 }
  const x = Math.max(0, box.x - margin)
  const y = Math.max(0, box.y - margin)
  await page.screenshot({ path: `${OUT}/${file}.png`, clip: { x, y, width: Math.min(vp.width - x, box.width + 2 * margin), height: Math.min(vp.height - y, box.height + 2 * margin) } })
}

/**
 * The scene's animations in the puppet (`host`), taken once after the scene started (Firefox no longer lists a paused
 * animation sitting exactly at its end): all paused and moved to `seconds` — an exact, repeatable frame.
 */
async function seekScene(host: Locator, seconds: number) {
  await host.evaluate((el, ms) => {
    const box = el as HTMLElement & { sceneAnimations?: Animation[] }
    box.sceneAnimations ??= el.shadowRoot?.querySelector('svg')?.getAnimations({ subtree: true }) ?? []
    for (const animation of box.sceneAnimations) {
      animation.pause()
      animation.currentTime = ms
    }
  }, seconds * 1000)
}

/** The scene runs on from where it was seeked (like the Playhead: what is already over stays at its end). */
async function resumeScene(host: Locator) {
  await host.evaluate((el) => {
    const box = el as HTMLElement & { sceneAnimations?: Animation[] }
    for (const animation of box.sceneAnimations ?? []) {
      const end = Number(animation.effect?.getComputedTiming().endTime ?? 0)
      if (Number(animation.currentTime ?? 0) < end) animation.play()
    }
    box.sceneAnimations = undefined
  })
}

/** The CSS look-around loop of the binoculars, paused at `ms` (before the scene). */
async function seekLoop(host: Locator, ms: number) {
  await host.evaluate((el, t) => {
    for (const animation of el.shadowRoot?.querySelector('svg')?.getAnimations({ subtree: true }) ?? []) {
      animation.pause()
      animation.currentTime = t
    }
  }, ms)
}

const driven = (host: Locator) => host.evaluate((el) => el.shadowRoot?.querySelector('.hm')?.classList.contains('driven') === true)
const running = (host: Locator) => host.evaluate((el) => (el.shadowRoot?.querySelector('svg')?.getAnimations({ subtree: true }) ?? []).filter((a) => a.playState === 'running').length)

/** A contact sheet: the frame PNGs in a grid with their times, screenshotted. */
async function contactSheet(browser: Browser, frames: Array<{ file: string; label: string }>, file: string, title: string, columns = 4) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 })
  const cells = frames.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(`${OUT}/${f.file}.png`).toString('base64')}"><figcaption>${f.label}</figcaption></figure>`).join('')
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 20px; background: #F2EBDD; font: 14px/1.3 system-ui, sans-serif; color: #2A231C; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    .grid { display: grid; grid-template-columns: repeat(${columns}, auto); gap: 12px; justify-content: start; }
    figure { margin: 0; } img { display: block; width: 260px; border-radius: 10px; box-shadow: 0 0 0 1px rgba(60,40,20,.15); }
    figcaption { margin-top: 4px; font-variant-numeric: tabular-nums; color: #62554A; }
  </style><h1>${title}</h1><div class="grid">${cells}</div>`)
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true })
  await page.close()
}

/** Start → Anna's housewarming (Mila is her guest in the demo world) → a free wish → "Ich schenke das". */
async function reserveAtAnna(page: Page): Promise<{ sheet: Locator; tapsi: Locator }> {
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await nav.getByRole('link', { name: /^Start/ }).click()
  await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
  const free = page.locator('[data-wish-id]', { hasText: 'Kinogutschein' })
  await free.scrollIntoViewIfNeeded()
  await free.locator('button').first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Ich schenke das', exact: true }).click()
  const tapsi = sheet.locator('[data-mascot="hamster"]')
  await expect(tapsi).toBeVisible({ timeout: 10_000 })
  return { sheet, tapsi }
}

test('Tapsi «Psst»: the reservation moment ends with paws over his mouth (frames, contact sheet, end)', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await open(browser)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signUp(page)
  const { sheet, tapsi } = await reserveAtAnna(page)
  await expect.poll(() => driven(tapsi), { timeout: 10_000 }).toBe(true)
  await seekScene(tapsi, 0)
  await tapsi.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(700) // the sheet's own bounce-in (motion, outside the puppet) ends
  const times = [0.2, 0.47, 1.0, 1.5, 1.9, 2.5, 3.1, 3.7, 4.05, 4.3, 4.6, 4.85, 5.2, 5.45, 5.65]
  const frames: Array<{ file: string; label: string }> = []
  for (const t of times) {
    await seekScene(tapsi, t)
    await page.waitForTimeout(60)
    const file = `psst-frame-${t.toFixed(2)}`
    await crop(page, tapsi, file, 18)
    frames.push({ file, label: `${t.toFixed(2)} s` })
  }
  await contactSheet(browser, frames, 'psst-contact-sheet', 'Tapsi «Psst» — Reservierung (scene “secret”), eingefrorene Kadr', 5)
  // the sheet at the «Psst» pose, then let the scene finish
  await seekScene(tapsi, 4.6)
  await page.screenshot({ path: `${OUT}/psst-sheet-4.60.png` })
  await resumeScene(tapsi)
  await expect.poll(() => driven(tapsi), { timeout: 10_000 }).toBe(false)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/psst-sheet-end.png` })
  await expect(sheet.getByRole('status')).toBeVisible()
  expect(errors).toEqual([])
})

test('Tapsi «Psst» under "Weniger": the still pose, no animation', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await open(browser, true)
  await signUp(page)
  const { tapsi } = await reserveAtAnna(page)
  await page.waitForTimeout(1200)
  expect(await driven(tapsi)).toBe(false)
  expect(await running(tapsi)).toBe(0)
  await tapsi.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await crop(page, tapsi, 'psst-weniger', 18)
  await page.screenshot({ path: `${OUT}/psst-weniger-sheet.png` })
})

/** Listen → Freunde with nobody followed (the demo's first account follows three people: unfollow them first). */
async function freundeEmpty(page: Page): Promise<Locator> {
  await page.evaluate(async (path) => {
    const api = (await import(/* @vite-ignore */ path)) as { unfollow: (id: string) => Promise<void> }
    for (const id of ['d1e0a000-0000-4000-8000-000000000001', 'd1e0a000-0000-4000-8000-000000000002', 'd1e0a000-0000-4000-8000-000000000004']) {
      await api.unfollow(id)
    }
  }, '/src/lib/api/lists.ts')
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await nav.getByRole('link', { name: /^Listen/ }).click()
  await page.getByRole('radio', { name: 'Freunde', exact: true }).click()
  const card = page.locator('.lf-empty')
  await expect(card).toBeVisible()
  const tapsi = card.locator('[data-mascot="hamster"]')
  await tapsi.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(900)
  return tapsi
}

test('Tapsi «Пылинка на линзе»: only a tap starts it, from the middle of the look-around (frames, contact sheet)', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await open(browser)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signUp(page)
  const tapsi = await freundeEmpty(page)
  await expect(tapsi).toHaveAttribute('role', 'button')
  await expect(tapsi).toHaveAttribute('aria-label', 'Tapsi putzt sein Fernglas')
  // never by itself
  await page.waitForTimeout(1500)
  expect(await driven(tapsi)).toBe(false)
  await crop(page, tapsi, 'speck-before', 14)
  // the look-around loop turned to the left (4 s into its 16 s), then the tap
  await seekLoop(tapsi, 4000)
  await crop(page, tapsi, 'speck-loop-left', 14)
  await tapsi.click()
  await expect.poll(() => driven(tapsi), { timeout: 10_000 }).toBe(true)
  const times = [0, 0.1, 0.2, 0.32, 0.45, 0.58, 0.66, 0.74, 0.86, 0.98, 1.1, 1.25, 1.4, 1.6]
  const frames: Array<{ file: string; label: string }> = []
  for (const t of times) {
    await seekScene(tapsi, t)
    await page.waitForTimeout(60)
    const file = `speck-frame-${t.toFixed(2)}`
    await crop(page, tapsi, file, 14)
    frames.push({ file, label: `${t.toFixed(2)} s` })
  }
  await contactSheet(browser, [{ file: 'speck-loop-left', label: 'vor dem Tippen (Schleife links)' }, ...frames], 'speck-contact-sheet', 'Tapsi «Пылинка на линзе» (scene “speck”), eingefrorene Kadr', 5)
  await seekScene(tapsi, 0.66)
  await page.screenshot({ path: `${OUT}/speck-card-0.66.png` })
  await resumeScene(tapsi)
  await expect.poll(() => driven(tapsi), { timeout: 10_000 }).toBe(false)
  await page.waitForTimeout(400)
  await crop(page, tapsi, 'speck-after', 14)
  // Enter answers too (keyboard)
  await tapsi.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => driven(tapsi), { timeout: 10_000 }).toBe(true)
  expect(errors).toEqual([])
})

test('Tapsi «Пылинка» under "Weniger": binoculars lowered, ^ ^, no button, nothing moves', async ({ browser }) => {
  test.setTimeout(90_000)
  const page = await open(browser, true)
  await signUp(page)
  const tapsi = await freundeEmpty(page)
  await expect(tapsi).not.toHaveAttribute('role', 'button')
  await tapsi.click({ force: true })
  await page.waitForTimeout(600)
  expect(await driven(tapsi)).toBe(false)
  expect(await running(tapsi)).toBe(0)
  await crop(page, tapsi, 'speck-weniger', 14)
  await page.screenshot({ path: `${OUT}/speck-weniger-card.png` })
})
