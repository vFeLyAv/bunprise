-- =============================================================================
-- Bunprise pilot — 3/5: RPCs (docs/spec/pilot-decisions.md §2–§3, docs/spec/data-and-secrecy.md §5)
-- Rules:
--   * security definer (owner postgres), set search_path = '', every name schema-qualified;
--     export_my_data() is SECURITY INVOKER (G-19) and reads under the caller's RLS.
--   * errors: raise exception using message = '<code>' → PostgREST {code:'P0001', message:'<code>'} → i18n errors.<code>
--     codes: not_authenticated, not_allowed, not_found, already_reserved (members only), invite_invalid (one code for
--     expired / revoked / exhausted / blocked / unknown), consent_required, profile_incomplete, validation
--   * order of checks: session → consents → "are you owner/recipient?" → membership → reservation state.
--     The answer for the list owner is always decided BEFORE reservations are looked at.
--   * no RPC is executable by anon; grants are at the end of this file.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_me() → { profile, consents_ok, legal_versions }
-- -----------------------------------------------------------------------------
create or replace function public.get_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                                          'onboarding_done_at', p.onboarding_done_at)
                from public.profiles p where p.id = v_uid),
    'consents_ok', private.has_consents(v_uid),
    'legal_versions', jsonb_build_object(
      'terms',   (select lv.version from public.legal_versions lv where lv.kind = 'terms'),
      'privacy', (select lv.version from public.legal_versions lv where lv.kind = 'privacy'),
      'age',     (select lv.version from public.legal_versions lv where lv.kind = 'age_18plus')));
end $$;

-- -----------------------------------------------------------------------------
-- get_feed() → { upcoming: Occasion[], past: Occasion[] }
-- Occasion = { id, title, starts_at, tz, all_day, place_text, role, rsvp, host_name, member_count, wish_count,
--              my_reservation_count }  — the host's rows ALWAYS carry my_reservation_count: null (key present).
-- An occasion is "past" once its end has passed: ends_at, or the end of its day in its own time zone.
-- past = ended within the last 30 days. upcoming sorted ascending, past descending.
-- -----------------------------------------------------------------------------
create or replace function public.get_feed()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_now timestamptz := now();
begin
  return (
    with mine as (
      select o.id, o.title, o.starts_at, o.tz, o.all_day, o.place_text, o.host_id, m.role, m.rsvp,
             coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) as ends_eff
      from public.occasion_members m
      join public.occasions o on o.id = m.occasion_id
      where m.profile_id = v_uid and m.status = 'active'
    ),
    feed_rows as (
      select x.id, x.starts_at, x.ends_eff,
        jsonb_build_object(
          'id', x.id, 'title', x.title, 'starts_at', x.starts_at, 'tz', x.tz, 'all_day', x.all_day,
          'place_text', x.place_text, 'role', x.role, 'rsvp', x.rsvp,
          'host_name', (select p.display_name from public.profiles p where p.id = x.host_id),
          'member_count', (select count(*) from public.occasion_members mm
                           where mm.occasion_id = x.id and mm.status = 'active'),
          'wish_count', (select count(*) from public.wishes w
                         join public.wishlists wl on wl.id = w.wishlist_id where wl.occasion_id = x.id),
          -- the host never gets a number here; a member only counts their OWN active reservations
          'my_reservation_count', case when x.role = 'host' then null::bigint
                                       else (select count(*) from public.reservations r
                                             join public.wishlists wl on wl.id = r.wishlist_id
                                             where wl.occasion_id = x.id and r.reserver_id = v_uid and r.status = 'active') end
        ) as j
      from mine x
    )
    select jsonb_build_object(
      'upcoming', coalesce((select jsonb_agg(f.j order by f.starts_at asc, f.id) from feed_rows f
                            where f.ends_eff >= v_now), '[]'::jsonb),
      'past',     coalesce((select jsonb_agg(f.j order by f.starts_at desc, f.id) from feed_rows f
                            where f.ends_eff < v_now and f.ends_eff >= v_now - interval '30 days'), '[]'::jsonb)
    )
  );
end $$;

-- -----------------------------------------------------------------------------
-- get_occasion_screen(p_occasion_id) → one JSON for the whole screen (shape: pilot-decisions §3)
-- {
--   occasion: { id, title, starts_at, tz, all_day, place_text, description, created_at, host: { id, display_name } },
--   viewer:   { role, rsvp },
--   members:  [ { profile_id, display_name, role, rsvp } ],
--   invite:   { active: true, expires_at } | null,          -- host only; the token is never returned
--   wishlist: { id, owner_id, title, wishes: [ { id, title, url, price_cents, currency, note, priority, created_at,
--                                               reserved, reserved_by_me, reserved_by_name } ] }
-- }
-- SECRECY: the keys reserved / reserved_by_me / reserved_by_name are ALWAYS present. For the list owner
-- (= recipient = host in the pilot) they are ALWAYS null and that branch never touches public.reservations,
-- so the owner's JSON is byte-identical whatever the reservations are. Same ordering for every role:
-- priority desc, created_at asc. Nothing here writes anywhere.
-- -----------------------------------------------------------------------------
create or replace function public.get_occasion_screen(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_occ       public.occasions%rowtype;
  v_me        public.occasion_members%rowtype;
  v_wl        public.wishlists%rowtype;
  v_host_name text;
  v_invite    jsonb := null;
  v_wishes    jsonb;
  v_wishlist  jsonb := null;
begin
  select o.* into v_occ from public.occasions o where o.id = p_occasion_id;
  if not found then raise exception using message = 'not_found'; end if;
  select m.* into v_me from public.occasion_members m
   where m.occasion_id = p_occasion_id and m.profile_id = v_uid and m.status = 'active';
  if not found then raise exception using message = 'not_found'; end if;   -- outsider / left / removed: one answer

  select p.display_name into v_host_name from public.profiles p where p.id = v_occ.host_id;

  if v_me.role = 'host' then
    select jsonb_build_object('active', true, 'expires_at', i.expires_at) into v_invite
      from public.invites i
     where i.occasion_id = p_occasion_id and i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses
     order by i.created_at desc
     limit 1;
  end if;

  -- the one list of the pilot: the host's
  select wl.* into v_wl from public.wishlists wl
   where wl.occasion_id = p_occasion_id and wl.owner_id = v_occ.host_id
   order by wl.created_at
   limit 1;

  if found then
    if v_uid in (v_wl.owner_id, v_wl.recipient_id) then
      -- OWNER BRANCH: literal nulls, public.reservations is not referenced at all
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
               'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
               'reserved', null::boolean, 'reserved_by_me', null::boolean, 'reserved_by_name', null::text)
               order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
        into v_wishes
        from public.wishes w
       where w.wishlist_id = v_wl.id;
    else
      -- MEMBER BRANCH: reserved flag + who reserved (members may coordinate a joint gift).
      -- Blocked pair (viewer <-> reserver): the fact "taken" stays (no double gift), the name is null —
      -- the same rule that hides the person from members[] (data-spec §7 row 16: profiles hidden).
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
               'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
               'reserved', (r.id is not null),
               'reserved_by_me', coalesce(r.reserver_id = v_uid, false),
               'reserved_by_name', rp.display_name)
               order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
        into v_wishes
        from public.wishes w
        left join public.reservations r on r.wish_id = w.id and r.status = 'active'
        left join public.profiles rp on rp.id = r.reserver_id and not private.is_blocked_pair(v_uid, r.reserver_id)
       where w.wishlist_id = v_wl.id;
    end if;
    v_wishlist := jsonb_build_object('id', v_wl.id, 'owner_id', v_wl.owner_id, 'title', v_wl.title, 'wishes', v_wishes);
  end if;

  return jsonb_build_object(
    'occasion', jsonb_build_object(
      'id', v_occ.id, 'title', v_occ.title, 'starts_at', v_occ.starts_at, 'tz', v_occ.tz, 'all_day', v_occ.all_day,
      'place_text', v_occ.place_text, 'description', v_occ.description, 'created_at', v_occ.created_at,
      'host', jsonb_build_object('id', v_occ.host_id, 'display_name', v_host_name)),
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

-- -----------------------------------------------------------------------------
-- create_invite(p_occasion_id) → { token }   (host only; shown once; older active links are revoked)
-- expires_at = greatest(now() + 14 days, starts_at + 7 days), max_uses = 50.
-- Token: 32 random bytes as 64 hex chars (two gen_random_uuid(): no extension needed, ≈244 bits of entropy);
-- the database keeps only sha256(token). Link: https://<app>/i#<token>
-- -----------------------------------------------------------------------------
create or replace function public.create_invite(p_occasion_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_starts timestamptz;
  v_token  text;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  select o.starts_at into v_starts from public.occasions o where o.id = p_occasion_id and o.host_id = v_uid;
  if not found then raise exception using message = 'not_found'; end if;   -- foreign / unknown occasion: one answer

  update public.invites set revoked_at = now()
   where occasion_id = p_occasion_id and revoked_at is null;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invites (occasion_id, created_by, token_hash, expires_at, max_uses)
  values (p_occasion_id, v_uid, sha256(convert_to(v_token, 'UTF8')),
          greatest(now() + interval '14 days', v_starts + interval '7 days'), 50);
  return jsonb_build_object('token', v_token);
end $$;

-- -----------------------------------------------------------------------------
-- accept_invite(p_token) → { occasion_id }
-- Requires consents + display_name. Re-activates a membership that is 'left' or 'removed' (pilot-decisions §1),
-- unless host and guest are blocked. Already-active members (incl. the host) just get the occasion_id back.
-- -----------------------------------------------------------------------------
create or replace function public.accept_invite(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_inv  public.invites%rowtype;
  v_host uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception using message = 'invite_invalid'; end if;

  -- for update: two people joining at the same time count use_count correctly
  select i.* into v_inv from public.invites i
   where i.token_hash = sha256(convert_to(p_token, 'UTF8')) for update;
  if not found or v_inv.revoked_at is not null or v_inv.expires_at <= now() or v_inv.use_count >= v_inv.max_uses then
    raise exception using message = 'invite_invalid';   -- one code for unknown / expired / revoked / exhausted
  end if;

  if private.is_active_member(v_inv.occasion_id, v_uid) then
    return jsonb_build_object('occasion_id', v_inv.occasion_id);
  end if;

  select o.host_id into v_host from public.occasions o where o.id = v_inv.occasion_id;
  if private.is_blocked_pair(v_uid, v_host) then raise exception using message = 'invite_invalid'; end if;

  insert into public.occasion_members as m (occasion_id, profile_id, role, rsvp, status, invited_via)
  values (v_inv.occasion_id, v_uid, 'member', 'none', 'active', v_inv.id)
  on conflict (occasion_id, profile_id) do update
    set status = 'active', invited_via = excluded.invited_via, rsvp = 'none', joined_at = now()
    where m.status in ('left', 'removed');            -- removed / left: welcome back by a (new) link

  update public.invites set use_count = use_count + 1 where id = v_inv.id;
  return jsonb_build_object('occasion_id', v_inv.occasion_id);
end $$;

-- -----------------------------------------------------------------------------
-- reserve_wish(p_wish_id) → { ok: true }
-- owner/recipient of the list → 'not_allowed'; outsider / blocked → the SAME 'not_allowed';
-- member: ok, or 'already_reserved' when someone else holds it; the same reserver again: ok (idempotent).
-- The partial unique index is the only lock (no row lock on wishes → nothing the owner could observe).
-- -----------------------------------------------------------------------------
create or replace function public.reserve_wish(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;
  v_wl   public.wishlists%rowtype;
  v_id   uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;

  select w.* into v_wish from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  select wl.* into v_wl from public.wishlists wl where wl.id = v_wish.wishlist_id;

  -- 1) owner / recipient: ALWAYS not_allowed, decided before reservations are looked at
  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then raise exception using message = 'not_allowed'; end if;

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

-- -----------------------------------------------------------------------------
-- cancel_reservation(p_wish_id) → { ok: true }   (only the reserver; owner / outsider → 'not_allowed';
-- member without an own active reservation on this wish → 'not_found', whatever others hold)
-- -----------------------------------------------------------------------------
create or replace function public.cancel_reservation(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;
  v_wl   public.wishlists%rowtype;
  v_id   uuid;
begin
  select w.* into v_wish from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  select wl.* into v_wl from public.wishlists wl where wl.id = v_wish.wishlist_id;

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
-- my_reservations() → [ { wish_id, wish_title, occasion_id, occasion_title, starts_at, status, end_reason, created_at } ]
-- Only the caller's own reservations as reserver: active ones, plus those ended by others
-- (wish deleted, removed, left, blocked) within the last 90 days. Own cancellations are not listed.
-- -----------------------------------------------------------------------------
create or replace function public.my_reservations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'wish_id', r.wish_id,
             'wish_title', coalesce(w.title, r.wish_title_snapshot),
             'occasion_id', o.id, 'occasion_title', o.title, 'starts_at', o.starts_at,
             'status', r.status, 'end_reason', r.end_reason, 'created_at', r.created_at)
             order by r.created_at desc, r.id), '[]'::jsonb)
    from public.reservations r
    left join public.wishes w on w.id = r.wish_id
    left join public.wishlists wl on wl.id = r.wishlist_id
    left join public.occasions o on o.id = wl.occasion_id
    where r.reserver_id = v_uid
      and (r.status = 'active'
           or (r.status = 'ended' and r.end_reason <> 'by_reserver' and r.ended_at >= now() - interval '90 days'))
  );
end $$;

-- -----------------------------------------------------------------------------
-- leave_occasion(p_occasion_id) / remove_member(p_occasion_id, p_profile_id) → { ok: true }
-- Leaving / being removed ends the person's active reservations in that occasion (pilot-decisions §1).
-- remove_member also REVOKES the occasion's active invite links: "Убрать гостя" is the pilot's only safety
-- tool (no "Blockieren" in the UI, G-20) and the removed person still has the old link in their chat —
-- it must not let them straight back in. A removed guest returns only by a NEW link (pilot-decisions §1),
-- so the host creates one afterwards (get_occasion_screen shows invite: null until then).
-- Leaving voluntarily does not touch the links: "left" may come back by the same link.
-- -----------------------------------------------------------------------------
create or replace function private.end_reservations_in_occasion(p_occasion uuid, p_uid uuid, p_reason text)
returns void language sql volatile security definer set search_path = '' as $$
  update public.reservations r
     set status = 'ended', end_reason = p_reason, ended_at = now()
   where r.reserver_id = p_uid and r.status = 'active'
     and r.wishlist_id in (select wl.id from public.wishlists wl where wl.occasion_id = p_occasion);
$$;

create or replace function public.leave_occasion(p_occasion_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if private.is_host(p_occasion_id, v_uid) then raise exception using message = 'not_allowed'; end if;   -- the host deletes instead
  update public.occasion_members set status = 'left'
   where occasion_id = p_occasion_id and profile_id = v_uid and status = 'active';
  if not found then raise exception using message = 'not_found'; end if;
  perform private.end_reservations_in_occasion(p_occasion_id, v_uid, 'member_left');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.remove_member(p_occasion_id uuid, p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if not private.is_host(p_occasion_id, v_uid) then raise exception using message = 'not_found'; end if;
  update public.occasion_members set status = 'removed'
   where occasion_id = p_occasion_id and profile_id = p_profile_id and role = 'member' and status = 'active';
  if not found then raise exception using message = 'not_found'; end if;
  perform private.end_reservations_in_occasion(p_occasion_id, p_profile_id, 'member_removed');
  -- the link the removed guest still has must die with the membership (F-1)
  update public.invites set revoked_at = now()
   where occasion_id = p_occasion_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- block_user(p_profile_id) / unblock_user(p_profile_id) → { ok: true }   (groundwork; no UI in the pilot)
-- Memberships in each other's occasions end, reservations between the two end quietly.
-- The block itself is never revealed: the blocked person sees 'member_removed', not 'blocked'; and the
-- membership status is what the OTHER side could have caused anyway — 'removed' when the host blocks a
-- guest (looks like "Убрать гостя"), 'left' when a guest blocks the host (looks like leaving), so the host
-- cannot tell a block from a voluntary exit through the occasion_members rows they can read.
-- -----------------------------------------------------------------------------
create or replace function public.block_user(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_profile_id is null or p_profile_id = v_uid
     or not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception using message = 'not_found';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_profile_id) on conflict do nothing;

  update public.occasion_members m
     set status = case when o.host_id = v_uid then 'removed' else 'left' end
    from public.occasions o
   where o.id = m.occasion_id and m.status = 'active' and m.role = 'member'
     and ((o.host_id = v_uid and m.profile_id = p_profile_id) or (o.host_id = p_profile_id and m.profile_id = v_uid));

  update public.reservations r set status = 'ended', end_reason = 'blocked', ended_at = now()
   where r.status = 'active' and r.reserver_id = v_uid and r.recipient_id = p_profile_id;
  update public.reservations r set status = 'ended', end_reason = 'member_removed', ended_at = now()
   where r.status = 'active' and r.reserver_id = p_profile_id and r.recipient_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.unblock_user(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  delete from public.blocks b where b.blocker_id = v_uid and b.blocked_id = p_profile_id;
  -- memberships / reservations are not restored: a new invite link is needed
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- export_my_data() → jsonb   (DSGVO Art. 15 / 20) — SECURITY INVOKER: everything is read under the caller's
-- own RLS. Two security definer helpers, both filtering on auth.uid() and ignoring every argument-free
-- way to ask for somebody else:
--   * my_profile_export(): the caller's own profile row in full (REST grants give only id + display_name);
--   * my_reservations_export(): the caller's own reservations AS RESERVER (reservations have no REST grants,
--     so the invoker could not read the table itself). Reservations on the caller's own wishes are never
--     touched. recipient_name is null when the caller and the recipient are a blocked pair (F-5).
-- E-mail is not part of the export (the client adds it from auth.getUser()).
-- -----------------------------------------------------------------------------
create or replace function private.my_profile_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                            'onboarding_done_at', p.onboarding_done_at, 'last_seen_at', p.last_seen_at,
                            'created_at', p.created_at, 'updated_at', p.updated_at)
  from public.profiles p where p.id = auth.uid();
$$;

create or replace function private.my_reservations_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'wish_title', coalesce(w.title, r.wish_title_snapshot),
           'recipient_name', p.display_name,
           'occasion_title', o.title,
           'status', r.status, 'end_reason', r.end_reason, 'created_at', r.created_at, 'ended_at', r.ended_at)
           order by r.created_at, r.id), '[]'::jsonb)
  from public.reservations r
  left join public.profiles p on p.id = r.recipient_id and not private.is_blocked_pair(auth.uid(), r.recipient_id)
  left join public.wishes w on w.id = r.wish_id
  left join public.wishlists wl on wl.id = r.wishlist_id
  left join public.occasions o on o.id = wl.occasion_id
  where r.reserver_id = auth.uid();
$$;

create or replace function public.export_my_data()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'format', 'bunprise-export-v1',
    'exported_at', now(),
    'profile', private.my_profile_export(),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'version', c.version, 'locale', c.locale,
                                                              'accepted_at', c.accepted_at) order by c.accepted_at, c.kind), '[]'::jsonb)
                 from public.consents c where c.profile_id = v_uid),
    'occasions_hosted', (
      select coalesce(jsonb_agg((to_jsonb(o) || jsonb_build_object(
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
    'wishlists', (
      select coalesce(jsonb_agg((to_jsonb(wl) || jsonb_build_object(
               'wishes', (select coalesce(jsonb_agg(to_jsonb(w) order by w.priority desc, w.created_at, w.id), '[]'::jsonb)
                          from public.wishes w where w.wishlist_id = wl.id)
             )) order by wl.created_at, wl.id), '[]'::jsonb)
      from public.wishlists wl where wl.owner_id = v_uid),
    'reservations_made_by_me', private.my_reservations_export(),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('blocked_name', p.display_name, 'created_at', b.created_at)
                                         order by b.created_at), '[]'::jsonb)
               from public.blocks b left join public.profiles p on p.id = b.blocked_id where b.blocker_id = v_uid),
    'reports', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb)
                from public.reports r where r.reporter_id = v_uid)
  );
end $$;

-- -----------------------------------------------------------------------------
-- delete_my_account() → { ok: true }   (DSGVO Art. 17)
-- Own reservations as reserver disappear (wishes become free, silently); reservations on the caller's own
-- wishes disappear with the caller. Everything else cascades from auth.users → profiles (occasions, members,
-- invites, lists, wishes, consents, blocks, reports). auth.sessions / refresh tokens cascade inside schema auth,
-- so every session ends.
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  delete from public.reservations r where r.reserver_id = v_uid or r.recipient_id = v_uid;
  delete from auth.users u where u.id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- Privileges: nothing for anon / PUBLIC; the RPCs for authenticated only.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.get_me(), public.get_feed(), public.get_occasion_screen(uuid),
  public.create_invite(uuid), public.accept_invite(text),
  public.reserve_wish(uuid), public.cancel_reservation(uuid), public.my_reservations(),
  public.leave_occasion(uuid), public.remove_member(uuid, uuid),
  public.block_user(uuid), public.unblock_user(uuid),
  public.export_my_data(), public.delete_my_account()
  to authenticated;

-- private.* added in this file: PUBLIC execute off; only what export_my_data (invoker) needs is granted.
revoke execute on all functions in schema private from public, anon;
revoke execute on function private.end_reservations_in_occasion(uuid, uuid, text) from authenticated;
grant execute on function private.require_user(), private.my_profile_export(), private.my_reservations_export() to authenticated;
