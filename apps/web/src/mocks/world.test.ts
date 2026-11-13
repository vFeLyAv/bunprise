import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { DEMO_INVITE_TOKEN, DEMO_OCCASIONS, DEMO_PEOPLE, DEMO_RESERVED_WISH_ID, seedDemoWorld } from './fixtures'
import { applyQuery, DemoDbError, embedder, parseQuery, project } from './rest'
import { endOfLocalDay, isValidTimeZone, localDayAt, zonedToMs } from './time'
import { createDemoWorld, INVITES, OCCASIONS, WISHES, type DemoPerson } from './world'

const NOW = Date.parse('2026-10-20T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const { anna, ben, clara } = DEMO_PEOPLE

function seededWorld() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  return world
}

function person(id: string, name: string | null = 'Mila', consents = true): DemoPerson {
  return { id, displayName: () => name, hasConsents: () => consents }
}

function dbError(run: () => unknown): DemoDbError {
  try {
    run()
  } catch (error) {
    if (error instanceof DemoDbError) return error
    throw error
  }
  throw new Error('expected a database error')
}

const request = (query: string) => new Request(`http://demo.localhost/rest/v1/table?${query}`)

describe('demo time helpers', () => {
  it('follow the Berlin calendar, including the October DST switch (2026-10-25)', () => {
    expect(zonedToMs(2026, 10, 24, 0, 0, 'Europe/Berlin')).toBe(Date.parse('2026-10-23T22:00:00Z'))
    expect(zonedToMs(2026, 10, 26, 0, 0, 'Europe/Berlin')).toBe(Date.parse('2026-10-25T23:00:00Z'))
    // get_feed's end of an all-day occasion = the next local midnight
    expect(endOfLocalDay(Date.parse('2026-10-24T20:00:00Z'), 'Europe/Berlin')).toBe(Date.parse('2026-10-24T22:00:00Z'))
    expect(endOfLocalDay(Date.parse('2026-10-25T12:00:00Z'), 'Europe/Berlin')).toBe(Date.parse('2026-10-25T23:00:00Z'))
    expect(localDayAt(NOW, 'Europe/Berlin', 3, 18, 0)).toBe(Date.parse('2026-10-23T16:00:00Z'))
    // 22:30 UTC is already the next calendar day in Berlin
    expect(localDayAt(Date.parse('2026-10-20T22:30:00Z'), 'Europe/Berlin', 0, 0, 0)).toBe(Date.parse('2026-10-20T22:00:00Z'))
    expect(isValidTimeZone('Europe/Berlin')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false)
  })
})

describe('seeded demo world', () => {
  it('uses ids the routes accept and a fixed 64-hex invite token', () => {
    const uuid = z.uuid()
    for (const id of [anna.id, ben.id, clara.id, DEMO_OCCASIONS.housewarming, DEMO_OCCASIONS.barbecue, DEMO_RESERVED_WISH_ID]) {
      expect(uuid.parse(id)).toBe(id)
    }
    expect(DEMO_INVITE_TOKEN).toMatch(/^[0-9a-f]{64}$/)
    const ascii = DEMO_INVITE_TOKEN.match(/../g)?.map((pair) => String.fromCharCode(Number.parseInt(pair, 16))).join('')
    expect(ascii).toBe('grillabend-ben-demo-invite-link!')
  })

  it('has the two occasions at fixed local times, with the right roles and counts', () => {
    const world = seededWorld()
    const benFeed = world.getFeed(ben.id)
    expect(benFeed.past).toEqual([])
    expect(benFeed.upcoming.map((row) => [row.title, row.role, row.member_count, row.wish_count, row.place_text])).toEqual([
      ['Annas Einweihung', 'member', 3, 6, 'Café am Markt'],
      ['Bens Grillabend', 'host', 3, 4, 'Stadtpark, Grillwiese'],
    ])
    expect(benFeed.upcoming[0]).toMatchObject({ starts_at: '2026-10-23T16:00:00.000Z', all_day: false, tz: 'Europe/Berlin', host_name: 'Anna Beispiel', my_reservation_count: 1 })
    expect(benFeed.upcoming[1]).toMatchObject({ starts_at: '2026-11-19T17:30:00.000Z', host_name: 'Ben Mustermann', my_reservation_count: null })
    expect(world.getFeed(clara.id).upcoming.map((row) => [row.rsvp, row.my_reservation_count])).toEqual([['maybe', 0], ['declined', 0]])
    expect(world.getFeed(anna.id).upcoming[0]).toMatchObject({ role: 'host', my_reservation_count: null })
  })

  it("keeps Ben's reservation secret from Anna and anonymous for Clara", () => {
    const world = seededWorld()
    const forAnna = world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming)
    expect(forAnna.viewer).toEqual({ role: 'host', rsvp: 'going' })
    expect(forAnna.wishlist?.wishes.map((wish) => wish.priority)).toEqual([3, 3, 2, 2, 1, 1])
    expect(forAnna.wishlist?.wishes.every((wish) => wish.reserved === null && wish.reserved_by_me === null)).toBe(true)
    const flags = (viewerId: string) => world.getOccasionScreen(viewerId, DEMO_OCCASIONS.housewarming).wishlist?.wishes
      .filter((wish) => wish.reserved).map((wish) => [wish.id, wish.reserved_by_me])
    expect(flags(clara.id)).toEqual([[DEMO_RESERVED_WISH_ID, false]])
    expect(flags(ben.id)).toEqual([[DEMO_RESERVED_WISH_ID, true]])
    expect(JSON.stringify(world.getOccasionScreen(clara.id, DEMO_OCCASIONS.housewarming))).not.toContain('reserved_by_name')
    expect(world.myReservations(ben.id)).toEqual([expect.objectContaining({
      wish_id: DEMO_RESERVED_WISH_ID, wish_title: 'Kaffeemühle mit Handkurbel', occasion_title: 'Annas Einweihung', status: 'active', end_reason: null,
    })])
    expect(world.myReservations(clara.id)).toEqual([])
  })

  it("answers the host byte-identically while members reserve and cancel", () => {
    const world = seededWorld()
    const hostView = () => JSON.stringify([
      world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming), world.getFeed(anna.id), world.exportFor(anna.id),
    ])
    const before = hostView()
    world.reserveWish(clara.id, 'd1e0d000-0000-4000-8000-000000000103')
    world.reserveWish(clara.id, 'd1e0d000-0000-4000-8000-000000000105')
    world.cancelReservation(clara.id, 'd1e0d000-0000-4000-8000-000000000103')
    world.cancelReservation(ben.id, DEMO_RESERVED_WISH_ID)
    world.reserveWish(clara.id, DEMO_RESERVED_WISH_ID)
    expect(hostView()).toBe(before)
    expect(world.getFeed(clara.id).upcoming[0]?.my_reservation_count).toBe(2)
  })
})

describe('demo world lifecycle', () => {
  it('adds a finished account as a guest once and never re-adds someone who left', () => {
    const world = seededWorld()
    world.addPerson(person(ME))
    expect(world.addGuest(DEMO_OCCASIONS.housewarming, ME)).toBe(true)
    expect(world.addGuest(DEMO_OCCASIONS.housewarming, ME)).toBe(false)
    expect(world.getOccasionScreen(ME, DEMO_OCCASIONS.housewarming).members.map((member) => member.profile_id)).toEqual([anna.id, ben.id, clara.id, ME])
    world.leaveOccasion(ME, DEMO_OCCASIONS.housewarming)
    expect(world.addGuest(DEMO_OCCASIONS.housewarming, ME)).toBe(false)
    expect(world.getFeed(ME)).toEqual({ upcoming: [], past: [] })
  })

  it('writes are all-or-nothing and run the occasion triggers', () => {
    const world = seededWorld()
    world.addPerson(person(ME))
    const good = { id: '00000000-0000-4000-8000-0000000000b1', host_id: ME, title: 'Gut', starts_at: '2026-12-01T10:00:00Z' }
    const bad = { host_id: ME, title: 'x'.repeat(81), starts_at: '2026-12-01T10:00:00Z' }
    expect(dbError(() => world.insertOccasions(ME, [good, bad], false)).code).toBe('23514')
    expect(world.occasionRows(ME)).toEqual([])
    const [created] = world.insertOccasions(ME, [good], true)
    expect(created).toMatchObject({ id: good.id, tz: 'Europe/Berlin', all_day: true, place_text: null })
    expect(world.memberRows(ME).filter((member) => member.occasion_id === good.id)).toEqual([expect.objectContaining({ role: 'host', rsvp: 'going', status: 'active' })])
    expect(world.wishlistRows(ME).filter((list) => list.occasion_id === good.id)).toEqual([expect.objectContaining({ owner_id: ME, recipient_id: ME, title: 'Gut' })])
    const elsewhere = { host_id: ME, title: 'Anderswo', starts_at: '2026-12-01T10:00:00Z', tz: 'Mars/Olympus_Mons' }
    expect(dbError(() => world.insertOccasions(ME, [elsewhere], false))).toMatchObject({ code: 'P0001', message: 'invalid_timezone' })
    const strangerOccasion = { ...good, id: '00000000-0000-4000-8000-0000000000b2', host_id: anna.id }
    expect(dbError(() => world.insertOccasions(ME, [strangerOccasion], false)).code).toBe('42501')
    world.addPerson(person('00000000-0000-4000-8000-0000000000ab', null))
    expect(dbError(() => world.insertOccasions('00000000-0000-4000-8000-0000000000ab', [{ ...good, host_id: '00000000-0000-4000-8000-0000000000ab' }], false)).code).toBe('42501')
  })
})

describe('demo REST query parsing', () => {
  it('checks every referenced column against the column grants before reading', () => {
    expect(dbError(() => parseQuery(request('select=token_hash'), INVITES)).code).toBe('42501')
    expect(dbError(() => parseQuery(request(''), INVITES)).code).toBe('42501') // * includes token_hash
    expect(dbError(() => parseQuery(request('select=id&token_hash=eq.x'), INVITES)).code).toBe('42501')
    expect(dbError(() => parseQuery(request('select=nope'), OCCASIONS)).code).toBe('42703')
    expect(dbError(() => parseQuery(request('select=id&starts_at=gt.2026-01-01'), OCCASIONS)).code).toBe('PGRST100')
    expect(dbError(() => parseQuery(request('select=wishes(*)'), OCCASIONS)).code).toBe('PGRST100')
    expect(parseQuery(request(''), OCCASIONS).columns).toEqual(OCCASIONS.columns)
    expect(parseQuery(request('select=id,title'), OCCASIONS).columns).toEqual(['id', 'title'])
    expect(parseQuery(request(''), INVITES, { projection: false }).columns).toEqual([])
  })

  it('embeds only declared many-to-one relations, with the grants of both tables', () => {
    const query = parseQuery(request('select=id,title,wishlist:wishlists(id,occasion_id,owner_id)&id=eq.x'), WISHES)
    expect(query.columns).toEqual(['id', 'title'])
    expect(query.embeds).toEqual([{ name: 'wishlist', table: 'wishlists', foreignKey: 'wishlist_id', columns: ['id', 'occasion_id', 'owner_id'] }])
    expect(parseQuery(request('select=id,wishlists(id)'), WISHES).embeds[0]?.name).toBe('wishlists') // no alias: the table name
    for (const select of ['id,wishlist:wishlists(*)', 'id,wishlist:occasions(id)', 'id,constructor(id)', 'id,wishlist:wishlists(id', 'id,wishlists(id))', 'id,w:wishlists(o:occasions(id))']) {
      expect(dbError(() => parseQuery(request(`select=${select}`), WISHES)).code, select).toBe('PGRST100')
    }
    expect(dbError(() => parseQuery(request('select=id,wishlist:wishlists(nope)'), WISHES)).code).toBe('42703')
    // like Postgres: the join needs the parent's foreign key, the embed each of its columns — all granted
    const lists = { table: 'lists', columns: ['id', 'secret'], readable: ['id'] }
    const items = { table: 'items', columns: ['id', 'list_id'], readable: ['id'], embeds: { lists: { foreignKey: 'list_id', access: lists } } }
    expect(dbError(() => parseQuery(request('select=id,l:lists(id)'), items)).code).toBe('42501')
    expect(dbError(() => parseQuery(request('select=id,l:lists(secret)'), { ...items, readable: ['id', 'list_id'] })).code).toBe('42501')
  })

  it('an embedded row is the referenced row the viewer may see — or null', () => {
    const query = parseQuery(request('select=id,wishlist:wishlists(id,owner_id)'), WISHES)
    const visible = [{ id: 'l1', occasion_id: 'o1', owner_id: 'p1', title: 'Liste' }]
    const embed = embedder(query, (table) => (table === 'wishlists' ? visible : []))
    expect(project([{ id: 'w1', wishlist_id: 'l1' }, { id: 'w2', wishlist_id: 'l-hidden' }], query.columns, embed)).toEqual([
      { id: 'w1', wishlist: { id: 'l1', owner_id: 'p1' } },
      { id: 'w2', wishlist: null },
    ])
    expect(embedder(parseQuery(request('select=id'), WISHES), () => visible)).toBeUndefined()
  })

  it('filters, orders (Postgres null placement) and pages', () => {
    const rows = [
      { id: 'a', n: 2, flag: true, at: null },
      { id: 'b', n: 1, flag: false, at: '2026-01-02' },
      { id: 'c', n: 3, flag: true, at: '2026-01-01' },
    ]
    const access = { table: 't', columns: ['id', 'n', 'flag', 'at'], readable: ['id', 'n', 'flag', 'at'] }
    const ids = (query: string) => applyQuery(rows, parseQuery(request(query), access)).map((row) => row.id)
    expect(ids('id=eq.b')).toEqual(['b'])
    expect(ids('id=neq.b')).toEqual(['a', 'c'])
    expect(ids('id=in.(a,"c")')).toEqual(['a', 'c'])
    expect(ids('flag=is.true')).toEqual(['a', 'c'])
    expect(ids('at=is.null')).toEqual(['a'])
    expect(ids('n=eq.3')).toEqual(['c'])
    expect(ids('order=n.desc')).toEqual(['c', 'a', 'b'])
    expect(ids('order=at.asc')).toEqual(['c', 'b', 'a']) // NULLS LAST
    expect(ids('order=at.desc')).toEqual(['a', 'b', 'c']) // NULLS FIRST
    expect(ids('order=at.desc.nullslast')).toEqual(['b', 'c', 'a'])
    expect(ids('order=n.asc&limit=1&offset=1')).toEqual(['a'])
  })
})
