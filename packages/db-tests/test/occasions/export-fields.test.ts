/**
 * "Meine Daten herunterladen" catches up with the 25.–27.10 columns (supabase/migrations/20261027210000_export_new_fields.sql):
 *   export_my_data().occasions_hosted[] carries place_lat / place_lon, sections, cover_theme and guests_can_invite of
 *   the host's own occasions; profile carries invitations_from. A guest's export has no occasions_hosted entry for an
 *   occasion they only attend, and the host's export stays byte-identical whatever is reserved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type TestDb } from '../../src/harness'
import { execAs, rpc, seedPilot } from '../pilot/seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface ExportShape {
  profile: Record<string, unknown>
  occasions_hosted: Array<Record<string, unknown> & { id: string }>
}

const exportText = (uid: string) => t.asUser(uid, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))

describe('export_my_data: the new occasion and profile fields', () => {
  it('defaults: every new key is there for the host, with its default value', async () => {
    const s = await seedPilot(t)
    const data = await rpc<ExportShape>(t, s.a, 'export_my_data')
    const occasion = data.occasions_hosted.find((o) => o.id === s.occasionId)
    expect(occasion).toBeDefined()
    for (const key of ['place_lat', 'place_lon', 'sections', 'cover_theme', 'guests_can_invite']) expect(occasion && key in occasion, key).toBe(true)
    expect(occasion?.place_lat).toBeNull()
    expect(occasion?.cover_theme).toBeNull()
    expect(occasion?.guests_can_invite).toBe(false)
    expect(data.profile.invitations_from).toBe('friends')
  })

  it('stored values come back as stored (the host writes them through REST)', async () => {
    const s = await seedPilot(t)
    expect(await execAs(t, s.a, 'update occasions set place_text = $2, place_lat = $3, place_lon = $4, cover_theme = $5, guests_can_invite = true where id = $1',
      [s.occasionId, 'Café Nord', 48.13743, 11.57549, 'birthday'])).toBe(1)
    expect(await execAs(t, s.a, `update profiles set invitations_from = 'nobody' where id = $1`, [s.a])).toBe(1)
    const data = await rpc<ExportShape>(t, s.a, 'export_my_data')
    const occasion = data.occasions_hosted.find((o) => o.id === s.occasionId)
    expect(occasion?.place_lat).toBe(48.13743)
    expect(occasion?.place_lon).toBe(11.57549)
    expect(occasion?.cover_theme).toBe('birthday')
    expect(occasion?.guests_can_invite).toBe(true)
    expect(typeof occasion?.sections).toBe('string')
    expect(data.profile.invitations_from).toBe('nobody')
  })

  it('a guest does not get the host occasion in occasions_hosted', async () => {
    const s = await seedPilot(t)
    const data = await rpc<ExportShape>(t, s.b, 'export_my_data')
    expect(data.occasions_hosted.some((o) => o.id === s.occasionId)).toBe(false)
  })

  it('the host export is byte-identical with and without a reservation on their wish (exported_at aside)', async () => {
    const s = await seedPilot(t)
    const strip = (text: string) => text.replace(/"exported_at": "[^"]+"/, '')
    const before = strip(await exportText(s.a))
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    expect(strip(await exportText(s.a))).toBe(before)
  })
})
