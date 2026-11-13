import { useState } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionPhotoMeta } from '../../../lib/api/types'
import { HOST_ID, OCCASION_ID, renderWithClient } from '../test-utils'

const pipeline = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('../photo/pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../photo/pipeline')>()),
  preparePhoto: pipeline.prepare,
}))
const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../../lib/api/photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/photos')>()),
  getOccasionPhoto: api.get,
}))

import { COVER_ASPECT_RATIO } from '../photo/coverGeometry'
import { PhotoPrepareError, type PreparedPhoto } from '../photo/pipeline'
import { resetPhotoUploadsForTests, startPhotoJob } from '../photo/uploads'
import { PhotoField, type PhotoChoice } from './PhotoField'

// The cover photo row of the occasion form: empty → picked (preview, replace, remove) → removed (undo),
// calm refusals, the preparing state, and a change of this occasion that is still on its way.

const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])
const prepared: PreparedPhoto = { mime: 'image/jpeg', bytes, blob: new Blob([bytes.slice().buffer], { type: 'image/jpeg' }), width: 1600, height: 1067 }
const STORED: OccasionPhotoMeta = { width: 1200, height: 800, updated_at: 'v1' }

function Harness({ initial, stored = null, onChange, onBusy }: {
  initial: PhotoChoice
  stored?: OccasionPhotoMeta | null
  onChange?: (next: PhotoChoice) => void
  onBusy?: (busy: boolean) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <PhotoField
      id="photo"
      value={value}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
      occasionId={OCCASION_ID}
      userId={HOST_ID}
      stored={stored}
      onBusyChange={onBusy}
    />
  )
}

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!
const pickFile = (file = new File([new Uint8Array(8)], 'IMG_1.jpg', { type: 'image/jpeg' })) =>
  act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } })
  })

beforeEach(() => {
  vi.clearAllMocks()
  resetPhotoUploadsForTests()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
  api.get.mockReturnValue(new Promise(() => {}))
})
afterEach(() => vi.restoreAllMocks())

describe('the cover photo row', () => {
  it('empty: "Foto hinzufügen" opens the system picker for images; the hint about people is always there', () => {
    renderWithClient(<Harness initial={{ kind: 'keep' }} />)
    const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Foto hinzufügen' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(fileInput().accept).toBe('image/*')
    expect(screen.getByText('Nur Fotos, die du teilen darfst. Sind Menschen darauf, frag sie vorher.')).toBeTruthy()
  })

  it('a picked file is prepared on the device and shown with "Ersetzen" / "Entfernen"', async () => {
    pipeline.prepare.mockResolvedValueOnce(prepared)
    const onChange = vi.fn()
    const onBusy = vi.fn()
    renderWithClient(<Harness initial={{ kind: 'keep' }} onChange={onChange} onBusy={onBusy} />)
    await pickFile()
    expect(onChange).toHaveBeenCalledWith({ kind: 'picked', photo: prepared })
    expect(onBusy).toHaveBeenCalledWith(true)
    expect(onBusy).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('img', { name: 'Vorschau des Titelfotos' }).getAttribute('src')).toBe('blob:preview')
    // the preview cuts the photo exactly like the occasion's hero will (one value: coverGeometry.ts)
    const frame = screen.getByRole('img', { name: 'Vorschau des Titelfotos' }).closest<HTMLElement>('.of-photo-frame')
    expect(frame?.style.getPropertyValue('--of-photo-ratio')).toBe(COVER_ASPECT_RATIO)
    expect(screen.getByText('Neu – wird mit dem Anlass gespeichert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ersetzen' })).toBeTruthy()
    // "Entfernen" of a new photo without a stored one: back to no photo
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'keep' })
    expect(screen.getByRole('button', { name: 'Foto hinzufügen' })).toBeTruthy()
  })

  it('while preparing it says so (and the form waits)', async () => {
    let finish: (photo: PreparedPhoto) => void = () => {}
    pipeline.prepare.mockReturnValueOnce(new Promise<PreparedPhoto>((resolve) => { finish = resolve }))
    renderWithClient(<Harness initial={{ kind: 'keep' }} />)
    await pickFile()
    expect(screen.getByText('Foto wird vorbereitet …')).toBeTruthy()
    await act(async () => finish(prepared))
    expect(screen.queryByText('Foto wird vorbereitet …')).toBeNull()
  })

  it('not an image / over 20 MB: a calm line, the previous choice stays', async () => {
    const onChange = vi.fn()
    renderWithClient(<Harness initial={{ kind: 'picked', photo: prepared }} onChange={onChange} />)
    pipeline.prepare.mockRejectedValueOnce(new PhotoPrepareError('not_image'))
    await pickFile(new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' }))
    expect(screen.getByText('Das können wir nicht als Foto öffnen. Nimm ein JPG, PNG oder WebP.')).toBeTruthy()
    pipeline.prepare.mockRejectedValueOnce(new PhotoPrepareError('too_large'))
    await pickFile()
    expect(screen.getByText('Das Foto ist größer als 20 MB – nimm bitte ein kleineres.')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ersetzen' })).toBeTruthy() // still the picked photo
  })

  it('edit: the stored cover shows; "Entfernen" marks it for removal, "Rückgängig" keeps it', async () => {
    api.get.mockResolvedValueOnce({ mime: 'image/webp', blob: new Blob(['x'], { type: 'image/webp' }), width: 1200, height: 800, updated_at: 'v1' })
    const onChange = vi.fn()
    renderWithClient(<Harness initial={{ kind: 'keep' }} stored={STORED} onChange={onChange} />)
    await waitFor(() => expect(screen.getByRole('img', { name: 'Vorschau des Titelfotos' })).toBeTruthy())
    expect(api.get).toHaveBeenCalledWith(OCCASION_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'remove' })
    expect(screen.getByText('Titelfoto wird entfernt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'keep' })
  })

  it('a change of this occasion on its way shows read-only: "Foto wird hochgeladen …", no controls', async () => {
    const { client } = renderWithClient(<Harness initial={{ kind: 'keep' }} stored={STORED} />)
    const photos = await import('../../../lib/api/photos')
    vi.spyOn(photos, 'setOccasionPhoto').mockReturnValue(new Promise(() => {}))
    await act(async () => {
      void startPhotoJob(HOST_ID, OCCASION_ID, { kind: 'upload', photo: prepared }, client)
    })
    expect(screen.getByText('Foto wird hochgeladen …')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ersetzen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull()
  })
})
