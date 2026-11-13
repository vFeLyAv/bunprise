import type { ReactNode, Ref } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen, Wish, WishInput } from '../../lib/api/types'
import type { PhotoUpload } from '../../lib/api/photos'
import { PhotoPrepareError, type PreparedPhoto } from '../occasions/photo/pipeline'
import { getToasts, toast } from '../../lib/toast'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'

// The product photo + details on the new / edit wish screen (2026-10-22). The REAL link-preview and link-image
// clients run against a stubbed fetch (so the test sees every request the browser would make); the canvas step
// (preparePhoto) and the database calls are stubbed. Invented shops (reserved example hosts) and bytes only.

const OWNER = 'host-profile'
const OCCASION_ID = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
const WISHLIST_ID = '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b'
const NEW_WISH_ID = 'f5d2a8e4-3333-4c0d-9e8f-123456789abc'
const PRODUCT = 'https://www.shop.example/kaffeemuehle'
const PICTURE = 'https://img.shop.example/produkte/kaffeemuehle.webp'

const api = vi.hoisted(() => ({
  createWish: vi.fn<(wishlistId: string, input: WishInput, expectedUserId?: string) => Promise<Wish>>(),
  updateWish: vi.fn<(wishId: string, patch: Partial<WishInput>, expectedUserId?: string) => Promise<Wish>>(),
  getOccasionScreen: vi.fn<(occasionId: string) => Promise<OccasionScreen>>(),
  upload: vi.fn<(wishId: string, photo: PhotoUpload, expectedUserId?: string) => Promise<{ updated_at: string }>>(),
  remove: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  getPhoto: vi.fn(),
  prepare: vi.fn<(blob: Blob) => Promise<PreparedPhoto>>(),
  navigate: vi.fn(),
  back: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'host-profile' }, access_token: 'fixture-token' } }, error: null }) } }),
}))
vi.mock('../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishes')>()),
  createWish: api.createWish,
  updateWish: api.updateWish,
}))
vi.mock('../../lib/api/occasions', () => ({ getOccasionScreen: api.getOccasionScreen }))
vi.mock('../../lib/api/wishPhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishPhotos')>()),
  uploadWishPhoto: api.upload,
  deleteWishPhoto: api.remove,
  getWishPhoto: api.getPhoto,
}))
vi.mock('../occasions/photo/pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../occasions/photo/pipeline')>()),
  preparePhoto: api.prepare,
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>
  return {
    Link,
    createLink: () => Link,
    useRouter: () => ({ history: { back: api.back } }),
    useCanGoBack: () => false,
    useNavigate: () => api.navigate,
  }
})
vi.mock('../mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  function Mascot({ ref }: { ref?: Ref<unknown> }) {
    useImperativeHandle(ref, () => ({ play: () => Promise.resolve(), tap: () => undefined, instance: { busy: false } }), [])
    return <div data-testid="mascot" />
  }
  return { Mascot, preloadMascot: () => undefined }
})

import { EMPTY_WISH_FORM, WishForm } from './WishForm'
import { NewWishPage } from './WishEditorPages'
import { resetWishPhotoQueueForTests, type PhotoIntent } from './wishPhotos'

const fetchMock = vi.fn<typeof fetch>()

const PREVIEW = {
  url: PRODUCT,
  site: 'Küchenkontor',
  title: 'Handkaffeemühle „Kegel“',
  price_cents: 4990,
  currency: 'EUR',
  partial: false,
  image_url: PICTURE,
  description: 'Handmühle mit Kegelmahlwerk aus Keramik.',
  brand: 'Mahlwerk & Söhne',
  color: 'Buche natur',
  gtin: '2001234567800',
}

const SHOP_BYTES = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4])
const PREPARED: PreparedPhoto = {
  mime: 'image/webp',
  bytes: Uint8Array.from([9, 9, 9]),
  width: 480,
  height: 480,
  blob: new Blob([Uint8Array.from([9, 9, 9])], { type: 'image/webp' }),
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The fake network: our Worker's two endpoints; anything else is a test failure (and recorded). */
function network({ preview = PREVIEW as Record<string, unknown>, image = 'ok' as 'ok' | 'fail' | Promise<Response> } = {}) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/api/link-preview') return json(preview)
    if (url.pathname === '/api/link-image') {
      if (image === 'ok') return new Response(SHOP_BYTES.slice().buffer, { status: 200, headers: { 'Content-Type': 'image/webp' } })
      if (image === 'fail') return json({ error: 'unsupported_content' }, 415)
      return image
    }
    throw new Error(`unexpected request: ${url.href}`)
  })
}

function withProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        {node}
      </LazyMotion>
    </QueryClientProvider>,
  )
  return client
}

function renderForm(extra: Partial<Parameters<typeof WishForm>[0]> = {}) {
  const onSubmit = vi.fn<(input: WishInput, extras: { photo: PhotoIntent }) => Promise<void>>().mockResolvedValue(undefined)
  withProviders(<WishForm initial={EMPTY_WISH_FORM} submitLabel="Wunsch hinzufügen" onSubmit={onSubmit} {...extra} />)
  return { onSubmit }
}

const linkField = () => screen.getByLabelText('Link zu deinem Wunsch') as HTMLInputElement

async function pasteLink(text = PRODUCT) {
  await act(async () => {
    fireEvent.paste(linkField(), { clipboardData: { getData: () => text } })
  })
}

async function submit(label = 'Wunsch hinzufügen') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }))
  })
}

/** Every <img> on screen shows our own bytes (an object URL), never an address of a shop. */
function expectOnlyOwnImages() {
  for (const img of Array.from(document.querySelectorAll('img'))) expect(img.getAttribute('src') ?? '').toMatch(/^blob:/)
}

/** Every request went to our own origin's /api/* (never to the shop or its picture host). */
function expectOnlyOwnApi() {
  expect(fetchMock).toHaveBeenCalled()
  for (const [input] of fetchMock.mock.calls) {
    const url = new URL(input instanceof Request ? input.url : String(input))
    expect(url.origin).toBe(window.location.origin)
    expect(url.pathname).toMatch(/^\/api\//)
  }
}

let objectUrls = 0
beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  objectUrls = 0
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/photo-${(objectUrls += 1)}`)
  URL.revokeObjectURL = vi.fn()
  api.prepare.mockResolvedValue(PREPARED)
  toast.clear()
  setRenderedAccount(OWNER)
  window.sessionStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
  resetWishPhotoQueueForTests()
})

describe('new wish: the photo and the details from the link', () => {
  it('reads the picture through our Worker right after the preview (shimmer meanwhile) and fills the details', async () => {
    let answer!: (response: Response) => void
    network({ image: new Promise<Response>((resolve) => (answer = resolve)) })
    renderForm()
    await pasteLink()
    await waitFor(() => expect(document.querySelector('[data-card-photo="loading"]')).not.toBeNull())
    // the details are there already (text, colour, brand — editable)
    expect((screen.getByLabelText('Beschreibung') as HTMLTextAreaElement).value).toBe('Handmühle mit Kegelmahlwerk aus Keramik.')
    expect((screen.getByLabelText('Farbe') as HTMLInputElement).value).toBe('Buche natur')
    expect((screen.getByLabelText('Marke') as HTMLInputElement).value).toBe('Mahlwerk & Söhne')
    // the picture request: our Worker, the picture's address as JSON, the bearer token, no referrer
    const imageCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/link-image'))
    expect(imageCall).toBeDefined()
    const init = imageCall?.[1]
    expect(JSON.parse(String(init?.body))).toEqual({ url: PICTURE })
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-token')

    await act(async () => answer(new Response(SHOP_BYTES.slice().buffer, { status: 200, headers: { 'Content-Type': 'image/webp' } })))
    await waitFor(() => expect(document.querySelector('[data-card-photo="shown"] img')).not.toBeNull())
    // downscaled on the device first: what is shown is what will be uploaded
    expect(api.prepare).toHaveBeenCalledTimes(1)
    expect(api.prepare.mock.calls[0]?.[0].type).toBe('image/webp')
    expect(screen.getByRole('button', { name: 'Foto entfernen' })).toBeTruthy()
    expectOnlyOwnImages()
    expectOnlyOwnApi()
  })

  it('any picture failure is calm: no photo, the shop’s letter tile stays, the wish can be saved', async () => {
    network({ image: 'fail' })
    const { onSubmit } = renderForm()
    await pasteLink()
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/link-image'))).toBe(true))
    await waitFor(() => expect(document.querySelector('[data-card-photo]')).toBeNull())
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('[data-shop-tile]')?.textContent).toBe('K')
    expect(screen.queryByText('Foto entfernen')).toBeNull()
    await submit()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Handkaffeemühle „Kegel“', shop_name: 'Küchenkontor' }), { photo: { kind: 'keep' } })
    expectOnlyOwnApi()
  })

  it('a picture the device cannot decode falls back the same way', async () => {
    network()
    api.prepare.mockRejectedValue(new Error('not_image'))
    renderForm()
    await pasteLink()
    await waitFor(() => expect(api.prepare).toHaveBeenCalled())
    await waitFor(() => expect(document.querySelector('[data-card-photo]')).toBeNull())
    expect(document.querySelector('[data-shop-tile]')).not.toBeNull()
  })

  it('"Foto entfernen" drops a wrong picture (Rückgängig brings it back); the save sends every detail', async () => {
    network()
    const { onSubmit } = renderForm()
    await pasteLink()
    const remove = await screen.findByRole('button', { name: 'Foto entfernen' })
    fireEvent.click(remove)
    expect(screen.getByText('Foto entfernt')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(await screen.findByRole('button', { name: 'Foto entfernen' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Foto entfernen' }))
    // a detail can be removed too (✕ next to the colour)
    fireEvent.click(screen.getByRole('button', { name: 'Farbe entfernen' }))
    await submit()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [input, extras] = onSubmit.mock.calls[0] ?? []
    expect(input).toEqual({
      title: 'Handkaffeemühle „Kegel“',
      price_cents: 4990,
      currency: 'EUR',
      url: PRODUCT,
      note: null,
      priority: 2,
      description: 'Handmühle mit Kegelmahlwerk aus Keramik.',
      brand: 'Mahlwerk & Söhne',
      gtin: '2001234567800',
      shop_name: 'Küchenkontor',
    })
    expect(extras).toEqual({ photo: { kind: 'keep' } }) // a new wish: nothing to upload, nothing to delete
  })

  it('keeps the photo: the save hands the prepared photo over for the upload', async () => {
    network()
    const { onSubmit } = renderForm()
    await pasteLink()
    await screen.findByRole('button', { name: 'Foto entfernen' })
    await submit()
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'upload', photo: PREPARED } })
  })
})

describe('saving: the photo never loses the wish', () => {
  function occasion(): OccasionScreen {
    return {
      occasion: {
        id: OCCASION_ID, title: 'Milas Geburtstag', starts_at: '2026-11-02T00:00:00+00:00', tz: 'Europe/Berlin', all_day: true,
        place_text: null, description: null, created_at: '2026-10-01T09:00:00+00:00', host: { id: OWNER, display_name: 'Mila' },
      },
      viewer: { role: 'host', rsvp: 'going' },
      members: [],
      invite: null,
      wishlist: { id: WISHLIST_ID, owner_id: OWNER, title: null, wishes: [] },
    }
  }
  const saved: Wish = {
    id: NEW_WISH_ID, wishlist_id: WISHLIST_ID, title: 'Handkaffeemühle „Kegel“', price_cents: 4990, currency: 'EUR', url: PRODUCT,
    note: null, priority: 2, created_at: '2026-10-22T10:00:00+00:00',
  }

  it('the wish is created with its details; a failed upload keeps it and says so calmly', async () => {
    network()
    api.getOccasionScreen.mockResolvedValue(occasion())
    api.createWish.mockResolvedValue(saved)
    api.upload.mockRejectedValue(new Error('network down'))
    withProviders(<NewWishPage occasionId={OCCASION_ID} />)
    await screen.findByRole('button', { name: 'Ohne Link hinzufügen' })
    await pasteLink()
    await screen.findByRole('button', { name: 'Foto entfernen' })
    await submit()
    expect(api.createWish).toHaveBeenCalledWith(
      WISHLIST_ID,
      expect.objectContaining({ title: 'Handkaffeemühle „Kegel“', description: 'Handmühle mit Kegelmahlwerk aus Keramik.', color: 'Buche natur', brand: 'Mahlwerk & Söhne', gtin: '2001234567800', shop_name: 'Küchenkontor' }),
      OWNER,
    )
    // the upload came AFTER the wish existed, for that wish and account
    expect(api.upload).toHaveBeenCalledWith(NEW_WISH_ID, PREPARED, OWNER)
    // the person still lands on the occasion (the wish is saved) and hears about the photo once
    expect(api.navigate).toHaveBeenCalledWith({ to: '/occasions/$occasionId', params: { occasionId: OCCASION_ID }, replace: true })
    expect(getToasts().map((item) => item.text)).toContain('Wunsch gespeichert – nur das Foto hat nicht geklappt.')
  })

  it('a successful upload seeds the photo cache (the list shows it without downloading it again)', async () => {
    network()
    api.getOccasionScreen.mockResolvedValue(occasion())
    api.createWish.mockResolvedValue(saved)
    api.upload.mockResolvedValue({ updated_at: '2026-10-22T10:00:01+00:00' })
    const client = withProviders(<NewWishPage occasionId={OCCASION_ID} />)
    await screen.findByRole('button', { name: 'Ohne Link hinzufügen' })
    await pasteLink()
    await screen.findByRole('button', { name: 'Foto entfernen' })
    await submit()
    expect(client.getQueryData(['wishPhoto', NEW_WISH_ID, '2026-10-22T10:00:01+00:00'])).toMatchObject({ blob: PREPARED.blob, width: 480 })
    expect(getToasts()).toHaveLength(0)
  })
})

// ---- own photo from the device (Felix 25.10: "if the link has no photo, the person adds one; also without a link")

const OWN: PreparedPhoto = {
  mime: 'image/jpeg',
  bytes: Uint8Array.from([7, 7, 7]),
  width: 1200,
  height: 900,
  blob: new Blob([Uint8Array.from([7, 7, 7])], { type: 'image/jpeg' }),
}
const OWN_2: PreparedPhoto = { ...OWN, bytes: Uint8Array.from([8, 8]), blob: new Blob([Uint8Array.from([8, 8])], { type: 'image/jpeg' }) }

const fileInput = () => document.querySelector<HTMLInputElement>('input[data-wish-photo-input]')
const ownFile = () => new File([Uint8Array.from([1, 2, 3])], 'IMG_0420.HEIC', { type: 'image/heic' })

/** The person picks a file in the device's picker (the button opens it; the file arrives through the input). */
async function pickOwnPhoto(file: File = ownFile()) {
  const input = fileInput()
  expect(input).not.toBeNull()
  await act(async () => {
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })
  })
}

const shownCaption = () => document.querySelector('[data-card-photo="shown"] p')?.textContent

describe('own photo: where the link has none, or there is no link', () => {
  it('a wish without a link: "Foto hinzufügen" opens the picker, the photo is prepared on the device and uploaded after saving', async () => {
    const { onSubmit } = renderForm()
    api.prepare.mockResolvedValue(OWN)
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    const add = await screen.findByRole('button', { name: /Foto hinzufügen/ })
    const click = vi.spyOn(fileInput() as HTMLInputElement, 'click').mockImplementation(() => undefined)
    fireEvent.click(add)
    expect(click).toHaveBeenCalledTimes(1)
    expect(fileInput()?.accept).toBe('image/*')
    const file = ownFile()
    await pickOwnPhoto(file)
    await waitFor(() => expect(document.querySelector('[data-card-photo="shown"] img')).not.toBeNull())
    // the same pipeline as a link picture: the picked file itself goes in, what is shown is what will be uploaded
    expect(api.prepare).toHaveBeenCalledWith(file)
    expect(shownCaption()).toBe('Dein Foto')
    expect(screen.queryByRole('button', { name: /Foto hinzufügen/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Foto ändern' })).toBeTruthy()
    expectOnlyOwnImages()
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Selbstgemachte Marmelade' } })
    await submit()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Selbstgemachte Marmelade', url: null }), { photo: { kind: 'upload', photo: OWN } })
    // nothing went to a shop or our Worker for it
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a link whose shop gives no picture: the card offers "Foto hinzufügen" next to the shop tile', async () => {
    network({ preview: { ...PREVIEW, image_url: null } })
    const { onSubmit } = renderForm()
    await pasteLink()
    const add = await screen.findByRole('button', { name: /Foto hinzufügen/ })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/link-image'))).toBe(false)
    expect(document.querySelector('[data-shop-tile]')).not.toBeNull()
    api.prepare.mockResolvedValue(OWN)
    fireEvent.click(add)
    await pickOwnPhoto()
    await waitFor(() => expect(shownCaption()).toBe('Dein Foto'))
    await submit()
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'upload', photo: OWN } })
    expectOnlyOwnApi()
  })

  it('the link picture failed: the same offer (the calm fallback is not a dead end)', async () => {
    network({ image: 'fail' })
    renderForm()
    await pasteLink()
    expect(await screen.findByRole('button', { name: /Foto hinzufügen/ })).toBeTruthy()
    expect(document.querySelector('[data-card-photo]')).toBeNull()
  })

  it('"Ändern" replaces the link picture with an own one, and a later link answer never takes it back', async () => {
    network()
    const { onSubmit } = renderForm()
    await pasteLink()
    await waitFor(() => expect(shownCaption()).toBe('Foto aus dem Shop'))
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/link-image'))).toHaveLength(1)
    api.prepare.mockResolvedValue(OWN)
    fireEvent.click(screen.getByRole('button', { name: 'Foto ändern' }))
    await pickOwnPhoto()
    await waitFor(() => expect(shownCaption()).toBe('Dein Foto'))
    // "Link neu einlesen" fills the texts again, but the picture stays the person's own: no new picture request
    fireEvent.click(screen.getByRole('button', { name: 'Link neu einlesen' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/link-preview'))).toHaveLength(2))
    await waitFor(() => expect(document.querySelector('[data-card-state="filled"]')).not.toBeNull())
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/link-image'))).toHaveLength(1)
    expect(shownCaption()).toBe('Dein Foto')
    await submit()
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'upload', photo: OWN } })
  })

  it('an own photo picked first: a link pasted afterwards does not even fetch its picture', async () => {
    network()
    const { onSubmit } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    api.prepare.mockResolvedValue(OWN)
    fireEvent.click(await screen.findByRole('button', { name: /Foto hinzufügen/ }))
    await pickOwnPhoto()
    await waitFor(() => expect(shownCaption()).toBe('Dein Foto'))
    await pasteLink()
    await waitFor(() => expect(document.querySelector('[data-card-state="filled"]')).not.toBeNull())
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/link-image'))).toBe(false)
    expect(shownCaption()).toBe('Dein Foto')
    await submit()
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'upload', photo: OWN } })
  })

  it('remove (Rückgängig brings it back) and replace: the last pick is the one saved', async () => {
    const { onSubmit } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    api.prepare.mockResolvedValue(OWN)
    fireEvent.click(await screen.findByRole('button', { name: /Foto hinzufügen/ }))
    await pickOwnPhoto()
    fireEvent.click(await screen.findByRole('button', { name: 'Foto entfernen' }))
    expect(screen.getByText('Foto entfernt')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }))
    await waitFor(() => expect(shownCaption()).toBe('Dein Foto'))
    api.prepare.mockResolvedValue(OWN_2)
    fireEvent.click(screen.getByRole('button', { name: 'Foto ändern' }))
    await pickOwnPhoto()
    await waitFor(() => expect(api.prepare).toHaveBeenCalledTimes(2))
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Ein Buch' } })
    await submit()
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'upload', photo: OWN_2 } })
  })

  it('a removed own photo of a new wish is gone for good once the link changes', async () => {
    network({ preview: { ...PREVIEW, image_url: null } })
    const { onSubmit } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    api.prepare.mockResolvedValue(OWN)
    fireEvent.click(await screen.findByRole('button', { name: /Foto hinzufügen/ }))
    await pickOwnPhoto()
    fireEvent.click(await screen.findByRole('button', { name: 'Foto entfernen' }))
    await pasteLink()
    await waitFor(() => expect(document.querySelector('[data-card-state="filled"]')).not.toBeNull())
    expect(screen.queryByText('Foto entfernt')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: /Foto hinzufügen/ })).toBeTruthy()
    await submit()
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'keep' } })
  })

  it('a file that is no photo (or too big) is refused calmly; nothing changes', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    api.prepare.mockRejectedValue(new PhotoPrepareError('too_large'))
    fireEvent.click(await screen.findByRole('button', { name: /Foto hinzufügen/ }))
    await pickOwnPhoto()
    await waitFor(() => expect(getToasts().map((item) => item.text)).toContain('Das Foto ist größer als 20 MB – nimm bitte ein kleineres.'))
    expect(document.querySelector('[data-card-photo]')).toBeNull()
    expect(screen.getByRole('button', { name: /Foto hinzufügen/ })).toBeTruthy()
  })

  it('saving waits while a picked photo is still being prepared (the card shimmers meanwhile)', async () => {
    const { onSubmit } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Ohne Link hinzufügen' }))
    let done!: (photo: PreparedPhoto) => void
    api.prepare.mockReturnValue(new Promise<PreparedPhoto>((resolve) => (done = resolve)))
    fireEvent.click(await screen.findByRole('button', { name: /Foto hinzufügen/ }))
    await pickOwnPhoto()
    expect(document.querySelector('[data-card-photo="loading"]')).not.toBeNull()
    expect(screen.getByText('Foto wird vorbereitet …')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Ein Buch' } })
    expect((screen.getByRole('button', { name: 'Wunsch hinzufügen' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => done(OWN))
    await waitFor(() => expect(shownCaption()).toBe('Dein Foto'))
    await submit()
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'upload', photo: OWN } })
  })

  it('the new wish page uploads the own photo for the created wish', async () => {
    api.getOccasionScreen.mockResolvedValue({
      occasion: {
        id: OCCASION_ID, title: 'Milas Geburtstag', starts_at: '2026-11-02T00:00:00+00:00', tz: 'Europe/Berlin', all_day: true,
        place_text: null, description: null, created_at: '2026-10-01T09:00:00+00:00', host: { id: OWNER, display_name: 'Mila' },
      },
      viewer: { role: 'host', rsvp: 'going' },
      members: [],
      invite: null,
      wishlist: { id: WISHLIST_ID, owner_id: OWNER, title: null, wishes: [] },
    })
    api.createWish.mockResolvedValue({
      id: NEW_WISH_ID, wishlist_id: WISHLIST_ID, title: 'Ein Buch', price_cents: null, currency: 'EUR', url: null,
      note: null, priority: 2, created_at: '2026-10-25T10:00:00+00:00',
    })
    api.upload.mockResolvedValue({ updated_at: '2026-10-25T10:00:01+00:00' })
    api.prepare.mockResolvedValue(OWN)
    const client = withProviders(<NewWishPage occasionId={OCCASION_ID} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ohne Link hinzufügen' }))
    fireEvent.click(await screen.findByRole('button', { name: /Foto hinzufügen/ }))
    await pickOwnPhoto()
    await waitFor(() => expect(shownCaption()).toBe('Dein Foto'))
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Ein Buch' } })
    await submit()
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith(NEW_WISH_ID, OWN, OWNER))
    expect(client.getQueryData(['wishPhoto', NEW_WISH_ID, '2026-10-25T10:00:01+00:00'])).toMatchObject({ blob: OWN.blob, width: 1200 })
  })
})

describe('edit: the stored photo', () => {
  it('"Ändern" replaces the saved photo with an own one (one upload, no delete)', async () => {
    network()
    api.getPhoto.mockResolvedValue({ mime: 'image/webp', blob: new Blob([Uint8Array.from([1])], { type: 'image/webp' }), width: 480, height: 480, updated_at: 'v1' })
    const { onSubmit } = renderForm({
      variant: 'edit',
      submitLabel: 'Speichern',
      initial: { ...EMPTY_WISH_FORM, title: 'Kaffeemühle' },
      savedPhoto: { wishId: NEW_WISH_ID, meta: { width: 480, height: 480, updated_at: 'v1' } },
    })
    await waitFor(() => expect(shownCaption()).toBe('Foto'))
    api.prepare.mockResolvedValue(OWN)
    fireEvent.click(screen.getByRole('button', { name: 'Foto ändern' }))
    await pickOwnPhoto()
    await waitFor(() => expect(shownCaption()).toBe('Dein Foto'))
    await submit('Speichern')
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'upload', photo: OWN } })
  })

  it('a wish without a stored photo offers "Foto hinzufügen" on the edit screen too', async () => {
    renderForm({
      variant: 'edit',
      submitLabel: 'Speichern',
      initial: { ...EMPTY_WISH_FORM, title: 'Kaffeemühle' },
      savedPhoto: { wishId: NEW_WISH_ID, meta: null },
    })
    expect(await screen.findByRole('button', { name: /Foto hinzufügen/ })).toBeTruthy()
    expect(api.getPhoto).not.toHaveBeenCalled()
  })

  it('shows the saved photo from our database and "Foto entfernen" deletes it on save', async () => {
    network()
    api.getPhoto.mockResolvedValue({ mime: 'image/webp', blob: new Blob([Uint8Array.from([1])], { type: 'image/webp' }), width: 480, height: 480, updated_at: 'v1' })
    const { onSubmit } = renderForm({
      variant: 'edit',
      submitLabel: 'Speichern',
      initial: { ...EMPTY_WISH_FORM, title: 'Kaffeemühle', url: PRODUCT, color: 'Buche natur', shopName: 'Küchenkontor' },
      savedPhoto: { wishId: NEW_WISH_ID, meta: { width: 480, height: 480, updated_at: 'v1' } },
    })
    await waitFor(() => expect(document.querySelector('[data-card-photo="shown"] img')).not.toBeNull())
    expect(api.getPhoto).toHaveBeenCalledWith(NEW_WISH_ID, OWNER)
    // the edit screen does not read the link again by itself: nothing goes to the Worker
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Foto entfernen' }))
    await submit('Speichern')
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ photo: { kind: 'remove' } })
    expectOnlyOwnImages()
  })
})
