import type { Session, User } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import type { Consent, ConsentKind, LegalVersion, Locale, Me, Profile } from '../lib/api/types'
import { LEGAL_VERSIONS } from '../lib/legal'
import { DEMO_OCCASIONS, DEMO_PEOPLE, DEMO_RESERVED_WISH_ID, seedDemoWorld } from './fixtures'
import { applyQuery, body, DEMO_SUPABASE_URL, guarded, parseQuery, record, respondRows, restError } from './rest'
import { createSocialHandlers } from './social'
import { createLinkPreviewHandlers } from './linkPreview'
import { createPlacesHandlers } from './places'
import { createGiftIdeasHandlers } from './giftIdeas'
import { createDemoPhotos, createPhotoHandlers } from './photos'
import { createDemoWishPhotos, createWishPhotoHandlers } from './wishPhotos'
import { createLinkImageHandlers } from './linkImage'
import { createShopIconHandlers } from './shopIcons'
import { BANNER_KEYS, createDemoWorld, PROFILES } from './world'
import { createListsHandlers, DEMO_LIST_PEOPLE, DEMO_LISTS, seedListsDemo } from './lists'
import { createDemoListPhotos, createListPhotoHandlers, DEMO_LIST_COVERS } from './listPhotos'
import { createDemoProfilePhotos, createProfilePhotoHandlers, DEMO_PROFILE_PHOTOS } from './profilePhotos'
import { createFollowsHandlers, followsExportFor, seedFollowsDemo } from './follows'
import { createDemoInvitations } from './invitations'
import { createDemoPush } from './push'
import { createDemoCalendar } from './calendar'
import { createDemoInviteEmail } from './inviteEmail'

export { DEMO_SUPABASE_URL } from './rest'
export { DEMO_INVITE_TOKEN, DEMO_OCCASIONS, DEMO_PEOPLE, DEMO_RESERVED_WISH_ID } from './fixtures'
export const DEMO_CODE = '123456'
export const DEMO_USER_ID = '7dd43443-0cb4-43c9-af4f-2c16a3d58ec5'
const SESSION_SECONDS = 15 * 60

interface PendingCode {
  email: string
  locale: Locale
  expiresAt: number
}

interface DemoAccount {
  user: User
  profile: Profile
  consents: Consent[]
  /** joined "Annas Einweihung" once after finishing the profile (never again after leaving it) */
  enrolled: boolean
}

const CONSENT_KINDS = Object.keys(LEGAL_VERSIONS) as ConsentKind[]
const PROFILE_READ_COLUMNS = ['id', 'display_name'] as const
// wave 2b (follows-design §4.4): + banner (M1) and in_suggestions (M3) — writable, never readable through REST
// 20261027120000: + invitations_from ("Einladungen in Anlässe") — the same pattern, never REST-readable
const PROFILE_WRITE_COLUMNS = ['display_name', 'locale', 'onboarding_done_at', 'banner', 'in_suggestions', 'invitations_from'] as const
const CONSENT_COLUMNS = ['profile_id', 'kind', 'version', 'locale', 'accepted_at'] as const

function projection(request: Request, allowed: readonly string[], allowStar = true): string[] | null {
  const selected = new URL(request.url).searchParams.get('select') ?? '*'
  if (selected === '*' && allowStar) return [...allowed]
  const columns = selected.split(',').map((value) => value.trim())
  return columns.length > 0 && columns.every((column) => allowed.includes(column)) ? columns : null
}

function selectedRows(request: Request, values: readonly Record<string, unknown>[], columns: readonly string[]): Response {
  const projected = values.map((value) => Object.fromEntries(columns.map((column) => [column, value[column]])))
  if (request.headers.get('accept')?.includes('application/vnd.pgrst.object+json')) {
    if (projected.length !== 1) return restError('PGRST116', 'Expected one row', 406)
    return HttpResponse.json(projected[0])
  }
  return HttpResponse.json(projected)
}

function matchesIdFilter(request: Request, column: string, value: string): boolean {
  const filter = new URL(request.url).searchParams.get(column)
  return filter === null || filter === `eq.${value}`
}

function authError(code: string, message: string, status = 400): Response {
  return HttpResponse.json({ code, msg: message }, { status, headers: { 'X-Supabase-Api-Version': '2024-01-01' } })
}

function base64url(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * The whole local demo server (docs/demo-mode.md): auth, profiles, legal records, account rights and
 * the shared fictional world of src/mocks/fixtures.ts. Invented data only. Accounts and the world
 * survive sign-out and reset when the page reloads.
 */
export function createDemoHandlers() {
  let pending: PendingCode | null = null
  let accountCount = 0
  const accounts = new Map<string, DemoAccount>()
  // One live session per account (a new sign-in or a refresh replaces it). Different accounts may be
  // signed in at the same time from different clients, like separate devices against hosted Auth.
  const sessions = new Map<string, Session>()
  const legalVersions: LegalVersion[] = CONSENT_KINDS.map((kind) => ({
    kind, version: LEGAL_VERSIONS[kind], published_at: new Date().toISOString(),
  }))
  // Anna, Ben, Clara and their occasions — the same for every demo account.
  const world = createDemoWorld()
  seedDemoWorld(world)
  // occasion cover photos (src/mocks/photos.ts): the screen shows their meta, "Annas Einweihung" has one
  const photos = createDemoPhotos(world)
  world.setPhotoMetaSource(photos.metaOf)
  photos.seedDemoCover()
  // wish photos (src/mocks/wishPhotos.ts): every wish answer shows their meta; the coffee grinder has a demo picture
  const wishPhotos = createDemoWishPhotos(world)
  world.setWishPhotoMetaSource(wishPhotos.metaOf)
  wishPhotos.seedDemoPhoto(DEMO_RESERVED_WISH_ID)
  // wave 2b (src/mocks/lists.ts): Paula, Finn, Greta, Rosa, the friends' lists and who follows whom — around the
  // FIRST account of this page load (DEMO_USER_ID; its own "Meine" starts empty, a second account sees no friends)
  seedListsDemo(world, DEMO_USER_ID)
  // list covers (src/mocks/listPhotos.ts, 20261022160000): every answer with a list shows their meta; Anna's
  // "Geburtstag" and Paula's "Weihnachten" start with an invented cover
  const listPhotos = createDemoListPhotos(world)
  world.setListPhotoMetaSource(listPhotos.metaOf)
  listPhotos.seedDemoCover(DEMO_LISTS.annaBirthday, DEMO_LIST_COVERS.birthday())
  listPhotos.seedDemoCover(DEMO_LISTS.paulaChristmas, DEMO_LIST_COVERS.christmas())
  // wave 2b, follows (src/mocks/follows.ts): Anna's and Clara's follow links and Clara's list for her followers
  seedFollowsDemo(world)
  // in-app invitations "Freunde einladen" (src/mocks/invitations.ts, 20261027120000): Paula invited the first account into
  // her "Spieleabend"; Anna's housewarming lets its guests invite; Anna says yes to an invitation after a moment
  const invitations = createDemoInvitations(world)
  // Web Push (src/mocks/push.ts, 20261027150000): devices + preference in memory, a fake VAPID key; no real push
  const push = createDemoPush()
  // the invitation e-mail opt-in (src/mocks/inviteEmail.ts, 20261028000000): the switch in memory; no mail is ever sent
  const inviteEmail = createDemoInviteEmail()
  invitations.seedDemo(DEMO_USER_ID)
  // Kalender-Abo + birthday suggestion (src/mocks/calendar.ts, 20261027170000): the feed RPCs in memory; two past
  // birthdays of the first account a year ago, so Start shows the suggestion
  const calendar = createDemoCalendar(world)
  calendar.seedDemo(DEMO_USER_ID)
  // own profile / banner photos (src/mocks/profilePhotos.ts, 20261024120000): every answer that shows a person carries
  // their meta as the viewer may see it; Anna has a profile photo and a banner photo, Paula a profile photo
  // (invented illustrations: a sunflower, hills at sunrise, a cup of tea)
  const profilePhotos = createDemoProfilePhotos(world)
  world.setProfilePhotoSource({
    fieldsFor: profilePhotos.fieldsFor,
    ownFields: (id) => ({ photo: profilePhotos.ownMeta(id, 'avatar'), banner_photo: profilePhotos.ownMeta(id, 'banner') }),
  })
  profilePhotos.seedDemoPhoto(DEMO_PEOPLE.anna.id, 'avatar', DEMO_PROFILE_PHOTOS.annaAvatar)
  profilePhotos.seedDemoPhoto(DEMO_PEOPLE.anna.id, 'banner', DEMO_PROFILE_PHOTOS.annaBanner)
  profilePhotos.seedDemoPhoto(DEMO_LIST_PEOPLE.paula.id, 'avatar', DEMO_PROFILE_PHOTOS.paulaAvatar)

  function consentsOk(account: DemoAccount): boolean {
    return legalVersions.every((version) => account.consents.some((consent) => consent.kind === version.kind && consent.version === version.version))
  }

  function accountForEmail(email: string, locale: Locale): DemoAccount {
    const existing = accounts.get(email)
    if (existing) return existing
    const timestamp = new Date().toISOString()
    const user: User = {
      id: accountCount++ === 0 ? DEMO_USER_ID : crypto.randomUUID(),
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { locale },
      identities: [],
    }
    const account: DemoAccount = {
      user,
      profile: { id: user.id, display_name: null, locale, onboarding_done_at: null, created_at: timestamp, updated_at: timestamp },
      consents: [],
      enrolled: false,
    }
    accounts.set(email, account)
    world.addPerson({ id: user.id, displayName: () => account.profile.display_name, hasConsents: () => consentsOk(account) })
    return account
  }

  /** A finished profile (name + current legal records) joins "Annas Einweihung" once: the guest view is there at once. */
  function enrollWhenComplete(account: DemoAccount): void {
    if (account.enrolled || account.profile.display_name === null || !consentsOk(account)) return
    account.enrolled = true
    world.addGuest(DEMO_OCCASIONS.housewarming, account.user.id)
  }

  function issueSession(account: DemoAccount): Session {
    const now = Math.floor(Date.now() / 1000)
    // Only the demo server reads this token; it is never a valid production JWT.
    const payload = { sub: account.user.id, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + SESSION_SECONDS, jti: crypto.randomUUID() }
    const accessToken = `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url(JSON.stringify(payload))}.demo-signature`
    const issued: Session = {
      access_token: accessToken,
      refresh_token: crypto.randomUUID(),
      token_type: 'bearer',
      expires_in: SESSION_SECONDS,
      expires_at: now + SESSION_SECONDS,
      user: account.user,
    }
    sessions.set(account.user.id, issued)
    return issued
  }

  /** The live, unexpired session of an existing account that this request's bearer token belongs to. */
  function sessionFor(request: Request): Session | null {
    const authorization = request.headers.get('authorization')
    if (!authorization) return null
    for (const candidate of sessions.values()) {
      if (authorization !== `Bearer ${candidate.access_token}`) continue
      const owner = accounts.get(candidate.user.email ?? '')
      return (candidate.expires_at ?? 0) > Date.now() / 1000 && owner?.user.id === candidate.user.id ? candidate : null
    }
    return null
  }

  function currentAccount(request: Request): DemoAccount | null {
    const live = sessionFor(request)
    return live ? accounts.get(live.user.email ?? '') ?? null : null
  }

  function getMe(account: DemoAccount): Me {
    const { id, display_name, locale, onboarding_done_at } = account.profile
    // wave 2b (M1–M3 get_me): + profile.banner, profile.in_suggestions, inbox.follow_requests (VISIBLE requests only);
    // 20261024120000: + profile.photo, profile.banner_photo (the own photos' meta)
    const settings = world.profileSettingsOf(id)
    const requests = world.follows.visibleRequestsTo(id).filter((row) => world.internals.people.has(row.follower_id)).length
    return {
      // 20261027120000: + profile.invitations_from, inbox.occasion_invites (the invitations VISIBLE to me: the dot on Start)
      profile: { id, display_name, locale, onboarding_done_at, banner: settings.banner, in_suggestions: settings.in_suggestions, ...world.internals.ownProfilePhotos(id), invitations_from: invitations.invitationsFromOf(id) },
      consents_ok: consentsOk(account),
      legal_versions: { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy_notice, age: LEGAL_VERSIONS.age_18plus },
      inbox: { follow_requests: requests, occasion_invites: invitations.inboxCount(id) },
    }
  }

  return [
    http.post(`${DEMO_SUPABASE_URL}/auth/v1/otp`, async ({ request }) => {
      const input = await body(request)
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return authError('email_address_invalid', 'Invalid email address', 422)
      }
      if (input.create_user === false && !accounts.has(email)) {
        pending = null
        return HttpResponse.json({}) // Neutral response; no code and no new account.
      }
      const metadata = record(input.data)
      pending = { email, locale: metadata.locale === 'en' ? 'en' : 'de', expiresAt: Date.now() + 10 * 60_000 }
      // No mail is sent. The demo UI explains its fixed code before submission.
      return HttpResponse.json({})
    }),
    http.post(`${DEMO_SUPABASE_URL}/auth/v1/verify`, async ({ request }) => {
      const input = await body(request)
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
      if (!pending || pending.email !== email || pending.expiresAt <= Date.now()) {
        return authError('otp_expired', 'The demo code is invalid or expired', 403)
      }
      if (input.type !== 'email' || input.token !== DEMO_CODE) {
        return authError('invalid_credentials', 'The demo code is incorrect', 403)
      }
      const result = issueSession(accountForEmail(pending.email, pending.locale))
      pending = null // The fixed code is still one-time for each request.
      return HttpResponse.json(result)
    }),
    http.post(`${DEMO_SUPABASE_URL}/auth/v1/token`, async ({ request }) => {
      const input = await body(request)
      if (new URL(request.url).searchParams.get('grant_type') !== 'refresh_token') {
        return authError('validation_failed', 'Only email codes are supported in this demo')
      }
      const live = [...sessions.values()].find((candidate) => candidate.refresh_token === input.refresh_token)
      const account = live ? accounts.get(live.user.email ?? '') : undefined
      if (!live || !account || account.user.id !== live.user.id) return authError('refresh_token_not_found', 'The demo session has ended', 400)
      return HttpResponse.json(issueSession(account))
    }),
    http.get(`${DEMO_SUPABASE_URL}/auth/v1/user`, ({ request }) => {
      const live = sessionFor(request)
      return live ? HttpResponse.json(live.user) : authError('session_not_found', 'The demo session has ended', 401)
    }),
    http.post(`${DEMO_SUPABASE_URL}/auth/v1/logout`, ({ request }) => {
      const live = sessionFor(request)
      if (!live) return authError('session_not_found', 'The demo session has ended', 401)
      sessions.delete(live.user.id)
      pending = null
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${DEMO_SUPABASE_URL}/rest/v1/rpc/get_me`, ({ request }) => {
      const account = currentAccount(request)
      return account ? HttpResponse.json(getMe(account)) : restError('PGRST301', 'Session expired', 401)
    }),
    http.get(`${DEMO_SUPABASE_URL}/rest/v1/profiles`, ({ request }) => guarded(() => {
      const account = currentAccount(request)
      if (!account) return restError('PGRST301', 'Session expired', 401)
      // RLS profiles_select: me + people from a shared active occasion; column grant: id + display_name only.
      const query = parseQuery(request, PROFILES)
      return respondRows(request, applyQuery(world.profileRows(account.user.id), query), query.columns)
    })),
    http.patch(`${DEMO_SUPABASE_URL}/rest/v1/profiles`, async ({ request }) => {
      const account = currentAccount(request)
      if (!account) return restError('PGRST301', 'Session expired', 401)
      const returning = request.headers.get('prefer')?.includes('return=representation') === true
      const columns = returning ? projection(request, PROFILE_READ_COLUMNS, false) : []
      if (!columns) return restError('42501', 'Profile column is not readable')
      const input = await body(request)
      if (Object.keys(input).some((key) => !(PROFILE_WRITE_COLUMNS as readonly string[]).includes(key))) {
        return restError('42501', 'Profile column is not writable')
      }
      if ('display_name' in input) {
        const name = input.display_name
        if (name !== null && (typeof name !== 'string' || name !== name.trim() || [...name].length < 1 || [...name].length > 40 || ['\n', '\r', '\t'].some((control) => name.includes(control)))) {
          return restError('23514', 'Invalid display name', 400)
        }
      }
      if ('locale' in input && input.locale !== 'de' && input.locale !== 'en') return restError('23514', 'Invalid locale', 400)
      if ('onboarding_done_at' in input && input.onboarding_done_at !== null && (typeof input.onboarding_done_at !== 'string' || !Number.isFinite(Date.parse(input.onboarding_done_at)))) {
        return restError('22007', 'Invalid onboarding timestamp', 400)
      }
      if ('banner' in input && input.banner !== null && !(typeof input.banner === 'string' && BANNER_KEYS.includes(input.banner))) {
        return restError('23514', 'new row violates check constraint "profiles_banner_check"', 400)
      }
      if ('in_suggestions' in input && typeof input.in_suggestions !== 'boolean') {
        return input.in_suggestions === null
          ? restError('23502', 'null value in column "in_suggestions" violates not-null constraint', 400)
          : restError('22P02', 'invalid input syntax for type boolean', 400)
      }
      if ('invitations_from' in input && input.invitations_from !== 'friends' && input.invitations_from !== 'nobody') {
        return restError('23514', 'new row violates check constraint "profiles_invitations_from_check"', 400)
      }
      if (!matchesIdFilter(request, 'id', account.profile.id)) {
        return returning ? selectedRows(request, [], columns) : new HttpResponse(null, { status: 204 })
      }
      // Validate the entire patch before mutating the local account, just like one SQL statement.
      if ('display_name' in input) account.profile.display_name = input.display_name as string | null
      if ('locale' in input) account.profile.locale = input.locale as Locale
      if ('onboarding_done_at' in input) account.profile.onboarding_done_at = input.onboarding_done_at === null ? null : new Date(input.onboarding_done_at as string).toISOString()
      if ('banner' in input) world.setProfileSettings(account.user.id, { banner: input.banner as string | null })
      if ('in_suggestions' in input) world.setProfileSettings(account.user.id, { in_suggestions: input.in_suggestions as boolean })
      if ('invitations_from' in input) invitations.setInvitationsFrom(account.user.id, input.invitations_from as 'friends' | 'nobody')
      account.profile.updated_at = new Date().toISOString()
      enrollWhenComplete(account)
      return returning ? selectedRows(request, [{ ...account.profile }], columns) : new HttpResponse(null, { status: 204 })
    }),
    http.get(`${DEMO_SUPABASE_URL}/rest/v1/legal_versions`, ({ request }) => {
      if (!currentAccount(request)) return restError('PGRST301', 'Session expired', 401)
      const columns = projection(request, ['kind', 'version', 'published_at'])
      return columns ? selectedRows(request, legalVersions.map((version) => ({ ...version })), columns) : restError('42501', 'Legal-version column is not readable')
    }),
    http.get(`${DEMO_SUPABASE_URL}/rest/v1/consents`, ({ request }) => {
      const account = currentAccount(request)
      if (!account) return restError('PGRST301', 'Session expired', 401)
      const columns = projection(request, CONSENT_COLUMNS)
      if (!columns) return restError('42501', 'Legal-record column is not readable')
      const matching = matchesIdFilter(request, 'profile_id', account.profile.id) ? account.consents.map((consent) => ({ ...consent })) : []
      return selectedRows(request, matching, columns)
    }),
    http.post(`${DEMO_SUPABASE_URL}/rest/v1/consents`, async ({ request }) => {
      const account = currentAccount(request)
      if (!account) return restError('PGRST301', 'Session expired', 401)
      let payload: unknown
      try { payload = await request.json() } catch { return restError('PGRST102', 'Invalid JSON', 400) }
      const values = Array.isArray(payload) ? payload : [payload]
      const staged: Consent[] = []
      const prefer = request.headers.get('prefer') ?? ''
      const returning = prefer.includes('return=representation')
      const columns = returning ? projection(request, CONSENT_COLUMNS) : []
      if (!columns) return restError('42501', 'Legal-record column is not readable')
      if (prefer.includes('resolution=merge-duplicates')) return restError('42501', 'Legal records are append-only')
      for (const value of values) {
        const input = record(value)
        if (Object.keys(input).some((key) => !['profile_id', 'kind', 'version', 'locale'].includes(key))) return restError('42501', 'Legal-record column is not writable')
        const kind = input.kind as ConsentKind
        if (input.profile_id !== account.profile.id || !CONSENT_KINDS.includes(kind) || input.version !== LEGAL_VERSIONS[kind]) return restError('42501', 'Legal record does not match the current account or text version')
        if (input.locale !== 'de' && input.locale !== 'en') return restError('23514', 'Invalid locale', 400)
        const duplicate = [...account.consents, ...staged].some((consent) => consent.kind === kind && consent.version === input.version)
        if (duplicate && !prefer.includes('resolution=ignore-duplicates')) return restError('23505', 'Legal record already exists', 409)
        if (!duplicate) staged.push({ profile_id: account.profile.id, kind, version: LEGAL_VERSIONS[kind], locale: input.locale, accepted_at: new Date().toISOString() })
      }
      // Apply only after all rows pass checks, so a bad batch never leaves partial declarations.
      account.consents.push(...staged)
      enrollWhenComplete(account)
      return returning ? selectedRows(request, staged.map((consent) => ({ ...consent })), columns) : new HttpResponse(null, { status: 201 })
    }),
    http.post(`${DEMO_SUPABASE_URL}/rest/v1/rpc/export_my_data`, ({ request }) => {
      const account = currentAccount(request)
      if (!account) return restError('PGRST301', 'Session expired', 401)
      // Own occasions, memberships, lists and reservations AS RESERVER — never reservations on own wishes.
      const social = world.exportFor(account.user.id)
      // wave 2b: the blocks are real now (blocking is in the UI, src/mocks/follows.ts). The M2 `follows` block
      // (followsExportFor().follows) joins with the export's v2 step — the v1 key set is pinned in social.test.ts.
      const blocks = followsExportFor(world, account.user.id).blocks
      return HttpResponse.json({
        format: 'bunprise-export-v1', exported_at: new Date().toISOString(), profile: { ...account.profile },
        consents: account.consents.map(({ kind, version, locale, accepted_at }) => ({ kind, version, locale, accepted_at })),
        occasions_hosted: social.occasions_hosted, memberships: social.memberships, wishlists: social.wishlists,
        reservations_made_by_me: social.reservations_made_by_me, blocks, reports: [],
      })
    }),
    http.post(`${DEMO_SUPABASE_URL}/rest/v1/rpc/delete_my_account`, ({ request }) => {
      const account = currentAccount(request)
      if (!account) return restError('PGRST301', 'Session expired', 401)
      world.deletePerson(account.user.id)
      accounts.delete(account.user.email ?? '')
      sessions.delete(account.user.id)
      if (pending?.email === account.user.email) pending = null
      return HttpResponse.json({ ok: true })
    }),
    // Occasions, members, wishlists, wishes, invites, reservations and their RPCs (src/mocks/social.ts).
    ...createSocialHandlers({ world, viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Our Worker's link preview (POST /api/link-preview, src/mocks/linkPreview.ts): fictional fixtures only.
    ...createLinkPreviewHandlers({ viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Our Worker's place search (GET /api/places, src/mocks/places.ts): invented places in an invented town.
    ...createPlacesHandlers({ viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Our Worker's gift ideas (POST /api/gift-ideas, src/mocks/giftIdeas.ts): invented products and shops.
    ...createGiftIdeasHandlers({ viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Our Worker's product picture proxy (POST /api/link-image, src/mocks/linkImage.ts): one bundled, fictional picture.
    ...createLinkImageHandlers({ viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Our Worker's shop icons (GET /api/shop-icon, src/mocks/shopIcons.ts): neutral placeholder icons, no real brand.
    ...createShopIconHandlers({ viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Wish photos (set / remove / get / export, src/mocks/wishPhotos.ts): memory only, like the world.
    ...createWishPhotoHandlers({ photos: wishPhotos, viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // List covers (set / remove / get / export, src/mocks/listPhotos.ts): memory only, like the world.
    ...createListPhotoHandlers({ photos: listPhotos, viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Own profile / banner photos (set / remove / get / export, src/mocks/profilePhotos.ts): memory only, like the world.
    ...createProfilePhotoHandlers({ photos: profilePhotos, viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Occasion cover photos (set / remove / get / export, src/mocks/photos.ts): memory only, like the world.
    ...createPhotoHandlers({ photos, viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Wave 2b: lists without an occasion, the lists tab and a list's screen, the two follow calls (src/mocks/lists.ts).
    ...createListsHandlers({ world, viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // Wave 2b: the follow actions, the people screens and the follow link + Anna's / Clara's / Ben's script (src/mocks/follows.ts).
    ...createFollowsHandlers({ world, viewerOf: (request) => currentAccount(request)?.user.id ?? null }),
    // In-app invitations "Freunde einladen" (src/mocks/invitations.ts, 20261027120000): RPC only, never through REST.
    ...invitations.handlers((request) => currentAccount(request)?.user.id ?? null),
    // Web Push (src/mocks/push.ts): the five RPCs and GET /api/push/key, simulated — the demo never subscribes a browser.
    ...push.handlers((request) => currentAccount(request)?.user.id ?? null),
    // Kalender-Abo + birthday suggestion (src/mocks/calendar.ts): simulated address, anniversaries from the demo world
    ...calendar.handlers((request) => currentAccount(request)?.user.id ?? null),
    // the invitation e-mail (src/mocks/inviteEmail.ts): the opt-in only — no Worker, no Brevo, no mail
    ...inviteEmail.handlers((request) => currentAccount(request)?.user.id ?? null),
    // Never let an unfinished demo endpoint fall through to a real network request.
    // Other origins (including the app's own assets) are not matched.
    http.all(`${DEMO_SUPABASE_URL}/*`, () => HttpResponse.json({ code: 'demo_not_implemented', message: 'This demo endpoint is not implemented' }, { status: 501 })),
  ]
}
