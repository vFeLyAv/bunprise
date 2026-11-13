import { describe, expect, it } from 'vitest'
import { DEMO_INVITE_TOKEN, DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// The demo's bring-along list "Mitbringen" behaves like supabase/migrations/20261025150000_potluck.sql (the SQL
// itself is proven in packages/db-tests/test/potluck): one bringer per entry, rights, release on leaving,
// switching off, the export of the own part.

const NOW = Date.parse('2026-10-20T10:00:00Z')
const MILA = '00000000-0000-4000-8000-0000000000aa'
const { anna, ben, clara } = DEMO_PEOPLE
const OCC = DEMO_OCCASIONS.housewarming

function person(id: string, name = 'Mila'): DemoPerson {
  return { id, displayName: () => name, hasConsents: () => true }
}

/** The seeded world + Mila as a guest of Annas Einweihung (sections 'both', three entries). */
function world() {
  const w = createDemoWorld(() => NOW)
  seedDemoWorld(w, NOW)
  w.addPerson(person(MILA))
  w.addGuest(OCC, MILA)
  return w
}

function code(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DemoDbError) return error.message
    throw error
  }
  throw new Error('expected a refusal')
}

const items = (w: ReturnType<typeof world>, viewer: string) => w.getOccasionScreen(viewer, OCC).potluck?.items ?? []

describe('demo bring-along list', () => {
  it('one bringer per entry; the same person twice is fine; only the own commitment can be withdrawn', () => {
    const w = world()
    const open = items(w, MILA).find((i) => !i.claimed)!
    expect(w.claimPotluckItem(MILA, open.id)).toEqual({ ok: true })
    expect(w.claimPotluckItem(MILA, open.id)).toEqual({ ok: true })
    expect(code(() => w.claimPotluckItem(ben.id, open.id))).toBe('already_claimed')
    expect(code(() => w.unclaimPotluckItem(ben.id, open.id))).toBe('not_found')
    expect(items(w, ben.id).find((i) => i.id === open.id)).toMatchObject({ claimed: true, claimed_by_me: false, bringer: { profile_id: MILA } })
    expect(w.unclaimPotluckItem(MILA, open.id)).toEqual({ ok: true })
  })

  it('rights: rename = the author, delete = the author or the host; outsiders get not_found', () => {
    const w = world()
    const { id } = w.addPotluckItem(MILA, OCC, ' Gitarre ', true)
    expect(items(w, MILA).at(-1)).toMatchObject({ id, title: 'Gitarre', can_edit: true, can_delete: true, claimed_by_me: true })
    expect(code(() => w.renamePotluckItem(anna.id, id, 'Ukulele'))).toBe('not_allowed')
    expect(code(() => w.deletePotluckItem(ben.id, id))).toBe('not_allowed')
    expect(w.deletePotluckItem(anna.id, id)).toEqual({ ok: true })
    w.addPerson(person('00000000-0000-4000-8000-0000000000bb', 'Fremd'))
    expect(code(() => w.addPotluckItem('00000000-0000-4000-8000-0000000000bb', OCC, 'x', false))).toBe('not_found')
    expect(code(() => w.addPotluckItem(MILA, OCC, '   ', false))).toBe('validation')
  })

  it('leaving releases the commitments; returning restores nothing', () => {
    const w = world()
    const open = items(w, MILA).find((i) => !i.claimed)!
    w.claimPotluckItem(MILA, open.id)
    w.leaveOccasion(MILA, OCC)
    expect(items(w, anna.id).find((i) => i.id === open.id)).toMatchObject({ claimed: false, bringer: null })
    expect(code(() => w.claimPotluckItem(MILA, open.id))).toBe('not_found')
    w.acceptInvite(MILA, DEMO_INVITE_TOKEN) // a link of another occasion: still not back in this one
    expect(code(() => w.getOccasionScreen(MILA, OCC))).toBe('not_found')
  })

  it('switching the list off deletes its entries; the wishes-only screen has none', () => {
    const w = world()
    w.updateOccasions(anna.id, [...w.occasionRows(anna.id)].filter((o) => o.id === OCC), { sections: 'wishes' }, true)
    const sc = w.getOccasionScreen(anna.id, OCC)
    expect(sc.occasion.sections).toBe('wishes')
    expect(sc.potluck).toBeNull()
    expect(code(() => w.addPotluckItem(anna.id, OCC, 'Salat', false))).toBe('not_allowed')
    w.updateOccasions(anna.id, [...w.occasionRows(anna.id)].filter((o) => o.id === OCC), { sections: 'both' }, true)
    expect(items(w, anna.id)).toEqual([])
  })

  it('a block hides the bringer\'s name, not the fact; the export holds only the own part', () => {
    const w = world()
    const musikbox = items(w, MILA).find((i) => i.title === 'Musikbox')!
    w.follows.block(MILA, clara.id)
    expect(items(w, MILA).find((i) => i.id === musikbox.id)).toMatchObject({ claimed: true, bringer: null })
    const own = w.addPotluckItem(MILA, OCC, 'Kuchen', true)
    const exported = w.exportMyPotluck(MILA) as { format: string; occasions: { items_created: unknown[]; my_claims: unknown[]; sections: unknown }[] }
    expect(exported.format).toBe('bunprise-potluck-v1')
    expect(exported.occasions).toEqual([expect.objectContaining({ sections: null, items_created: [expect.objectContaining({ title: 'Kuchen', claimed: true })], my_claims: [{ title: 'Kuchen' }] })])
    expect(JSON.stringify(exported)).not.toContain(clara.id)
    expect(own.id).toEqual(expect.any(String))
  })
})
