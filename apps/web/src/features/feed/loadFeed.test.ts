import { QueryClient, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'

const api = vi.hoisted(() => ({ getFeed: vi.fn() }))
vi.mock('../../lib/api/occasions', () => ({ getFeed: api.getFeed, getOccasionScreen: vi.fn() }))

import { loadFeed } from './loadFeed'

const FEED: FeedScreen = { upcoming: [], past: [] }
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  api.getFeed.mockReset()
})
afterEach(() => {
  client.clear()
  onlineManager.setOnline(true)
})

describe('loadFeed (route loader of /soon)', () => {
  it('puts get_feed into the cache entry the screen reads', async () => {
    api.getFeed.mockResolvedValueOnce(FEED)
    await loadFeed(client)
    expect(client.getQueryData(qk.feed())).toEqual(FEED)
    expect(api.getFeed).toHaveBeenCalledTimes(1)
  })

  it('reuses cached data without another request', async () => {
    client.setQueryData(qk.feed(), FEED)
    await loadFeed(client)
    expect(api.getFeed).not.toHaveBeenCalled()
  })

  it('never throws: a failed request stays in the query for the inline error + retry', async () => {
    api.getFeed.mockRejectedValueOnce(new AppError('network'))
    await expect(loadFeed(client)).resolves.toBeUndefined()
    const state = client.getQueryState(qk.feed())
    expect(state?.status).toBe('error')
    expect(state?.error).toBeInstanceOf(AppError)
  })

  it('does not hang on a paused fetch when offline', async () => {
    onlineManager.setOnline(false)
    await expect(loadFeed(client)).resolves.toBeUndefined()
    expect(api.getFeed).not.toHaveBeenCalled()
  })
})
