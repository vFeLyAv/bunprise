import { expect, test, type CDPSession, type Page } from '@playwright/test'

// Pompon (the Lists buddy) against the swipe between the tabs (Felix 27.10 «когда я держу зайца, свайп вкладки не
// должен работать», docs/handoffs/2026-10-27-buddy-vs-swipe.md). In the demo at phone size with touch: a long press
// picks him up, he is carried far to the left (past the left edge's system strip) and let go — the tab stays "Listen",
// the page never moves, history is untouched. The very same swipe started on the page still turns the tab to "Ideen".
// Chromium (Edge, real touches through CDP: touch-action and pointer capture as on a phone) and Firefox (synthetic
// touch pointer events — Playwright has no touch drag for Firefox).

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
  await page.waitForURL('**/soon')
}

/** A new account has no lists (the empty card's own Pompon shows and the buddy steps aside): make one. */
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
  await page.waitForURL((url) => /\/lists\/[^/]+$/.test(url.pathname), { timeout: 8000 }).catch(() => undefined)
  if (/\/lists\/[^/]+$/.test(new URL(page.url()).pathname)) {
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Zurück' }).first().click()
    await page.waitForURL((url) => url.pathname.replace(/\/$/, '').endsWith('/lists'), { timeout: 5000 })
  }
  // the swipe is a lazy chunk loaded once the tab is idle
  await expect(page.locator('html')).toHaveAttribute('data-tab-swipe', '', { timeout: 10_000 })
}

/** A point on Pompon's body that really is his hit box right now (he may be walking), clear of the top bar. */
async function onBunny(page: Page): Promise<{ x: number; y: number }> {
  await expect(page.locator('.bd-hit').first()).toBeAttached({ timeout: 15_000 })
  await page.evaluate(() => {
    const hit = document.querySelector('.bd-hit')
    if (hit) window.scrollTo({ top: window.scrollY + hit.getBoundingClientRect().top - 160, behavior: 'instant' })
  })
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(150)
    const p = await page.evaluate(() => {
      const h = document.querySelector('.bd-hit')
      if (!h) return null
      const r = h.getBoundingClientRect()
      const p = { x: r.left + r.width / 2, y: r.top + r.height * 0.45 }
      return document.elementFromPoint(p.x, p.y) === h && r.top > 90 && p.x > 60 ? p : null
    })
    if (p) return p
  }
  throw new Error('Pompon could not be reached')
}

/** A point of the page itself: no buddy near, no deck, field or sideways rail under it. */
async function onPage(page: Page): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(() => {
    const actor = document.querySelector('.bd-actor')?.getBoundingClientRect()
    for (let y = 140; y < window.innerHeight - 120; y += 16) {
      const x = window.innerWidth / 2
      if (actor && x > actor.left - 40 && x < actor.right + 40 && y > actor.top - 40 && y < actor.bottom + 40) continue
      const el = document.elementFromPoint(x, y)
      if (!el || !el.closest('main') || el.closest('[data-swipe-own], [data-drag-own], input, textarea, [role="slider"]')) continue
      let rail = false
      for (let e: Element | null = el; e; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX
        if (e.scrollWidth > e.clientWidth + 1 && (o === 'auto' || o === 'scroll')) rail = true
      }
      if (!rail) return { x, y }
    }
    return null
  })
  if (!p) throw new Error('no free point on the page')
  return p
}

/** The finger: down, (held), moved to the left in small steps, up — through `touch`. */
type Touch = (type: 'down' | 'move' | 'up', x: number, y: number) => Promise<void>

async function carry(page: Page, touch: Touch, from: { x: number; y: number }, toX: number, hold: number, check?: () => Promise<void>) {
  await touch('down', from.x, from.y)
  await page.waitForTimeout(hold)
  const steps = 16
  for (let i = 1; i <= steps; i++) {
    await touch('move', from.x + ((toX - from.x) * i) / steps, from.y + 4 * Math.sin((Math.PI * i) / steps))
    await page.waitForTimeout(16)
  }
  await check?.()
  await touch('up', toX, from.y)
}

const pageStill = (page: Page) =>
  page.evaluate(() => ({
    swiping: document.documentElement.hasAttribute('data-tab-swiping'),
    moved: Array.from(document.querySelectorAll<HTMLElement>('#root > header, #root > main')).some((el) => el.style.transform !== ''),
    neighbour: document.querySelectorAll('.tab-swipe-layer').length,
  }))

async function scenario(page: Page, touch: Touch) {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signUp(page)
  await toListsWithAList(page)
  const history = await page.evaluate(() => history.length)

  // 1. Pompon picked up (long press) and carried far to the left, across the left edge's strip, and let go
  const bunny = await onBunny(page)
  await carry(page, touch, bunny, 2, 450, async () => {
    // he is really held (the package's class while he dangles) — and the page did not move at all
    await expect(page.locator('.bd-layer.bd-held-cursor')).toHaveCount(1)
    expect(await pageStill(page)).toEqual({ swiping: false, moved: false, neighbour: 0 })
  })
  await page.waitForTimeout(800)
  expect(new URL(page.url()).pathname).toMatch(/\/lists\/?$/)
  expect(await page.evaluate(() => history.length)).toBe(history)
  expect(await pageStill(page)).toEqual({ swiping: false, moved: false, neighbour: 0 })

  // 2. a quick sideways flick that starts on him (no long press) is no tab swipe either
  await page.waitForTimeout(2500) // he lands, huffs and stands again
  const again = await onBunny(page)
  await carry(page, touch, again, Math.max(30, again.x - 200), 0)
  await page.waitForTimeout(800)
  expect(new URL(page.url()).pathname).toMatch(/\/lists\/?$/)

  // 3. the same swipe started on the page turns the tab, as before
  const free = await onPage(page)
  await carry(page, touch, free, 40, 0)
  await page.waitForURL('**/gifts', { timeout: 5000 })
  expect(errors).toEqual([])
}

test.use({ hasTouch: true })

test('Chromium (Edge), real touches: carrying Pompon sideways never turns the tab; a page swipe still does', async ({ playwright, baseURL }) => {
  const browser = await playwright.chromium.launch({ channel: 'msedge' })
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'de-DE' })
    const page = await context.newPage()
    const cdp: CDPSession = await context.newCDPSession(page)
    const touch: Touch = async (type, x, y) => {
      const kind = type === 'down' ? 'touchStart' : type === 'move' ? 'touchMove' : 'touchEnd'
      await cdp.send('Input.dispatchTouchEvent', { type: kind, touchPoints: type === 'up' ? [] : [{ x, y, id: 1 }] })
    }
    await scenario(page, touch)
  } finally {
    await browser.close()
  }
})

test('Firefox, synthetic touch pointers: carrying Pompon sideways never turns the tab; a page swipe still does', async ({ page, browserName }) => {
  test.skip(browserName !== 'firefox', 'the Firefox half')
  const touch: Touch = (type, x, y) =>
    page.evaluate(
      ({ type, x, y }) => {
        const w = window as Window & { __touchTarget?: Element | null }
        if (type === 'down') w.__touchTarget = document.elementFromPoint(x, y)
        const target = w.__touchTarget ?? document.body
        const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: type === 'move' ? -1 : 0, buttons: type === 'up' ? 0 : 1, clientX: x, clientY: y, bubbles: true, composed: true, cancelable: true }
        target.dispatchEvent(new PointerEvent(type === 'down' ? 'pointerdown' : type === 'move' ? 'pointermove' : 'pointerup', init))
      },
      { type, x, y },
    )
  await scenario(page, touch)
})
