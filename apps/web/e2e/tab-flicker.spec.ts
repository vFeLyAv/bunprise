import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect, firefox, test, type Browser, type CDPSession, type Page } from '@playwright/test'

// Felix 31.10 (live preview :5174, real Supabase + local Worker, Firefox): «Данные с перехода с Ideen в Profil и
// обратно мигают. То есть фото и данные» — on Profil «пропадает баннер, аватарка, имя, эл. почта, вход». The demo
// (:5173) answers at once, so the 28.10 photo spec never saw it. This spec makes the demo behave like the preview:
// - LATENCY: every answer of „Supabase“ (the demo's http://demo.localhost) and of our Worker (/api/*) arrives
//   150–600 ms late (a fetch wrapper in the page, before the app's own code; deterministic sequence).
// - PHOTOS: my own avatar + banner photo (seeded through the app's own API, as in profile-photos-screens.spec.ts),
//   the deck's ideas with photos; in Edge the deck photos are REAL catalogue photos taken from the local Worker
//   (:8787, an open endpoint) and answered by Playwright late with the Worker's own headers
//   (`Cache-Control: private, max-age=86400`) — the browser cache decides what comes back (Firefox: Playwright does
//   not see service-worker requests there, the demo's placeholder photo is used).
// - the path Start → Listen → Ideen → Profil → Ideen → Listen → Start → Listen → Ideen → Profil (first visits are
//   cold, the returns warm), then once more after every cached answer was made 61 s old (Felix stays a while on a
//   tab: TanStack refetches on mount, the _authed guard asks get_me again).
// - per frame (requestAnimationFrame, both browsers): the live screen's text, its visible <img>s (painted? opacity?
//   src = which object URL), skeletons, the landmarks' places — and the copy that slides in during a swipe;
//   in Edge also the compositor's frames (CDP screencast) → a film strip per step.
// A RETURN to a tab must show the same screen from its first frame: no skeleton, no photo missing or fading in, no
// text that changes (data that flashes), no landmark that moves, the swipe's copy = the live screen.
// Before the fix (31.10, this spec on the old code): every return to Profil stood empty for 570–600 ms (default banner,
// initials, grey bars instead of name / e-mail / sign-in), Start's „Bald wieder“ card came 80–100 ms after the screen.
// After: 0 / 0 in Firefox and Edge, tap and swipe (docs/handoffs/2026-10-31-tab-flicker.md).
// Run: npx playwright test e2e/tab-flicker.spec.ts (demo on :5173, Worker on :8787 for Edge's real photos).
// Results: $FLICKER_OUT (default test-results/tab-flicker): <browser>-<how>.json + film strips (Edge).

const OUT = process.env.FLICKER_OUT ?? resolve(process.cwd(), 'test-results/tab-flicker')
mkdirSync(OUT, { recursive: true })
const WORKER = process.env.FLICKER_WORKER ?? 'http://localhost:8787'
const STRICT = process.env.FLICKER_REPORT_ONLY !== '1'

type Tab = 'soon' | 'lists' | 'gifts' | 'settings'
const LABEL: Record<Tab, string> = { soon: 'Start', lists: 'Listen', gifts: 'Ideen', settings: 'Profil' }
const ORDER: Tab[] = ['soon', 'lists', 'gifts', 'settings']
/** the walk; `age` = every cached answer is made 61 s old first (a stay on the tab) */
const WALK: Array<{ to: Tab; age?: true }> = [
  { to: 'lists' }, { to: 'gifts' }, { to: 'settings' }, { to: 'gifts' }, { to: 'lists' }, { to: 'soon' },
  { to: 'lists' }, { to: 'gifts' }, { to: 'settings' },
  { to: 'gifts', age: true }, { to: 'settings', age: true }, { to: 'gifts', age: true }, { to: 'lists', age: true }, { to: 'soon', age: true },
]

const CATALOG_PHOTOS = [
  'speaker/cat%3Anothing-cmf-speaker-s', 'speaker/cat%3Anothing-cmf-speaker-m', 'headphones/cat%3Anothing-cmf-buds-2a',
]

interface Img { s: string; ok: 0 | 1; op: number }
interface Frame { t: number; path: string; copy: 0 | 1; skel: number; text: number; copyText: number; tops: number; imgs: Img[]; copyImgs: number }
interface Mark { t: number; label: string }
interface Probe { frames: Frame[]; marks: Mark[]; texts: string[]; requests: Array<{ t: number; what: string }> }

async function prepare(page: Page, photoPaths: string[]) {
  await page.addInitScript((photos: string[]) => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
    const w = window as unknown as { __probe: Probe & { on: boolean; mark: (label: string) => void; start: () => void } }
    const probe = { on: false, frames: [] as Frame[], marks: [] as Mark[], texts: [] as string[], requests: [] as Array<{ t: number; what: string }> } as Probe & { on: boolean; mark: (label: string) => void; start: () => void }
    w.__probe = probe
    // ---- latency: Supabase (the demo's host) and our Worker answer 150–600 ms late, like the preview ----
    const original = window.fetch.bind(window)
    let n = 0
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const remote = url.startsWith('http://demo.localhost') || new URL(url, location.href).pathname.startsWith('/api/')
      const started = performance.now()
      let response = await original(input, init)
      if (!remote) return response
      n += 1
      const what = new URL(url, location.href).pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth/')
      probe.requests.push({ t: started, what })
      const ms = 150 + ((n * 7919) % 451)
      await new Promise((done) => setTimeout(done, Math.max(0, ms - (performance.now() - started))))
      // the deck's ideas wear photo paths (Edge: real catalogue photos answered by Playwright; Firefox: the demo's)
      if (what === '/api/gift-ideas' && init?.method === 'POST' && photos.length > 0) {
        const body = (await response.clone().json()) as { items?: Array<{ id: string; image_url: string | null }> }
        if (Array.isArray(body.items)) {
          for (const item of body.items) {
            let hash = 0
            for (const char of item.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
            item.image_url = photos[hash % photos.length] ?? item.image_url
          }
          response = new Response(JSON.stringify(body), { status: response.status, headers: response.headers })
        }
      }
      return response
    }
    // ---- the frame sampler ----
    const ids = new Map<string, number>()
    const id = (text: string) => {
      let i = ids.get(text)
      if (i === undefined) { i = probe.texts.length; ids.set(text, i); probe.texts.push(text) }
      return i
    }
    const inView = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
    }
    const opacityOf = (el: Element | null) => {
      let op = 1
      for (let node = el; node && node !== document.body; node = node.parentElement) op *= Number(getComputedStyle(node).opacity)
      return Math.round(op * 100) / 100
    }
    const shortSrc = (src: string) => (src.startsWith('blob:') ? `blob:${src.slice(-6)}` : src.replace(/^https?:\/\/[^/]+/, ''))
    const imgsOf = (roots: Element[]) => roots.flatMap((root) => Array.from(root.querySelectorAll('img')))
      .filter(inView).map((img): Img => ({ s: shortSrc(img.getAttribute('src') ?? ''), ok: img.complete && img.naturalWidth > 0 ? 1 : 0, op: opacityOf(img) }))
    // what is on screen: without the screen-reader-only lines and the swipe hint once it has faded out (both unseen)
    const textOf = (roots: Element[]) => {
      let text = roots.map((root) => (root as HTMLElement).innerText).join('\n')
      for (const root of roots) {
        for (const unseen of Array.from(root.querySelectorAll<HTMLElement>('.sr-only, .gift-swipe-hint:not([data-shown])'))) {
          if (unseen.innerText) text = text.replace(unseen.innerText, '')
        }
      }
      return text.replace(/\s+/g, ' ').trim()
    }
    const tick = () => {
      if (!probe.on) return
      const root = document.getElementById('root')
      const parts = root ? Array.from(root.children).filter((el) => /^(HEADER|MAIN|FOOTER)$/.test(el.tagName)) : []
      const nav = document.querySelector('nav[data-tabbar]')
      const layer = document.querySelector('.tab-swipe-layer')
      const landmarks = parts.flatMap((part) => Array.from(part.querySelectorAll('h1, h2, .glass-panel, img, [data-banner], .set-hero-name, .gift-card[data-depth="0"]'))).filter(inView).slice(0, 40)
      probe.frames.push({
        t: performance.now(),
        path: location.pathname,
        copy: layer ? 1 : 0,
        skel: parts.flatMap((part) => Array.from(part.querySelectorAll('.skeleton'))).filter(inView).length + (layer?.classList.contains('tab-swipe-skeleton') ? 100 : 0),
        text: id(textOf(parts)),
        copyText: layer ? id(textOf(Array.from(layer.children))) : -1,
        tops: id(landmarks.map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.top)}:${Math.round(r.height)}` }).join(',')),
        imgs: imgsOf(nav ? [...parts, nav] : parts),
        copyImgs: layer ? imgsOf([layer]).length : 0,
      })
      requestAnimationFrame(tick)
    }
    probe.mark = (label: string) => { probe.marks.push({ t: performance.now(), label }) }
    probe.start = () => { probe.on = true; requestAnimationFrame(tick) }
  }, photoPaths)
}

async function signUp(page: Page) {
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await page.getByLabel('Name', { exact: true }).fill('Mila Sommer')
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await page.getByRole('button', { name: 'Überspringen', exact: true }).click()
  await expect(page).toHaveURL(/\/soon/, { timeout: 20_000 })
}

/** My own photos (a lake avatar, a sea banner — drawn here, invented) through the app's own API module. */
async function seedOwnPhotos(page: Page) {
  await page.evaluate(async () => {
    const photos = (await import(/* @vite-ignore */ '/src/lib/api/profilePhotos.ts')) as {
      uploadProfilePhoto: (kind: string, photo: object) => Promise<{ updated_at: string }>
    }
    async function draw(width: number, height: number, a: string, b: string) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const sky = ctx.createLinearGradient(0, 0, 0, height)
      sky.addColorStop(0, a); sky.addColorStop(1, b)
      ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#FFF4C9'; ctx.beginPath(); ctx.arc(width * 0.7, height * 0.3, height * 0.12, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#5E9E8A'; ctx.fillRect(0, height * 0.66, width, height * 0.34)
      const blob = await new Promise<Blob>((done) => canvas.toBlob((out) => done(out!), 'image/webp', 0.84))
      return { mime: 'image/webp', bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
    }
    await photos.uploadProfilePhoto('avatar', await draw(512, 512, '#BFD9F2', '#F6E7D6'))
    await photos.uploadProfilePhoto('banner', await draw(1600, 640, '#9FC6EA', '#3E7DA8'))
    const { queryClient } = (await import(/* @vite-ignore */ '/src/lib/query.ts')) as { queryClient: { refetchQueries: (filters: object) => Promise<void> } }
    await queryClient.refetchQueries({ queryKey: ['me'] })
  })
}

/** Every cached answer is made `ms` older (a stay on the tab: TanStack's staleTime and the guard's 60 s trust run out). */
async function ageCache(page: Page, ms: number) {
  await page.evaluate(async (ms) => {
    const { queryClient } = (await import(/* @vite-ignore */ '/src/lib/query.ts')) as {
      queryClient: { getQueryCache: () => { getAll: () => Array<{ state: { dataUpdatedAt: number }; setState: (s: object) => void }> } }
    }
    for (const query of queryClient.getQueryCache().getAll()) {
      if (query.state.dataUpdatedAt > 0) query.setState({ dataUpdatedAt: query.state.dataUpdatedAt - ms })
    }
  }, ms)
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
      target.dispatchEvent(new PointerEvent('pointermove', init(fromX + ((toX - fromX) * i) / steps)))
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

/** A film strip: up to `count` frames side by side at half size (drawn in a blank page of the same browser). */
async function filmStrip(lab: Page, pngs: Buffer[], file: string, count = 10) {
  if (pngs.length === 0) return
  // more frames than room: the first ones (the moment itself) and then evenly spread up to the last
  const pick = pngs.length <= count ? pngs : [...pngs.slice(0, Math.ceil(count / 2)), ...Array.from({ length: Math.floor(count / 2) }, (_, i) => pngs[Math.round(Math.ceil(count / 2) + ((pngs.length - 1 - Math.ceil(count / 2)) * (i + 1)) / Math.floor(count / 2))]!)]
  const base64 = await lab.evaluate(async (frames) => {
    const bitmaps = await Promise.all(frames.map(async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())))
    const w = Math.round(bitmaps[0]!.width / 2), h = Math.round(bitmaps[0]!.height / 2)
    const canvas = new OffscreenCanvas(w * bitmaps.length + 4 * (bitmaps.length - 1), h)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#d00'
    ctx.fillRect(0, 0, canvas.width, h)
    bitmaps.forEach((bitmap, i) => ctx.drawImage(bitmap, i * (w + 4), 0, w, h))
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let text = ''
    for (const byte of bytes) text += String.fromCharCode(byte)
    return btoa(text)
  }, pick.map((png) => png.toString('base64')))
  writeFileSync(file, Buffer.from(base64, 'base64'))
}

interface StepReport {
  step: number; to: Tab; from: Tab; visit: number; aged: boolean
  /** ms from the tap / the end of the swipe to the first frame of the live screen */
  toLive: number
  frames: number
  /** frames of the live screen with a skeleton (the copy of a never-seen tab = 100) */
  skeleton: number
  /** frames in which a visible photo is not painted or not fully opaque */
  photoMissing: number
  /** the same for the app's own logo (/icons/icon.svg, the Start bar) — see the note at the assertions */
  logoMissing: number
  /** frames whose text differs from the screen at rest (data shown, then replaced) */
  textChanges: number
  /** frames in which a landmark is elsewhere than at rest */
  layoutMoves: number
  /** the swipe: the copy's text ≠ the live screen's first frame */
  handoverText: boolean | null
  /** a return: the screen at rest differs from the last visit's (text) */
  restDiffers: boolean | null
  /** a return: object URLs shown now that were not shown on the last visit (a new URL = decoded anew) */
  newObjectUrls: number
  requests: string[]
  photoRequests: number
}

async function walk(browser: Browser, name: 'firefox' | 'edge', how: 'tap' | 'swipe') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'de-DE', baseURL: 'http://localhost:5173', hasTouch: true })
  const lab = await context.newPage()
  let photoPaths = CATALOG_PHOTOS.map((path) => `/api/gift-ideas/img/${path}`)
  const photoLog: number[] = []
  if (name === 'edge') {
    // real catalogue photos from the local Worker (an open endpoint), answered late with the Worker's own headers
    const bytes: Buffer[] = []
    for (const path of CATALOG_PHOTOS) {
      try {
        const response = await fetch(`${WORKER}/api/gift-ideas/img/${path}`)
        if (response.ok) bytes.push(Buffer.from(await response.arrayBuffer()))
      } catch { /* no Worker running: the demo's placeholder */ }
    }
    if (bytes.length > 0) {
      photoPaths = bytes.map((_, i) => `/api/gift-ideas/probe/${i}.webp`)
      let k = 0
      await context.route('**/api/gift-ideas/probe/**', async (route) => {
        photoLog.push(Date.now())
        k += 1
        await new Promise((done) => setTimeout(done, 150 + ((k * 7919) % 451)))
        const i = Number(/probe\/(\d+)/.exec(route.request().url())?.[1] ?? 0)
        await route.fulfill({ status: 200, body: bytes[i % bytes.length]!, headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
      })
    }
  }
  const page = await context.newPage()
  await prepare(page, photoPaths)
  await signUp(page)
  await seedOwnPhotos(page)
  // TabSwipe (and its copies of the tabs) is a lazy chunk loaded once the first screen is idle
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-tab-swipe'), null, { timeout: 15_000 })
  await page.waitForTimeout(800)
  const cast = name === 'edge' ? await startScreencast(page) : null
  await page.evaluate(() => (window as unknown as { __probe: { start: () => void } }).__probe.start())
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  const stepTimes: Array<{ wall: number }> = []
  let at: Tab = 'soon'
  for (const [i, step] of WALK.entries()) {
    if (step.age) await ageCache(page, 61_000)
    const wall = Date.now()
    await page.evaluate((label) => (window as unknown as { __probe: { mark: (l: string) => void } }).__probe.mark(label), `${i}:${step.to}`)
    stepTimes.push({ wall })
    if (how === 'tap') {
      await nav.getByRole('link', { name: new RegExp(`^${LABEL[step.to]}`) }).click()
    } else {
      const dir = ORDER.indexOf(step.to) - ORDER.indexOf(at)
      // y: below the big titles, above Ideen's deck (a finger on the deck is the card's, never the page's)
      if (dir === 1) await swipe(page, 360, 30, 150)
      else await swipe(page, 30, 360, 150)
    }
    await expect(page).toHaveURL(new RegExp(`/${step.to}`), { timeout: 10_000 })
    // long enough for two answers in a row (150–600 ms each) and the photos; the deck's first page takes ≈ 2 s
    await page.waitForTimeout(step.to === 'gifts' ? 3200 : 2600)
    at = step.to
  }
  const probe = await page.evaluate(() => {
    const p = (window as unknown as { __probe: Probe & { on: boolean } }).__probe
    p.on = false
    return { frames: p.frames, marks: p.marks, texts: p.texts, requests: p.requests }
  })
  const reports = analyse(probe, photoLog, stepTimes)
  if (cast) {
    await cast.stop()
    // film strips: each step's first frames from its mark (screencast timestamps are wall-clock seconds)
    for (const [i, report] of reports.entries()) {
      const from = stepTimes[i]!.wall
      const frames = cast.frames.filter((f) => f.t >= from - 20 && f.t <= from + 2000).map((f) => f.data)
      const file = `${OUT}/${name}-${how}-${String(i).padStart(2, '0')}-${report.from}-to-${report.to}`
      await filmStrip(lab, frames, `${file}.png`, 12)
      // and the moment the live screen takes over (the copy / the old screen → the new one), plus the 900 ms after it
      if (report.toLive >= 0) {
        const at = from + report.toLive
        await filmStrip(lab, cast.frames.filter((f) => f.t >= at - 120 && f.t <= at + 900).map((f) => f.data), `${file}-handover.png`, 10)
      }
    }
  }
  writeFileSync(`${OUT}/${name}-${how}.json`, JSON.stringify({ reports, texts: probe.texts.slice(0, 400), marks: probe.marks, frames: probe.frames }, null, 0))
  await context.close()
  return reports
}

function analyse(probe: Probe, photoLog: number[], stepTimes: Array<{ wall: number }>): StepReport[] {
  const reports: StepReport[] = []
  const restOf = new Map<Tab, { text: number; srcs: Set<string> }>()
  // the walk starts on Start, at rest: the first step back to Start is a return too
  const startRest = probe.frames.filter((f) => f.t < (probe.marks[0]?.t ?? 0)).pop()
  if (startRest) restOf.set('soon', { text: startRest.text, srcs: new Set(startRest.imgs.map((img) => img.s)) })
  let from: Tab = 'soon'
  for (const [i, mark] of probe.marks.entries()) {
    const to = mark.label.split(':')[1] as Tab
    const end = probe.marks[i + 1]?.t ?? Infinity
    const frames = probe.frames.filter((f) => f.t >= mark.t && f.t < end)
    // the new screen's first frame: its address, no copy over it, and no longer the old screen (the address changes
    // first; the old screen stays while the router waits, e.g. for the guard's get_me)
    const before = frames[0]?.text
    const firstLive = frames.findIndex((f) => f.path.startsWith(`/${to}`) && f.copy === 0 && f.text !== before)
    const live = firstLive < 0 ? [] : frames.slice(firstLive)
    const rest = live[live.length - 1]
    const previous = restOf.get(to)
    const copyFrames = frames.slice(0, Math.max(0, firstLive)).filter((f) => f.copy === 1)
    const lastCopy = copyFrames[copyFrames.length - 1]
    const restSrcs = new Set((rest?.imgs ?? []).map((img) => img.s))
    const wall = stepTimes[i]!.wall
    const nextWall = stepTimes[i + 1]?.wall ?? Infinity
    reports.push({
      step: i, to, from, visit: previous ? 2 : 1, aged: Boolean(WALK[i]?.age),
      toLive: firstLive < 0 ? -1 : Math.round(live[0]!.t - mark.t),
      frames: live.length,
      skeleton: live.filter((f) => f.skel > 0).length,
      photoMissing: live.filter((f) => f.imgs.some((img) => !img.s.startsWith('/icons/') && (!img.ok || img.op < 0.99))).length,
      logoMissing: live.filter((f) => f.imgs.some((img) => img.s.startsWith('/icons/') && (!img.ok || img.op < 0.99))).length,
      textChanges: rest ? live.filter((f) => f.text !== rest.text).length : -1,
      layoutMoves: rest ? live.filter((f) => f.tops !== rest.tops).length : -1,
      handoverText: lastCopy && live[0] ? probe.texts[lastCopy.copyText] !== probe.texts[live[0].text] : null,
      restDiffers: previous && rest ? previous.text !== rest.text : null,
      newObjectUrls: previous ? [...restSrcs].filter((s) => s.startsWith('blob:') && !previous.srcs.has(s)).length : 0,
      requests: probe.requests.filter((r) => r.t >= mark.t && r.t < end).map((r) => r.what),
      photoRequests: photoLog.filter((t) => t >= wall && t < nextWall).length,
    })
    if (rest) restOf.set(to, { text: rest.text, srcs: restSrcs })
    from = to
  }
  return reports
}

for (const name of ['firefox', 'edge'] as const) {
  for (const how of ['tap', 'swipe'] as const) {
    test(`tabs with latency by ${how} (${name}): a tab that comes back shows the same screen from its first frame`, async () => {
      test.setTimeout(240_000)
      const browser = name === 'edge' ? await chromium.launch({ channel: 'msedge' }) : await firefox.launch()
      try {
        const reports = await walk(browser, name, how)
        for (const r of reports) {
          console.log(`${name}/${how} #${r.step} ${r.from}→${r.to} v${r.visit}${r.aged ? ' aged' : ''}: live after ${r.toLive} ms, frames ${r.frames}, skeleton ${r.skeleton}, photoMissing ${r.photoMissing}, logoMissing ${r.logoMissing}, textChanges ${r.textChanges}, layoutMoves ${r.layoutMoves}, handoverText ${r.handoverText}, restDiffers ${r.restDiffers}, newObjectUrls ${r.newObjectUrls}, photoReq ${r.photoRequests}, req [${r.requests.join(' ')}]`)
        }
        if (!STRICT) return
        for (const r of reports.filter((report) => report.visit === 2)) {
          const where = `${r.from}→${r.to} (#${r.step}${r.aged ? ', aged' : ''})`
          expect.soft(r.toLive, `${where}: the live screen arrives`).toBeGreaterThanOrEqual(0)
          expect.soft(r.skeleton, `${where}: skeleton frames`).toBe(0)
          expect.soft(r.photoMissing, `${where}: frames with a photo missing / fading`).toBe(0)
          expect.soft(r.textChanges, `${where}: frames whose data changes`).toBe(0)
          expect.soft(r.layoutMoves, `${where}: frames with a landmark out of place`).toBe(0)
          // the logo: Firefox 0. Edge on the demo re-requests /icons/icon.svg through the demo's service worker on every
          // return to Start and paints it 2–5 frames late — an open item (docs/handoffs/2026-10-31-tab-flicker.md), counted
          // and printed, not asserted there
          if (name === 'firefox') expect.soft(r.logoMissing, `${where}: frames without the logo`).toBe(0)
          expect.soft(r.newObjectUrls, `${where}: photos with a new object URL`).toBe(0)
          if (how === 'swipe') expect.soft(r.handoverText, `${where}: the copy's text = the live screen's`).not.toBe(true)
        }
      } finally {
        await browser.close()
      }
    })
  }
}
