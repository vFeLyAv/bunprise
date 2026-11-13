import type { ReactNode } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { deferred, HOST_ID, hostScreen, makeQueryClient, OCCASION_ID, renderWithClient } from './test-utils'

// The cover photo through the whole form (wave 2): it is uploaded only after the server confirmed the
// occasion (create or edit), a failed save keeps it with the draft, and nothing about the photo is sent
// when the person did not touch it.

const nav = vi.hoisted(() => ({ navigate: vi.fn(), back: vi.fn(), pathname: '/occasions/new' }))
const api = vi.hoisted(() => ({
  createOccasion: vi.fn(), newOccasionId: vi.fn(), updateOccasion: vi.fn(), deleteOccasion: vi.fn(),
  leaveOccasion: vi.fn(), removeMember: vi.fn(), setRsvp: vi.fn(), getOccasionScreen: vi.fn(), getFeed: vi.fn(),
}))
const photoApi = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn(), get: vi.fn() }))
const pipeline = vi.hoisted(() => ({ prepare: vi.fn() }))

vi.mock('@tanstack/react-router', () => {
  const Link = ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>
  return {
    useRouter: () => ({ navigate: nav.navigate, history: { back: nav.back }, state: { location: { get pathname() { return nav.pathname }, search: {} } } }),
    useCanGoBack: () => true,
    Link,
    createLink: () => Link,
  }
})
vi.mock('../../lib/api/occasions', () => api)
vi.mock('../../lib/api/photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/photos')>()),
  setOccasionPhoto: photoApi.set,
  removeOccasionPhoto: photoApi.remove,
  getOccasionPhoto: photoApi.get,
}))
vi.mock('./photo/pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./photo/pipeline')>()),
  preparePhoto: pipeline.prepare,
}))
vi.mock('../../lib/api/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/places')>()),
  searchPlaces: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))

import { EditOccasionPage } from './EditOccasionPage'
import { NewOccasionPage } from './NewOccasionPage'
import type { PreparedPhoto } from './photo/pipeline'
import { peekPhotoJob, resetPhotoUploadsForTests } from './photo/uploads'
import { peekDraft, resetSavingForTests } from './saving'

const NEW_ID = '77777777-7777-4777-8777-777777777777'
const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])
const prepared: PreparedPhoto = { mime: 'image/jpeg', bytes, blob: new Blob([bytes.slice().buffer], { type: 'image/jpeg' }), width: 1600, height: 1067 }

const saveButton = () => screen.getByRole('button', { name: /Speichern/ })
async function pickPhoto() {
  pipeline.prepare.mockResolvedValueOnce(prepared)
  await act(async () => {
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([new Uint8Array(4)], 'IMG.jpg', { type: 'image/jpeg' })] } })
  })
  await screen.findByRole('button', { name: 'Ersetzen' })
}
function fillNewForm() {
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Milas Gartenfest' } })
  fireEvent.click(screen.getByRole('button', { name: /^Datum/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Morgen' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSavingForTests()
  resetPhotoUploadsForTests()
  nav.pathname = '/occasions/new'
  nav.navigate.mockResolvedValue(undefined)
  api.newOccasionId.mockReturnValue(NEW_ID)
  api.getOccasionScreen.mockReturnValue(new Promise(() => {}))
  api.getFeed.mockReturnValue(new Promise(() => {}))
  photoApi.set.mockResolvedValue({ updated_at: 'v9' })
  photoApi.remove.mockResolvedValue(undefined)
  photoApi.get.mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('new occasion with a cover photo', () => {
  it('uploads the photo only after the server confirmed the occasion, for the same client id and account', async () => {
    const created = deferred<{ occasionId: string }>()
    api.createOccasion.mockReturnValueOnce(created.promise)
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    fillNewForm()
    await pickPhoto()
    fireEvent.click(saveButton())
    await waitFor(() => expect(api.createOccasion).toHaveBeenCalledTimes(1))
    expect(photoApi.set).not.toHaveBeenCalled() // the occasion does not exist yet
    await act(async () => created.resolve({ occasionId: NEW_ID }))
    await waitFor(() => expect(photoApi.set).toHaveBeenCalledWith(NEW_ID, prepared, HOST_ID))
  })

  it('a failed create sends no photo and keeps it: the reopened form has it again', async () => {
    api.createOccasion.mockRejectedValueOnce(new AppError('generic'))
    const first = renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    fillNewForm()
    await pickPhoto()
    fireEvent.click(saveButton())
    // the failed save keeps its values for the form (../saving.ts) — and the photo next to them
    await waitFor(() => expect(peekDraft(HOST_ID, 'new')?.id).toBe(NEW_ID))
    expect(photoApi.set).not.toHaveBeenCalled()
    first.unmount()
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    expect(await screen.findByRole('button', { name: 'Ersetzen' })).toBeTruthy()
    expect(screen.getByText('Neu – wird mit dem Anlass gespeichert')).toBeTruthy()
  })

  it('without a photo nothing about photos is sent', async () => {
    api.createOccasion.mockResolvedValueOnce({ occasionId: NEW_ID })
    renderWithClient(<NewOccasionPage userId={HOST_ID} />)
    fillNewForm()
    fireEvent.click(saveButton())
    await waitFor(() => expect(api.createOccasion).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(photoApi.set).not.toHaveBeenCalled()
    expect(peekPhotoJob(HOST_ID, NEW_ID)).toBeUndefined()
  })
})

describe('edit with a cover photo', () => {
  function renderEdit(screenData: OccasionScreen) {
    nav.pathname = `/occasions/${OCCASION_ID}/edit`
    const client = makeQueryClient()
    client.setQueryData(qk.occasion(OCCASION_ID), screenData)
    return renderWithClient(<EditOccasionPage occasionId={OCCASION_ID} userId={HOST_ID} />, client)
  }

  it('a new photo goes after the update was confirmed', async () => {
    const updated = deferred<unknown>()
    api.updateOccasion.mockReturnValueOnce(updated.promise)
    renderEdit(hostScreen())
    await pickPhoto()
    fireEvent.click(saveButton())
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    expect(photoApi.set).not.toHaveBeenCalled()
    await act(async () => updated.resolve(hostScreen().occasion))
    await waitFor(() => expect(photoApi.set).toHaveBeenCalledWith(OCCASION_ID, prepared, HOST_ID))
  })

  it('removing the stored cover sends the removal after the update', async () => {
    api.updateOccasion.mockResolvedValueOnce(hostScreen().occasion)
    renderEdit({ ...hostScreen(), occasion: { ...hostScreen().occasion, photo: { width: 1200, height: 800, updated_at: 'v1' } } })
    fireEvent.click(await screen.findByRole('button', { name: 'Entfernen' }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(photoApi.remove).toHaveBeenCalledWith(OCCASION_ID, HOST_ID))
    expect(photoApi.set).not.toHaveBeenCalled()
  })

  it('an untouched cover is left alone', async () => {
    api.updateOccasion.mockResolvedValueOnce(hostScreen().occasion)
    renderEdit({ ...hostScreen(), occasion: { ...hostScreen().occasion, photo: { width: 1200, height: 800, updated_at: 'v1' } } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(photoApi.set).not.toHaveBeenCalled()
    expect(photoApi.remove).not.toHaveBeenCalled()
  })
})
