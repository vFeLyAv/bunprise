import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// The "+" menu's bunny (restored 2026-10-22; Felix: "remove only the ears animation, the bunny climbing out was
// pretty", then on the restored version: no hamster, no ears shooting up, nothing peeking in "out of nothing" from
// the empty screen edge, no bunny that "teleports" onto the edge). A real-time frame sequence of the menu opening
// for every moment of the director's 'create-menu' pool (forced through the dev-only window.__bunpriseMenuMoment
// of CreateMenu.tsx), six openings in a row without forcing (no downgrade after the 4th: no "ears only", no bunny
// that just sits there), and quick re-openings of the jump out of the "+" (closed after 0.7 s, opened again at
// once). Firefox at phone size (390 × 844), 2× pixels. One contact sheet per sequence (every frame, with its time
// and what the menu showed) + frames.json: docs/screens/2026-10-22-plus-menu/; the full-size frames (≈ 270 MB)
// stay in apps/web/test-results/plus-menu-frames/ (git-ignored).

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-22-plus-menu')
const FRAMES = resolve(process.cwd(), 'test-results/plus-menu-frames')
mkdirSync(OUT, { recursive: true })
mkdirSync(FRAMES, { recursive: true })

// SHOTS_BASE_URL: a demo server without hot reload (another edit must not reload — and so sign out — the demo
// in the middle of a sequence), e.g. `vite --mode demo` with `server.hmr: false` on another port
test.use({ deviceScaleFactor: 2, ...(process.env['SHOTS_BASE_URL'] ? { baseURL: process.env['SHOTS_BASE_URL'] } : {}) })

/** Frames every STEP ms for DURATION ms after the tap on "+" (the moment starts ≈ 0.35 s after the panel). */
const STEP = 150
const DURATION = 4500
/** The lower part of the screen: the panel, the room above it and the "+" the jump starts from. */
const CLIP = { x: 0, y: 150, width: 390, height: 694 }

type Force = { preset: string; special?: string } | null

// Headless Firefox does not paint backdrop-filter: the app's own solid material (<html data-transparency="reduce">).
async function solidMaterials(page: Page) {
  await page.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
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

interface Frame { file: string; ms: number; state: string }

/** What the menu shows right now: the welcome stage's preset, a hamster, the jump. */
async function menuState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = []
    const welcome = document.querySelector('.cm-bunny [data-welcome]')
    if (welcome) parts.push(`stage:${welcome.getAttribute('data-welcome')}`)
    if (document.querySelector('.cm-bunny [data-move]')) parts.push('HAMSTER')
    if (document.querySelector('[data-carry]')) parts.push('jump')
    return parts.join(' ') || '—'
  })
}

async function force(page: Page, value: Force) {
  await page.evaluate((f) => {
    const w = window as Window & { __bunpriseMenuMoment?: unknown }
    if (f) w.__bunpriseMenuMoment = f
    else delete w.__bunpriseMenuMoment
  }, value)
}

function plusButton(page: Page) {
  return page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Neu erstellen' })
}

/** Records the frames of the opening that was just tapped, then closes the menu. */
async function record(page: Page, name: string): Promise<Frame[]> {
  const t0 = Date.now()
  const frames: Frame[] = []
  for (let i = 0; i * STEP <= DURATION; i++) {
    const wait = t0 + i * STEP - Date.now()
    if (wait > 0) await page.waitForTimeout(wait)
    const ms = Date.now() - t0
    const file = `${name}-${String(i).padStart(2, '0')}.png`
    await page.screenshot({ path: `${FRAMES}/${file}`, clip: CLIP })
    frames.push({ file, ms, state: await menuState(page) })
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.waitForTimeout(700)
  return frames
}

/** Opens the menu with `value` forced (null = the director decides) and records it. */
async function sequence(page: Page, name: string, value: Force): Promise<Frame[]> {
  await force(page, value)
  await plusButton(page).click()
  return record(page, name)
}

/** One contact sheet per sequence (rendered by the browser itself: no image tools needed). */
async function contactSheet(page: Page, name: string, title: string, frames: Frame[]) {
  const cells = frames
    .map((f) => `<figure><img src="data:image/png;base64,${readFileSync(`${FRAMES}/${f.file}`).toString('base64')}"><figcaption>${f.ms} ms · ${f.state}</figcaption></figure>`)
    .join('')
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:12px;background:#222;color:#eee;font:13px system-ui}
    h1{font-size:16px;margin:0 0 10px}
    .grid{display:grid;grid-template-columns:repeat(8,195px);gap:8px}
    figure{margin:0}img{width:195px;display:block;border-radius:4px}figcaption{padding:2px 0 0}
  </style><h1>${title}</h1><div class="grid">${cells}</div>`)
  await page.screenshot({ path: `${OUT}/${name}.jpg`, fullPage: true, type: 'jpeg', quality: 82 })
}

test('the "+" menu bunny: every moment of the pool, six openings in a row, quick re-openings', async ({ page, context }) => {
  test.setTimeout(420_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await solidMaterials(page)
  await signUp(page)
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await expect(nav).toBeVisible()
  await page.waitForTimeout(1500)

  const runs: Array<{ name: string; title: string; frames: Frame[] }> = []
  const forced: Array<[string, NonNullable<Force>]> = [
    ['a-climb-left', { preset: 'climb-left' }],
    ['b-climb-right', { preset: 'climb-right' }],
    ['c-hop-across', { preset: 'hop-across' }],
    ['d-wave', { preset: 'wave' }],
    ['e-jump-out', { preset: 'peek-once', special: 'jump-out' }],
    ['f-peek-sniff-calendar', { preset: 'peek-sniff', special: 'calendar' }],
  ]
  for (const [name, value] of forced) {
    runs.push({ name, title: `${name} (forced: ${JSON.stringify(value)}) — Start`, frames: await sequence(page, name, value) })
  }

  // Openings in a row, the director decides (openings 7–12 of this tab; the old pool fell back to "ears only" /
  // "lift" from the 4th on): every one must be a lively moment of the pool
  for (let i = 1; i <= 6; i++) {
    const name = `g-unforced-${i}`
    runs.push({ name, title: `${name}: opening ${forced.length + i} in a row, the director's own pick — Start`, frames: await sequence(page, name, null) })
  }

  // The jump itself in slow motion (its own Web Animations at 1/5 speed from its first frame): it pops out of
  // the "+" over the tab bar, vanishes behind the panel (cut out there), then the bunny climbs out over the top
  await page.evaluate(() => {
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.dataset['carry'] !== undefined) {
          // per element (Firefox has no ShadowRoot.getAnimations): the stage's clocks (on the host) and the bunny's parts
          for (const el of [node, ...(node.shadowRoot?.querySelectorAll('*') ?? [])]) for (const animation of el.getAnimations()) animation.playbackRate = 0.2
          observer.disconnect()
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  runs.push({ name: 'e2-jump-out-slow', title: 'e2-jump-out-slow: the jump at 1/5 speed (frame times are real time: 150 ms = 30 ms of the jump)', frames: await sequence(page, 'e2-jump-out-slow', { preset: 'peek-once', special: 'jump-out' }) })

  // Quick re-openings of the jump: open, close after 0.7 s (mid-jump), open again at once — twice
  await force(page, { preset: 'peek-once', special: 'jump-out' })
  for (let i = 1; i <= 2; i++) {
    await plusButton(page).click()
    await page.waitForTimeout(700)
    await page.keyboard.press('Escape')
    await plusButton(page).click()
    const name = `h-jump-reopened-${i}`
    runs.push({ name, title: `${name}: the jump-out opened, closed after 0.7 s, opened again at once — this is the second opening`, frames: await record(page, name) })
  }

  // Listen: the menu's sniffing bunny there has no calendar — and there is no hamster in the menu any more
  await nav.getByRole('link', { name: /^Listen/ }).click()
  await expect(page).toHaveURL(/\/lists/)
  await page.waitForTimeout(2500)
  runs.push({ name: 'i-peek-sniff-lists', title: 'i-peek-sniff-lists (forced: peek-sniff, as the director picks it on Listen) — Listen', frames: await sequence(page, 'i-peek-sniff-lists', { preset: 'peek-sniff' }) })
  runs.push({ name: 'j-unforced-lists', title: 'j-unforced-lists: the director’s own pick on Listen', frames: await sequence(page, 'j-unforced-lists', null) })

  writeFileSync(`${OUT}/frames.json`, JSON.stringify(runs.map(({ name, frames }) => ({ name, frames })), null, 2))
  const sheet = await context.newPage()
  for (const run of runs) await contactSheet(sheet, run.name, run.title, run.frames)
  await sheet.close()
  expect(errors).toEqual([])
  for (const run of runs) for (const frame of run.frames) expect(frame.state).not.toContain('HAMSTER')
})
