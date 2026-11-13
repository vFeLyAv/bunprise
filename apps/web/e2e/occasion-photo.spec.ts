import { expect, test, type Page } from '@playwright/test'

// The occasion cover photo in a real browser (demo mode, src/mocks/photos.ts):
//   1. the REAL pipeline (features/occasions/photo/pipeline.ts) on a camera-like JPEG that carries an EXIF
//      block with a GPS position: the canvas re-encode leaves no EXIF / GPS / XMP behind, ≤ 1600 px, ≤ 400 KB;
//   2. the photo through the form: picked in "Neuer Anlass", uploaded after the save, the occasion's hero
//      shows it — and what the (demo) server stored has no metadata either.
// Everything is generated in the page: no photo file, no person, made-up coordinates.

async function signUp(page: Page, email: string, name: string): Promise<void> {
  await page.goto('/login?mode=signup&method=email&frame=0')
  await page.getByLabel('E-Mail', { exact: true }).fill(email)
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Code schicken', exact: true }).click()
  await expect(page).toHaveURL(/\/login\/code/)
  await page.getByLabel('Sechsstelliger Code', { exact: true }).fill('123456')
  await expect(page).toHaveURL(/\/welcome\/profile/)
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Fertig', exact: true }).click()
  await expect(page).not.toHaveURL(/\/welcome\/profile/)
}

/** In the page: a 3000 × 2000 JPEG (gradient + confetti) with an EXIF block holding a GPS IFD right after SOI. */
async function cameraJpegBase64(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 3000
    canvas.height = 2000
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    const sky = ctx.createLinearGradient(0, 0, 3000, 2000)
    sky.addColorStop(0, 'rgb(246, 201, 160)')
    sky.addColorStop(1, 'rgb(95, 157, 105)')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 3000, 2000)
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 70% 60%)`
      ctx.fillRect((i * 97) % 3000, (i * 53) % 2000, 14, 14)
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no jpeg'))), 'image/jpeg', 0.95))
    const jpeg = new Uint8Array(await blob.arrayBuffer())
    const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0))
    const tiff = [
      ...ascii('MM'), 0x00, 0x2a, 0, 0, 0, 8, 0, 1,
      0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, // IFD0: GPSInfo → 26
      0, 2,
      0x00, 0x01, 0, 2, 0, 0, 0, 2, ...ascii('N\0'), 0, 0, // GPSLatitudeRef
      0x00, 0x02, 0, 5, 0, 0, 0, 3, 0, 0, 0, 56, 0, 0, 0, 0, // GPSLatitude → 56
      0, 0, 0, 48, 0, 0, 0, 1, 0, 0, 0, 8, 0, 0, 0, 1, 0, 0, 0, 30, 0, 0, 0, 1, // 48° 8′ 30″ (made up)
    ]
    const payload = [...ascii('Exif'), 0, 0, ...tiff]
    const app1 = [0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload]
    const out = new Uint8Array(jpeg.length + app1.length)
    out.set(jpeg.subarray(0, 2), 0)
    out.set(app1, 2)
    out.set(jpeg.subarray(2), 2 + app1.length)
    let binary = ''
    for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000))
    return btoa(binary)
  })
}

test('the re-encode of a camera JPEG leaves no EXIF / GPS: ≤ 1600 px and ≤ 400 KB, a type the database takes', async ({ page }) => {
  await page.goto('/?frame=0')
  const photo = await cameraJpegBase64(page)
  const result = await page.evaluate(async (b64) => {
    const binary = atob(b64)
    const input = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const { preparePhoto } = await import('/src/features/occasions/photo/pipeline.ts')
    const { findImageMetadata, photoBytesMatch } = await import('/src/features/occasions/photo/metadata.ts')
    const out = await preparePhoto(new File([input], 'IMG_0001.JPG', { type: 'image/jpeg' }))
    const head = String.fromCharCode(...out.bytes.subarray(0, Math.min(out.bytes.length, 8192)))
    return {
      before: findImageMetadata(input, 'image/jpeg'),
      after: findImageMetadata(out.bytes, out.mime),
      exifText: head.includes('Exif'),
      mime: out.mime,
      width: out.width,
      height: out.height,
      bytes: out.bytes.length,
      valid: photoBytesMatch(out.mime, out.bytes),
    }
  }, photo)
  expect(result.before).toEqual(expect.arrayContaining(['exif', 'gps']))
  expect(result.after).toEqual([])
  expect(result.exifText).toBe(false)
  expect(['image/webp', 'image/jpeg']).toContain(result.mime)
  expect(result).toMatchObject({ width: 1600, height: 1067, valid: true })
  expect(result.bytes).toBeLessThanOrEqual(409_600)
})

test('a picked photo goes with the new occasion into its hero — stored without metadata', async ({ page }) => {
  await signUp(page, 'jona@example.test', 'Jona Demo')
  const photo = Buffer.from(await cameraJpegBase64(page), 'base64')
  await page.evaluate(async () => {
    const { router } = await import('/src/router.tsx')
    await router.navigate({ to: '/occasions/new' })
  })
  await page.getByLabel('Titel', { exact: true }).fill('Sommerfest im Hof')
  await page.getByRole('button', { name: /^Datum/ }).click()
  await page.getByRole('button', { name: 'Morgen', exact: true }).click()
  await expect(page.getByText('Nur Fotos, die du teilen darfst. Sind Menschen darauf, frag sie vorher.')).toBeVisible()
  await page.setInputFiles('input[type="file"]', { name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: photo })
  await expect(page.getByRole('button', { name: 'Ersetzen', exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()

  // the new occasion's id from the feed, then its screen: the hero shows the cover
  await expect.poll(async () => page.evaluate(async () => {
    const { getFeed } = await import('/src/lib/api/occasions.ts')
    return (await getFeed()).upcoming.some((o) => o.title === 'Sommerfest im Hof')
  }), { timeout: 10_000 }).toBe(true)
  const occasionId = await page.evaluate(async () => {
    const { getFeed } = await import('/src/lib/api/occasions.ts')
    return (await getFeed()).upcoming.find((o) => o.title === 'Sommerfest im Hof')?.id ?? ''
  })
  await expect.poll(async () => page.evaluate(async (id) => {
    const { getOccasionScreen } = await import('/src/lib/api/occasions.ts')
    return (await getOccasionScreen(id)).occasion.photo?.width ?? 0
  }, occasionId), { timeout: 15_000 }).toBe(1600)
  // Follow the confirmed creation landing; an imperative route change before the create action
  // settles can be superseded by that action's own navigation back to the month.
  await page.getByRole('link', { name: 'Freunde zu „Sommerfest im Hof“ einladen', exact: true }).click()
  await expect(page.locator('.occ-cover[data-state="ready"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Sommerfest im Hof' })).toBeVisible()

  const stored = await page.evaluate(async (id) => {
    const { getOccasionPhoto } = await import('/src/lib/api/photos.ts')
    const { findImageMetadata } = await import('/src/features/occasions/photo/metadata.ts')
    const cover = await getOccasionPhoto(id)
    const bytes = new Uint8Array(await cover.blob.arrayBuffer())
    return { width: cover.width, height: cover.height, bytes: bytes.length, metadata: findImageMetadata(bytes, cover.mime) }
  }, occasionId)
  expect(stored).toMatchObject({ width: 1600, height: 1067, metadata: [] })
  expect(stored.bytes).toBeLessThanOrEqual(409_600)
})
