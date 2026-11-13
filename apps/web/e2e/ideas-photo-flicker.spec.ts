import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect, firefox, test, type Browser, type CDPSession, type Page } from '@playwright/test'

// Felix 28.10 «фотки дёргаются, когда я перехожу с Ideen на Profil и обратно»: records every frame of
// Ideen → Profil → Ideen (a tap on the tab bar, and the swipe) and counts the frames in which the top card of the
// deck shows its plate WITHOUT the photo, its „Bild: <Shop>“ line is missing, or its picture box changes size/place.
// - The demo's deck has drawn pictures only; to get real catalogue PHOTOS on the deck, the page's own answer of
//   POST /api/gift-ideas is rewritten in the page (the image paths of real catalogue items with a photo; the demo's
//   MSW serves its local placeholder „Demo-Foto“ for exactly those). Nothing leaves the browser.
// - Two measures: (1) a per-frame DOM sampler (requestAnimationFrame: is the <img> there, complete, its box, the
//   credit line, and — for the swipe — the same box in the copy that slid in vs the real screen that replaces it),
//   both browsers; (2) Edge only: the compositor's own frames (CDP screencast) — the photo's pixels in the picture
//   box per painted frame (the placeholder's brown parcel vs the white plate).
// - PHOTO_MODE=jpeg (Edge only): big noisy JPEGs answered by Playwright with the Worker's Cache-Control instead of the
//   demo's small SVG — slow to decode like a real shop photo; it also counts the photo requests on the way back.
// - Ideen is left 1.2 s after its deck arrived: the first-visit swipe hint is nudging the card, Pompon cheers.
// Before the fix (28.10): „Bild: <Shop>“ missing for 2 frames on every return; with the swipe the copy showed the card
// 8–25 px off (mid-nudge) with Pompon's bubble, and the real screen jumped. After: 0 / 0 / 0 px.
// Run: npx playwright test e2e/ideas-photo-flicker.spec.ts (demo on :5173; Edge + Firefox installed).
// Results go to $FLICKER_OUT (default: test-results/ideas-photo-flicker) as JSON + the frames of Edge.

const OUT = process.env.FLICKER_OUT ?? resolve(process.cwd(), 'test-results/ideas-photo-flicker')
mkdirSync(OUT, { recursive: true })

const CATALOG = JSON.parse(readFileSync(resolve(process.cwd(), '../../workers/edge/src/giftIdeas/catalog.de.json'), 'utf8')) as { items: Array<{ id: string; art: string; image_source?: string }> }
const ITEMS = CATALOG.items
// PHOTO_MODE=jpeg: big real JPEGs (≈ 1200 px, noisy — slow to decode, like a shop's photo) answered by Playwright with
// the Worker's own Cache-Control, instead of the demo's small SVG placeholder (both under /api/gift-ideas/)
const JPEG = process.env.PHOTO_MODE === 'jpeg'
const PHOTOS = JPEG
  ? Array.from({ length: 40 }, (_, i) => `/api/gift-ideas/probe/${i}.jpg`)
  : ITEMS.filter((item) => item.image_source).slice(0, 40).map((item) => `/api/gift-ideas/img/${item.art}/${encodeURIComponent(item.id)}`)
/** A noisy brown 1200 px JPEG, made by the browser itself (a blank page with a canvas). */
async function probeJpeg(lab: Page): Promise<Buffer> {
  const base64 = await lab.evaluate(async () => {
    const size = 1200
    const canvas = new OffscreenCanvas(size, size)
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(size, size)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const n = Math.floor(Math.random() * 40)
      pixels.data[i] = 190 + n; pixels.data[i + 1] = 160 + n; pixels.data[i + 2] = 120 + Math.floor(n / 2); pixels.data[i + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer())
    let text = ''
    for (const byte of bytes) text += String.fromCharCode(byte)
    return btoa(text)
  })
  return Buffer.from(base64, 'base64')
}

interface Sample { t: number; img: boolean; complete: boolean; nw: number; credit: boolean; x: number; y: number; w: number; h: number; copy: boolean; src: string; copyBox: { x: number; y: number; w: number; h: number } | null }

async function prepare(page: Page) {
  await page.addInitScript((photos: string[]) => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
    // the deck's ideas wear real catalogue photo paths (the demo serves its placeholder for them)
    const original = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.endsWith('/api/gift-ideas') || init?.method !== 'POST') return response
      if (typeof init.body === 'string' && /"topic":"/.test(init.body)) return response
      const body = (await response.clone().json()) as { items?: Array<{ id: string; image_url: string | null }> }
      if (!Array.isArray(body.items)) return response
      for (const item of body.items) {
        let hash = 0
        for (const char of item.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
        item.image_url = photos[hash % photos.length] ?? item.image_url
      }
      return new Response(JSON.stringify(body), { status: response.status, headers: response.headers })
    }
    // the sampler: one record per frame while on
    const w = window as unknown as { __flick: { on: boolean; samples: Sample[]; start: () => void; stop: () => Sample[] } }
    const samples: Sample[] = []
    const tick = () => {
      if (!w.__flick.on) return
      const picture = Array.from(document.querySelectorAll<HTMLElement>('.gift-card[data-depth="0"] .gift-picture')).find((el) => !el.closest('.tab-swipe-layer'))
      const img = picture?.querySelector('img') ?? null
      const box = picture?.getBoundingClientRect()
      // the same picture in the copy that slides in (features/nav/tabCopies.ts)
      const copied = document.querySelector<HTMLElement>('.tab-swipe-layer .gift-card[data-depth="0"] .gift-picture')?.getBoundingClientRect()
      samples.push({
        t: performance.now(),
        img: Boolean(img),
        complete: Boolean(img?.complete),
        nw: img?.naturalWidth ?? 0,
        credit: Boolean(picture?.querySelector('.gift-picture-credit')),
        x: Math.round(box?.x ?? -1), y: Math.round(box?.y ?? -1), w: Math.round(box?.width ?? 0), h: Math.round(box?.height ?? 0),
        copy: Boolean(document.querySelector('.tab-swipe-layer')),
        src: img?.getAttribute('src') ?? '',
        copyBox: copied ? { x: Math.round(copied.x), y: Math.round(copied.y), w: Math.round(copied.width), h: Math.round(copied.height) } : null,
      })
      requestAnimationFrame(tick)
    }
    w.__flick = {
      on: false,
      samples,
      start: () => { samples.length = 0; w.__flick.on = true; requestAnimationFrame(tick) },
      stop: () => { w.__flick.on = false; return samples.slice() },
    }
  }, PHOTOS)
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

const TOP_IMG = '.gift-card[data-depth="0"] .gift-picture img'

async function deckPhotoShown(page: Page) {
  await expect(page.locator(TOP_IMG).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction((selector) => {
    const img = Array.from(document.querySelectorAll<HTMLImageElement>(selector)).find((el) => !el.closest('.tab-swipe-layer'))
    return Boolean(img?.complete && img.naturalWidth > 0 && img.closest('.gift-picture')?.querySelector('.gift-picture-credit'))
  }, TOP_IMG)
}

/** A finger drag across the page (synthetic touch pointer events — TabSwipe listens to pointer events). */
async function swipe(page: Page, fromX: number, toX: number, y: number) {
  await page.evaluate(async ({ fromX, toX, y }) => {
    const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))
    const init = (x: number): PointerEventInit => ({ bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 })
    const target = document.elementFromPoint(fromX, y) ?? document.body
    target.dispatchEvent(new PointerEvent('pointerdown', init(fromX)))
    const steps = 14
    for (let i = 1; i <= steps; i += 1) {
      await frame()
      const x = fromX + ((toX - fromX) * i) / steps
      target.dispatchEvent(new PointerEvent('pointermove', init(x)))
    }
    await frame()
    target.dispatchEvent(new PointerEvent('pointerup', { ...init(toX), buttons: 0 }))
  }, { fromX, toX, y })
}

interface Screencast { frames: Array<{ t: number; data: Buffer }>; stop: () => Promise<void> }

async function startScreencast(page: Page): Promise<Screencast> {
  const cdp: CDPSession = await page.context().newCDPSession(page)
  const frames: Screencast['frames'] = []
  cdp.on('Page.screencastFrame', (frame: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ t: (frame.metadata.timestamp ?? 0) * 1000, data: Buffer.from(frame.data, 'base64') })
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined)
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 390, maxHeight: 844 })
  return { frames, stop: async () => { await cdp.send('Page.stopScreencast'); await cdp.detach() } }
}

/**
 * Per frame (decoded in a blank page of the same browser): the share of the picture box painted with the photo's
 * browns (0 = an empty plate) and the share of the whole screen that differs from the first frame (Profil at rest).
 */
async function frameStats(lab: Page, pngs: Buffer[], box: { x: number; y: number; w: number; h: number }): Promise<Array<{ share: number; changed: number }>> {
  return lab.evaluate(async ({ frames, box }) => {
    const read = async (base64: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      return context.getImageData(0, 0, bitmap.width, bitmap.height)
    }
    const first = await read(frames[0]!)
    const out: Array<{ share: number; changed: number }> = []
    for (const base64 of frames) {
      const image = await read(base64)
      const scale = image.width / 390
      const left = Math.round((box.x + 8) * scale), top = Math.round((box.y + 8) * scale)
      const right = Math.min(image.width, Math.round((box.x + box.w - 8) * scale)), bottom = Math.min(image.height, Math.round((box.y + box.h - 8) * scale))
      let brown = 0, all = 0
      for (let y = top; y < bottom; y += 2) {
        for (let x = left; x < right; x += 2) {
          const i = (y * image.width + x) * 4
          const r = image.data[i]!, g = image.data[i + 1]!, b = image.data[i + 2]!
          all += 1
          if (r > 150 && r - b > 35 && g > 120 && g < 215) brown += 1
        }
      }
      let changed = 0, seen = 0
      for (let i = 0; i < image.data.length; i += 4 * 7) {
        seen += 1
        if (Math.abs(image.data[i]! - first.data[i]!) + Math.abs(image.data[i + 1]! - first.data[i + 1]!) + Math.abs(image.data[i + 2]! - first.data[i + 2]!) > 24) changed += 1
      }
      out.push({ share: all ? brown / all : 0, changed: changed / seen })
    }
    return out
  }, { frames: pngs.map((png) => png.toString('base64')), box })
}

interface Report { handoverJump: number | null; how: string; browser: string; photoRequestsOnReturn: number; frames: number; missingPhoto: number; missingCredit: number; boxMoves: number; painted?: { frames: number; blank: number; shares: number[] } }

function analyse(samples: Sample[], rest: { x: number; y: number; w: number; h: number }) {
  // only the frames from the first one the real page shows its top card again (before that: Profil or the copy)
  const first = samples.findIndex((s) => s.w > 0 && !s.copy)
  const after = first < 0 ? [] : samples.slice(first)
  // a swipe: the copy's picture in its last frame (slid all the way in) vs the real one that takes its place
  const lastCopy = first > 0 ? samples[first - 1]?.copyBox ?? null : null
  const real = samples[first]
  const handoverJump = lastCopy && real ? Math.max(Math.abs(lastCopy.x - real.x), Math.abs(lastCopy.y - real.y), Math.abs(lastCopy.w - real.w), Math.abs(lastCopy.h - real.h)) : null
  return {
    handoverJump,
    frames: after.length,
    missingPhoto: after.filter((s) => !s.img || !s.complete || s.nw === 0).length,
    missingCredit: after.filter((s) => !s.credit).length,
    boxMoves: after.filter((s) => Math.abs(s.x - rest.x) > 1 || Math.abs(s.y - rest.y) > 1 || Math.abs(s.w - rest.w) > 1 || Math.abs(s.h - rest.h) > 1).length,
  }
}

async function run(browser: Browser, name: string, how: 'tap' | 'swipe'): Promise<Report> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'de-DE', baseURL: 'http://localhost:5173', hasTouch: true })
  const lab = await context.newPage()
  let photoRequests = 0
  if (JPEG) {
    const bytes = await probeJpeg(lab)
    await context.route('**/api/gift-ideas/probe/**', async (route) => {
      photoRequests += 1
      await new Promise((done) => setTimeout(done, 120))
      await route.fulfill({ status: 200, body: bytes, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
    })
  }
  const page = await context.newPage()
  await prepare(page)
  await signUp(page)
  const nav = page.getByRole('navigation')
  await nav.getByRole('link', { name: 'Ideen' }).click()
  await deckPhotoShown(page)
  await page.waitForTimeout(1200)
  await nav.getByRole('link', { name: 'Profil' }).click()
  await expect(page).toHaveURL(/\/settings/)
  // long enough for every short-lived keeper to have let go (lib/objectUrl's 1 s, React's StrictMode)
  await page.waitForTimeout(2500)
  const cast = name === 'edge' ? await startScreencast(page) : null
  await page.evaluate(() => (window as unknown as { __flick: { start: () => void } }).__flick.start())
  const castFrom = Date.now()
  const requestsBefore = photoRequests
  if (how === 'tap') await nav.getByRole('link', { name: 'Ideen' }).click()
  else await swipe(page, 40, 370, 420)
  await expect(page).toHaveURL(/\/gifts/)
  await page.waitForTimeout(1500)
  const samples = await page.evaluate(() => (window as unknown as { __flick: { stop: () => Sample[] } }).__flick.stop())
  // the box at rest = where it is at the end (the first visit's swipe hint nudges the card, so not before leaving)
  const last = samples[samples.length - 1]
  const rest = { x: last?.x ?? 0, y: last?.y ?? 0, w: last?.w ?? 0, h: last?.h ?? 0 }
  const report: Report = { how, browser: name, ...analyse(samples, rest), photoRequestsOnReturn: photoRequests - requestsBefore }
  if (cast) {
    await cast.stop()
    const frames = cast.frames.filter((f) => f.t >= castFrom - 50)
    for (const [i, frame] of frames.entries()) writeFileSync(`${OUT}/${name}-${how}-${String(i).padStart(3, '0')}.png`, frame.data)
    const stats = await frameStats(lab, frames.map((frame) => frame.data), rest)
    const shares = stats.map((s) => Math.round(s.share * 1000) / 1000)
    // the photo at rest; the Ideen screen counts from the first frame in which half the photo's box shows it (a
    // swipe: the copy slides in with its photo) — after a tap from the first frame in which a fifth of the screen
    // changed (no slide: the screen swaps at once, an empty plate there would be a blank frame)
    const restShare = shares.length > 0 ? Math.max(...shares) : 0
    const firstPhoto = shares.findIndex((s) => s > restShare * 0.5)
    const firstSwap = stats.findIndex((s) => s.changed > 0.2)
    const candidates = (how === 'tap' ? [firstPhoto, firstSwap] : [firstPhoto]).filter((i) => i >= 0)
    const ideenFrom = candidates.length > 0 ? Math.min(...candidates) : -1
    const tail = ideenFrom < 0 ? [] : shares.slice(ideenFrom)
    report.painted = { frames: shares.length, blank: tail.filter((s) => s < restShare * 0.5).length, shares }
  }
  writeFileSync(`${OUT}/${name}-${how}.json`, JSON.stringify({ report, rest, samples }, null, 1))
  await context.close()
  return report
}

for (const name of ['firefox', 'edge'] as const) {
  for (const how of ['tap', 'swipe'] as const) {
    test(`Ideen → Profil → Ideen by ${how} (${name}): the deck's photo stays put`, async () => {
      test.setTimeout(90_000)
      // Playwright's routing does not see Firefox's service-worker requests: the JPEG mode is Edge only
      test.skip(JPEG && name === 'firefox', 'PHOTO_MODE=jpeg needs Edge')
      const browser = name === 'edge' ? await chromium.launch({ channel: 'msedge' }) : await firefox.launch()
      try {
        const report = await run(browser, name, how)
        console.log(JSON.stringify({ ...report, painted: report.painted ? { frames: report.painted.frames, blank: report.painted.blank } : undefined }))
        expect(report.frames).toBeGreaterThan(10)
        expect(report.missingPhoto).toBe(0)
        expect(report.missingCredit).toBe(0)
        expect(report.boxMoves).toBe(0)
        // the copy that slid in and the real screen show the card at the same place and size (≤ 1 px)
        if (how === 'swipe') expect(report.handoverJump).toBeLessThanOrEqual(1)
        if (report.painted) expect(report.painted.blank).toBe(0)
      } finally {
        await browser.close()
      }
    })
  }
}
