-- Bunprise pilot v1.1: security/privacy follow-up (pilot-decisions section 0, S1-S9/L3/L4/L13).
-- Previous migrations stay historical; this migration changes the effective schema and privileges.
-- Wire changes: consent kind privacy_notice; no profiles.last_seen_at or reserved_by_name.
-- get_me().legal_versions keeps its terms/privacy/age envelope.
alter table public.legal_versions drop constraint legal_versions_kind_check;
alter table public.consents drop constraint consents_kind_check;
update public.legal_versions set kind = 'privacy_notice' where kind = 'privacy';
update public.consents set kind = 'privacy_notice' where kind = 'privacy';
alter table public.legal_versions add constraint legal_versions_kind_check check (kind in ('terms', 'privacy_notice', 'age_18plus'));
alter table public.consents add constraint consents_kind_check check (kind in ('terms', 'privacy_notice', 'age_18plus'));
comment on table public.consents is 'Append-only legal record: terms acceptance, age declaration, privacy notice version shown (not consent to processing).';
alter table public.profiles drop column last_seen_at;


alter table public.occasions drop constraint occasions_title_check;
alter table public.occasions add constraint occasions_title_check check (length(title) between 1 and 80 and btrim(title) <> '');

alter table public.occasion_addresses drop constraint occasion_addresses_address_check;
alter table public.occasion_addresses add constraint occasion_addresses_address_check check (length(address) between 1 and 300 and btrim(address) <> '');

alter table public.wishlists drop constraint wishlists_title_check;
alter table public.wishlists add constraint wishlists_title_check check (title is null or (length(title) between 1 and 80 and btrim(title) <> ''));

alter table public.wishes drop constraint wishes_title_check;
alter table public.wishes add constraint wishes_title_check check (length(title) between 1 and 120 and btrim(title) <> '');

alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check check (length(reason) between 1 and 1000 and btrim(reason) <> '');

alter table public.wishes drop constraint wishes_currency_check;
alter table public.wishes add constraint wishes_currency_check check (currency = 'EUR');

-- Table SELECT also exposes xmax. Reset table grants, then allow only explicit application columns.
revoke select on public.profiles, public.legal_versions, public.consents, public.occasions, public.occasion_addresses, public.invites, public.occasion_members, public.wishlists, public.wishes, public.blocks, public.reports from public, anon, authenticated;

grant select (id, display_name) on public.profiles to authenticated;

grant select (kind, version, published_at) on public.legal_versions to authenticated;

grant select (profile_id, kind, version, locale, accepted_at) on public.consents to authenticated;

grant select (id, host_id, title, starts_at, ends_at, tz, all_day, place_text, description, cancelled_at, created_at, updated_at) on public.occasions to authenticated;

grant select (occasion_id, address, updated_at) on public.occasion_addresses to authenticated;

grant select (id, occasion_id, created_by, expires_at, max_uses, use_count, revoked_at, created_at) on public.invites to authenticated;

grant select (occasion_id, profile_id, role, rsvp, status, invited_via, joined_at, updated_at) on public.occasion_members to authenticated;

grant select (id, occasion_id, owner_id, recipient_id, title, created_at, updated_at) on public.wishlists to authenticated;

grant select (id, wishlist_id, title, price_cents, currency, url, note, priority, created_at, updated_at) on public.wishes to authenticated;

grant select (blocker_id, blocked_id, created_at) on public.blocks to authenticated;

grant select (id, reporter_id, target_kind, target_id, reason, created_at, handled_at, outcome) on public.reports to authenticated;

revoke insert on public.reports from authenticated;
grant insert (reporter_id, target_kind, target_id, reason) on public.reports to authenticated;

create or replace function private.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception using message = 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception using message = 'not_allowed';
  end if;
  return v_uid;
end $$;

create or replace function private.can_read_wishlist(p_wishlist uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wishlists wl
    join public.occasion_members m on m.occasion_id = wl.occasion_id
    where wl.id = p_wishlist and m.profile_id = p_uid and m.status = 'active'
      and not private.is_blocked_pair(p_uid, wl.owner_id)
      and not private.is_blocked_pair(p_uid, wl.recipient_id));
$$;

-- Consistent first lock for relationship writes, before occasion/invite/membership/reservation locks.
-- NO KEY UPDATE serializes pair writers while remaining compatible with ordinary FK KEY SHARE.
create or replace function private.lock_profile_pair(p_a uuid, p_b uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform p.id from public.profiles p where p.id in (p_a, p_b) order by p.id for no key update;
  perform private.require_user();
end $$;


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
      'privacy', (select lv.version from public.legal_versions lv where lv.kind = 'privacy_notice'),
      'age',     (select lv.version from public.legal_versions lv where lv.kind = 'age_18plus')));
end $$;

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

create or replace function public.create_invite(p_occasion_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_starts timestamptz;
  v_token  text;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  perform private.lock_profile_pair(v_uid, v_uid);
  select o.starts_at into v_starts from public.occasions o where o.id = p_occasion_id and o.host_id = v_uid for update;
  if not found then raise exception using message = 'not_found'; end if;   -- foreign / unknown occasion: one answer

  update public.invites set revoked_at = now()
   where occasion_id = p_occasion_id and revoked_at is null;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invites (occasion_id, created_by, token_hash, expires_at, max_uses, created_at)
  values (p_occasion_id, v_uid, sha256(convert_to(v_token, 'UTF8')),
          greatest(now() + interval '14 days', v_starts + interval '7 days'), 50, clock_timestamp());
  return jsonb_build_object('token', v_token);
end $$;

-- Enforce one unrevoked link even if a caller ever bypasses the RPC.
with ranked as (select id, row_number() over (partition by occasion_id order by created_at desc, id desc) n
  from public.invites where revoked_at is null)
update public.invites i set revoked_at = now() from ranked r where i.id = r.id and r.n > 1;
create unique index invites_one_active_per_occasion on public.invites (occasion_id) where revoked_at is null;

create or replace function public.accept_invite(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.invites%rowtype;
  v_host uuid;
  v_status text;
  v_status_at timestamptz;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception using message = 'invite_invalid'; end if;
  -- Initial lookup identifies the pair only. Authorization is checked again under locks.
  select o.host_id into v_host from public.invites i join public.occasions o on o.id = i.occasion_id
   where i.token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then raise exception using message = 'invite_invalid'; end if;
  perform private.lock_profile_pair(v_uid, v_host);
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  perform o.id from public.occasions o join public.invites i on i.occasion_id = o.id
   where i.token_hash = sha256(convert_to(p_token, 'UTF8')) for update of o;
  select i.id, i.occasion_id, i.created_by, i.token_hash, i.expires_at, i.max_uses, i.use_count, i.revoked_at, i.created_at
    into v_inv from public.invites i where i.token_hash = sha256(convert_to(p_token, 'UTF8')) for update;
  if not found or v_inv.revoked_at is not null or v_inv.expires_at <= now() or v_inv.use_count >= v_inv.max_uses
     or private.is_blocked_pair(v_uid, v_host) then
    raise exception using message = 'invite_invalid';
  end if;
  select m.status, m.updated_at into v_status, v_status_at from public.occasion_members m
   where m.occasion_id = v_inv.occasion_id and m.profile_id = v_uid for update;
  if v_status = 'active' then return jsonb_build_object('occasion_id', v_inv.occasion_id); end if;
  if v_status = 'removed' and v_inv.created_at <= v_status_at then
    raise exception using message = 'invite_invalid';
  end if;
  insert into public.occasion_members as m (occasion_id, profile_id, role, rsvp, status, invited_via)
  values (v_inv.occasion_id, v_uid, 'member', 'none', 'active', v_inv.id)
  on conflict (occasion_id, profile_id) do update
    set status = 'active', invited_via = excluded.invited_via, rsvp = 'none', joined_at = now()
    where m.status in ('left', 'removed');
  update public.invites set use_count = use_count + 1 where id = v_inv.id;
  return jsonb_build_object('occasion_id', v_inv.occasion_id);
end $$;

create or replace function public.reserve_wish(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;
  v_wl   public.wishlists%rowtype;
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



create or replace function public.leave_occasion(p_occasion_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_host uuid;
begin
  select o.host_id into v_host from public.occasions o where o.id = p_occasion_id;
  perform private.lock_profile_pair(v_uid, v_host);
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
  perform private.lock_profile_pair(v_uid, p_profile_id);
  perform o.id from public.occasions o where o.id = p_occasion_id and o.host_id = v_uid for update;
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

create or replace function public.block_user(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, p_profile_id);
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
  perform private.lock_profile_pair(v_uid, p_profile_id);
  delete from public.blocks b where b.blocker_id = v_uid and b.blocked_id = p_profile_id;
  -- memberships / reservations are not restored: a new invite link is needed
  return jsonb_build_object('ok', true);
end $$;

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
    left join public.wishlists wl on wl.id = r.wishlist_id and private.can_read_wishlist(wl.id, v_uid)
    left join public.wishes w on w.id = r.wish_id and wl.id is not null
    left join public.occasions o on o.id = wl.occasion_id
    where r.reserver_id = v_uid
      and (r.status = 'active'
           or (r.status = 'ended' and r.end_reason <> 'by_reserver' and r.ended_at >= now() - interval '90 days'))
  );
end $$;

create or replace function private.my_profile_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                            'onboarding_done_at', p.onboarding_done_at,
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
  left join public.wishlists wl on wl.id = r.wishlist_id and private.can_read_wishlist(wl.id, auth.uid())
  left join public.wishes w on w.id = r.wish_id and wl.id is not null
  left join public.profiles p on p.id = r.recipient_id and wl.id is not null and not private.is_blocked_pair(auth.uid(), r.recipient_id)
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
    'wishlists', (
      select coalesce(jsonb_agg((jsonb_build_object('id', wl.id, 'occasion_id', wl.occasion_id, 'owner_id', wl.owner_id, 'recipient_id', wl.recipient_id, 'title', wl.title, 'created_at', wl.created_at, 'updated_at', wl.updated_at) || jsonb_build_object(
               'wishes', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'wishlist_id', w.wishlist_id, 'title', w.title, 'price_cents', w.price_cents, 'currency', w.currency, 'url', w.url, 'note', w.note, 'priority', w.priority, 'created_at', w.created_at, 'updated_at', w.updated_at) order by w.priority desc, w.created_at, w.id), '[]'::jsonb)
                          from public.wishes w where w.wishlist_id = wl.id)
             )) order by wl.created_at, wl.id), '[]'::jsonb)
      from public.wishlists wl where wl.owner_id = v_uid),
    'reservations_made_by_me', private.my_reservations_export(),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('blocked_name', p.display_name, 'created_at', b.created_at)
                                         order by b.created_at), '[]'::jsonb)
               from public.blocks b left join public.profiles p on p.id = b.blocked_id where b.blocker_id = v_uid),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporter_id', r.reporter_id, 'target_kind', r.target_kind, 'target_id', r.target_id, 'reason', r.reason, 'created_at', r.created_at, 'handled_at', r.handled_at, 'outcome', r.outcome) order by r.created_at), '[]'::jsonb)
                from public.reports r where r.reporter_id = v_uid)
  );
end $$;

-- Account deletion takes the same first lock before deleting reservations/cascading profiles.
create or replace function public.delete_my_account()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  delete from public.reservations r where r.reserver_id = v_uid or r.recipient_id = v_uid;
  delete from auth.users u where u.id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- Use explicit user-column projections in every updated reservation RPC.
create or replace function public.cancel_reservation(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;
  v_wl   public.wishlists%rowtype;
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

-- Retention is executable only by the migration/cron owner, never the API roles.
create or replace function private.purge_unconfirmed_users()
returns void language sql volatile security definer set search_path = '' as $$
  delete from auth.users where last_sign_in_at is null and created_at < now() - interval '24 hours';
$$;
create or replace function private.purge_expired_records()
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.reservations where status = 'ended' and ended_at < now() - interval '90 days';
  delete from public.reports where handled_at < now() - interval '90 days';
$$;
revoke execute on function private.lock_profile_pair(uuid, uuid), private.purge_unconfirmed_users(), private.purge_expired_records()
  from public, anon, authenticated;

-- Hourly cleanup promises no more than 25 hours for never-confirmed addresses.
-- The separate daily job enforces the 90-day reservation/report retention period.
do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable - retention scheduling skipped (expected on PGlite)';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $cmd$select cron.unschedule(jobid) from cron.job
    where jobname in ('bunprise_purge_unconfirmed_users', 'bunprise_purge_expired_records')$cmd$;
  execute $cmd$select cron.schedule('bunprise_purge_unconfirmed_users', '17 * * * *', 'select private.purge_unconfirmed_users()')$cmd$;
  execute $cmd$select cron.schedule('bunprise_purge_expired_records', '37 3 * * *', 'select private.purge_expired_records()')$cmd$;
end
$cron$;
