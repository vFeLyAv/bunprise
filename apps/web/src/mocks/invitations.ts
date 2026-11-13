import { http, HttpResponse, type JsonBodyType } from 'msw'
import { DEMO_PEOPLE } from './fixtures'
import { DEMO_LIST_PEOPLE } from './lists'
import { DEMO_SUPABASE_URL, DemoDbError, guarded, invalidBody, invalidInput, raise, readJson, sessionExpiredError } from './rest'
import { endOfLocalDay, localDayAt } from './time'
import type { DemoWorld, MemberRow, OccasionRow } from './world'

// The demo server's in-app invitations "Freunde einladen" — the rules of supabase/migrations/20261027120000_
// occasion_invitations.sql re-implemented in memory (docs/spec/in-app-invites-design.md v1.1): who may invite
// (host; a guest while "Gäste dürfen Freunde einladen" is on), whom (friends = accepted follows both ways), the 8
// silent suppressions, the ONE visibility rule for counter / list / acceptance, the sender's projection ("invited"
// whatever happened), quotas, the silence after a decline and the closed occasion. Synchronous like the world: one
// handler = one step (the demo's row locks). Void is terminal here as well: a read that finds a pending invitation
// invisible closes it for good (the database does it with triggers in the same transaction).
// The demo's friends: Paula has invited the first demo account into "Paulas Spieleabend"; Anna says yes to a demo
// account's invitation after a moment (Paula never answers — "Eingeladen" stays, like a friend who has not looked).

const DAY = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

type Outcome = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'void'
export type InvitationsFrom = 'friends' | 'nobody'

export interface InvitationRow {
  id: string
  occasion_id: string
  inviter_id: string
  invitee_id: string
  created_at: string
  expires_at: string
  delivered: boolean
  outcome: Outcome
  withdrawn_at: string | null
  live: boolean
}

/** The demo's own occasion of Paula (she invites the first demo account into it). */
export const DEMO_INVITE_OCCASION = 'd1e0b000-0000-4000-8000-000000000003'
const DEMO_INVITE_LIST = 'd1e0c000-0000-4000-8000-000000000003'
export const DEMO_INVITATION_ID = 'd1e01100-0000-4000-8000-000000000001'

export interface DemoInvitationsOptions {
  /** who answers a demo account's invitation with "Beitreten" (default: Anna); false = a quiet world (tests) */
  acceptors?: readonly string[] | false
  acceptDelayMs?: number
  schedule?: (run: () => void, ms: number) => void
}

export type DemoInvitations = ReturnType<typeof createDemoInvitations>

export function createDemoInvitations(world: DemoWorld, options: DemoInvitationsOptions = {}) {
  const t = world.internals
  const graph = world.follows
  const rows: InvitationRow[] = []
  const attempts: { sender: string; at: number }[] = []
  const refusals = new Map<string, string>() // `${occasion}:${invitee}` -> the title the person saw when declining
  const cooldowns = new Map<string, number>() // `${invitee}:${inviter}` -> until (ms)
  const invitedBy = new Map<string, string>() // `${occasion}:${member}` -> inviter
  const invitationsFrom = new Map<string, InvitationsFrom>()
  const fictional: ReadonlySet<string> = new Set([...Object.values(DEMO_PEOPLE), ...Object.values(DEMO_LIST_PEOPLE)].map((person): string => person.id))
  const acceptors: ReadonlySet<string> = new Set<string>(options.acceptors === false ? [] : options.acceptors ?? [DEMO_PEOPLE.anna.id])
  const schedule = options.schedule ?? ((run: () => void, ms: number) => {
    setTimeout(run, ms)
  })

  const now = () => t.clock()
  const occasion = (id: string | null): OccasionRow | undefined => (id === null ? undefined : t.occasions.get(id))
  const membership = (occasionId: string, profileId: string): MemberRow | undefined =>
    t.members.find((m) => m.occasion_id === occasionId && m.profile_id === profileId)
  const fromOf = (id: string): InvitationsFrom => invitationsFrom.get(id) ?? 'friends'
  const mutual = (a: string, b: string): boolean => a !== b && graph.isAcceptedFollower(a, b) && graph.isAcceptedFollower(b, a)
  const blocked = (a: string, b: string): boolean => graph.isBlockedPair(a, b)
  const cutoff = (o: OccasionRow): number => (o.all_day ? endOfLocalDay(Date.parse(o.starts_at), o.tz) : Date.parse(o.starts_at))
  const card = (viewer: string, id: string) => ({ id, display_name: t.nameOf(id), banner: world.profileSettingsOf(id).banner, ...t.profilePhotoFields(viewer, id) })

  function mayInvite(uid: string, o: OccasionRow | undefined): o is OccasionRow {
    if (!o || o.cancelled_at !== null || cutoff(o) <= now()) return false
    if (o.host_id === uid) return true
    const m = membership(o.id, uid)
    return o.guests_can_invite === true && m?.status === 'active' && m.role === 'member' && !blocked(uid, o.host_id)
  }

  function isCandidate(sender: string, person: string, o: OccasionRow): boolean {
    return person !== sender && t.people.has(person) && mutual(sender, person) && !blocked(sender, person)
      && membership(o.id, person)?.status !== 'active'
  }

  /** private.invitation_visible — and a pending invitation that fails it is closed for good (terminal void). */
  function visible(row: InvitationRow): boolean {
    if (!row.delivered || row.outcome !== 'pending' || Date.parse(row.expires_at) <= now()) return false
    const o = occasion(row.occasion_id)
    const m = o ? membership(o.id, row.invitee_id) : undefined
    const ok = o !== undefined && fromOf(row.invitee_id) === 'friends' && mayInvite(row.inviter_id, o)
      && mutual(row.inviter_id, row.invitee_id) && !blocked(row.invitee_id, row.inviter_id) && !blocked(row.invitee_id, o.host_id)
      && !refusals.has(`${o.id}:${row.invitee_id}`) && m?.status !== 'active'
      && !(m?.status === 'removed' && (row.inviter_id !== o.host_id || Date.parse(row.created_at) <= Date.parse(m.updated_at)))
    if (!ok) row.outcome = 'void'
    return ok
  }

  const visibleTo = (uid: string): InvitationRow[] =>
    rows.filter((row) => row.invitee_id === uid && visible(row))
      .sort((a, b) => byText(b.created_at, a.created_at) || byText(a.id, b.id))
      .slice(0, 20)

  /** private.invitation_sender_state */
  function senderState(row: InvitationRow): 'invited' | 'withdrawn' | 'accepted' | 'expired' {
    if (row.outcome === 'accepted') return 'accepted'
    if (Date.parse(row.expires_at) <= now()) return 'expired'
    return row.withdrawn_at !== null ? 'withdrawn' : 'invited'
  }

  const liveRow = (occasionId: string, inviter: string, invitee: string): InvitationRow | undefined =>
    rows.find((row) => row.live && row.occasion_id === occasionId && row.inviter_id === inviter && row.invitee_id === invitee)

  function deliverable(sender: string, invitee: string, o: OccasionRow): boolean {
    const m = membership(o.id, invitee)
    return fromOf(invitee) === 'friends' && !blocked(invitee, o.host_id)
      && !(sender !== o.host_id && m?.status === 'removed')
      && !refusals.has(`${o.id}:${invitee}`)
      && (cooldowns.get(`${invitee}:${sender}`) ?? 0) <= now()
      && !rows.some((row) => row.occasion_id === o.id && row.invitee_id === invitee && row.delivered && row.outcome === 'pending')
      && visibleTo(invitee).length < 20
      && !graph.hasFollowCooldown(invitee, sender)
  }

  function requireUser(uid: string): void {
    t.requireUser(uid)
  }

  // ---- the sender ------------------------------------------------------------------------------------------------

  function getInviteCandidates(uid: string, occasionId: string | null) {
    requireUser(uid)
    const o = occasion(occasionId)
    if (!mayInvite(uid, o)) throw raise('not_found')
    const friends = graph.followingOf(uid).filter((row) => row.status === 'accepted').map((row) => row.followee_id)
      .filter((id) => isCandidate(uid, id, o))
    return friends
      .map((id) => {
        const row = liveRow(o.id, uid, id)
        const state = row ? senderState(row) : 'expired'
        const shown = state === 'invited' || state === 'withdrawn' ? state : 'none'
        return { profile: card(uid, id), state: shown, expires_at: shown === 'none' ? null : row?.expires_at ?? null }
      })
      .sort((a, b) => byText(a.profile.display_name ?? '', b.profile.display_name ?? '') || byText(a.profile.id, b.profile.id))
  }

  function sendOccasionInvites(uid: string, occasionId: string | null, ids: readonly string[] | null) {
    requireUser(uid)
    if (!t.hasConsents(uid)) throw raise('consent_required')
    if (!t.profileComplete(uid)) throw raise('profile_incomplete')
    if (ids === null || ids.length < 1 || ids.length > 10) throw raise('validation')
    const o = occasion(occasionId)
    if (!mayInvite(uid, o)) throw raise('not_found')
    const unique = [...new Set(ids)].sort(byText)
    if (unique.some((id) => !isCandidate(uid, id, o))) throw raise('not_found')
    const at = now()
    // close what has expired: my own triples and the recipients' slots
    for (const row of rows) {
      if (Date.parse(row.expires_at) > at || !(row.inviter_id === uid || unique.includes(row.invitee_id))) continue
      row.live = false
      if (row.outcome === 'pending') row.outcome = 'void'
    }
    const fresh = unique.filter((id) => !liveRow(o.id, uid, id))
    const since = (ms: number) => attempts.filter((a) => a.sender === uid && a.at > at - ms).length
    const open = rows.filter((row) => row.inviter_id === uid && row.live && Date.parse(row.expires_at) > at && row.outcome !== 'accepted' && row.withdrawn_at === null).length
    if (fresh.length > 0 && (since(60_000) + fresh.length > 5 || since(DAY) + fresh.length > 10 || since(7 * DAY) + fresh.length > 30 || open + fresh.length > 30)) {
      throw raise('limit_reached')
    }
    const expires = new Date(Math.min(at + 7 * DAY, cutoff(o))).toISOString()
    for (const id of fresh) {
      attempts.push({ sender: uid, at })
      rows.push({
        id: crypto.randomUUID(), occasion_id: o.id, inviter_id: uid, invitee_id: id, created_at: t.stamp(), expires_at: expires,
        delivered: deliverable(uid, id, o), outcome: 'pending', withdrawn_at: null, live: true,
      })
      scheduleAnswer(uid, id, o.id)
    }
    return unique.map((id) => {
      const row = liveRow(o.id, uid, id)
      return { profile_id: id, state: row ? senderState(row) : 'invited', expires_at: row?.expires_at ?? expires }
    })
  }

  function withdrawOccasionInvite(uid: string, occasionId: string | null, profileId: string | null) {
    requireUser(uid)
    const o = occasion(occasionId)
    const row = o && profileId ? liveRow(o.id, uid, profileId) : undefined
    if (!row || !o || !profileId || Date.parse(row.expires_at) <= now() || row.outcome === 'accepted'
        || !mayInvite(uid, o) || !mutual(uid, profileId) || blocked(uid, profileId)) throw raise('not_found')
    row.withdrawn_at ??= new Date(now()).toISOString()
    if (row.outcome === 'pending') row.outcome = 'withdrawn'
    return { ok: true }
  }

  function getSentInvitations(uid: string, occasionId: string | null) {
    requireUser(uid)
    const o = occasion(occasionId)
    if (!mayInvite(uid, o)) throw raise('not_found')
    const newest = new Map<string, InvitationRow>()
    for (const row of rows) {
      if (row.occasion_id !== o.id || row.inviter_id !== uid) continue
      if (!(row.outcome === 'accepted' || (row.live && Date.parse(row.expires_at) > now()))) continue
      const seen = newest.get(row.invitee_id)
      if (!seen || seen.created_at < row.created_at) newest.set(row.invitee_id, row)
    }
    return [...newest.values()]
      .filter((row) => mutual(uid, row.invitee_id) && !blocked(uid, row.invitee_id))
      .sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
      .map((row) => ({ profile_id: row.invitee_id, display_name: t.nameOf(row.invitee_id), state: senderState(row), expires_at: row.expires_at }))
  }

  function getOccasionInviteInfo(uid: string, occasionId: string | null) {
    requireUser(uid)
    const o = occasion(occasionId)
    if (!o || !t.isActiveMember(o.id, uid) || blocked(uid, o.host_id)) throw raise('not_found')
    const invited = o.host_id !== uid ? [] : t.members
      .filter((m) => m.occasion_id === o.id && m.status === 'active' && invitedBy.has(`${o.id}:${m.profile_id}`))
      .flatMap((m) => {
        const inviter = invitedBy.get(`${o.id}:${m.profile_id}`) ?? ''
        const ok = t.isActiveMember(o.id, inviter) && !blocked(inviter, o.host_id) && !blocked(m.profile_id, o.host_id)
        return ok ? [{ profile_id: m.profile_id, inviter: { id: inviter, display_name: t.nameOf(inviter) } }] : []
      })
      .sort((a, b) => byText(a.profile_id, b.profile_id))
    return { guests_can_invite: o.guests_can_invite === true, can_invite: mayInvite(uid, o), invited_by: invited }
  }

  // ---- the invitee -----------------------------------------------------------------------------------------------

  function getMyInvitations(uid: string) {
    requireUser(uid)
    return visibleTo(uid).flatMap((row) => {
      const o = occasion(row.occasion_id)
      if (!o) return []
      return [{
        id: row.id, occasion: { id: o.id, title: o.title, starts_at: o.starts_at, tz: o.tz, all_day: o.all_day },
        host_name: t.nameOf(o.host_id), from_host: row.inviter_id === o.host_id, inviter: card(uid, row.inviter_id),
        expires_at: row.expires_at, created_at: row.created_at,
      }]
    })
  }

  function accept(uid: string, row: InvitationRow): { occasion_id: string } {
    const o = occasion(row.occasion_id)
    if (!o || !visible(row)) throw raise('invite_invalid')
    row.outcome = 'accepted'
    row.live = false
    const at = t.stamp()
    const existing = membership(o.id, uid)
    if (existing) Object.assign(existing, { status: 'active', invited_via: null, rsvp: 'none', joined_at: at, updated_at: at })
    else t.members.push({ occasion_id: o.id, profile_id: uid, role: 'member', rsvp: 'none', status: 'active', invited_via: null, joined_at: at, updated_at: at })
    // the membership trigger: every other pending invitation into this occasion is done; a new "eingeladen von"
    for (const other of rows) if (other.occasion_id === o.id && other.invitee_id === uid && other.outcome === 'pending') other.outcome = 'void'
    invitedBy.delete(`${o.id}:${uid}`)
    if (row.inviter_id !== o.host_id) invitedBy.set(`${o.id}:${uid}`, row.inviter_id)
    return { occasion_id: o.id }
  }

  function respondOccasionInvite(uid: string, invitationId: string | null, answer: boolean | null) {
    requireUser(uid)
    if (answer === null) throw raise('validation')
    if (answer) {
      if (!t.hasConsents(uid)) throw raise('consent_required')
      if (!t.profileComplete(uid)) throw raise('profile_incomplete')
    }
    const row = rows.find((r) => r.id === invitationId && r.invitee_id === uid)
    if (!row) throw raise('invite_invalid')
    if (answer) return accept(uid, row)
    if (!visible(row)) throw raise('invite_invalid')
    row.outcome = 'declined'
    refusals.set(`${row.occasion_id}:${uid}`, occasion(row.occasion_id)?.title ?? '')
    const key = `${uid}:${row.inviter_id}`
    cooldowns.set(key, Math.max(cooldowns.get(key) ?? 0, now() + 30 * DAY))
    return { ok: true }
  }

  function exportMyInvitations(uid: string) {
    requireUser(uid)
    const titleOf = (id: string) => occasion(id)?.title ?? null
    return {
      format: 'bunprise-invitations-v1',
      settings: { invitations_from: fromOf(uid) },
      received: rows.filter((row) => row.invitee_id === uid && row.delivered).map((row) => {
        const o = occasion(row.occasion_id)
        // the live title / host name only while the person may see them; a declined one: the title as seen then
        const sees = o !== undefined && ((row.outcome === 'pending' && visible(row)) || (row.outcome === 'accepted' && t.isActiveMember(o.id, uid)))
        return {
          occasion_title: sees ? o.title : row.outcome === 'declined' ? refusals.get(`${row.occasion_id}:${uid}`) ?? null : null,
          host_name: sees ? t.nameOf(o.host_id) : null,
          inviter_name: graph.knowsProfile(uid, row.inviter_id, t.sharesOccasion) ? t.nameOf(row.inviter_id) : null,
          created_at: row.created_at, expires_at: row.expires_at,
          decision: row.outcome === 'accepted' ? 'accepted' : row.outcome === 'declined' ? 'declined' : row.outcome === 'pending' && visible(row) ? 'open' : 'closed',
        }
      }),
      sent: rows.filter((row) => row.inviter_id === uid).map((row) => ({
        profile_id: row.invitee_id,
        display_name: mutual(uid, row.invitee_id) && !blocked(uid, row.invitee_id) ? t.nameOf(row.invitee_id) : null,
        occasion_title: t.isActiveMember(row.occasion_id, uid) ? titleOf(row.occasion_id) : null,
        state: senderState(row), created_at: row.created_at, expires_at: row.expires_at,
      })),
      refusals: [...refusals].filter(([key]) => key.endsWith(`:${uid}`)).map(([, title]) => ({ occasion_title: title, created_at: null })),
      silences: [...cooldowns].filter(([key, until]) => key.startsWith(`${uid}:`) && until > now())
        .map(([key, until]) => ({ inviter_name: t.nameOf(key.split(':')[1] ?? ''), until: new Date(until).toISOString() })),
      attempts: attempts.filter((a) => a.sender === uid).map((a) => new Date(a.at).toISOString()),
      hosted: [...t.occasions.values()].filter((o) => o.host_id === uid).map((o) => ({ occasion_title: o.title, guests_can_invite: o.guests_can_invite === true })),
      invited_by: [...invitedBy].filter(([key]) => key.endsWith(':' + uid)).map(([key, inviter]) => ({
        occasion_title: titleOf(key.split(':')[0] ?? ''), inviter_name: graph.knowsProfile(uid, inviter, t.sharesOccasion) ? t.nameOf(inviter) : null })),
      joined_through_me: [...invitedBy].filter(([, inviter]) => inviter === uid).map(([key]) => {
        const [occasionId = '', member = ''] = key.split(':')
        return { occasion_title: t.isActiveMember(occasionId, uid) ? titleOf(occasionId) : null, display_name: graph.knowsProfile(uid, member, t.sharesOccasion) ? t.nameOf(member) : null }
      }),
    }
  }

  // ---- the demo's friends ----------------------------------------------------------------------------------------

  /** Anna joins a demo account's invitation after a moment — only while she still sees it (withdrawn: nothing). */
  function scheduleAnswer(sender: string, invitee: string, occasionId: string): void {
    if (!acceptors.has(invitee) || fictional.has(sender)) return
    schedule(() => {
      const row = rows.find((r) => r.occasion_id === occasionId && r.inviter_id === sender && r.invitee_id === invitee && r.outcome === 'pending')
      if (row && visible(row)) accept(invitee, row)
    }, options.acceptDelayMs ?? 3_000)
  }

  /** Paula's "Spieleabend" (Anna is a guest) and Paula's invitation of the first demo account; Anna's housewarming
   *  lets guests invite (the demo account joins it as a guest and can invite Paula from there). */
  function seedDemo(me: string, nowMs: number = Date.now()): void {
    const { anna } = DEMO_PEOPLE
    const { paula } = DEMO_LIST_PEOPLE
    const created = new Date(nowMs - 2 * DAY).toISOString()
    const starts = new Date(localDayAt(nowMs, 'Europe/Berlin', 12, 19, 0)).toISOString()
    world.seed({
      people: [], invites: [], reservations: [],
      occasions: [{
        id: DEMO_INVITE_OCCASION, host_id: paula.id, title: 'Paulas Spieleabend', starts_at: starts, ends_at: null, tz: 'Europe/Berlin',
        all_day: false, place_text: 'Bei Paula, Lindenweg', description: 'Brettspiele, Snacks und gute Laune.', cancelled_at: null,
        created_at: created, updated_at: created, sections: 'wishes',
      }],
      members: [
        { occasion_id: DEMO_INVITE_OCCASION, profile_id: paula.id, role: 'host', rsvp: 'going', status: 'active', invited_via: null, joined_at: created, updated_at: created },
        { occasion_id: DEMO_INVITE_OCCASION, profile_id: anna.id, role: 'member', rsvp: 'going', status: 'active', invited_via: null, joined_at: created, updated_at: created },
      ],
      wishlists: [{ id: DEMO_INVITE_LIST, occasion_id: DEMO_INVITE_OCCASION, owner_id: paula.id, recipient_id: paula.id, title: 'Paulas Spieleabend', created_at: created, updated_at: created }],
      wishes: [
        { id: 'd1e0d000-0000-4000-8000-000000000501', wishlist_id: DEMO_INVITE_LIST, title: 'Kartenspiel für große Runden', price_cents: 1500, currency: 'EUR', url: null, note: null, priority: 3, created_at: created, updated_at: created },
        { id: 'd1e0d000-0000-4000-8000-000000000502', wishlist_id: DEMO_INVITE_LIST, title: 'Sanduhr aus Holz', price_cents: 900, currency: 'EUR', url: null, note: null, priority: 1, created_at: created, updated_at: created },
      ],
    })
    const housewarming = t.occasions.get('d1e0b000-0000-4000-8000-000000000001')
    if (housewarming) housewarming.guests_can_invite = true
    rows.push({
      id: DEMO_INVITATION_ID, occasion_id: DEMO_INVITE_OCCASION, inviter_id: paula.id, invitee_id: me,
      created_at: new Date(nowMs - 3 * 3_600_000).toISOString(), expires_at: new Date(nowMs + 6 * DAY).toISOString(),
      delivered: true, outcome: 'pending', withdrawn_at: null, live: true,
    })
  }

  /** get_me's inbox.occasion_invites */
  const inboxCount = (uid: string): number => visibleTo(uid).length

  /** "Niemand" voids every pending invitation (trigger profiles_invitations_from) */
  function setInvitationsFrom(uid: string, value: InvitationsFrom): void {
    invitationsFrom.set(uid, value)
    if (value === 'nobody') for (const row of rows) if (row.invitee_id === uid && row.outcome === 'pending') row.outcome = 'void'
  }

  // ---- HTTP ------------------------------------------------------------------------------------------------------

  type ParamType = 'uuid' | 'uuids' | 'boolean'
  type Arg = string | string[] | boolean | null

  function handlers(viewerOf: (request: Request) => string | null) {
    const rest = `${DEMO_SUPABASE_URL}/rest/v1`
    const viewer = (request: Request): string => {
      const id = viewerOf(request)
      if (id === null) throw sessionExpiredError()
      return id
    }
    const uuid = (value: unknown): string => {
      if (typeof value !== 'string' || !UUID.test(value)) throw invalidInput('uuid')
      return value.toLowerCase()
    }
    function rpc(name: string, params: Readonly<Record<string, ParamType>>, run: (me: string, args: Readonly<Record<string, Arg>>) => JsonBodyType) {
      return http.post(`${rest}/rpc/${name}`, ({ request }) => guarded(async () => {
        const input = (await readJson(request)) ?? {}
        if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalidBody()
        const given = Object.keys(input)
        const expected = Object.keys(params)
        if (given.length !== expected.length || given.some((key) => !expected.includes(key))) {
          throw new DemoDbError('PGRST202', `Could not find the function public.${name}(${given.join(', ')}) in the schema cache`, 404)
        }
        const args: Record<string, Arg> = {}
        for (const [key, type] of Object.entries(params)) {
          const value = (input as Record<string, unknown>)[key]
          if (value === null || value === undefined) args[key] = null
          else if (type === 'uuid') args[key] = uuid(value)
          else if (type === 'uuids') {
            if (!Array.isArray(value)) throw invalidInput('uuid[]')
            args[key] = value.map(uuid)
          } else {
            if (typeof value !== 'boolean') throw invalidInput('boolean')
            args[key] = value
          }
        }
        return HttpResponse.json(run(viewer(request), args))
      }))
    }
    const str = (value: Arg): string | null => (typeof value === 'string' ? value : null)
    return [
      rpc('get_invite_candidates', { p_occasion_id: 'uuid' }, (me, a) => getInviteCandidates(me, str(a.p_occasion_id ?? null))),
      rpc('send_occasion_invites', { p_occasion_id: 'uuid', p_profile_ids: 'uuids' },
        (me, a) => sendOccasionInvites(me, str(a.p_occasion_id ?? null), Array.isArray(a.p_profile_ids) ? a.p_profile_ids : null)),
      rpc('withdraw_occasion_invite', { p_occasion_id: 'uuid', p_profile_id: 'uuid' },
        (me, a) => withdrawOccasionInvite(me, str(a.p_occasion_id ?? null), str(a.p_profile_id ?? null))),
      rpc('get_sent_invitations', { p_occasion_id: 'uuid' }, (me, a) => getSentInvitations(me, str(a.p_occasion_id ?? null))),
      rpc('get_occasion_invite_info', { p_occasion_id: 'uuid' }, (me, a) => getOccasionInviteInfo(me, str(a.p_occasion_id ?? null))),
      rpc('get_my_invitations', {}, (me) => getMyInvitations(me)),
      rpc('respond_occasion_invite', { p_invitation_id: 'uuid', p_accept: 'boolean' },
        (me, a) => respondOccasionInvite(me, str(a.p_invitation_id ?? null), typeof a.p_accept === 'boolean' ? a.p_accept : null)),
      rpc('export_my_invitations', {}, (me) => exportMyInvitations(me) as JsonBodyType),
    ]
  }

  return {
    handlers, seedDemo, inboxCount, setInvitationsFrom, invitationsFromOf: fromOf,
    // the RPC bodies, for the tests (the same functions the handlers call)
    api: {
      getInviteCandidates, sendOccasionInvites, withdrawOccasionInvite, getSentInvitations, getOccasionInviteInfo, getMyInvitations,
      respondOccasionInvite, exportMyInvitations,
    },
    rows,
  }
}
