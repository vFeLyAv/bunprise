import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Own profile photo + own banner photo (Felix 24.10, 20261024120000) in the demo, Firefox at phone size (390 × 844 and
// 320 px, 2× pixels): the Profil header with my photo and my banner photo, the banner sheet (own photo above the presets),
// the avatar sheet, the "Listen" header, friends with a photo in "Freunde" and on the people page, a person page, the
// guests of an occasion. Screens go to docs/screens/2026-10-24-profile-photos/.
// The demo resets on reload: everything below navigates inside the app after seeding through the app's own API modules
// (the same module instances the app uses, served by Vite). My own pictures are drawn on a canvas right here (a lake
// and a sea — invented, no people); Anna and Paula bring the demo's own invented pictures.

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-24-profile-photos')
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

/** Every photo ON SCREEN that is on its way has arrived (the demo answers after a short pause; off-screen ones wait). */
async function photosReady(page: Page) {
  await page.waitForFunction(() => {
    const offScreen = (el: Element) => {
      const box = el.getBoundingClientRect()
      return box.bottom < 0 || box.top > window.innerHeight || box.width === 0
    }
    // nothing on screen still on its way, and every photo on screen has faded in completely
    return [...document.querySelectorAll('[data-profile-photo][data-photo-state="loading"]')].every(offScreen)
      && [...document.querySelectorAll('.pph-img')].every((img) => offScreen(img) || Number(getComputedStyle(img).opacity) > 0.99)
  }, null, { timeout: 15_000 })
}

async function settle(page: Page) {
  await photosReady(page)
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
}

/** My own profile photo (a lake under mountains, 512 px square) and banner photo (a sea with a sail, 1600 × 640). */
async function seedOwnPhotos(page: Page) {
  return page.evaluate(async () => {
    const photos = (await import(/* @vite-ignore */ '/src/lib/api/profilePhotos.ts')) as {
      uploadProfilePhoto: (kind: string, photo: object) => Promise<{ updated_at: string }>
    }
    async function draw(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      paint(ctx)
      const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/webp', 0.84))
      return { mime: 'image/webp', bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
    }
    const avatar = await draw(512, 512, (ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 0, 512)
      sky.addColorStop(0, '#BFD9F2'); sky.addColorStop(1, '#F6E7D6')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 512)
      ctx.fillStyle = '#FFF4C9'; ctx.beginPath(); ctx.arc(370, 150, 52, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#8FA7C4'; ctx.beginPath(); ctx.moveTo(-20, 330); ctx.lineTo(150, 150); ctx.lineTo(300, 330); ctx.fill()
      ctx.fillStyle = '#6F89AA'; ctx.beginPath(); ctx.moveTo(180, 330); ctx.lineTo(360, 120); ctx.lineTo(540, 330); ctx.fill()
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.moveTo(331, 154); ctx.lineTo(360, 120); ctx.lineTo(389, 154); ctx.lineTo(372, 150); ctx.lineTo(360, 162); ctx.lineTo(348, 150); ctx.fill()
      ctx.fillStyle = '#5E9E8A'; ctx.fillRect(0, 330, 512, 182)
      ctx.fillStyle = '#7DB9C9'; ctx.beginPath(); ctx.ellipse(256, 420, 230, 60, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 6
      for (const y of [400, 425, 448]) { ctx.beginPath(); ctx.moveTo(150, y); ctx.lineTo(360, y); ctx.stroke() }
    })
    const banner = await draw(1600, 640, (ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 0, 640)
      sky.addColorStop(0, '#9FC6EA'); sky.addColorStop(0.62, '#F8DCC2'); sky.addColorStop(0.62, '#5D9DC4'); sky.addColorStop(1, '#3E7DA8')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 1600, 640)
      ctx.fillStyle = '#FFE3A3'; ctx.beginPath(); ctx.arc(420, 380, 90, Math.PI, 0); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,.75)'
      for (const [x, y, r] of [[1100, 120, 70], [1170, 100, 55], [1240, 125, 60], [260, 150, 50], [320, 135, 40]]) { ctx.beginPath(); ctx.arc(x!, y!, r!, 0, Math.PI * 2); ctx.fill() }
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.moveTo(1000, 520); ctx.lineTo(1000, 300); ctx.lineTo(1130, 520); ctx.fill()
      ctx.fillStyle = '#E98C6E'; ctx.beginPath(); ctx.moveTo(990, 520); ctx.lineTo(990, 340); ctx.lineTo(900, 520); ctx.fill()
      ctx.fillStyle = '#8A5A3C'; ctx.beginPath(); ctx.moveTo(880, 530); ctx.lineTo(1150, 530); ctx.lineTo(1110, 570); ctx.lineTo(920, 570); ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 5
      for (const [x, y] of [[200, 470], [600, 520], [1300, 480], [1400, 560], [300, 590]]) { ctx.beginPath(); ctx.moveTo(x!, y!); ctx.lineTo(x! + 120, y!); ctx.stroke() }
    })
    await photos.uploadProfilePhoto('avatar', avatar)
    await photos.uploadProfilePhoto('banner', banner)
    return { avatar: avatar.bytes.length, banner: banner.bytes.length }
  })
}

test('profile photos: Profil header, banner + avatar sheets, Listen, friends, people, person, occasion', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await solidMaterials(page)
  await signUp(page)
  console.log('seeded', JSON.stringify(await seedOwnPhotos(page)))
  // the seed went past the screens: get_me is asked again (the tab bar's own avatar reads it), as after a reload
  await page.evaluate(async () => {
    const { queryClient } = (await import(/* @vite-ignore */ '/src/lib/query.ts')) as { queryClient: { refetchQueries: (filters: object) => Promise<void> } }
    await queryClient.refetchQueries({ queryKey: ['me'] })
  })

  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' })
  // the tab bar's own avatar shows the photo once the browser is idle
  await nav.getByRole('link', { name: /Profil/ }).click()
  await expect(page.getByRole('button', { name: 'Profilbild ändern' })).toBeVisible()
  await shot(page, 'a-profile-390')

  await page.getByRole('button', { name: 'Banner ändern' }).click()
  await expect(page.getByRole('radio', { name: 'Mein Foto' })).toBeVisible({ timeout: 15_000 })
  await shot(page, 'b-banner-sheet-390')
  await page.getByRole('dialog').getByRole('radiogroup', { name: 'Muster' }).scrollIntoViewIfNeeded()
  await shot(page, 'b-banner-sheet-presets-390')
  await page.keyboard.press('Escape')
  await settle(page)

  await page.getByRole('button', { name: 'Profilbild ändern' }).click()
  await expect(page.getByRole('radio', { name: /Initialen/ })).toBeVisible({ timeout: 15_000 })
  await shot(page, 'c-avatar-sheet-390')
  await page.keyboard.press('Escape')
  await settle(page)

  // scrolled: my photo glides into the bar
  await page.mouse.wheel(0, 260)
  await shot(page, 'a-profile-scrolled-390')
  await page.mouse.wheel(0, -2000)

  await nav.getByRole('link', { name: /^Listen/ }).click()
  await expect(page.getByRole('radio', { name: 'Freunde', exact: true })).toBeVisible()
  await shot(page, 'd-listen-390')

  await page.getByRole('radio', { name: 'Freunde', exact: true }).click()
  await shot(page, 'e-friends-390')
  await page.getByRole('heading', { name: 'Anna Beispiel' }).first().scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 120)
  await shot(page, 'e-friends-people-390')
  await page.mouse.wheel(0, -3000)

  // the people page (followers / following) and Anna's person page
  await page.getByRole('button', { name: /Follower · Du folgst/ }).click()
  await expect(page.getByRole('link', { name: 'Anna Beispiel' }).first()).toBeVisible({ timeout: 15_000 })
  await shot(page, 'f-people-390')
  await page.getByRole('link', { name: 'Anna Beispiel' }).first().click()
  await expect(page.getByRole('heading', { name: 'Anna Beispiel', level: 1 })).toBeVisible({ timeout: 15_000 })
  await shot(page, 'g-person-anna-390')

  // an occasion's guests: Anna is the host of "Annas Einweihung"
  await page.goBack()
  await page.goBack()
  await nav.getByRole('link', { name: /^Start/ }).click()
  const occasion = page.getByRole('link', { name: /Annas Einweihung/ }).first()
  await expect(occasion).toBeVisible({ timeout: 15_000 })
  await occasion.click()
  await expect(page.getByRole('heading', { name: 'Wer kommt' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('heading', { name: 'Wer kommt' }).scrollIntoViewIfNeeded()
  await shot(page, 'h-occasion-guests-390')
  await page.goBack()

  // 320 px
  await page.setViewportSize({ width: 320, height: 700 })
  await nav.getByRole('link', { name: /Profil/ }).click()
  await expect(page.getByRole('button', { name: 'Profilbild ändern' })).toBeVisible()
  await page.mouse.wheel(0, -2000)
  await shot(page, 'i-profile-320')
  await page.getByRole('button', { name: 'Banner ändern' }).click()
  await expect(page.getByRole('radio', { name: 'Mein Foto' })).toBeVisible({ timeout: 15_000 })
  await shot(page, 'i-banner-sheet-320')
  await page.keyboard.press('Escape')
  await settle(page)
  await page.getByRole('button', { name: 'Profilbild ändern' }).click()
  await expect(page.getByRole('radio', { name: /Initialen/ })).toBeVisible({ timeout: 15_000 })
  await shot(page, 'i-avatar-sheet-320')
  await page.keyboard.press('Escape')
  await settle(page)
  await nav.getByRole('link', { name: /^Listen/ }).click()
  await expect(page.getByRole('radio', { name: 'Freunde', exact: true })).toBeVisible()
  await page.mouse.wheel(0, -2000)
  await shot(page, 'j-listen-320')
  await page.getByRole('radio', { name: 'Freunde', exact: true }).click()
  await page.getByRole('heading', { name: 'Anna Beispiel' }).first().scrollIntoViewIfNeeded()
  await shot(page, 'j-friends-320')

  console.log('page errors:', errors.length ? errors.join(' | ') : 'none')
})
