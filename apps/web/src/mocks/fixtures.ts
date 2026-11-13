import { localDayAt } from './time'
import type { DemoPerson, DemoWorld, InviteRow, MemberRow, OccasionRow, PotluckRow, ReservationRow, SeedWishlistRow, WishRow } from './world'

// The fictional friends every demo account shares (invented names, public places, example.com
// links — no real person, address or shop). Ids are fixed so a reload always rebuilds the same
// world; dates are relative to the moment the demo server starts.

const DAY = 86_400_000
const HOUR = 3_600_000
const ZONE = 'Europe/Berlin'

export const DEMO_PEOPLE = {
  anna: { id: 'd1e0a000-0000-4000-8000-000000000001', name: 'Anna Beispiel' },
  ben: { id: 'd1e0a000-0000-4000-8000-000000000002', name: 'Ben Mustermann' },
  clara: { id: 'd1e0a000-0000-4000-8000-000000000003', name: 'Clara Test' },
} as const

export const DEMO_OCCASIONS = {
  /** "Annas Einweihung" (in 3 days): every demo account joins it as a guest once its profile is complete. */
  housewarming: 'd1e0b000-0000-4000-8000-000000000001',
  /** "Bens Grillabend" (in 30 days): reachable only through DEMO_INVITE_TOKEN and an explicit "Beitreten". */
  barbecue: 'd1e0b000-0000-4000-8000-000000000002',
} as const

/** The wish in "Annas Einweihung" that Ben reserved (guests see "Reserviert", Anna would see nothing). */
export const DEMO_RESERVED_WISH_ID = 'd1e0d000-0000-4000-8000-000000000101'

/** "Brettspiel für zwei" and "Duftkerze" in "Annas Einweihung": linked ("Passt zusammen", 30.10 — a games evening). */
export const DEMO_TOGETHER_WISH_IDS = ['d1e0d000-0000-4000-8000-000000000105', 'd1e0d000-0000-4000-8000-000000000106'] as const

/**
 * Fixed invite link of "Bens Grillabend": http://localhost:5173/i#<token> (docs/demo-mode.md).
 * 64 hex chars like create_invite() returns; they spell "grillabend-ben-demo-invite-link!" in ASCII.
 */
export const DEMO_INVITE_TOKEN = '6772696c6c6162656e642d62656e2d64656d6f2d696e766974652d6c696e6b21'

const LISTS = { housewarming: 'd1e0c000-0000-4000-8000-000000000001', barbecue: 'd1e0c000-0000-4000-8000-000000000002' } as const
const BARBECUE_INVITE_ID = 'd1e0e000-0000-4000-8000-000000000002'

export function seedDemoWorld(world: DemoWorld, nowMs: number = Date.now()): void {
  const ago = (days: number, hours = 0): string => new Date(nowMs - days * DAY - hours * HOUR).toISOString()
  const minutesAfter = (iso: string, minutes: number): string => new Date(Date.parse(iso) + minutes * 60_000).toISOString()
  const friend = ({ id, name }: { id: string; name: string }): DemoPerson => ({ id, displayName: () => name, hasConsents: () => true })
  const { anna, ben, clara } = DEMO_PEOPLE

  const housewarmingCreated = ago(6)
  const barbecueCreated = ago(5, 1)
  const inviteCreated = ago(5)
  const occasions: OccasionRow[] = [
    {
      id: DEMO_OCCASIONS.housewarming, host_id: anna.id, title: 'Annas Einweihung',
      starts_at: new Date(localDayAt(nowMs, ZONE, 3, 18, 0)).toISOString(), ends_at: null, tz: ZONE, all_day: false,
      place_text: 'Café am Markt', description: 'Kleine Runde zum Anstoßen auf die neue Wohnung.',
      // 20261027190000: an invented point in the invented town (mocks/places.ts), for the screen's mini map
      place_lat: 51.16094, place_lon: 10.45108,
      cancelled_at: null, created_at: housewarmingCreated, updated_at: housewarmingCreated,
      // the bring-along list "Mitbringen" next to the wishes (features/potluck, on in the demo)
      sections: 'both',
    },
    {
      id: DEMO_OCCASIONS.barbecue, host_id: ben.id, title: 'Bens Grillabend',
      starts_at: new Date(localDayAt(nowMs, ZONE, 30, 18, 30)).toISOString(), ends_at: null, tz: ZONE, all_day: false,
      place_text: 'Stadtpark, Grillwiese', description: 'Bringt gute Laune mit – für Würstchen und Gemüse ist gesorgt.',
      place_lat: 51.16655, place_lon: 10.44302,
      cancelled_at: null, created_at: barbecueCreated, updated_at: barbecueCreated,
      sections: 'wishes',
    },
  ]

  const member = (occasionId: string, profileId: string, role: MemberRow['role'], rsvp: MemberRow['rsvp'], joinedAt: string, invitedVia: string | null = null): MemberRow =>
    ({ occasion_id: occasionId, profile_id: profileId, role, rsvp, status: 'active', invited_via: invitedVia, joined_at: joinedAt, updated_at: joinedAt })
  const members: MemberRow[] = [
    member(DEMO_OCCASIONS.housewarming, anna.id, 'host', 'going', housewarmingCreated),
    member(DEMO_OCCASIONS.housewarming, ben.id, 'member', 'going', ago(5, 2)),
    member(DEMO_OCCASIONS.housewarming, clara.id, 'member', 'maybe', ago(4)),
    member(DEMO_OCCASIONS.barbecue, ben.id, 'host', 'going', barbecueCreated),
    member(DEMO_OCCASIONS.barbecue, anna.id, 'member', 'going', ago(4, 3), BARBECUE_INVITE_ID),
    member(DEMO_OCCASIONS.barbecue, clara.id, 'member', 'declined', ago(3), BARBECUE_INVITE_ID),
  ]

  const wishlists: SeedWishlistRow[] = [
    { id: LISTS.housewarming, occasion_id: DEMO_OCCASIONS.housewarming, owner_id: anna.id, recipient_id: anna.id, title: 'Annas Einweihung', created_at: housewarmingCreated, updated_at: housewarmingCreated },
    { id: LISTS.barbecue, occasion_id: DEMO_OCCASIONS.barbecue, owner_id: ben.id, recipient_id: ben.id, title: 'Bens Grillabend', created_at: barbecueCreated, updated_at: barbecueCreated },
  ]

  type WishSeed = [id: string, title: string, priority: WishRow['priority'], priceCents: number | null, url: string | null, note: string | null]
  const wishSeeds = (wishlistId: string, createdFrom: string, seeds: readonly WishSeed[]): WishRow[] =>
    seeds.map(([id, title, priority, priceCents, url, note], index) => {
      const createdAt = minutesAfter(createdFrom, 10 + index * 3)
      return { id, wishlist_id: wishlistId, title, price_cents: priceCents, currency: 'EUR', url, note, priority, created_at: createdAt, updated_at: createdAt }
    })
  const wishes: WishRow[] = [
    ...wishSeeds(LISTS.housewarming, housewarmingCreated, [
      [DEMO_RESERVED_WISH_ID, 'Kaffeemühle mit Handkurbel', 3, 4500, 'https://example.com/kaffeemuehle', 'Gern aus Holz'],
      ['d1e0d000-0000-4000-8000-000000000102', 'Große Zimmerpflanze', 3, 3500, null, 'Etwas Pflegeleichtes fürs Wohnzimmer'],
      ['d1e0d000-0000-4000-8000-000000000103', 'Kinogutschein', 2, 2500, null, null],
      ['d1e0d000-0000-4000-8000-000000000104', 'Leinen-Geschirrtücher', 2, 1800, 'https://example.com/geschirrtuecher', 'Gern in Grün oder Grau'],
      ['d1e0d000-0000-4000-8000-000000000105', 'Brettspiel für zwei', 1, 3000, null, 'Etwas Kurzes für Spieleabende'],
      ['d1e0d000-0000-4000-8000-000000000106', 'Duftkerze', 1, 1500, null, null],
    ]),
    ...wishSeeds(LISTS.barbecue, barbecueCreated, [
      ['d1e0d000-0000-4000-8000-000000000201', 'Grillzange aus Edelstahl', 3, 1900, null, null],
      ['d1e0d000-0000-4000-8000-000000000202', 'Gewürzset zum Grillen', 2, 2200, null, 'Gern etwas Scharfes'],
      ['d1e0d000-0000-4000-8000-000000000203', 'Grillschürze', 2, 2500, 'https://example.com/grillschuerze', null],
      ['d1e0d000-0000-4000-8000-000000000204', 'Lichterkette für den Garten', 1, 2000, null, null],
    ]),
  ]

  // The wish details (20261022120000): three wishes show the detail sheet in the demo. Invented brands, shops and
  // GTINs (prefix 200–299 = for internal use only, never a real product); the coffee grinder also gets the demo photo
  // (src/mocks/wishPhotos.ts seedDemoPhoto, called from handlers.ts).
  const details: Readonly<Record<string, Pick<WishRow, 'description' | 'brand' | 'color' | 'gtin' | 'shop_name'>>> = {
    [DEMO_RESERVED_WISH_ID]: {
      description: 'Handmühle mit Kegelmahlwerk aus Keramik, stufenlos einstellbar von fein (Espresso) bis grob (French Press). Gehäuse aus geöltem Buchenholz, Schublade für ca. 30 g Kaffee.',
      brand: 'Mahlwerk & Söhne', color: 'Buche natur', gtin: '2001234567893', shop_name: 'Küchenkontor',
    },
    'd1e0d000-0000-4000-8000-000000000104': {
      description: '3er-Set aus reinem Leinen, 50 × 70 cm, mit Aufhänger. Wird mit jeder Wäsche weicher.',
      brand: 'Leinenliebe', color: 'Salbeigrün', gtin: null, shop_name: 'Haus & Faden',
    },
    'd1e0d000-0000-4000-8000-000000000203': {
      description: 'Robuste Schürze aus gewachstem Canvas mit Lederriemen und zwei Fronttaschen.',
      brand: 'Glutfreunde', color: 'Anthrazit', gtin: '2009876543210', shop_name: 'Grillhütte',
    },
  }
  for (const wish of wishes) Object.assign(wish, details[wish.id])
  // 30.10 "Anzahl": two cinema vouchers (one friend gives both)
  const voucher = wishes.find((wish) => wish.id === 'd1e0d000-0000-4000-8000-000000000103')
  if (voucher) voucher.quantity = 2

  const barbecueStarts = Date.parse(occasions[1]?.starts_at ?? inviteCreated)
  const invite: InviteRow = {
    id: BARBECUE_INVITE_ID, occasion_id: DEMO_OCCASIONS.barbecue, created_by: ben.id,
    expires_at: new Date(Math.max(Date.parse(inviteCreated) + 14 * DAY, barbecueStarts + 7 * DAY)).toISOString(),
    max_uses: 50, use_count: 2, revoked_at: null, created_at: inviteCreated,
  }

  const reservations: ReservationRow[] = [{
    id: 'd1e0f000-0000-4000-8000-000000000001', wish_id: DEMO_RESERVED_WISH_ID, wishlist_id: LISTS.housewarming,
    recipient_id: anna.id, reserver_id: ben.id, status: 'active', end_reason: null,
    wish_title_snapshot: 'Kaffeemühle mit Handkurbel', created_at: ago(3), ended_at: null,
  }]

  // "Mitbringen" at Annas Einweihung: Anna brings one entry, Clara one, one is still open (invented). Ben — the one
  // who reserved a wish here — brings nothing: the screen tests prove he appears only as a member
  const potluck: PotluckRow[] = [
    { id: 'd1e01000-0000-4000-8000-000000000001', occasion_id: DEMO_OCCASIONS.housewarming, title: 'Sekt zum Anstoßen', created_by: anna.id, claimed_by: anna.id, created_at: minutesAfter(housewarmingCreated, 5) },
    { id: 'd1e01000-0000-4000-8000-000000000002', occasion_id: DEMO_OCCASIONS.housewarming, title: 'Knabberzeug', created_by: anna.id, claimed_by: null, created_at: minutesAfter(housewarmingCreated, 6) },
    { id: 'd1e01000-0000-4000-8000-000000000003', occasion_id: DEMO_OCCASIONS.housewarming, title: 'Musikbox', created_by: clara.id, claimed_by: clara.id, created_at: minutesAfter(housewarmingCreated, 7) },
  ]

  world.seed({
    people: [friend(anna), friend(ben), friend(clara)],
    occasions, members, wishlists, wishes, invites: [{ row: invite, token: DEMO_INVITE_TOKEN }], reservations, potluck,
  })
  // 30.10 "Passt zusammen": Anna linked the board game and the candle (a games evening)
  world.seedLink(...DEMO_TOGETHER_WISH_IDS)
}
