import { describe, expect, it } from 'vitest'
import { asGuestWishes, asOwnerWishes } from '../lib/api/types'
import { wishQuantityEnabled, wishTogetherEnabled } from '../lib/api/wishExtras'
import { DEMO_OCCASIONS, DEMO_PEOPLE, DEMO_TOGETHER_WISH_IDS, seedDemoWorld } from './fixtures'
import { DemoDbError } from './rest'
import { createDemoWorld } from './world'

// The demo server follows 20261030120000_wish_quantity_together.sql: "Anzahl" (1..10, owner-written, one reservation
// for the whole set) and "Passt zusammen" (the owner's links; a friend sees only what they may read; the joint
// reservation is all or nothing; the owner is refused before anything else and learns nothing).

const NOW = Date.parse('2026-10-30T10:00:00Z')
const { anna, ben, clara } = DEMO_PEOPLE
const [GAME, CANDLE] = DEMO_TOGETHER_WISH_IDS
const VOUCHER = 'd1e0d000-0000-4000-8000-000000000103'
const TOWELS = 'd1e0d000-0000-4000-8000-000000000104'

function seeded() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  return world
}

function code(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DemoDbError) return `${error.code}:${error.message}`
    throw error
  }
  throw new Error('expected a refusal')
}

const screenWish = (world: ReturnType<typeof seeded>, viewer: string, id: string) =>
  world.getOccasionScreen(viewer, DEMO_OCCASIONS.housewarming).wishlist?.wishes.find((wish) => wish.id === id)
const reserverOf = (world: ReturnType<typeof seeded>, id: string) =>
  world.internals.reservations.find((row) => row.wish_id === id && row.status === 'active')?.reserver_id ?? null

describe('build flags', () => {
  it('on in the demo, on with the flag, off otherwise', () => {
    expect([wishQuantityEnabled({ VITE_DEMO: '1' }), wishTogetherEnabled({ VITE_DEMO: '1' })]).toEqual([true, true])
    expect([wishQuantityEnabled({ VITE_WISH_QUANTITY: '1' }), wishTogetherEnabled({ VITE_WISH_TOGETHER: '1' })]).toEqual([true, true])
    expect([wishQuantityEnabled({ VITE_WISH_QUANTITY: '0' }), wishTogetherEnabled({})]).toEqual([false, false])
  })
})

describe('"Anzahl"', () => {
  it('the voucher asks for 2 — the same number for the owner and every guest', () => {
    const world = seeded()
    expect(screenWish(world, anna.id, VOUCHER)?.quantity).toBe(2)
    expect(screenWish(world, ben.id, VOUCHER)?.quantity).toBe(2)
    expect(screenWish(world, ben.id, TOWELS)?.quantity).toBe(1)
  })

  it('REST: the owner writes 1..10; 0 / 11 break the CHECK; the switch off refuses a change', () => {
    const world = seeded()
    const towels = () => world.wishRows(anna.id).filter((wish) => wish.id === TOWELS)
    world.updateWishes(anna.id, towels(), { quantity: 4 }, true)
    expect(screenWish(world, clara.id, TOWELS)?.quantity).toBe(4)
    expect(code(() => world.updateWishes(anna.id, towels(), { quantity: 11 }, true))).toMatch(/23514/)
    expect(code(() => world.updateWishes(anna.id, towels(), { quantity: 0 }, true))).toMatch(/23514/)
    world.features.wishQuantity = false
    expect(code(() => world.updateWishes(anna.id, towels(), { quantity: 5 }, true))).toBe('P0001:not_allowed')
    world.updateWishes(anna.id, towels(), { quantity: 4, title: 'Geschirrtücher' }, true) // unchanged quantity: fine
  })
})

describe('"Passt zusammen"', () => {
  it('the owner sees the partner by name only; a guest sees it with its flags', () => {
    const world = seeded()
    const forAnna = world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming).wishlist!.wishes
    expect(forAnna.find((wish) => wish.id === GAME)?.together).toEqual([{ id: CANDLE, title: 'Duftkerze' }])
    expect(screenWish(world, ben.id, CANDLE)?.together).toEqual([{ id: GAME, title: 'Brettspiel für zwei', reserved: false, reserved_by_me: false }])
    // the client strips whatever a list could carry for the owner; a guest keeps the flags
    expect(asOwnerWishes([{ ...forAnna[0]!, together: [{ id: 'x', title: 'X', reserved: true, reserved_by_me: true }] }])[0]?.together)
      .toEqual([{ id: 'x', title: 'X' }])
    expect(asGuestWishes([{ ...forAnna[0]!, together: [{ id: 'x', title: 'X', reserved: true }] }])[0]?.together)
      .toEqual([{ id: 'x', title: 'X', reserved: true, reserved_by_me: false }])
  })

  it('"Beides reservieren": one call reserves both for the giver', () => {
    const world = seeded()
    expect(world.reserveTogether(clara.id, GAME, JSON.stringify([CANDLE]))).toEqual({ ok: true, reserved: 2 })
    expect([reserverOf(world, GAME), reserverOf(world, CANDLE)]).toEqual([clara.id, clara.id])
    expect(screenWish(world, clara.id, GAME)?.together).toEqual([{ id: CANDLE, title: 'Duftkerze', reserved: true, reserved_by_me: true }])
    expect(code(() => world.reserveWish(ben.id, CANDLE))).toBe('P0001:already_reserved')
  })

  it('all or nothing: the partner taken by somebody else → already_reserved and nothing reserved', () => {
    const world = seeded()
    world.reserveWish(ben.id, CANDLE)
    expect(code(() => world.reserveTogether(clara.id, GAME, JSON.stringify([CANDLE])))).toBe('P0001:already_reserved')
    expect([reserverOf(world, GAME), reserverOf(world, CANDLE)]).toEqual([null, ben.id])
  })

  it('the owner: not_allowed before anything else; her screen is the same with and without reservations', () => {
    const world = seeded()
    const before = JSON.stringify(world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming))
    expect(code(() => world.reserveTogether(anna.id, GAME, JSON.stringify([CANDLE])))).toBe('P0001:not_allowed')
    world.reserveTogether(clara.id, GAME, JSON.stringify([CANDLE]))
    expect(code(() => world.reserveTogether(anna.id, GAME, JSON.stringify([CANDLE])))).toBe('P0001:not_allowed')
    expect(JSON.stringify(world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming))).toBe(before)
  })

  it('set_wish_links: owner only (not_found for anybody else), replaces the partners; not linked any more → validation', () => {
    const world = seeded()
    expect(code(() => world.setWishLinks(ben.id, GAME, JSON.stringify([TOWELS])))).toBe('P0001:not_found')
    expect(code(() => world.setWishLinks(anna.id, GAME, JSON.stringify([GAME])))).toBe('P0001:validation')
    expect(world.setWishLinks(anna.id, GAME, JSON.stringify([TOWELS]))).toEqual({ ok: true, linked: 1 })
    expect(screenWish(world, ben.id, CANDLE)?.together).toEqual([])
    expect(code(() => world.reserveTogether(ben.id, GAME, JSON.stringify([CANDLE])))).toBe('P0001:validation')
    expect(world.setWishLinks(anna.id, GAME, '[]')).toEqual({ ok: true, linked: 0 })
    expect(screenWish(world, anna.id, GAME)?.together).toEqual([])
  })

  it('the switch off: together is null, both calls not_allowed', () => {
    const world = seeded()
    world.features.wishTogether = false
    expect(screenWish(world, ben.id, GAME)?.together).toBeNull()
    expect(code(() => world.reserveTogether(ben.id, GAME, JSON.stringify([CANDLE])))).toBe('P0001:not_allowed')
    expect(code(() => world.setWishLinks(anna.id, GAME, '[]'))).toBe('P0001:not_allowed')
  })
})
