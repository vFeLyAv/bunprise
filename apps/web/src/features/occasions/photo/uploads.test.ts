import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { OccasionScreen } from '../../../lib/api/types'
import { AppError } from '../../../lib/errors'
import { qk } from '../../../lib/queryKeys'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../../lib/accountBoundary'
import { hostScreen, HOST_ID, OCCASION_ID } from '../test-utils'

const api = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn() }))
vi.mock('../../../lib/api/photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/photos')>()),
  setOccasionPhoto: api.set,
  removeOccasionPhoto: api.remove,
}))

import { photoQueryKey } from './queries'
import {
  clearPhotoDraftOf,
  discardPhotoJob,
  keepPhotoDraft,
  peekPhotoDraft,
  peekPhotoJob,
  resetPhotoUploadsForTests,
  retryPhotoJob,
  startPhotoJob,
  type PhotoChange,
} from './uploads'
import type { PreparedPhoto } from './pipeline'

// The cover change after a save (memory only): what the screen and the cache know at each step.

const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])
const photo: PreparedPhoto = { mime: 'image/jpeg', bytes, blob: new Blob([bytes.slice().buffer], { type: 'image/jpeg' }), width: 1600, height: 900 }
const upload: PhotoChange = { kind: 'upload', photo }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  resetPhotoUploadsForTests()
  resetAccountBoundaryForTests()
  setRenderedAccount(HOST_ID)
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  client.setQueryData(qk.occasion(OCCASION_ID), hostScreen())
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
})

describe('an upload after the save', () => {
  it('is visible as "sending" at once; success seeds the photo cache under the new version and the screen meta', async () => {
    const answer = deferred<{ updated_at: string }>()
    api.set.mockReturnValueOnce(answer.promise)
    const sent = startPhotoJob(HOST_ID, OCCASION_ID, upload, client)
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toMatchObject({ status: 'sending', change: upload })
    expect(api.set).toHaveBeenCalledWith(OCCASION_ID, photo, HOST_ID) // pinned to the account
    answer.resolve({ updated_at: 'v2' })
    await sent
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toBeUndefined()
    expect(client.getQueryData(photoQueryKey(OCCASION_ID, 'v2'))).toEqual({ mime: 'image/jpeg', blob: photo.blob, width: 1600, height: 900, updated_at: 'v2' })
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.photo).toEqual({ width: 1600, height: 900, updated_at: 'v2' })
  })

  it('offline: the job waits and goes again when the browser is back online', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    api.set.mockRejectedValueOnce(new AppError('network'))
    await startPhotoJob(HOST_ID, OCCASION_ID, upload, client)
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toMatchObject({ status: 'offline' })
    api.set.mockResolvedValueOnce({ updated_at: 'v3' })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toBeUndefined())
    expect(api.set).toHaveBeenCalledTimes(2)
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.photo?.updated_at).toBe('v3')
  })

  it('a network failure while online can be retried without an online event', async () => {
    api.set.mockRejectedValueOnce(new AppError('network'))
    await startPhotoJob(HOST_ID, OCCASION_ID, upload, client)
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toMatchObject({ status: 'failed', error: { code: 'network' } })
    api.set.mockResolvedValueOnce({ updated_at: 'recovered' })
    await retryPhotoJob(HOST_ID, OCCASION_ID, client)
    expect(api.set).toHaveBeenCalledTimes(2)
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toBeUndefined()
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.photo?.updated_at).toBe('recovered')
  })

  it('another failure: "failed" with the error, "Nochmal" sends it again, "Verwerfen" forgets it', async () => {
    api.set.mockRejectedValueOnce(new AppError('generic'))
    await startPhotoJob(HOST_ID, OCCASION_ID, upload, client)
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toMatchObject({ status: 'failed', error: { code: 'generic' } })
    api.set.mockRejectedValueOnce(new AppError('generic'))
    await retryPhotoJob(HOST_ID, OCCASION_ID, client)
    expect(api.set).toHaveBeenCalledTimes(2)
    discardPhotoJob(HOST_ID, OCCASION_ID)
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toBeUndefined()
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.photo).toBeUndefined() // untouched
  })

  it('not_found (the occasion is gone): the job just ends', async () => {
    api.set.mockRejectedValueOnce(new AppError('not_found'))
    await startPhotoJob(HOST_ID, OCCASION_ID, upload, client)
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toBeUndefined()
  })

  it('a removal clears the screen meta', async () => {
    client.setQueryData(qk.occasion(OCCASION_ID), hostScreen({ occasion: { ...hostScreen().occasion, photo: { width: 1, height: 1, updated_at: 'v1' } } }))
    api.remove.mockResolvedValueOnce(undefined)
    await startPhotoJob(HOST_ID, OCCASION_ID, { kind: 'remove' }, client)
    expect(api.remove).toHaveBeenCalledWith(OCCASION_ID, HOST_ID)
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.photo).toBeNull()
  })
})

describe('the account boundary', () => {
  it('an answer that arrives after the account ended writes nothing (no cache, no job state)', async () => {
    const answer = deferred<{ updated_at: string }>()
    api.set.mockReturnValueOnce(answer.promise)
    const sent = startPhotoJob(HOST_ID, OCCASION_ID, upload, client)
    endAccountEpoch()
    answer.resolve({ updated_at: 'late' })
    await sent
    expect(client.getQueryData(photoQueryKey(OCCASION_ID, 'late'))).toBeUndefined()
    expect(client.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.photo).toBeUndefined()
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toBeUndefined() // forgotten with the account
  })

  it('jobs and drafts are forgotten when the account ends', async () => {
    api.set.mockRejectedValueOnce(new AppError('generic'))
    await startPhotoJob(HOST_ID, OCCASION_ID, upload, client)
    keepPhotoDraft(HOST_ID, 'new', { occasionId: OCCASION_ID, change: upload })
    endAccountEpoch()
    expect(peekPhotoJob(HOST_ID, OCCASION_ID)).toBeUndefined()
    expect(peekPhotoDraft(HOST_ID, 'new')).toBeUndefined()
  })

  it('a change for another account than the one the tab shows is not sent', async () => {
    await startPhotoJob('someone-else', OCCASION_ID, upload, client)
    expect(api.set).not.toHaveBeenCalled()
  })
})

describe('drafts of a save on its way', () => {
  it('belong to one occasion: a later form does not clear another one', () => {
    keepPhotoDraft(HOST_ID, 'new', { occasionId: 'first', change: upload })
    clearPhotoDraftOf(HOST_ID, 'new', 'second')
    expect(peekPhotoDraft(HOST_ID, 'new')?.occasionId).toBe('first')
    clearPhotoDraftOf(HOST_ID, 'new', 'first')
    expect(peekPhotoDraft(HOST_ID, 'new')).toBeUndefined()
  })
})
