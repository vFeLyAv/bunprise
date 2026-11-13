import { describe, expect, it } from 'vitest'
import type { FollowedPerson, ListsOverview, OwnerListCard, UpcomingList } from '../../lib/api/lists.types'
import { isTabList, listsTabView } from './tabView'

// What the "Wunschlisten" tab SHOWS (Felix 22.10: "In Listen gibt es keine Anlässe – nur Wunschlisten"): the
// overview minus everything that belongs to an occasion and minus the lists waiting for their 5 s undo; the
// header's counters are counted from exactly what is shown. Pure: fictional data only.

const ME = '00000000-0000-4000-8000-0000000000aa'
const MINE = '11111111-1111-4111-8111-111111111111'
const BOOKS = '11111111-1111-4111-8111-111111111112'
const PARTY = '11111111-1111-4111-8111-111111111113'
const OCCASION = '99999999-9999-4999-8999-999999999999'
const PAULA_XMAS = '88888888-8888-4888-8888-888888888881'
const PAULA_BOOKS = '88888888-8888-4888-8888-888888888882'
const ANNA_BDAY = '88888888-8888-4888-8888-888888888883'

function card(id: string, patch: Partial<OwnerListCard> = {}): OwnerListCard {
  return {
    id, title: 'Meine Wünsche', kind: 'standalone', visibility: 'private', cover_tone: 2, cover_icon: 'star', due_on: null,
    wish_count: 4, occasion: null, created_at: '2026-10-19T10:00:00Z', photo: null, ...patch,
  }
}

/** my hosted occasion's list: it lives on the occasion's own screen, never in "Listen" */
const occasionCard = card(PARTY, {
  title: 'Sommerfest',
  kind: 'occasion',
  visibility: 'occasion',
  wish_count: 7,
  occasion: { id: OCCASION, title: 'Sommerfest', starts_at: '2026-12-01T16:00:00Z', tz: 'Europe/Berlin', all_day: false },
})

function person(id: string, listIds: string[]): FollowedPerson {
  return {
    profile: { id, display_name: 'Paula Brandt', banner: null },
    mutual: true,
    accepted_at: '2026-10-01T10:00:00Z',
    lists: listIds.map((listId) => ({ id: listId, title: 'Weihnachten', cover_tone: null, cover_icon: null, due_on: null, wish_count: 2, new_wish_count: 0, photo: null })),
  }
}

const soonOccasion: UpcomingList = {
  list: { id: '44444444-4444-4444-8444-444444444444', title: 'Annas Einweihung', cover_tone: null, cover_icon: null, wish_count: 3, occasion_id: '55555555-5555-4555-8555-555555555555', photo: null },
  owner: { id: '66666666-6666-4666-8666-666666666666', display_name: 'Anna Beispiel' },
  date: '2026-12-24',
  kind: 'occasion',
}

const soonList: UpcomingList = {
  list: { id: PAULA_XMAS, title: 'Weihnachten', cover_tone: 1, cover_icon: 'tree', wish_count: 2, occasion_id: null, photo: null },
  owner: { id: '77777777-7777-4777-8777-777777777777', display_name: 'Paula Brandt' },
  date: '2026-12-20',
  kind: 'standalone',
}

function overview(patch: Partial<ListsOverview> = {}): ListsOverview {
  return {
    me: { id: ME, display_name: 'Mila Sommer', banner: null, live_links: 0 },
    // the server counts occasion lists and guest occasions too
    stats: { my_wishes: 20, my_lists: 3, friends_lists: 9, followers: 3, following: 2, requests: 1 },
    my_lists: [card(MINE), occasionCard, card(BOOKS, { title: 'Bücher', wish_count: 9 })],
    following: [],
    upcoming: [],
    suggestions: [],
    ...patch,
  }
}

describe('isTabList', () => {
  it('only a standalone list without an occasion belongs in "Meine"', () => {
    expect(isTabList(card(MINE))).toBe(true)
    expect(isTabList(occasionCard)).toBe(false)
    // defensive: an occasion attached to a "standalone" card still keeps it out
    expect(isTabList({ kind: 'standalone', occasion: occasionCard.occasion })).toBe(false)
  })
})

describe('listsTabView', () => {
  it('drops my occasion list from "Meine" and keeps the server order of the rest', () => {
    const view = listsTabView(overview())
    expect(view.myLists.map((entry) => entry.id)).toEqual([MINE, BOOKS])
  })

  it('drops an upcoming occasion from "Bald" and keeps the dated lists of people I follow', () => {
    const view = listsTabView(overview({ upcoming: [soonOccasion, soonList] }))
    expect(view.upcoming).toEqual([soonList])
  })

  it('counts my_wishes and my_lists from the shown lists only; the other counters stay the server’s', () => {
    const { stats } = listsTabView(overview())
    expect(stats.my_lists).toBe(2)
    expect(stats.my_wishes).toBe(4 + 9) // not the occasion list's 7
    expect(stats.followers).toBe(3)
    expect(stats.following).toBe(2)
    expect(stats.requests).toBe(1)
  })

  it('friends_lists = the follower lists of the people I follow, each list once (no guest occasions)', () => {
    const view = listsTabView(
      overview({
        following: [person('77777777-7777-4777-8777-777777777777', [PAULA_XMAS, PAULA_BOOKS]), person('77777777-7777-4777-8777-777777777778', [ANNA_BDAY, PAULA_XMAS])],
        upcoming: [soonOccasion, soonList],
      }),
    )
    expect(view.stats.friends_lists).toBe(3)
    expect(listsTabView(overview()).stats.friends_lists).toBe(0)
  })

  it('a list waiting for its delete is gone from the grid and from both counters', () => {
    const view = listsTabView(overview(), new Set([BOOKS]))
    expect(view.myLists.map((entry) => entry.id)).toEqual([MINE])
    expect(view.stats.my_lists).toBe(1)
    expect(view.stats.my_wishes).toBe(4)
  })

  it('only occasion lists left: an empty "Meine" with zero counters', () => {
    const view = listsTabView(overview({ my_lists: [occasionCard] }))
    expect(view.myLists).toEqual([])
    expect(view.stats.my_lists).toBe(0)
    expect(view.stats.my_wishes).toBe(0)
  })

  it('never changes the cached overview itself (other screens read the server’s numbers)', () => {
    const cached = overview({ upcoming: [soonOccasion, soonList] })
    const before = structuredClone(cached)
    listsTabView(cached, new Set([MINE]))
    expect(cached).toEqual(before)
  })
})
