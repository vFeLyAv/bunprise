import { describe, expect, it } from 'vitest'
import type { FeedOccasion, FeedScreen } from '../../lib/api/types'
import { wishCandidates, wishTarget } from './occasionPicker'

function occasion(id: string, role: FeedOccasion['role'], days = 3): FeedOccasion {
  return {
    id,
    title: `Anlass ${id}`,
    starts_at: new Date(Date.UTC(2026, 9, 20 + days, 16)).toISOString(),
    tz: 'Europe/Berlin',
    all_day: false,
    place_text: null,
    role,
    rsvp: role === 'host' ? 'going' : 'none',
    host_name: role === 'host' ? 'Mila' : 'Anna',
    member_count: 1,
    wish_count: 0,
    my_reservation_count: role === 'host' ? null : 0,
  }
}

const feed = (upcoming: FeedOccasion[], past: FeedOccasion[] = []): FeedScreen => ({ upcoming, past })

describe('"Wunsch hinzufügen": which wishlist', () => {
  it('waits while the feed is not there yet', () => {
    expect(wishTarget(undefined)).toEqual({ kind: 'loading' })
  })

  it('0 occasions I host → "create an occasion first" (guests cannot add to someone else’s list)', () => {
    expect(wishTarget(feed([]))).toEqual({ kind: 'none' })
    expect(wishTarget(feed([occasion('a', 'member'), occasion('b', 'member')]))).toEqual({ kind: 'none' })
  })

  it('exactly one → straight to its wish form', () => {
    const mine = occasion('mine', 'host')
    expect(wishTarget(feed([occasion('guest', 'member'), mine]))).toEqual({ kind: 'one', occasion: mine })
  })

  it('several → the picker, in the feed order (ascending start)', () => {
    const first = occasion('first', 'host', 2)
    const second = occasion('second', 'host', 9)
    const target = wishTarget(feed([first, occasion('guest', 'member', 5), second]))
    expect(target.kind).toBe('many')
    expect(target.kind === 'many' ? target.occasions.map((item) => item.id) : []).toEqual(['first', 'second'])
  })

  it('never offers a past occasion and lists every occasion once', () => {
    const upcoming = occasion('soon', 'host')
    expect(wishCandidates(feed([upcoming, upcoming], [occasion('over', 'host', -5)])).map((item) => item.id)).toEqual(['soon'])
    expect(wishTarget(feed([], [occasion('over', 'host', -5)]))).toEqual({ kind: 'none' })
  })
})
