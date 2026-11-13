/**
 * ATTACK ROUND 1 — catalog-level hardening.
 * Exact allow-list of what `authenticated` may execute (anything else that appears is a new, unreviewed path),
 * nothing for anon / PUBLIC, search_path pinned on EVERY function (trigger and invoker functions too),
 * reservations: no privilege of any kind for the API roles and no write policy, RLS forced, no sequences,
 * no views, no publication, functions owned by the migration role.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES } from '../pilot/seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const NOT_EXTENSION_MEMBER = `not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`

/**
 * Everything authenticated may execute. Policies need the private helpers; export_my_data (invoker) needs three more:
 * require_user, my_reservations_export and — since the F-2 fix (profiles is a column grant: id + display_name only,
 * so the invoker can no longer read its own full row) — my_profile_export. Both export helpers filter on auth.uid()
 * and take no arguments, so they cannot be pointed at somebody else.
 */
const AUTHENTICATED_MAY_EXECUTE = [
  'private.can_read_wishlist',
  'private.has_consents',
  'private.invite_guard',
  'private.is_active_member',
  'private.is_blocked_pair',
  'private.is_going_member',
  'private.is_host',
  'private.is_wishlist_owner',
  // wave 2b: the follows block of the invoker export (no argument, auth.uid() only; follows-design §4.4)
  'private.my_follows_export',
  'private.my_profile_export',
  'private.my_reservations_export',
  // wave 2b M1: the own lists for the invoker export (updated_at is not REST-readable any more)
  'private.my_wishlists_export',
  'private.occasion_guard',
  'private.occasion_has_wishlist',
  'private.profile_complete',
  'private.require_user',
  'private.reservation_guard',
  'private.set_updated_at',
  'private.shares_occasion',
  'private.wish_guard',
  'private.wishlist_guard',
  // wave 2b M1: the 20-standalone-lists guard (invoker trigger; the grant is a safety net like the other guards)
  'private.wishlist_limit',
  'public.accept_invite',
  'public.block_user',
  // the bring-along list "Mitbringen" (20261025150000): members of the occasion; the helpers private.potluck_* are NOT callable
  'public.add_potluck_item',
  'public.claim_potluck_item',
  'public.delete_potluck_item',
  'public.export_my_potluck',
  'public.rename_potluck_item',
  'public.unclaim_potluck_item',
  'public.cancel_reservation',
  // wave 2b M1 + M2 (follows-design §5.2–§5.3): list screens, follows, links, people
  'public.create_follow_link',
  'public.get_list_screen',
  'public.get_lists_overview',
  'public.get_people_screen',
  'public.get_profile_card',
  'public.peek_follow_link',
  'public.remove_follower',
  'public.request_follow',
  'public.request_follow_via_link',
  'public.respond_follow',
  'public.revoke_follow_links',
  'public.unfollow',
  // wave 2b M3 + M4: the only way to change a list's audience; the giver's free wishes of a person
  'public.set_list_visibility',
  'public.get_free_wishes',
  'public.create_invite',
  'public.delete_my_account',
  'public.export_my_data',
  // cover photos (20261020160000, reviewed): host-only writes, the occasion's membership rules for reading,
  // the caller's own photos for the export; the magic-byte helper private.photo_bytes_match is NOT callable
  'public.export_my_occasion_photos',
  'public.get_feed',
  'public.get_me',
  'public.get_occasion_photo',
  'public.get_occasion_screen',
  'public.leave_occasion',
  'public.my_reservations',
  'public.remove_member',
  'public.remove_occasion_photo',
  'public.reserve_wish',
  'public.set_occasion_photo',
  'public.unblock_user',
  // wish photos (20261022120000): list-owner writes, the wish's own read rules, own photos for the export;
  // the helper private.wish_detail_fields is NOT callable
  'public.export_my_wish_photos',
  'public.get_wish_photo',
  'public.remove_wish_photo',
  'public.set_wish_photo',
  // list covers, "Erhalten" and moving a wish (20261022160000): list-owner writes, the list's own read rules,
  // own covers for the export; the helper private.list_photo_meta is NOT callable
  'public.export_my_list_photos',
  'public.get_list_photo',
  'public.remove_list_photo',
  'public.set_list_photo',
  'public.set_wish_received',
  'public.move_wish',
  // profile + banner photos (20261024120000): own writes, the profile card's visibility (private.knows_profile) for
  // reading, own photos for the export; the helpers private.profile_photo_meta / profile_photo_fields are NOT callable
  'public.export_my_profile_photos',
  'public.get_profile_photo',
  'public.remove_profile_photo',
  'public.set_profile_photo',
  // in-app invitations (20261027120000): friends of the host / allowed guests, the invitee's own inbox, the host's
  // "eingeladen von", the own export; every private.invitation* / invite* helper and trigger is NOT callable
  'public.export_my_invitations',
  'public.get_invite_candidates',
  'public.get_my_invitations',
  'public.get_occasion_invite_info',
  'public.get_sent_invitations',
  'public.respond_occasion_invite',
  'public.send_occasion_invites',
  'public.withdraw_occasion_invite',
  // Web Push (20261027150000): the own devices and preference, the own export; dispatch / collect / purge / the switch
  // and every helper are NOT callable
  'public.export_my_push',
  'public.get_push_settings',
  'public.push_subscribe',
  'public.push_unsubscribe',
  'public.set_push_settings',
  // friend codes (20261027160000): own codes, the code lookups with their miss limit; the helpers
  // private.normalize_friend_code / friend_code_gate / friend_code_owner / purge_friend_codes are NOT callable
  'public.create_friend_code',
  'public.peek_friend_code',
  'public.request_follow_via_code',
  'public.revoke_friend_codes',
  // Kalender-Abo + birthday suggestion (20261027170000): the own feed address and its status, the own export, the own
  // past occasions' anniversaries; calendar_feed itself is for anon only (the Worker), the helpers are NOT callable
  'public.create_calendar_feed',
  'public.export_my_calendar_feed',
  'public.get_anniversary_suggestions',
  'public.get_calendar_feed',
  'public.revoke_calendar_feed',
  // invitation e-mail (20261028000000): the own opt-in, its state and the own export; the unsubscribe is for anon only (the
  // Worker), dispatch / collect / purge / the switch and every helper are NOT callable
  'public.export_my_invite_email',
  'public.get_invite_email_settings',
  'public.set_invite_email',
  // one wish in several lists (20261027200000): the read rule of a wish for the policy wishes_select (like
  // can_read_wishlist); the owner's four writes. Every other shared-wish helper and both jobs are NOT callable
  'private.can_read_wish',
  'public.add_wishes_to_list',
  'public.delete_wish_everywhere',
  'public.dismiss_received_prompt',
  'public.remove_wish_from_list',
  // "Anzahl" + "Passt zusammen" (20261030120000): the owner's links, the giver's joint reservation (reserve_wish per wish);
  // the switches, the quantity guard and the link helpers are NOT callable
  'public.reserve_together',
  'public.set_wish_links',
].sort()

const NEVER_EXECUTABLE_BY_API_ROLES = [
  'private.end_reservations_in_occasion', 'private.handle_new_user', 'private.occasion_after_insert', 'private.wish_before_delete', 'private.photo_bytes_match',
  'private.wish_detail_fields', 'private.photo_dimensions', 'private.list_photo_meta',
  'private.profile_photo_meta', 'private.profile_photo_fields',
  // wave 2b M1 + M2: the relation helpers answer "does X follow / hide / know Y" for ANY X and Y — definer-only
  'private.is_accepted_follower', 'private.has_follow_cooldown', 'private.visible_request', 'private.i_follow_state',
  'private.follows_me_state', 'private.visible_relation', 'private.knows_profile', 'private.profile_card',
  'private.make_follow_request', 'private.end_follow_reservations', 'private.end_list_reservations', 'private.shared_occasions',
  'private.lock_profile_pair', 'private.purge_expired_records',
  // wave 2b M3: the red button's state and the "may X read / find a gift for Y" helpers — definer-only
  'private.follower_lists_on', 'private.can_find_gift', 'private.follower_list_cards', 'private.lock_owned_delete',
  // 20261025150000: the bring-along list's gate, title check, screen part and triggers — definer-only
  'private.potluck_gate', 'private.potluck_title', 'private.potluck_screen', 'private.potluck_release_on_leave', 'private.potluck_off',
  // 20261027200000: liveness, places, hints, the owner's/audience's wish lists, the jobs — definer-only
  'private.reservation_is_live', 'private.effective_list_wishes', 'private.owner_list_wishes', 'private.list_wish_objects',
  'private.occasion_wishlist_json', 'private.wish_places_for_owner', 'private.wish_places_for_viewer', 'private.reservation_place',
  'private.counts_for_cap', 'private.reads_wish_via_occasion', 'private.end_own_dead_reservations',
  'private.reservations_cleanup_run', 'private.unlink_past_occasion_places_run', 'private.shared_wishes_health',
  'private.shared_wishes_on', 'private.shared_wishes_visible', 'private.wish_shared_delete_guard', 'private.wishlist_before_delete',
  // 20261027120000: the invitation rules answer "may X invite / see / reach Y" for ANY X and Y — definer-only
  'private.invitations_on', 'private.is_mutual_follow', 'private.invitation_cutoff', 'private.invite_lock_key',
  'private.may_invite', 'private.is_invite_candidate', 'private.invitation_visible', 'private.invitation_sender_state',
  'private.invitation_deliverable', 'private.visible_invitation_ids', 'private.invitations_on_membership',
  'private.invitations_on_occasion_change', 'private.invitations_on_unfollow', 'private.invitations_on_block',
  'private.invitations_on_nobody', 'private.purge_invitations', 'private.invitation_settings_guard',
  // 20261027150000: Web Push — the dispatcher sends to ANY device; the helpers read sessions, secrets and preferences
  'private.web_push_on', 'private.push_endpoint_ok', 'private.current_session_id', 'private.push_session_alive',
  'private.push_hmac', 'private.push_secret', 'private.push_wants', 'private.push_enqueue', 'private.push_collect',
  'private.push_dispatch', 'private.purge_push', 'private.set_web_push',
  // 20261027160000: "whose live code is this, may X still guess" for ANY X — definer-only
  'private.normalize_friend_code', 'private.friend_code_gate', 'private.friend_code_owner', 'private.purge_friend_codes',
  // 20261027170000: the token maker and the anniversary arithmetic — definer-only
  'private.new_calendar_token', 'private.next_anniversary',
  // 20261028000000: the mail dispatcher reads ANY person's address — definer-only
  'private.invite_email_on', 'private.invite_email_address', 'private.invite_email_has_visible', 'private.invite_email_requeue',
  'private.invite_email_enqueue', 'private.invite_email_collect', 'private.invite_email_dispatch', 'private.purge_invite_email',
  'private.set_invite_email_feature',
  // 20261030120000: the switches, the quantity guard and "which wishes are linked / what may X see of them" for ANY X
  'private.wish_quantity_on', 'private.wish_together_on', 'private.wish_quantity_guard', 'private.linked_wish_ids',
  'private.wish_links_for_owner', 'private.wish_links_for_viewer',
]

describe('function privileges', () => {
  it('authenticated can execute exactly the allow-list, nothing more', async () => {
    const fns = await rows<{ fn: string }>(
      t.db,
      `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and ${NOT_EXTENSION_MEMBER} and has_function_privilege('authenticated', p.oid, 'execute')
        order by 1`,
    )
    expect(fns.map((f) => f.fn)).toEqual(AUTHENTICATED_MAY_EXECUTE)
    for (const fn of NEVER_EXECUTABLE_BY_API_ROLES) {
      const row = await rows<{ ok: boolean }>(
        t.db,
        `select has_function_privilege('authenticated', p.oid, 'execute') as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname || '.' || p.proname = $1`,
        [fn],
      )
      expect(row, fn).toEqual([{ ok: false }])
    }
  })

  it('anon and PUBLIC can execute nothing in public/private; anon has no usage on private', async () => {
    for (const who of ['anon', 'public']) {
      const fns = await rows<{ fn: string }>(
        t.db,
        `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private') and ${NOT_EXTENSION_MEMBER} and has_function_privilege('${who}', p.oid, 'execute')`,
      )
      // the ONE exception (20261027170000): anon executes the Kalender-Abo feed (the Worker's publishable key; the token
      // is the permission — packages/db-tests/test/calendar/calendar-feed.test.ts); PUBLIC executes nothing
      // and the second (20261028000000): the invitation e-mail's unsubscribe token (it can only switch the e-mails OFF)
      expect(fns.map((f) => f.fn).sort(), who).toEqual(who === 'anon' ? ['public.calendar_feed', 'public.invite_email_unsubscribe'] : [])
    }
    expect(await scalar<boolean>(t.db, `select has_schema_privilege('anon', 'private', 'usage')`)).toBe(false)
    expect(await scalar<boolean>(t.db, `select has_schema_privilege('anon', 'private', 'create')`)).toBe(false)
    expect(await scalar<boolean>(t.db, `select has_schema_privilege('authenticated', 'private', 'create')`)).toBe(false)
    expect(await scalar<boolean>(t.db, `select has_schema_privilege('authenticated', 'public', 'create')`)).toBe(false)
    expect(await scalar<boolean>(t.db, `select has_schema_privilege('anon', 'public', 'create')`)).toBe(false)
  })

  it('every function in public/private pins search_path to "" (security definer, invoker and trigger functions alike)', async () => {
    const fns = await rows<{ fn: string; cfg: string[] | null; secdef: boolean }>(
      t.db,
      `select n.nspname || '.' || p.proname as fn, p.proconfig as cfg, p.prosecdef as secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and ${NOT_EXTENSION_MEMBER} order by 1`,
    )
    expect(fns.length).toBeGreaterThan(30)
    for (const f of fns) {
      expect(f.cfg, f.fn).not.toBeNull()
      expect(f.cfg!.some((c) => c === 'search_path=""' || c === "search_path=''" || c === 'search_path='), `${f.fn}: ${JSON.stringify(f.cfg)}`).toBe(true)
    }
    // the only invoker RPC is export_my_data; every other public function is security definer
    const invokers = fns.filter((f) => f.fn.startsWith('public.') && !f.secdef).map((f) => f.fn)
    expect(invokers).toEqual(['public.export_my_data'])
  })

  it('every function in public/private is owned by the migration role and no function is leakproof-marked or SETOF-returning over reservations', async () => {
    const owners = await rows<{ fn: string; owner: string }>(
      t.db,
      `select n.nspname || '.' || p.proname as fn, pg_get_userbyid(p.proowner) as owner
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and ${NOT_EXTENSION_MEMBER}`,
    )
    const owner = await scalar<string>(t.db, 'select current_user')
    for (const f of owners) expect(f.owner, f.fn).toBe(owner)
    const setof = await rows(
      t.db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.proretset and p.prorettype = 'public.reservations'::regtype`,
    )
    expect(setof).toEqual([])
  })
})

describe('table privileges and policies', () => {
  it('reservations: no privilege of any kind for anon / authenticated (incl. REFERENCES / TRIGGER / TRUNCATE) and no column privilege', async () => {
    for (const who of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
        expect(await scalar<boolean>(t.db, `select has_table_privilege('${who}', 'public.reservations', '${priv}')`), `${who} ${priv}`).toBe(false)
      }
      expect(await scalar<boolean>(t.db, `select has_any_column_privilege('${who}', 'public.reservations', 'select')`), who).toBe(false)
      expect(await scalar<boolean>(t.db, `select has_any_column_privilege('${who}', 'public.reservations', 'insert')`), who).toBe(false)
      expect(await scalar<boolean>(t.db, `select has_any_column_privilege('${who}', 'public.reservations', 'update')`), who).toBe(false)
    }
    expect(await scalar<boolean>(t.db, `select has_table_privilege('public', 'public.reservations', 'select')`)).toBe(false)
  })

  it('reservations: the only policy is a SELECT policy (no insert/update/delete policy could ever be "accidentally" grant-enabled)', async () => {
    const pol = await rows<{ policyname: string; cmd: string; roles: string }>(
      t.db,
      `select policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'reservations' order by 1`,
    )
    expect(pol).toEqual([{ policyname: 'reservations_select', cmd: 'SELECT', roles: '{authenticated}' }])
  })

  it('every policy in public is "to authenticated" only (nothing for anon / PUBLIC), and every table has RLS enabled + forced', async () => {
    const pol = await rows<{ tablename: string; policyname: string; roles: string }>(
      t.db,
      `select tablename, policyname, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`,
    )
    expect(pol.length).toBeGreaterThan(20)
    for (const p of pol) expect(p.roles, `${p.tablename}.${p.policyname}`).toBe('{authenticated}')
    const tables = await rows<{ relname: string; rls: boolean; forced: boolean; kind: string }>(
      t.db,
      `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced, c.relkind as kind
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')`,
    )
    expect(tables.map((x) => x.relname).sort()).toEqual([...ALL_TABLES].sort()) // no sequences, views, matviews, foreign or partitioned tables
    for (const x of tables) expect([x.kind, x.rls, x.forced], x.relname).toEqual(['r', true, true])
  })

  it('anon has no privilege on any table or column in public; authenticated has no write privilege on invite-only tables', async () => {
    expect(await rows(t.db, `select table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`)).toEqual([])
    expect(await rows(t.db, `select table_name from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public'`)).toEqual([])
    // wave 2b M2: the three follow tables are RPC-only (follows-design §4.4)
    const FOLLOW_TABLES = ['follows', 'follow_cooldowns', 'follow_links']
    // 20261027120000: the five invitation tables are RPC-only as well
    const INVITATION_TABLES = ['occasion_invitations', 'invitation_attempts', 'occasion_invite_refusals', 'invitation_cooldowns', 'member_invited_by']
    const noInsert = ['profiles', 'legal_versions', 'invites', 'occasion_members', 'reservations', 'blocks', ...FOLLOW_TABLES, ...INVITATION_TABLES]
    const noDelete = ['profiles', 'legal_versions', 'consents', 'occasion_members', 'reservations', 'blocks', 'reports', ...FOLLOW_TABLES, ...INVITATION_TABLES]
    const noUpdate = ['legal_versions', 'consents', 'reservations', 'blocks', 'reports', ...FOLLOW_TABLES, ...INVITATION_TABLES]
    for (const tbl of noInsert) expect(await scalar<boolean>(t.db, `select has_table_privilege('authenticated', 'public.${tbl}', 'insert')`), `${tbl} insert`).toBe(false)
    for (const tbl of noDelete) expect(await scalar<boolean>(t.db, `select has_table_privilege('authenticated', 'public.${tbl}', 'delete')`), `${tbl} delete`).toBe(false)
    for (const tbl of noUpdate) {
      expect(await scalar<boolean>(t.db, `select has_table_privilege('authenticated', 'public.${tbl}', 'update')`), `${tbl} update`).toBe(false)
      expect(await scalar<boolean>(t.db, `select has_any_column_privilege('authenticated', 'public.${tbl}', 'update')`), `${tbl} column update`).toBe(false)
    }
    // column-level update grants: exactly the contract columns
    const colUpd = await rows<{ table_name: string; column_name: string }>(
      t.db,
      `select table_name, column_name from information_schema.column_privileges
        where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'UPDATE'
          and not exists (select 1 from information_schema.role_table_grants g where g.grantee = 'authenticated' and g.table_schema = 'public' and g.table_name = column_privileges.table_name and g.privilege_type = 'UPDATE')
        order by 1, 2`,
    )
    expect(colUpd).toEqual([
      { table_name: 'invites', column_name: 'revoked_at' },
      { table_name: 'occasion_addresses', column_name: 'address' },
      { table_name: 'occasion_members', column_name: 'rsvp' },
      { table_name: 'occasions', column_name: 'all_day' },
      { table_name: 'occasions', column_name: 'cancelled_at' },
      { table_name: 'occasions', column_name: 'cover_theme' }, // 20261027140000: the cover motif (host only, policy occasions_update)
      { table_name: 'occasions', column_name: 'description' },
      { table_name: 'occasions', column_name: 'ends_at' },
      { table_name: 'occasions', column_name: 'guests_can_invite' }, // 20261027120000: "Gäste dürfen Freunde einladen" (host only)
      { table_name: 'occasions', column_name: 'place_lat' }, // 20261027190000: the point of the picked place (host only, policy occasions_update)
      { table_name: 'occasions', column_name: 'place_lon' },
      { table_name: 'occasions', column_name: 'place_text' },
      { table_name: 'occasions', column_name: 'sections' }, // 20261025150000: wishes | bring | both (host only, policy occasions_update)
      { table_name: 'occasions', column_name: 'starts_at' },
      { table_name: 'occasions', column_name: 'title' },
      { table_name: 'occasions', column_name: 'tz' },
      { table_name: 'profiles', column_name: 'banner' }, // wave 2b M1
      { table_name: 'profiles', column_name: 'display_name' },
      { table_name: 'profiles', column_name: 'in_suggestions' }, // wave 2b M3 (never SELECT-granted)
      { table_name: 'profiles', column_name: 'invitations_from' }, // 20261027120000 (never SELECT-granted)
      { table_name: 'profiles', column_name: 'locale' },
      { table_name: 'profiles', column_name: 'onboarding_done_at' },
      { table_name: 'wishes', column_name: 'brand' }, // 20261022120000: the wish details
      { table_name: 'wishes', column_name: 'color' },
      { table_name: 'wishes', column_name: 'currency' },
      { table_name: 'wishes', column_name: 'description' },
      { table_name: 'wishes', column_name: 'gtin' },
      { table_name: 'wishes', column_name: 'note' },
      { table_name: 'wishes', column_name: 'price_cents' },
      { table_name: 'wishes', column_name: 'priority' },
      { table_name: 'wishes', column_name: 'quantity' }, // 20261030120000: "Anzahl" (owner only; the switch guards values <> 1)
      { table_name: 'wishes', column_name: 'shop_name' },
      { table_name: 'wishes', column_name: 'title' },
      { table_name: 'wishes', column_name: 'url' },
      { table_name: 'wishlists', column_name: 'cover_icon' }, // wave 2b M1; visibility is NEVER updatable through REST
      { table_name: 'wishlists', column_name: 'cover_tone' },
      { table_name: 'wishlists', column_name: 'due_on' },
      { table_name: 'wishlists', column_name: 'title' },
    ])
  })

  it('no publication, no view, no event trigger, no rule, and no trigger on reservations that could call back into wishes', async () => {
    expect(await rows(t.db, `select pubname from pg_publication`)).toEqual([])
    expect(await rows(t.db, `select viewname from pg_views where schemaname in ('public', 'private')`)).toEqual([])
    expect(await rows(t.db, `select evtname from pg_event_trigger`)).toEqual([])
    expect(await rows(t.db, `select rulename from pg_rules where schemaname = 'public'`)).toEqual([])
    const trg = await rows<{ tgname: string; fn: string }>(
      t.db,
      `select t.tgname, p.proname as fn from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
        where c.relname = 'reservations' and not t.tgisinternal order by 1`,
    )
    expect(trg).toEqual([{ tgname: 'reservation_guard', fn: 'reservation_guard' }])
    // 20261027200000 (shared wishes, INV-7 a): reservations have NO foreign key at all — no delete of a wish, list,
    // occasion or account does any work on them (liveness at read time + the cleanup job instead)
    const fks = await rows<{ col: string; action: string }>(
      t.db,
      `select a.attname as col, c.confdeltype as action from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid = 'public.reservations'::regclass and c.contype = 'f' order by 1`,
    )
    expect(fks).toEqual([])
    expect(await rows(t.db, `select conname from pg_constraint where confrelid = 'public.reservations'::regclass`)).toEqual([])
  })
})
