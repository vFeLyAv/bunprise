import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

// Felix's feedback 2 (2026-10-22) in the demo, Firefox at phone size (390 × 844, playwright config; 2× pixels so
// the paws can be judged): (a) the empty "Freunde" card — Tapsi holds the binoculars in his own paws and looks
// around (frames in real time, plus the key poses of the 16 s loop, plus the still pose under reduced motion);
// (b) the "+" menu without any bunny; (c) the owner's wish sheet and (d) a friend's wish sheet with the brand
// stamp at the very bottom. Screens go to docs/screens/2026-10-22-feedback-2/.

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-22-feedback-2')
mkdirSync(OUT, { recursive: true })

test.use({ deviceScaleFactor: 2 })

// Headless Firefox does not paint backdrop-filter: the screens use the app's own solid material
// (<html data-transparency="reduce">), as in wish-details-screens.spec.ts.
async function solidMaterials(page: Page) {
  await page.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
}

/** Waits for the finite animations of the page (a looping mascot never finishes: only finite ones count). */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
  })
  await page.waitForTimeout(600)
}

async function shot(page: Page, name: string) {
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

/** A screenshot of `box` with `margin` px around it (page coordinates of the viewport). */
async function crop(page: Page, target: Locator, name: string, margin = 16) {
  const box = await target.boundingBox()
  if (!box) throw new Error(`no box for ${name}`)
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin), width: box.width + 2 * margin, height: box.height + 2 * margin },
  })
}

/** The binoculars loop of the hamster in `host`: pause every animation of the puppet and show loop time `ms`. */
async function seekLoop(host: Locator, ms: number) {
  await host.evaluate((el, t) => {
    const svg = el.shadowRoot?.querySelector('svg')
    for (const animation of svg?.getAnimations({ subtree: true }) ?? []) {
      animation.pause()
      animation.currentTime = t
    }
  }, ms)
}

/** Loop time (ms) of the binoculars group right now, and whether the stage paused his idle loop. */
async function loopState(host: Locator): Promise<{ t: number | null; paused: boolean; holding: boolean }> {
  return host.evaluate((el) => {
    const svg = el.shadowRoot?.querySelector('svg')
    const bino = el.shadowRoot?.querySelector('.bino')
    const look = bino?.getAnimations().find((animation) => (animation as CSSAnimation).animationName === 'bino-look')
    return {
      t: look ? Math.round(Number(look.currentTime) % 16000) : null,
      paused: svg?.classList.contains('idle-paused') === true || svg?.classList.contains('visibility-paused') === true,
      holding: el.shadowRoot?.querySelector('.hm')?.classList.contains('hold-binoculars') === true,
    }
  })
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

test('feedback 2: Tapsi with binoculars, the "+" menu without a bunny, the brand stamp in both wish sheets', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await solidMaterials(page)
  await signUp(page)

  // The demo's first account follows Anna, Ben and Paula; a newcomer follows nobody. Unfollow them through the
  // app's own API module (the same module instance the app uses, served by Vite) before "Listen" ever loads.
  await page.evaluate(async (path) => {
    const api = (await import(/* @vite-ignore */ path)) as { unfollow: (id: string) => Promise<void> }
    for (const id of ['d1e0a000-0000-4000-8000-000000000001', 'd1e0a000-0000-4000-8000-000000000002', 'd1e0a000-0000-4000-8000-000000000004']) {
      await api.unfollow(id)
    }
  }, '/src/lib/api/lists.ts')

  // (a) Listen → Freunde: the empty card with Tapsi
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await nav.getByRole('link', { name: /^Listen/ }).click()
  await page.getByRole('radio', { name: 'Freunde', exact: true }).click()
  const card = page.locator('.lf-empty')
  await expect(card).toBeVisible()
  const tapsi = card.locator('[data-mascot="hamster"]')
  // the card sits under "Bald": bring Tapsi and the card's title to the middle, clear of the floating tab bar
  await tapsi.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(400)
  await expect.poll(async () => (await loopState(tapsi)).holding).toBe(true)
  await page.waitForTimeout(800) // the puppet fades in
  // the whole screen and the card, at the start of the loop
  const first = await loopState(tapsi)
  console.log('loop state at first screen', first)
  expect(first.paused).toBe(false)
  await page.screenshot({ path: `${OUT}/a-freunde-empty-390.png` })

  // real time: 9 frames over 4 s (the loop is running in the browser, not seeked)
  const times: string[] = []
  for (let i = 0; i < 9; i++) {
    const state = await loopState(tapsi)
    times.push(`${i}: t=${state.t} ms`)
    await crop(page, tapsi, `a-realtime-${i}`, 12)
    await page.waitForTimeout(500)
  }
  console.log('real-time frames (loop time of each):', times.join(' · '))

  // the key poses of the 16 s loop (paused + seeked): straight · left · scanning left · right + glint · back ·
  // lowered · blink · raised (spring overshoot) · settled
  const poses: Array<[string, number]> = [
    ['00-straight', 600], ['01-turning-left', 2000], ['02-left', 4000], ['03-sweeping', 6300], ['04-right-glint', 8000],
    ['05-right', 9400], ['06-lowering', 12000], ['07-lowered', 12500], ['08-blink', 12740], ['09-raising', 14000], ['10-up-again', 15400],
  ]
  for (const [name, ms] of poses) {
    await seekLoop(tapsi, ms)
    await page.waitForTimeout(80)
    await crop(page, tapsi, `a-pose-${name}`, 12)
  }
  await seekLoop(tapsi, 4000)
  await page.waitForTimeout(80)
  await page.screenshot({ path: `${OUT}/a-freunde-empty-left-390.png` })

  // reduced motion: the same pose, still (the package's .rm)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(400)
  await crop(page, tapsi, 'a-reduced-motion-still', 12)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // (b) the "+" menu: the panel only, no bunny peeking over it, none jumping out of the "+". Opened on Start:
  // over the Freunde card the page's own Tapsi would show through the (unblurred, headless) scrim right above
  // the panel and look like a menu mascot. Start's own short peek over its card is let finish first, for the
  // same reason (it is the page's moment, not the menu's).
  await nav.getByRole('link', { name: /^Start/ }).click()
  await page.waitForTimeout(7000)
  // what lies behind the scrim (the page's own bunny stays under its card): for comparison with the menu shot
  await page.screenshot({ path: `${OUT}/b-start-before-menu-390.png` })
  await page.getByRole('button', { name: 'Neu erstellen', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Was möchtest du erstellen?' })).toBeVisible()
  await page.waitForTimeout(900) // the bunny used to start 350 ms after the panel rose
  await expect(page.locator('.cm-bunny')).toHaveCount(0)
  await expect(page.locator('[data-carry]')).toHaveCount(0)
  await shot(page, 'b-plus-menu-390')

  // (c) the owner's wish sheet: a first list and a wish with a photo, then tap it
  await page.getByRole('button', { name: /Wunsch hinzufügen/ }).click()
  await page.getByRole('button', { name: '„Meine Wünsche“ anlegen' }).click()
  const field = page.getByLabel('Link zu deinem Wunsch', { exact: true })
  await field.fill('https://www.kuechenkontor.example/kaffeemuehle-kegel')
  await field.press('Enter')
  await expect(page.getByText('Aus dem Link gelesen')).toBeVisible()
  await expect(page.locator('[data-card-photo="shown"] img[data-loaded]')).toBeVisible()
  await page.getByRole('button', { name: 'Wunsch hinzufügen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Meine Wünsche', exact: true })).toBeVisible()
  await page.waitForTimeout(2500) // Pompon carries the new wish in
  const grinderRow = page.locator('[data-wish-id]', { hasText: 'Handkaffeemühle' })
  await grinderRow.locator('button').first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.locator('[data-wish-photo] img[data-loaded]')).toBeVisible()
  const ownerStamp = sheet.locator('[data-brand-stamp]')
  await expect(ownerStamp).toBeVisible()
  await expect(ownerStamp).toHaveAttribute('aria-hidden', 'true')
  await shot(page, 'c-owner-sheet-390')
  await sheet.locator('[data-wish-compare]').scrollIntoViewIfNeeded()
  await shot(page, 'c-owner-sheet-scrolled-390')
  await expect(ownerStamp).toBeInViewport()
  await crop(page, ownerStamp, 'c-owner-sheet-stamp-zoom', 40)
  await page.keyboard.press('Escape')

  // (d) a friend's wish sheet: Anna's housewarming (Mila is her guest in the demo world), a free wish
  await page.getByRole('button', { name: 'Zurück', exact: true }).click()
  await nav.getByRole('link', { name: /^Start/ }).click()
  await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
  const annaGrinder = page.locator('[data-wish-id]', { hasText: 'Kaffeemühle mit Handkurbel' })
  await annaGrinder.scrollIntoViewIfNeeded()
  await annaGrinder.locator('button').first().click()
  const guestSheet = page.getByRole('dialog')
  await expect(guestSheet.locator('[data-wish-photo] img[data-loaded]')).toBeVisible()
  const guestStamp = guestSheet.locator('[data-brand-stamp]')
  await expect(guestStamp).toBeVisible()
  await shot(page, 'd-guest-sheet-390')
  await crop(page, guestStamp, 'd-guest-sheet-stamp-zoom', 40)
  await page.keyboard.press('Escape')
  const free = page.locator('[data-wish-id]', { hasText: 'Kinogutschein' })
  await free.scrollIntoViewIfNeeded()
  await free.locator('button').first().click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Ich schenke das', exact: true })).toBeVisible()
  await shot(page, 'd-guest-sheet-free-390')

  expect(errors).toEqual([])
})
