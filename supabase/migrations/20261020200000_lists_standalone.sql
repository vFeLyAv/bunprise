-- =============================================================================
-- Bunprise wave 2b — M1 (agent J1): wishlists WITHOUT an occasion ("standalone"), list cover + optional date,
-- the profile banner, and the two list screens in their OWNER-ONLY version.
-- Spec: docs/spec/follows-design.md v1.2 (§00 wins over the rest), §3.2, §5.2, §5.5; pilot-decisions §000 (v1.3).
-- Forward only: every earlier migration stays untouched. NOT applied to the hosted project: `supabase db push`
-- only after Felix's OK, and only together with the checked pilot-2 legal texts (follows-design §00 item 8).
--
-- What changes and who sees what after this step (closed by construction):
--   * wishlists.occasion_id may be NULL (= a standalone list). Every list has exactly ONE audience, `visibility`:
--     'occasion' (an occasion's list, as in the pilot) or 'private' ("Nur ich" — how every new list starts).
--     'followers' does not exist yet: M3 (20261020200200_follow_sharing.sql) adds it. Until then NOBODY but the
--     owner reads a standalone list: can_read_wishlist gives it to its owner only, and the pilot RPCs
--     reserve_wish / cancel_reservation answer not_allowed on it (they look for a membership in occasion NULL).
--   * a standalone list's recipient is its owner (CHECK wishlists_standalone_self): a list "for somebody else"
--     would show the recipient — a possible follower — the reservations on their own gifts.
--   * wishlist_guard compares with IS DISTINCT FROM: the pilot's `<>` let NULL -> occasion (and back) through.
--   * at most 20 standalone lists per owner (trigger wishlist_limit, error 'limit_reached'); the count is only
--     taken for the caller's OWN new list, so a foreign owner_id is refused by the policy, never by a count.
--   * wishlists_select gets the owner's short path first: a policy that only calls a helper which looks the
--     row up in the same table breaks `insert … returning` (supabase-js .insert().select()) of a new list —
--     the new row is not visible to that helper yet (probe, follows-design §0.4).
--   * privileges (column grants only, pilot-decisions §0 item 1): INSERT on wishlists becomes a column grant
--     (before: a table grant, so the client could set created_at / updated_at); `visibility` is NEVER
--     updatable through REST (only set_list_visibility, M3); `updated_at` of wishlists AND wishes is no longer
--     readable through REST (P9: a standalone list lives for years, and polling updated_at would be a log of
--     "when the owner edits"). The owner still gets it in the export (private.my_wishlists_export below).
--     CLIENT IN THE SAME STEP: apps/web/src/lib/api/wishes.ts WISH_COLUMNS and the Wish type without updated_at.
--   * profiles.banner: the key of one of 8 fixed banners, no URL, no upload, no free text. Updatable by the
--     person (REST), NOT selectable through REST: other people get it only from RPCs (profile card, list screen).
--
-- RPCs of this step (follows-design §5.2; the exact keys are listed in agent J1's report for the UI chain):
--   get_list_screen(p_list_id uuid) -> { list{id, title, kind, visibility, cover_tone, cover_icon, due_on, created_at,
--       owner{id, display_name, banner}}, viewer{role}, wishes[{id, title, url, price_cents, currency, note, priority,
--       created_at, reserved, reserved_by_me}] }
--     M1 has ONLY the owner branch (literal nulls for reserved / reserved_by_me; the reservation table is not
--     read at all); anybody else, an occasion's list, an unknown id: not_found (one answer). M3 adds the follower branch.
--   get_lists_overview() -> { me{id, display_name, banner, live_links}, stats{my_wishes, my_lists, friends_lists,
--       followers, following, requests}, my_lists[…], following[], upcoming[], suggestions[] }
--     The body never mentions the reservation table (F18 checks the whole text). Until M3 `following`,
--     `upcoming`, `suggestions` are always [] and stats.friends_lists is 0 (M3 fills them, follows-design §3.4);
--     me.live_links and stats.followers / following / requests are 0 here and come from M2 (the follow tables).
--   get_me(): + profile.banner.   export_my_data(): format 'bunprise-export-v2'; wishlists[] (+ visibility,
--     cover_tone, cover_icon, due_on; occasion_id may be null) built by the new definer helper
--     private.my_wishlists_export() — export_my_data is SECURITY INVOKER and could not read updated_at itself
--     after the revoke below.   private.my_profile_export(): + banner.
--   get_occasion_screen / reserve_wish / cancel_reservation: re-created with `v_wl record` instead of
--     `public.wishlists%rowtype` (wishlists now has 11 columns; the pilot bodies select 7 of them, which only
--     works by silently filling nulls — with plpgsql.extra_errors = 'strict_multi_assignment' it fails, A10).
--     Everything else statement for statement as the latest bodies: get_occasion_screen = 20261020160000
--     (agent G, keeps occasion.photo), reserve_wish = 20261020120000, cancel_reservation = 20261019120500.
--     Probe (J1, 2026-10-20, PGlite 18.6 and PostgreSQL 17.10): after a SELECT INTO that finds 0 rows a `record`
--     has null fields exactly like the %rowtype did (`v_uid in (v_wl.owner_id, v_wl.recipient_id)` is null).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. wishlists: the occasion is optional; every list has exactly one audience
-- -----------------------------------------------------------------------------
alter table public.wishlists alter column occasion_id drop not null;
alter table public.wishlists
  add column visibility text not null default 'occasion',   -- the trigger occasion_after_insert keeps working unchanged
  add column cover_tone smallint,                           -- 1..4 = the tile tones (ui/tile.ts); null = from the id, like tileTone()
  add column cover_icon text,                               -- null = 'gift'
  add column due_on     date;                               -- optional date of a standalone list (the day of the party)
alter table public.wishlists
  add constraint wishlists_visibility_check  check (visibility in ('occasion', 'private')),     -- M3: + 'followers'
  add constraint wishlists_kind_check        check ((occasion_id is not null) = (visibility = 'occasion')),
  add constraint wishlists_standalone_self   check (occasion_id is not null or recipient_id = owner_id),
  add constraint wishlists_standalone_title  check (occasion_id is not null or title is not null),
  add constraint wishlists_cover_tone_check  check (cover_tone is null or cover_tone between 1 and 4),
  add constraint wishlists_cover_icon_check  check (cover_icon is null or cover_icon in
    ('gift', 'cake', 'tree', 'home', 'ring', 'star', 'book', 'game', 'plant', 'plane', 'music', 'heart')),
  add constraint wishlists_due_on_check      check (due_on is null or
    (occasion_id is null and due_on between date '2020-01-01' and date '2100-12-31'));
-- unique (occasion_id, owner_id) stays: NULLs are distinct -> many standalone lists, still one list per occasion
create index wishlists_standalone_owner_idx on public.wishlists (owner_id, created_at) where occasion_id is null;
comment on column public.wishlists.visibility is
  'Exactly one audience per list: occasion (the occasion''s active members) | private (only the owner). M3 adds followers. Never updatable through REST.';
comment on column public.wishlists.due_on is 'Optional day of a standalone list (a party, not a birth date); null for occasion lists.';

-- -----------------------------------------------------------------------------
-- 2. guard: NULL-safe comparison (the pilot's `<>` let NULL -> occasion and back through)
-- -----------------------------------------------------------------------------
create or replace function private.wishlist_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.recipient_id is distinct from old.recipient_id
     or new.occasion_id is distinct from old.occasion_id then
    raise exception using message = 'not_allowed';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 3. at most 20 standalone lists. Only the caller's OWN new list is counted: a foreign owner_id is refused by
--    the insert policy right after this trigger, so the count of somebody else's lists can never become an
--    oracle ("X has 20 lists"). No lock: two tabs at the same moment give at most a 21st list — harmless.
--    SECURITY INVOKER: the count runs under the caller's own RLS (the owner's short path shows all own lists).
-- -----------------------------------------------------------------------------
create or replace function private.wishlist_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.occasion_id is null and new.owner_id = auth.uid()
     and (select count(*) from public.wishlists wl
           where wl.owner_id = new.owner_id and wl.occasion_id is null) >= 20 then
    raise exception using message = 'limit_reached';
  end if;
  return new;
end $$;
create trigger wishlist_limit before insert on public.wishlists
  for each row execute function private.wishlist_limit();

-- -----------------------------------------------------------------------------
-- 4. read rule: + the owner of any own list (a standalone list has no membership row).
--    For occasion lists this is exactly v1.1: the owner of an occasion list is its host, and the host is always
--    an active member of their own occasion and never blocked with themselves.
-- -----------------------------------------------------------------------------
create or replace function private.can_read_wishlist(p_wishlist uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wishlists wl
     where wl.id = p_wishlist
       and (wl.owner_id = p_uid
            or (wl.occasion_id is not null
                and not private.is_blocked_pair(p_uid, wl.owner_id)
                and not private.is_blocked_pair(p_uid, wl.recipient_id)
                and exists (select 1 from public.occasion_members m
                             where m.occasion_id = wl.occasion_id and m.profile_id = p_uid and m.status = 'active'))));
$$;

-- -----------------------------------------------------------------------------
-- 5. policies. SELECT: the direct column comparison first (insert … returning of a new list, §0.4).
--    INSERT: two branches — the pilot's occasion list, and a standalone list that always starts as 'private'.
--    wishlists_update / wishlists_delete and every wishes_* policy stay: they call can_read_wishlist /
--    is_wishlist_owner and work for standalone lists by themselves.
-- -----------------------------------------------------------------------------
drop policy wishlists_select on public.wishlists;
create policy wishlists_select on public.wishlists for select to authenticated
  using (owner_id = (select auth.uid()) or private.can_read_wishlist(id, (select auth.uid())));
drop policy wishlists_insert on public.wishlists;
create policy wishlists_insert on public.wishlists for insert to authenticated
  with check (owner_id = (select auth.uid()) and recipient_id = (select auth.uid())
              and private.profile_complete((select auth.uid())) and private.has_consents((select auth.uid()))
              and ((occasion_id is not null and visibility = 'occasion'                 -- the pilot's branch
                    and private.is_host(occasion_id, (select auth.uid()))
                    and not private.occasion_has_wishlist(occasion_id))
                or (occasion_id is null and visibility = 'private')));                 -- M3: in ('private', 'followers')

-- -----------------------------------------------------------------------------
-- 6. privileges: column grants only. REVOKE on the table also drops column privileges, so revoke first, then grant.
-- -----------------------------------------------------------------------------
revoke insert on public.wishlists from authenticated;          -- was a table grant: the client could set created_at / updated_at
grant insert (id, occasion_id, owner_id, recipient_id, title, visibility, cover_tone, cover_icon, due_on)
  on public.wishlists to authenticated;
grant select (visibility, cover_tone, cover_icon, due_on) on public.wishlists to authenticated;
grant update (cover_tone, cover_icon, due_on) on public.wishlists to authenticated;   -- title: pilot grant; visibility: NEVER through REST
-- P9: nobody else needs updated_at (order and "neu" use created_at); the owner gets it in the export.
revoke select (updated_at) on public.wishlists from authenticated;
revoke select (updated_at) on public.wishes    from authenticated;

-- -----------------------------------------------------------------------------
-- 7. banner: one key of a fixed list — no URL, no upload, no free text
-- -----------------------------------------------------------------------------
alter table public.profiles add column banner text
  constraint profiles_banner_check check (banner is null or banner in
    ('sunrise', 'meadow', 'sky', 'berry', 'dusk', 'bunnies', 'carrots', 'confetti'));
grant update (banner) on public.profiles to authenticated;   -- no SELECT grant: other people get it only from RPCs
comment on column public.profiles.banner is 'Key of one of 8 fixed profile banners (gradients / bunny patterns), null = derived from the id. No upload.';

-- -----------------------------------------------------------------------------
-- 8. helper: the card of a person as RPCs show it (never callable by the API roles; M2 uses it as well)
-- -----------------------------------------------------------------------------
create or replace function private.profile_card(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'banner', p.banner)
    from public.profiles p where p.id = p_id;
$$;

-- -----------------------------------------------------------------------------
-- 9. get_list_screen(p_list_id) — the screen /lists/$listId. M1: the owner only.
--    Everything else is one answer, not_found: unknown id, an occasion's list (that one lives on the occasion
--    screen), somebody else's list. M3 adds the follower path (follows-design §5.5) after the owner check.
-- -----------------------------------------------------------------------------
create or replace function public.get_list_screen(p_list_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_wl     record;
  v_wishes jsonb;
begin
  select wl.id, wl.owner_id, wl.recipient_id, wl.title, wl.visibility, wl.cover_tone, wl.cover_icon, wl.due_on, wl.created_at
    into v_wl from public.wishlists wl where wl.id = p_list_id and wl.occasion_id is null;
  if not found or not private.can_read_wishlist(v_wl.id, v_uid) then
    raise exception using message = 'not_found';
  end if;
  if v_uid not in (v_wl.owner_id, v_wl.recipient_id) then
    -- M1 / M2: nobody but the owner can read a standalone list (can_read_wishlist above); M3 adds the follower path
    raise exception using message = 'not_found';
  end if;
  -- OWNER BRANCH: literal nulls only, the secret table is never read here
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
           'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
           'reserved', null::boolean, 'reserved_by_me', null::boolean)
           order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
    into v_wishes from public.wishes w where w.wishlist_id = v_wl.id;
  return jsonb_build_object(
    'list', jsonb_build_object('id', v_wl.id, 'title', v_wl.title, 'kind', 'standalone', 'visibility', v_wl.visibility,
              'cover_tone', v_wl.cover_tone, 'cover_icon', v_wl.cover_icon, 'due_on', v_wl.due_on,
              'created_at', v_wl.created_at, 'owner', private.profile_card(v_wl.owner_id)),
    'viewer', jsonb_build_object('role', 'owner'),
    'wishes', v_wishes);
end $$;

-- -----------------------------------------------------------------------------
-- 10. get_lists_overview() — the tab "Wunschlisten" in one call. M1: me, stats, my_lists.
--     my_lists = my standalone lists + the lists of my own occasions (I am the host) that are upcoming or ended
--     at most 30 days ago ("Vorbei"). Order (fixed, never from reservations): lists with a future date by that
--     date (occasion: starts_at, standalone: due_on as a day in Europe/Berlin), then lists without a future date
--     by created_at desc, then past occasions by starts_at desc; always id last.
--     stats.my_lists / my_wishes count exactly the cards of my_lists (the tile equals the sum of wish_count).
--     Until M3: following = upcoming = suggestions = [] and friends_lists = 0; until M2: live_links = followers =
--     following = requests = 0. The text of this function must never mention the reservation table (F18).
-- -----------------------------------------------------------------------------
create or replace function public.get_lists_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_now    timestamptz := now();
  v_today  date := (now() at time zone 'Europe/Berlin')::date;
  v_mine   jsonb;
  v_lists  bigint;
  v_wishes bigint;
begin
  with my_lists as (
    -- OWNER BRANCH: wishlists + wishes only
    select wl.id, wl.title, wl.occasion_id, wl.visibility, wl.cover_tone, wl.cover_icon, wl.due_on, wl.created_at,
           o.title as occasion_title, o.starts_at, o.tz, o.all_day,
           coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) as ends_eff,
           (select count(*) from public.wishes w where w.wishlist_id = wl.id) as wish_count
      from public.wishlists wl
      left join public.occasions o on o.id = wl.occasion_id
     where wl.owner_id = v_uid
  ), shown as (
    select m.*,
           case when m.occasion_id is null then (case when m.due_on >= v_today then 0 else 1 end)
                when m.ends_eff >= v_now then 0
                else 2 end as grp,
           case when m.occasion_id is null then (m.due_on::timestamp at time zone 'Europe/Berlin') else m.starts_at end as dated_at
      from my_lists m
     where m.occasion_id is null or m.ends_eff >= v_now - interval '30 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title', s.title,
           'kind', case when s.occasion_id is null then 'standalone' else 'occasion' end,
           'visibility', s.visibility, 'cover_tone', s.cover_tone, 'cover_icon', s.cover_icon, 'due_on', s.due_on,
           'wish_count', s.wish_count,
           'occasion', case when s.occasion_id is null then null::jsonb
                            else jsonb_build_object('id', s.occasion_id, 'title', s.occasion_title, 'starts_at', s.starts_at,
                                                    'tz', s.tz, 'all_day', s.all_day) end,
           'created_at', s.created_at)
           order by s.grp,
                    case when s.grp = 0 then s.dated_at end asc,
                    case when s.grp = 1 then s.created_at end desc,
                    case when s.grp = 2 then s.starts_at end desc,
                    s.id), '[]'::jsonb),
         count(*),
         coalesce(sum(s.wish_count), 0)::bigint
    into v_mine, v_lists, v_wishes
    from shown s;

  return jsonb_build_object(
    'me', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'banner', p.banner, 'live_links', 0)
             from public.profiles p where p.id = v_uid),
    'stats', jsonb_build_object('my_wishes', v_wishes, 'my_lists', v_lists, 'friends_lists', 0,
                                'followers', 0, 'following', 0, 'requests', 0),
    'my_lists', v_mine,
    'following', '[]'::jsonb,
    'upcoming', '[]'::jsonb,
    'suggestions', '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- 11. get_me(): + profile.banner (the 20261019120500 body otherwise)
-- -----------------------------------------------------------------------------
create or replace function public.get_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                                          'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner)
                from public.profiles p where p.id = v_uid),
    'consents_ok', private.has_consents(v_uid),
    'legal_versions', jsonb_build_object(
      'terms',   (select lv.version from public.legal_versions lv where lv.kind = 'terms'),
      'privacy', (select lv.version from public.legal_versions lv where lv.kind = 'privacy_notice'),
      'age',     (select lv.version from public.legal_versions lv where lv.kind = 'age_18plus')));
end $$;

-- -----------------------------------------------------------------------------
-- 12. export helpers + export_my_data() format v2
--     private.my_profile_export(): + banner.
--     private.my_wishlists_export(): the caller's OWN lists with their wishes, explicit keys, updated_at included
--     (the invoker export cannot read updated_at any more), same order as v1.1. No argument: it cannot be pointed
--     at somebody else. Reservations are not touched (the owner never gets any about their own wishes).
-- -----------------------------------------------------------------------------
create or replace function private.my_profile_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                            'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner,
                            'created_at', p.created_at, 'updated_at', p.updated_at)
  from public.profiles p where p.id = auth.uid();
$$;

create or replace function private.my_wishlists_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', wl.id, 'occasion_id', wl.occasion_id, 'owner_id', wl.owner_id, 'recipient_id', wl.recipient_id,
           'title', wl.title, 'visibility', wl.visibility, 'cover_tone', wl.cover_tone, 'cover_icon', wl.cover_icon,
           'due_on', wl.due_on, 'created_at', wl.created_at, 'updated_at', wl.updated_at,
           'wishes', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', w.id, 'wishlist_id', w.wishlist_id, 'title', w.title, 'price_cents', w.price_cents,
                        'currency', w.currency, 'url', w.url, 'note', w.note, 'priority', w.priority,
                        'created_at', w.created_at, 'updated_at', w.updated_at)
                        order by w.priority desc, w.created_at, w.id), '[]'::jsonb)
                      from public.wishes w where w.wishlist_id = wl.id))
           order by wl.created_at, wl.id), '[]'::jsonb)
  from public.wishlists wl where wl.owner_id = auth.uid();
$$;

-- export_my_data(): the 20261019120500 body; format v2; wishlists from the definer helper above.
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'format', 'bunprise-export-v2',
    'exported_at', now(),
    'profile', private.my_profile_export(),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'version', c.version, 'locale', c.locale,
                                                              'accepted_at', c.accepted_at) order by c.accepted_at, c.kind), '[]'::jsonb)
                 from public.consents c where c.profile_id = v_uid),
    'occasions_hosted', (
      select coalesce(jsonb_agg((jsonb_build_object('id', o.id, 'host_id', o.host_id, 'title', o.title, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'tz', o.tz, 'all_day', o.all_day, 'place_text', o.place_text, 'description', o.description, 'cancelled_at', o.cancelled_at, 'created_at', o.created_at, 'updated_at', o.updated_at) || jsonb_build_object(
               'invites', (select coalesce(jsonb_agg(jsonb_build_object(               -- never token_hash
                             'id', i.id, 'expires_at', i.expires_at, 'max_uses', i.max_uses, 'use_count', i.use_count,
                             'revoked_at', i.revoked_at, 'created_at', i.created_at) order by i.created_at), '[]'::jsonb)
                           from public.invites i where i.occasion_id = o.id),
               'members', (select coalesce(jsonb_agg(jsonb_build_object(
                             'display_name', p.display_name, 'role', m.role, 'rsvp', m.rsvp, 'status', m.status,
                             'joined_at', m.joined_at) order by m.joined_at), '[]'::jsonb)
                           from public.occasion_members m
                           left join public.profiles p on p.id = m.profile_id
                           where m.occasion_id = o.id)
             )) order by o.starts_at, o.id), '[]'::jsonb)
      from public.occasions o where o.host_id = v_uid),
    'memberships', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'occasion_id', m.occasion_id, 'occasion_title', o.title, 'starts_at', o.starts_at,
               'role', m.role, 'rsvp', m.rsvp, 'status', m.status, 'joined_at', m.joined_at)
               order by m.joined_at, m.occasion_id), '[]'::jsonb)
      from public.occasion_members m
      left join public.occasions o on o.id = m.occasion_id
      where m.profile_id = v_uid and m.role = 'member'),
    'wishlists', private.my_wishlists_export(),
    'reservations_made_by_me', private.my_reservations_export(),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('blocked_name', p.display_name, 'created_at', b.created_at)
                                         order by b.created_at), '[]'::jsonb)
               from public.blocks b left join public.profiles p on p.id = b.blocked_id where b.blocker_id = v_uid),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporter_id', r.reporter_id, 'target_kind', r.target_kind, 'target_id', r.target_id, 'reason', r.reason, 'created_at', r.created_at, 'handled_at', r.handled_at, 'outcome', r.outcome) order by r.created_at), '[]'::jsonb)
                from public.reports r where r.reporter_id = v_uid)
  );
end $$;

-- -----------------------------------------------------------------------------
-- 13. %rowtype -> record (follows-design §0.4 item 4, A10). Only the declaration of v_wl changes.
-- -----------------------------------------------------------------------------

-- get_occasion_screen(): the 20261020160000 body (agent G: occasion.photo), `v_wl record`.
create or replace function public.get_occasion_screen(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_occ       public.occasions%rowtype;
  v_me        public.occasion_members%rowtype;
  v_wl        record;   -- not %rowtype: wishlists has 11 columns now, 7 are selected (strict_multi_assignment)
  v_host_name text;
  v_invite    jsonb := null;
  v_wishes    jsonb;
  v_wishlist  jsonb := null;
begin
  select o.id, o.host_id, o.title, o.starts_at, o.ends_at, o.tz, o.all_day, o.place_text, o.description, o.cancelled_at, o.created_at, o.updated_at into v_occ from public.occasions o where o.id = p_occasion_id;
  if not found then raise exception using message = 'not_found'; end if;
  select m.occasion_id, m.profile_id, m.role, m.rsvp, m.status, m.invited_via, m.joined_at, m.updated_at into v_me from public.occasion_members m
   where m.occasion_id = p_occasion_id and m.profile_id = v_uid and m.status = 'active';
  if not found then raise exception using message = 'not_found'; end if;   -- outsider / left / removed: one answer

  if private.is_blocked_pair(v_uid, v_occ.host_id) then raise exception using message = 'not_found'; end if;

  select p.display_name into v_host_name from public.profiles p where p.id = v_occ.host_id;

  if v_me.role = 'host' then
    select jsonb_build_object('active', true, 'expires_at', i.expires_at) into v_invite
      from public.invites i
     where i.occasion_id = p_occasion_id and i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses
     order by i.created_at desc
     limit 1;
  end if;

  -- the one list of the pilot: the host's
  select wl.id, wl.occasion_id, wl.owner_id, wl.recipient_id, wl.title, wl.created_at, wl.updated_at into v_wl from public.wishlists wl
   where wl.occasion_id = p_occasion_id and wl.owner_id = v_occ.host_id
   order by wl.created_at
   limit 1;

  if found then
    if v_uid in (v_wl.owner_id, v_wl.recipient_id) then
      -- OWNER BRANCH: literal nulls, public.reservations is not referenced at all
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
               'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
               'reserved', null::boolean, 'reserved_by_me', null::boolean)
               order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
        into v_wishes
        from public.wishes w
       where w.wishlist_id = v_wl.id;
    else
      -- MEMBER BRANCH: availability and own reservation only; no reserver name.
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
               'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
               'reserved', (r.id is not null),
               'reserved_by_me', coalesce(r.reserver_id = v_uid, false))
               order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
        into v_wishes
        from public.wishes w
        left join public.reservations r on r.wish_id = w.id and r.status = 'active'
       where w.wishlist_id = v_wl.id;
    end if;
    v_wishlist := jsonb_build_object('id', v_wl.id, 'owner_id', v_wl.owner_id, 'title', v_wl.title, 'wishes', v_wishes);
  end if;

  return jsonb_build_object(
    'occasion', jsonb_build_object(
      'id', v_occ.id, 'title', v_occ.title, 'starts_at', v_occ.starts_at, 'tz', v_occ.tz, 'all_day', v_occ.all_day,
      'place_text', v_occ.place_text, 'description', v_occ.description, 'created_at', v_occ.created_at,
      'host', jsonb_build_object('id', v_occ.host_id, 'display_name', v_host_name),
      -- the cover photo's meta (the bytes: get_occasion_photo); null without a photo
      'photo', (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                  from public.occasion_photos ph where ph.occasion_id = v_occ.id)),
    'viewer', jsonb_build_object('role', v_me.role, 'rsvp', v_me.rsvp),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'display_name', p.display_name, 'role', m.role, 'rsvp', m.rsvp)
                                order by m.joined_at, p.id), '[]'::jsonb)
      from public.occasion_members m
      join public.profiles p on p.id = m.profile_id
      where m.occasion_id = p_occasion_id and m.status = 'active' and not private.is_blocked_pair(v_uid, p.id)),
    'invite', v_invite,
    'wishlist', v_wishlist);
end $$;

-- reserve_wish(): the 20261020120000 body, `v_wl record`. On a standalone list it answers not_allowed (there is
-- no membership in occasion NULL) — closed by default until M3 adds the follower path.
create or replace function public.reserve_wish(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;   -- 10 columns into 10 fields: wishes does not change
  v_wl   record;                  -- not %rowtype (strict_multi_assignment, follows-design §0.4 item 4)
  v_id   uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;

  select w.id, w.wishlist_id, w.title, w.price_cents, w.currency, w.url, w.note, w.priority, w.created_at, w.updated_at into v_wish from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  select wl.id, wl.occasion_id, wl.owner_id, wl.recipient_id, wl.title, wl.created_at, wl.updated_at into v_wl from public.wishlists wl where wl.id = v_wish.wishlist_id;

  -- 1) owner / recipient: ALWAYS not_allowed, decided before reservations are looked at
  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then raise exception using message = 'not_allowed'; end if;

  perform private.lock_profile_pair(v_uid, v_wl.recipient_id);
  -- Revocation must wait for this transaction, then end the just-created reservation.
  perform m.profile_id from public.occasion_members m
   where m.occasion_id = v_wl.occasion_id and m.profile_id = v_uid and m.status = 'active' for share;
  if not found then raise exception using message = 'not_allowed'; end if;

  -- List and wish must still exist; a delete of either waits for this transaction (see the header).
  perform wl.id from public.wishlists wl where wl.id = v_wl.id for key share;
  if not found then raise exception using message = 'not_found'; end if;
  perform w.id from public.wishes w where w.id = p_wish_id for key share;
  if not found then raise exception using message = 'not_found'; end if;

  -- 2) not an active member of the occasion, or blocked with the owner/recipient: the same code
  if not private.is_active_member(v_wl.occasion_id, v_uid)
     or private.is_blocked_pair(v_uid, v_wl.owner_id)
     or private.is_blocked_pair(v_uid, v_wl.recipient_id) then
    raise exception using message = 'not_allowed';
  end if;

  -- 3) the same person pressing again: idempotent
  if exists (select 1 from public.reservations r
             where r.wish_id = p_wish_id and r.status = 'active' and r.reserver_id = v_uid) then
    return jsonb_build_object('ok', true);
  end if;

  -- 4) atomic: a concurrent second insert waits for the first commit, sees the conflict → already_reserved
  insert into public.reservations (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot)
  values (p_wish_id, v_wl.id, v_wl.recipient_id, v_uid, v_wish.title)
  on conflict (wish_id) where status = 'active' do nothing
  returning id into v_id;

  if v_id is null then raise exception using message = 'already_reserved'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- cancel_reservation(): the 20261019120500 body, `v_wl record`.
create or replace function public.cancel_reservation(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;
  v_wl   record;   -- not %rowtype (strict_multi_assignment)
  v_id   uuid;
begin
  select w.id, w.wishlist_id, w.title, w.price_cents, w.currency, w.url, w.note, w.priority, w.created_at, w.updated_at into v_wish from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  select wl.id, wl.occasion_id, wl.owner_id, wl.recipient_id, wl.title, wl.created_at, wl.updated_at into v_wl from public.wishlists wl where wl.id = v_wish.wishlist_id;

  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then raise exception using message = 'not_allowed'; end if;
  if not private.is_active_member(v_wl.occasion_id, v_uid) then raise exception using message = 'not_allowed'; end if;

  update public.reservations r
     set status = 'ended', end_reason = 'by_reserver', ended_at = now()
   where r.wish_id = p_wish_id and r.reserver_id = v_uid and r.status = 'active'
  returning r.id into v_id;
  if v_id is null then raise exception using message = 'not_found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 14. Privileges. New public RPCs: authenticated only (Supabase's default privileges and PUBLIC would give
--     anon EXECUTE). schema private: PUBLIC execute off again; the export helper is needed by the invoker
--     export, the guard trigger gets its grant "as a safety net" like the other guards; profile_card is only
--     ever called from definer functions. CREATE OR REPLACE keeps the privileges of the re-created functions.
-- -----------------------------------------------------------------------------
revoke execute on function public.get_list_screen(uuid), public.get_lists_overview() from public, anon;
grant execute on function public.get_list_screen(uuid), public.get_lists_overview() to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function private.profile_card(uuid) from authenticated;
grant execute on function private.my_wishlists_export(), private.wishlist_limit() to authenticated;
