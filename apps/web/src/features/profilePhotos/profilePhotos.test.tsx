import type { ReactNode } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import type { ListsOverview } from '../../lib/api/lists.types'
import type { ProfilePhotoMeta } from '../../lib/api/types'
import { FeatureUnavailableError } from '../../lib/api/unavailable'
import { AppError } from '../../lib/errors'
import { getToasts, toast } from '../../lib/toast'

// A person's own profile / banner photo in jsdom (20261024120000): the avatar with and without a photo (lazy, from OUR
// database only, the initials stay underneath), the avatar sheet (photo / initials), the banner sheet's "Eigenes Foto"
// above the presets, my change shown at once and rolled back on a refusal, and the calm "Das geht bald" of a server
// without the migration.

const api = vi.hoisted(() => ({
  getProfilePhoto: vi.fn(),
  uploadProfilePhoto: vi.fn(),
  deleteProfilePhoto: vi.fn(),
  setMyBanner: vi.fn(),
  preparePhoto: vi.fn<(file: Blob, deps?: unknown, options?: unknown) => Promise<unknown>>(),
}))
vi.mock('../../lib/api/profilePhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/profilePhotos')>()),
  getProfilePhoto: api.getProfilePhoto,
  uploadProfilePhoto: api.uploadProfilePhoto,
  deleteProfilePhoto: api.deleteProfilePhoto,
}))
vi.mock('../../lib/api/lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/lists')>()),
  setMyBanner: api.setMyBanner,
}))
// the sheets load the pipeline lazily; here it hands back a prepared photo (no canvas in jsdom)
vi.mock('../occasions/photo/pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../occasions/photo/pipeline')>()),
  preparePhoto: api.preparePhoto,
}))

import { ProfileAvatar } from '../nav/ProfileAvatar'
import { resetWishPhotoQueueForTests } from '../wishes/wishPhotos'
import BannerSheet from '../lists/BannerSheet'
import { BannerArt } from '../lists/banners'
import AvatarSheet from './AvatarSheet'
import { AvatarPhoto, BannerPhoto } from './PersonPhoto'
import { resetOwnPhotoChangesForTests } from './photos'

const ME = '00000000-0000-4000-8000-0000000000aa'
const FRIEND = '00000000-0000-4000-8000-0000000000bb'
const META: ProfilePhotoMeta = { width: 512, height: 512, updated_at: '2026-10-24T10:00:00.000Z' }
const BANNER_META: ProfilePhotoMeta = { width: 1600, height: 640, updated_at: '2026-10-24T10:00:00.000Z' }

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
}

function renderWith(ui: ReactNode, queryClient: QueryClient = client()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </QueryClientProvider>
  )
  return { queryClient, ...render(<>{ui}</>, { wrapper }) }
}

const photoAnswer = (meta: ProfilePhotoMeta, bytes = 'photo') => ({ mime: 'image/webp', blob: new Blob([bytes], { type: 'image/webp' }), ...meta })
const prepared = (width = 512, height = 512) => ({
  mime: 'image/webp', bytes: new Uint8Array([1, 2, 3]), blob: new Blob(['picked'], { type: 'image/webp' }), width, height,
})
const toastTexts = () => getToasts().map((item) => item.text)
const fileInput = () => {
  const input = document.querySelector<HTMLInputElement>('input.pph-file')
  if (!input) throw new Error('file input missing')
  return input
}
const pick = (input: HTMLInputElement) => fireEvent.change(input, { target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] } })

let originalCreate: typeof URL.createObjectURL
let originalRevoke: typeof URL.revokeObjectURL

beforeEach(() => {
  setRenderedAccount(ME)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  // no IntersectionObserver → every picture counts as on screen at once (inView.ts)
  vi.stubGlobal('IntersectionObserver', undefined)
  originalCreate = URL.createObjectURL
  originalRevoke = URL.revokeObjectURL
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/photo-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
  toast.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  resetOwnPhotoChangesForTests()
  resetWishPhotoQueueForTests()
  resetAccountBoundaryForTests()
  toast.clear()
})

describe('a person with and without a photo', () => {
  it('without a photo: the initials only — nothing is asked', () => {
    const { container } = renderWith(
      <ProfileAvatar seed={FRIEND} name="Anna Beispiel" size={44}>
        <AvatarPhoto profileId={FRIEND} meta={null} />
      </ProfileAvatar>,
    )
    expect(container.textContent).toBe('AB')
    expect(container.querySelector('img')).toBeNull()
    expect(api.getProfilePhoto).not.toHaveBeenCalled()
  })

  it('with a photo: asked once for its version; the photo lies over the initials (object URL, decorative)', async () => {
    api.getProfilePhoto.mockResolvedValue(photoAnswer(META))
    const { container } = renderWith(
      <ProfileAvatar seed={FRIEND} name="Anna Beispiel" size={44}>
        <AvatarPhoto profileId={FRIEND} meta={META} />
      </ProfileAvatar>,
    )
    const img = await waitFor(() => {
      const found = container.querySelector('img')
      expect(found).not.toBeNull()
      return found!
    })
    expect(img.getAttribute('src')).toMatch(/^blob:/)
    expect(img.getAttribute('alt')).toBe('')
    expect(container.textContent).toBe('AB') // the initials stay underneath: nothing moves
    expect(api.getProfilePhoto).toHaveBeenCalledTimes(1)
    expect(api.getProfilePhoto).toHaveBeenCalledWith(FRIEND, 'avatar', ME)
  })

  it('no access any more (not_found): the initials stay, no retry', async () => {
    api.getProfilePhoto.mockRejectedValue(new AppError('not_found'))
    const { container } = renderWith(
      <ProfileAvatar seed={FRIEND} name="Anna Beispiel" size={44}>
        <AvatarPhoto profileId={FRIEND} meta={META} />
      </ProfileAvatar>,
    )
    await waitFor(() => expect(container.querySelector('[data-photo-state="unavailable"]')).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
    expect(api.getProfilePhoto).toHaveBeenCalledTimes(1)
  })

  it('a banner photo lies over the preset banner, under the banner\'s own buttons', async () => {
    api.getProfilePhoto.mockResolvedValue(photoAnswer(BANNER_META, 'banner'))
    const { container } = renderWith(
      <BannerArt banner="sky" photo={<BannerPhoto profileId={FRIEND} meta={BANNER_META} eager />}>
        <button type="button">Banner ändern</button>
      </BannerArt>,
    )
    await waitFor(() => expect(container.querySelector('[data-profile-photo="banner"] img')).not.toBeNull())
    expect(api.getProfilePhoto).toHaveBeenCalledWith(FRIEND, 'banner', ME)
    const children = [...container.querySelector('.lb-banner')!.children].map((el) => el.getAttribute('data-banner') ?? el.getAttribute('data-profile-photo') ?? el.tagName)
    expect(children).toEqual(['sky', 'banner', 'BUTTON'])
  })
})

describe('the avatar sheet', () => {
  it('photo or initials; with a stored photo "Foto" is chosen; "Initialen" + Übernehmen removes it at once (optimistic)', async () => {
    api.getProfilePhoto.mockResolvedValue(photoAnswer(META))
    let finish: () => void = () => undefined
    api.deleteProfilePhoto.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const onClose = vi.fn()
    const { container } = renderWith(
      <>
        <ProfileAvatar seed={ME} name="Mila Sommer" size={88}>
          <AvatarPhoto profileId={ME} meta={META} eager />
        </ProfileAvatar>
        <AvatarSheet open onClose={onClose} userId={ME} name="Mila Sommer" photo={META} supported />
      </>,
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Foto/ }).getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).getByRole('radio', { name: /Initialen/ }).getAttribute('aria-checked')).toBe('false')
    expect(within(dialog).getByText(/Dein Foto sehen nur Menschen, die dein Profil sehen/)).toBeTruthy()
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    fireEvent.click(within(dialog).getByRole('radio', { name: /Initialen/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
    expect(onClose).toHaveBeenCalled()
    expect(api.deleteProfilePhoto).toHaveBeenCalledWith('avatar', ME)
    // the header's avatar shows the initials at once (the photo fades out), before the server answered
    await waitFor(() => expect(container.querySelector('.tile [data-profile-photo] img')).toBeNull())
    await act(async () => finish())
    await waitFor(() => expect(toastTexts()).toContain('Wieder mit Initialen'))
  })

  it('a new photo: made small on the device as a 512 px square, shown at once everywhere, then saved', async () => {
    api.preparePhoto.mockResolvedValue(prepared())
    api.uploadProfilePhoto.mockResolvedValue({ updated_at: '2026-10-24T11:00:00.000Z' })
    renderWith(
      <>
        <span data-testid="header">
          <ProfileAvatar seed={ME} name="Mila Sommer" size={88}>
            <AvatarPhoto profileId={ME} meta={null} eager />
          </ProfileAvatar>
        </span>
        <AvatarSheet open onClose={() => undefined} userId={ME} name="Mila Sommer" photo={null} supported />
      </>,
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Initialen/ }).getAttribute('aria-checked')).toBe('true')
    pick(fileInput())
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /Foto/ }).getAttribute('aria-checked')).toBe('true'))
    expect(api.preparePhoto).toHaveBeenCalledWith(expect.any(File), expect.anything(), { square: true, maxSide: 512 })
    // the picked photo is only a preview until "Übernehmen"
    expect(api.uploadProfilePhoto).not.toHaveBeenCalled()
    expect(screen.getByTestId('header').querySelector('img')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(screen.getByTestId('header').querySelector('img')).not.toBeNull())
    expect(api.uploadProfilePhoto).toHaveBeenCalledWith('avatar', expect.objectContaining({ width: 512, height: 512 }), ME)
    await waitFor(() => expect(toastTexts()).toContain('Profilbild gespeichert'))
    // confirmed: the header keeps the photo (now the stored version, seeded in the cache — nothing is downloaded)
    expect(screen.getByTestId('header').querySelector('img')).not.toBeNull()
    expect(api.getProfilePhoto).not.toHaveBeenCalled()
  })

  it('a refusal brings the old picture back and says why; a server without the migration says "Das geht bald"', async () => {
    api.preparePhoto.mockResolvedValue(prepared())
    api.uploadProfilePhoto.mockRejectedValue(new FeatureUnavailableError('profile_photos'))
    renderWith(
      <>
        <span data-testid="header">
          <ProfileAvatar seed={ME} name="Mila Sommer" size={88}>
            <AvatarPhoto profileId={ME} meta={null} eager />
          </ProfileAvatar>
        </span>
        <AvatarSheet open onClose={() => undefined} userId={ME} name="Mila Sommer" photo={null} supported />
      </>,
    )
    const dialog = await screen.findByRole('dialog')
    pick(fileInput())
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /Foto/ }).getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(toastTexts()).toContain('Eigene Fotos kommen bald – noch nicht freigeschaltet.'))
    await waitFor(() => expect(screen.getByTestId('header').querySelector('img')).toBeNull())
  })

  it('a server without profile photos: the photo choice says so, opens no picker and sends nothing', async () => {
    renderWith(<AvatarSheet open onClose={() => undefined} userId={ME} name="Mila Sommer" photo={undefined} supported={false} />)
    const dialog = await screen.findByRole('dialog')
    const photo = within(dialog).getByRole('radio', { name: /Foto/ })
    expect(photo.getAttribute('aria-disabled')).toBe('true')
    expect(photo.textContent).toContain('Eigene Fotos kommen bald')
    const click = vi.spyOn(fileInput(), 'click')
    fireEvent.click(photo)
    expect(click).not.toHaveBeenCalled()
    expect(toastTexts()).toContain('Eigene Fotos kommen bald – noch nicht freigeschaltet.')
    expect(api.uploadProfilePhoto).not.toHaveBeenCalled()
  })
})

describe('the banner sheet: "Eigenes Foto" above the presets', () => {
  const overview = (): ListsOverview => ({
    me: { id: ME, display_name: 'Mila Sommer', banner: 'sky', live_links: 0, photo: null, banner_photo: BANNER_META },
    stats: { my_wishes: 0, my_lists: 0, friends_lists: 0, followers: 0, following: 0, requests: 0 },
    my_lists: [], following: [], upcoming: [], suggestions: [],
  })

  it('the own photo comes first, the eight presets stay; a stored banner photo is the current choice', async () => {
    api.getProfilePhoto.mockResolvedValue(photoAnswer(BANNER_META, 'banner'))
    renderWith(<BannerSheet open onClose={() => undefined} userId={ME} name="Mila" current="sky" photo={BANNER_META} photosSupported />)
    const dialog = await screen.findByRole('dialog')
    const groups = within(dialog).getAllByRole('radiogroup').map((group) => group.getAttribute('aria-label'))
    expect(groups).toEqual(['Eigenes Foto', 'Verläufe', 'Muster'])
    expect(within(dialog).getAllByRole('radio')).toHaveLength(9)
    expect(within(dialog).getByRole('radio', { name: 'Mein Foto' }).getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).getByRole('radio', { name: 'Himmel' }).getAttribute('aria-checked')).toBe('false')
    expect(within(dialog).getByRole('button', { name: 'Anderes Foto' })).toBeTruthy()
  })

  it('a preset over my banner photo: the preset is saved and the photo removed (one toast)', async () => {
    api.getProfilePhoto.mockResolvedValue(photoAnswer(BANNER_META, 'banner'))
    api.setMyBanner.mockResolvedValue(undefined)
    api.deleteProfilePhoto.mockResolvedValue(undefined)
    const queryClient = client()
    queryClient.setQueryData(['lists'], overview())
    renderWith(<BannerSheet open onClose={() => undefined} userId={ME} name="Mila" current="sky" photo={BANNER_META} photosSupported />, queryClient)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Wiese' }))
    expect(within(dialog).getByRole('radio', { name: 'Mein Foto' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(toastTexts()).toContain('Banner gespeichert'))
    expect(api.setMyBanner).toHaveBeenCalledWith('meadow', ME)
    expect(api.deleteProfilePhoto).toHaveBeenCalledWith('banner', ME)
    expect(queryClient.getQueryData<ListsOverview>(['lists'])?.me).toMatchObject({ banner: 'meadow', banner_photo: null })
    expect(toastTexts().filter((text) => text === 'Banner gespeichert')).toHaveLength(1)
  })

  it('my own photo: picked, kept whole (no square), uploaded as the banner; the preset is not touched', async () => {
    api.preparePhoto.mockResolvedValue(prepared(1600, 900))
    api.uploadProfilePhoto.mockResolvedValue({ updated_at: '2026-10-24T11:00:00.000Z' })
    const queryClient = client()
    queryClient.setQueryData(['lists'], { ...overview(), me: { ...overview().me, banner_photo: null } })
    renderWith(<BannerSheet open onClose={() => undefined} userId={ME} name="Mila" current="sky" photo={null} photosSupported />, queryClient)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: 'Foto wählen' }).getAttribute('aria-checked')).toBe('false')
    pick(fileInput())
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Mein Foto' }).getAttribute('aria-checked')).toBe('true'))
    expect(api.preparePhoto).toHaveBeenCalledWith(expect.any(File), expect.anything(), {})
    fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(toastTexts()).toContain('Banner gespeichert'))
    expect(api.uploadProfilePhoto).toHaveBeenCalledWith('banner', expect.objectContaining({ width: 1600, height: 900 }), ME)
    expect(api.setMyBanner).not.toHaveBeenCalled()
    expect(queryClient.getQueryData<ListsOverview>(['lists'])?.me.banner_photo).toEqual({ width: 1600, height: 900, updated_at: '2026-10-24T11:00:00.000Z' })
  })

  it('a server without profile photos: "Das geht bald" under the own photo, presets still work', async () => {
    api.setMyBanner.mockResolvedValue(undefined)
    renderWith(<BannerSheet open onClose={() => undefined} userId={ME} name="Mila" current="sky" photosSupported={false} />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Eigene Fotos kommen bald – noch nicht freigeschaltet.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Foto wählen' }))
    expect(within(dialog).getByRole('radio', { name: 'Himmel' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Beere' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
    await waitFor(() => expect(api.setMyBanner).toHaveBeenCalledWith('berry', ME))
    expect(api.uploadProfilePhoto).not.toHaveBeenCalled()
    expect(api.deleteProfilePhoto).not.toHaveBeenCalled()
  })
})
