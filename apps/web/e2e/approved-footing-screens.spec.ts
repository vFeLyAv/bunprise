import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

// «Твёрдая почва» in the demo app (Felix 26.10 «нравится», 27.10 in the app): on "Listen" Pompon (the buddy) is
// picked up with the mouse, carried slowly to just above the rounded right end of a card and set down gently — he
// touches the card with one paw, shifts his weight and steps inward. Frames are captured as fast as Firefox allows
// over ≈ 1.8 s and put on one contact sheet; "Weniger" (OS reduced motion): he is set down straight on the safe spot.
// Screens go to SCREENS_OUT (default: the session scratchpad, approved-anims/footing).

const OUT = process.env.SCREENS_OUT
  ? resolve(process.env.SCREENS_OUT)
  : 'C:/Users/Mrkol/AppData/Local/Temp/claude/E--BALLR/cda4a0c0-3e93-43ed-bab4-a6208e393f3f/scratchpad/approved-anims/footing'
mkdirSync(OUT, { recursive: true })

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

async function open(browser: Browser, reduced: boolean) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: 'light', baseURL: 'http://localhost:5173',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  })
  const p = await context.newPage()
  await p.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
  return { context, page: p }
}

/** A new account has no lists (then the empty card's own Pompon shows and the buddy steps aside): make one. */
async function makeLists(page: Page) {
  for (const name of ['Weihnachten']) {
    const empty = page.getByRole('group', { name: 'Vorlagen' }).getByRole('button', { name })
    if (await empty.count()) await empty.first().click()
    else await page.getByRole('button', { name: 'Neue Liste' }).first().click()
    const sheet = page.getByRole('dialog')
    const title = sheet.getByLabel('Titel')
    if ((await title.inputValue()) === '') await title.fill(name)
    await sheet.getByRole('button', { name: 'Anlegen', exact: true }).click()
    await expect(sheet).toBeHidden({ timeout: 10_000 })
    // the app opens the new list (after its carry moment): wait for that, then back to the tab ("Zurück", never a
    // reload — the demo resets on reload)
    await page.waitForURL((url) => /\/lists\/[^/]+$/.test(url.pathname), { timeout: 8000 }).catch(() => undefined)
    if (/\/lists\/[^/]+$/.test(new URL(page.url()).pathname)) {
      await page.waitForTimeout(500)
      await page.getByRole('button', { name: 'Zurück' }).first().click()
      await page.waitForURL((url) => url.pathname.replace(/\/$/, '').endsWith('/lists'), { timeout: 5000 })
    }
    await page.waitForTimeout(1500)
  }
}

interface Target { cardTop: number; cardRight: number; feetX: number; radius: number; id: string }

function pickCard(): HTMLElement {
  const floors = [...document.querySelectorAll<HTMLElement>('[data-buddy-floor]')]
  const pick = floors.filter((f) => f.dataset.buddyCard !== undefined).sort((x, y) => y.getBoundingClientRect().right - x.getBoundingClientRect().right)[0] ?? floors.find((f) => f.dataset.buddyFloor === 'new') ?? floors[0]
  if (!pick) throw new Error('no floor')
  return pick
}

/** Scroll (instantly) so Pompon is clear of the top bar and the card is on screen. */
async function frame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hit = document.querySelector('.bd-hit')
    if (hit) window.scrollTo({ top: window.scrollY + hit.getBoundingClientRect().top - 110, behavior: 'instant' })
  })
  await page.waitForTimeout(500)
}

/** The card to drop on (a right-column list card, else "Neue Liste", else the stats row) and where to let go. */
async function target(page: Page): Promise<Target> {
  return page.evaluate((src) => {
    const pick = (new Function(`return (` + src + `)`)() as () => HTMLElement)()
    const r = pick.getBoundingClientRect()
    const read = (e: Element | null) => (e ? parseFloat(getComputedStyle(e).borderTopRightRadius) || 0 : 0)
    const card = [pick, ...pick.querySelectorAll('*')].find((e) => read(e) > 0 && e.getBoundingClientRect().width >= 0.8 * r.width) ?? null
    const radius = Math.min(r.width / 2, read(card))
    // src/buddy/footing.ts feetForTouch(side 1, φ 8°, width 96): the touch lands a little round the corner
    const u = (1.2 * 96) / 400
    const start = r.right - radius
    const cx = start + (Math.max(0, radius - 2.8 * u) + 6.8 * u) * Math.sin((8 * Math.PI) / 180)
    return { cardTop: r.top, cardRight: r.right, feetX: cx - (38 + 12) * u, radius, id: pick.dataset.buddyFloor ?? '' }
  }, pickCard.toString())
}

/** Press on Pompon, carry him slowly to above the card's end, hold still, let go. */
async function setDown(page: Page, t: Target) {
  const hit = page.locator('.bd-hit').first()
  await expect(hit).toBeAttached({ timeout: 15_000 })
  // wait until he stands (his life may be mid-hop)
  // a point on his body that really is his hit box right now (he may be walking): measured and pressed at once
  let from: { x: number; y: number } | null = null
  for (let i = 0; i < 40 && !from; i++) {
    await page.waitForTimeout(150)
    from = await page.evaluate(() => {
      const h = document.querySelector('.bd-hit')
      if (!h) return null
      const r = h.getBoundingClientRect()
      const p = { x: r.left + r.width / 2, y: r.top + r.height * 0.4 }
      return document.elementFromPoint(p.x, p.y) === h && r.top > 70 ? p : null
    })
  }
  if (!from) throw new Error(`Pompon could not be reached: ` + await page.evaluate(() => {
    const h = document.querySelector('.bd-hit')
    if (!h) return 'no hit'
    const r = h.getBoundingClientRect()
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.4)
    return JSON.stringify({ r, vis: getComputedStyle(h).visibility, at: e ? e.tagName + '.' + e.className : null, n: document.querySelectorAll('.bd-hit').length })
  }))
  // the finger holds his scruff; his body hangs ≈ 75 px above the card's top when let go (demo/firmground dropAt)
  const to = { x: t.feetX, y: t.cardTop - 75 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const steps = 40
  for (let i = 1; i <= steps; i++) {
    const k = i / steps
    const e = k * k * k * (k * (6 * k - 15) + 10)
    await page.mouse.move(from.x + (to.x - from.x) * e, Math.min(from.y, to.y) - 24 * Math.sin(Math.PI * k) + (to.y - Math.min(from.y, to.y)) * e)
    await page.waitForTimeout(30)
  }
  // he hangs still under the finger (the pendulum calms down)
  await page.waitForTimeout(2200)
  await page.mouse.move(to.x, to.y)
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForTimeout(100)
}

function sheet(frames: { file: string; t: number }[], title: string, cols = 6): string {
  const cells = frames.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f.file).toString('base64')}"><figcaption>${f.t.toFixed(2)} s</figcaption></figure>`).join('')
  return `<!doctype html><meta charset="utf-8"><style>body{margin:16px;font:13px system-ui;background:#F2EBDD;color:#2A231C}h1{font-size:16px;margin:0 0 10px}
  .g{display:grid;grid-template-columns:repeat(${cols},auto);gap:8px;justify-content:start}figure{margin:0}img{width:180px;display:block;border-radius:10px;box-shadow:0 0 0 1px rgba(60,40,20,.15)}
  figcaption{text-align:center;font-variant-numeric:tabular-nums;color:#62554A}</style><h1>${title}</h1><div class="g">${cells}</div>`
}

test('footing: Pompon tests the card edge (full motion) — frames + contact sheet', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await open(browser, false)
  await signUp(page)
  await page.getByRole('link', { name: /Listen/ }).first().click()
  await makeLists(page)
  await expect(page.locator('.bd-hit').first()).toBeAttached({ timeout: 15_000 })
  await page.waitForTimeout(1200)
  await frame(page)
  const t2 = await target(page)
  const t = t2
  await page.screenshot({ path: `${OUT}/a-listen-before.png` })
  await setDown(page, t2)
  const now = await target(page)
  const clip = { x: now.cardRight - 150, y: now.cardTop - 92, width: 168, height: 118 }
  const frames: { file: string; t: number }[] = []
  const t0 = Date.now()
  for (let i = 0; Date.now() - t0 < 2300 && i < 40; i++) {
    const file = `${OUT}/frame-${String(i).padStart(2, '0')}.png`
    await page.screenshot({ path: file, clip })
    frames.push({ file, t: (Date.now() - t0) / 1000 })
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/b-listen-after.png` })
  const html = `${OUT}/sheet.html`
  writeFileSync(html, sheet(frames, `«Твёрдая почва» — Firefox, 390 px, card «${t.id}» right end (frames after letting go; times are capture times)`))
  const s = await context.newPage()
  await s.setViewportSize({ width: 1180, height: 900 })
  await s.goto(`file:///${html.replace(/\\/g, '/')}`)
  await s.screenshot({ path: `${OUT}/contact-sheet.png`, fullPage: true })
  await context.close()
})

test('footing: "Weniger" — set down straight on the safe spot, eyes ^ ^', async ({ browser }) => {
  test.setTimeout(90_000)
  const { context, page } = await open(browser, true)
  await signUp(page)
  await page.getByRole('link', { name: /Listen/ }).first().click()
  await makeLists(page)
  await expect(page.locator('.bd-hit').first()).toBeAttached({ timeout: 15_000 })
  await page.waitForTimeout(800)
  await frame(page)
  const t = await target(page)
  await setDown(page, t)
  await page.waitForTimeout(120)
  const now = await target(page)
  const clip = { x: now.cardRight - 150, y: now.cardTop - 92, width: 168, height: 118 }
  await page.screenshot({ path: `${OUT}/reduced-set-down.png`, clip })
  await page.screenshot({ path: `${OUT}/reduced-listen.png` })
  await context.close()
})
