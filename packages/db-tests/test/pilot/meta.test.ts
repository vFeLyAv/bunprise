/**
 * Meta checks on the applied migrations: every file applied, legal seed present, pg_cron migration a no-op on
 * PGlite, search_path pinned on every security definer function, RLS enabled + forced everywhere, anon/PUBLIC
 * without any privilege, no views, no realtime publication for reservations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES } from './seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

/** SQL fragment: the pg_proc row `p` does not belong to an extension (pgcrypto etc. in the PGlite shim). */
const NOT_EXTENSION_MEMBER = `not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`

describe('migrations', () => {
  it('applies the pilot migrations and security follow-up in lexical order', () => {
    expect(t.appliedMigrations).toEqual([
      '20261019120000_pilot_schema.sql',
      '20261019120100_pilot_rls.sql',
      '20261019120200_pilot_rpc.sql',
      '20261019120300_legal_versions_seed.sql',
      '20261019120400_pilot_cron.sql',
      '20261019120500_pilot_security_v11.sql',
      '20261020120000_concurrency_fix.sql',
      '20261020160000_occasion_photos.sql',
      // wave 2b (follows-design §00 item 10): M1 standalone lists, M2 follows, M3 follower sharing, M4 free wishes
      '20261020200000_lists_standalone.sql',
      '20261020200100_follows.sql',
      '20261020200200_follow_sharing.sql',
      '20261020200300_free_wishes.sql',
      '20261020221230_feed_host_identity.sql',
      '20261022120000_wish_details.sql',
      '20261022160000_list_photos_received_move.sql',
      '20261024120000_profile_photos.sql',
      // Felix 25.10: pilot-2 privacy notice + terms (docs/legal-drafts/pilot-2/README.md)
      '20261025120000_legal_versions_pilot_2.sql',
      // Felix 25.10: the occasion cover's meta in get_feed (Start)
      '20261025130000_feed_occasion_photos.sql',
      // Felix 25.10: the bring-along list "Mitbringen" (docs/design/2026-10-25-bring-list.md)
      '20261025150000_potluck.sql',
      // Felix 25.10: pilot-3 privacy notice + terms (docs/legal-drafts/pilot-3/README.md)
      '20261025160000_legal_versions_pilot_3.sql',
      // Felix 26.10: the occasion's end time (ends_at in get_occasion_screen + get_feed; P-I16 member_count)
      '20261026180000_occasion_end_time.sql',
      // Felix 26.10 (Р11): accept_invite refuses a cancelled occasion; unfinished accounts purged after 30 days
      '20261026190000_small_fixes.sql',
      // 4th release: pilot-4 privacy notice + terms, with the in-app invitations (docs/legal-drafts/pilot-4/README.md)
      '20261026200000_legal_versions_pilot_4.sql',
      // Felix 26.10 (Р1–Р14): in-app invitations "Freunde einladen" (docs/spec/in-app-invites-design.md)
      '20261027120000_occasion_invitations.sql',
      // Felix 26.10 («так включи приглашения»): the invitations' database switch ON with the 4th release
      '20261027130000_occasion_invitations_on.sql',
      // Felix 26.10: automatic cover motifs for occasions without a photo (docs/design/2026-10-26-occasion-covers.md)
      '20261027140000_occasion_cover_theme.sql',
      // Web Push, created switched off (docs/spec/web-push-design.md)
      '20261027150000_web_push.sql',
      // Felix 27.10: short friend codes "Mein Code" / "Code eingeben" (docs/spec/add-friends-design.md)
      '20261027160000_friend_codes.sql',
      // Felix 27.10: Kalender-Abo + birthday suggestion (docs/handoffs/2026-10-27-calendar.md)
      '20261027170000_calendar_feed.sql',
      // Felix 27.10: the mini map on the occasion screen — the point of the picked place (docs/handoffs/2026-10-27-place-minimap.md)
      '20261027190000_occasion_place_point.sql',
      // Felix 27.10: one wish in several lists (docs/spec/shared-wishes-design.md, docs/handoffs/2026-10-27-shared-wishes.md)
      '20261027200000_shared_wishes.sql',
      '20261027210000_export_new_fields.sql',
      // 5th release: pilot-5 privacy notice + terms, built per feature set (docs/legal-drafts/pilot-5/README.md)
      '20261027220000_legal_versions_pilot_5.sql',
      // Felix 27.10 «так все включаем»: one wish in several lists switched on with the 5th release
      '20261027230000_shared_wishes_on.sql',
      // Web Push on in the database once the 5th release is live (/api/push/key 200)
      '20261027235000_web_push_on.sql',
      // Felix 27.10: the invitation e-mail, opt-in and neutral, created switched off (docs/spec/invite-email-design.md)
      '20261028000000_invite_email.sql',
      // Felix 30.10: "Anzahl" + "Passt zusammen", created switched off (docs/handoffs/2026-10-30-quantity-together.md)
      '20261030120000_wish_quantity_together.sql',
      // 6th release: pilot-6 privacy notice only (terms stay pilot-5), built per feature set (docs/legal-drafts/pilot-6/README.md)
      '20261031120000_legal_versions_pilot_6.sql',
      // Felix 31.10: "Anzahl" + "Passt zusammen" switched on with the 6th release, after the pilot-6 text
      '20261031130000_wish_extras_on.sql',
    ])
  })

  it('seeds legal_versions with the pilot ids (privacy notice bumped to pilot-6, terms still pilot-5)', async () => {
    const lv = await rows<{ kind: string; version: string }>(t.db, 'select kind, version from legal_versions order by kind')
    expect(lv).toEqual([
      { kind: 'age_18plus', version: 'age-18plus-2026-10-pilot-1' },
      { kind: 'privacy_notice', version: 'privacy-2026-10-pilot-6' },
      { kind: 'terms', version: 'terms-2026-10-pilot-5' },
    ])
  })

  it('pg_cron migration is a no-op where pg_cron is unavailable (PGlite)', async () => {
    expect(await rows(t.db, `select 1 from pg_available_extensions where name = 'pg_cron'`)).toEqual([])
    expect(await rows(t.db, `select 1 from pg_extension where extname = 'pg_cron'`)).toEqual([])
    expect(await rows(t.db, `select 1 from pg_namespace where nspname = 'cron'`)).toEqual([])
  })
})

describe('hardening', () => {
  it('every security definer function in public/private pins search_path', async () => {
    const unpinned = await rows<{ fn: string }>(
      t.db,
      `select n.nspname || '.' || p.proname as fn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef
          and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%'`,
    )
    expect(unpinned).toEqual([])
    // and there are security definer functions at all (the check is not vacuous)
    expect(await scalar<number>(t.db, `select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prosecdef`)).toBeGreaterThan(10)
  })

  it('export_my_data is SECURITY INVOKER, every other RPC is SECURITY DEFINER', async () => {
    // (the PGlite shim installs pgcrypto/uuid-ossp into public; extension members are not ours)
    const fns = await rows<{ proname: string; prosecdef: boolean }>(
      t.db,
      `select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and ${NOT_EXTENSION_MEMBER} order by p.proname`,
    )
    expect(fns.map((f) => f.proname)).toEqual([
      'accept_invite',
      'add_potluck_item', // 20261025150000
      'add_wishes_to_list', // 20261027200000
      'block_user',
      'calendar_feed', // 20261027170000 (anon, through the Worker)
      'cancel_reservation',
      'claim_potluck_item', // 20261025150000
      'create_calendar_feed', // 20261027170000
      'create_follow_link',
      'create_friend_code', // 20261027160000
      'create_invite',
      'delete_my_account',
      'delete_potluck_item', // 20261025150000
      'delete_wish_everywhere', // 20261027200000
      'dismiss_received_prompt', // 20261027200000
      'export_my_calendar_feed', // 20261027170000
      'export_my_data',
      'export_my_invitations', // 20261027120000
      'export_my_invite_email', // 20261028000000
      'export_my_list_photos', // 20261022160000
      'export_my_occasion_photos',
      'export_my_potluck', // 20261025150000
      'export_my_profile_photos', // 20261024120000
      'export_my_push', // 20261027150000
      'export_my_wish_photos', // 20261022120000
      'get_anniversary_suggestions', // 20261027170000
      'get_calendar_feed', // 20261027170000
      'get_feed',
      'get_free_wishes', // wave 2b M4
      'get_invite_candidates', // 20261027120000
      'get_invite_email_settings', // 20261028000000
      'get_list_photo', // 20261022160000
      'get_list_screen',
      'get_lists_overview',
      'get_me',
      'get_my_invitations', // 20261027120000
      'get_occasion_invite_info', // 20261027120000
      'get_occasion_photo',
      'get_occasion_screen',
      'get_people_screen',
      'get_profile_card',
      'get_profile_photo', // 20261024120000
      'get_push_settings', // 20261027150000
      'get_sent_invitations', // 20261027120000
      'get_wish_photo',
      'invite_email_unsubscribe', // 20261028000000 (anon, through the Worker)
      'leave_occasion',
      'move_wish', // 20261022160000
      'my_reservations',
      'peek_follow_link',
      'peek_friend_code', // 20261027160000
      'push_subscribe', // 20261027150000
      'push_unsubscribe', // 20261027150000
      'remove_follower',
      'remove_list_photo', // 20261022160000
      'remove_member',
      'remove_occasion_photo',
      'remove_profile_photo', // 20261024120000
      'remove_wish_from_list', // 20261027200000
      'remove_wish_photo',
      'rename_potluck_item', // 20261025150000
      'request_follow',
      'request_follow_via_code', // 20261027160000
      'request_follow_via_link',
      'reserve_together', // 20261030120000
      'reserve_wish',
      'respond_follow',
      'respond_occasion_invite', // 20261027120000
      'revoke_calendar_feed', // 20261027170000
      'revoke_follow_links',
      'revoke_friend_codes', // 20261027160000
      'send_occasion_invites', // 20261027120000
      'set_invite_email', // 20261028000000
      'set_list_photo', // 20261022160000
      'set_list_visibility', // wave 2b M3
      'set_occasion_photo',
      'set_profile_photo', // 20261024120000
      'set_push_settings', // 20261027150000
      'set_wish_links', // 20261030120000
      'set_wish_photo',
      'set_wish_received', // 20261022160000
      'unblock_user',
      'unclaim_potluck_item', // 20261025150000
      'unfollow',
      'withdraw_occasion_invite', // 20261027120000
    ])
    for (const f of fns) expect(f.prosecdef, f.proname).toBe(f.proname !== 'export_my_data')
  })

  it('RLS is enabled AND forced on every table in public', async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      t.db,
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    )
    expect(tables.map((x) => x.relname).sort()).toEqual([...ALL_TABLES].sort())
    for (const x of tables) {
      expect(x.relrowsecurity, x.relname).toBe(true)
      expect(x.relforcerowsecurity, x.relname).toBe(true)
    }
  })

  it('anon has no table, column or function privilege; PUBLIC cannot execute anything in public/private', async () => {
    expect(await rows(t.db, `select table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`)).toEqual([])
    expect(await rows(t.db, `select table_name from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public'`)).toEqual([])
    const anonFns = await rows<{ fn: string }>(
      t.db,
      `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and ${NOT_EXTENSION_MEMBER} and has_function_privilege('anon', p.oid, 'execute')`,
    )
    // the ONE exception (20261027170000): the Kalender-Abo feed, called by our Worker with the publishable key; the
    // 43-character token is the permission (packages/db-tests/test/calendar/calendar-feed.test.ts)
    // and the second (20261028000000): the one-click unsubscribe of the invitation e-mail, also only through the Worker
    expect(anonFns.map((f) => f.fn).sort()).toEqual(['public.calendar_feed', 'public.invite_email_unsubscribe'])
    const publicFns = await rows<{ fn: string }>(
      t.db,
      `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and ${NOT_EXTENSION_MEMBER} and has_function_privilege('public', p.oid, 'execute')`,
    )
    expect(publicFns).toEqual([])
    expect(await scalar<boolean>(t.db, `select has_schema_privilege('anon', 'private', 'usage')`)).toBe(false)
  })

  it('authenticated has not a single privilege on reservations (no REST path at all)', async () => {
    expect(await rows(t.db, `select privilege_type from information_schema.role_table_grants where grantee = 'authenticated' and table_name = 'reservations'`)).toEqual([])
    expect(await rows(t.db, `select column_name from information_schema.column_privileges where grantee = 'authenticated' and table_name = 'reservations'`)).toEqual([])
    expect(await scalar<boolean>(t.db, `select has_table_privilege('authenticated', 'public.reservations', 'select')`)).toBe(false)
    // internal lifecycle helper is not callable by the API role either
    expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', 'private.end_reservations_in_occasion(uuid,uuid,text)', 'execute')`)).toBe(false)
  })

  it('no views in public; reservations are in no publication; no realtime publication was created', async () => {
    expect(await rows(t.db, `select viewname from pg_views where schemaname = 'public'`)).toEqual([])
    expect(await rows(t.db, `select matviewname from pg_matviews where schemaname = 'public'`)).toEqual([])
    expect(await rows(t.db, `select * from pg_publication_tables where tablename = 'reservations'`)).toEqual([])
    expect(await rows(t.db, `select pubname from pg_publication`)).toEqual([])
  })

  it('wishes have a priority column and no position column; profiles carry onboarding_done_at and no activity tracking field', async () => {
    const cols = await rows<{ table_name: string; column_name: string }>(
      t.db,
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('wishes', 'profiles', 'reservations') order by table_name, ordinal_position`,
    )
    const wishes = cols.filter((c) => c.table_name === 'wishes').map((c) => c.column_name)
    expect(wishes).toContain('priority')
    expect(wishes).not.toContain('position')
    expect(wishes.some((c) => c.includes('reserv'))).toBe(false)
    const profiles = cols.filter((c) => c.table_name === 'profiles').map((c) => c.column_name)
    expect(profiles).toContain('onboarding_done_at')
    expect(profiles).not.toContain('last_seen_at')
    expect(profiles).not.toContain('birthday')
    expect(cols.filter((c) => c.table_name === 'reservations').map((c) => c.column_name)).toEqual(
      expect.arrayContaining(['status', 'end_reason', 'ended_at', 'wish_title_snapshot']),
    )
  })
})
