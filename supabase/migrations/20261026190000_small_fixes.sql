-- =============================================================================
-- Bunprise — Р11 small fixes (Felix 26.10: «делай пока дефолтно»; docs/spec/in-app-invites-design.md §12,
-- docs/legal-drafts/pilot-4/README.md «Решения и шаги»):
--   1. accept_invite: a CANCELLED occasion (occasions.cancelled_at is not null) cannot be joined by an old link.
--      Same `invite_invalid` as unknown / expired / revoked / exhausted / blocked — the answer reveals nothing
--      (a deleted occasion already has no invites: on delete cascade; a past one: the link's expires_at).
--   2. private.purge_unconfirmed_users (the existing HOURLY pg_cron job 'bunprise_purge_unconfirmed_users',
--      20261019120500) now also deletes accounts that signed in but never finished the setup: not a single
--      consent record, and neither created nor signed in during the last 30 days (Datenschutz pilot-4 §3.1, §6).
--      People who finished the setup once and only have to accept NEWER texts keep their account (they have
--      older consent rows). Without any consent row an account cannot hold content: every write path checks
--      private.has_consents — so it owns only auth.users + its profiles row (cascade).
-- Both functions keep their name, signature, owner and privileges (create or replace keeps the ACL); the cron
-- job calls the function by name and needs no change.
-- NOTE for later migrations (in-app invites, 20261027*): redefine accept_invite from THIS text.
-- =============================================================================

-- 1. accept_invite — the 20261019120500 text + the cancelled check (read under the same row lock on the occasion).
create or replace function public.accept_invite(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.invites%rowtype;
  v_host uuid;
  v_status text;
  v_status_at timestamptz;
  v_cancelled timestamptz;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception using message = 'invite_invalid'; end if;
  -- Initial lookup identifies the pair only. Authorization is checked again under locks.
  select o.host_id into v_host from public.invites i join public.occasions o on o.id = i.occasion_id
   where i.token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then raise exception using message = 'invite_invalid'; end if;
  perform private.lock_profile_pair(v_uid, v_host);
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  -- the occasion row stays locked until commit: a concurrent cancellation waits for this join (or this join sees it)
  select o.cancelled_at into v_cancelled from public.occasions o join public.invites i on i.occasion_id = o.id
   where i.token_hash = sha256(convert_to(p_token, 'UTF8')) for update of o;
  select i.id, i.occasion_id, i.created_by, i.token_hash, i.expires_at, i.max_uses, i.use_count, i.revoked_at, i.created_at
    into v_inv from public.invites i where i.token_hash = sha256(convert_to(p_token, 'UTF8')) for update;
  -- one code for every reason: unknown / revoked / expired / exhausted / blocked / cancelled occasion
  if not found or v_inv.revoked_at is not null or v_inv.expires_at <= now() or v_inv.use_count >= v_inv.max_uses
     or v_cancelled is not null
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

-- 2. Retention of unfinished accounts — the 20261019120500 text + the second delete.
create or replace function private.purge_unconfirmed_users()
returns void language sql volatile security definer set search_path = '' as $$
  -- an address typed in, never signed in: after 24 hours (the hourly job keeps it under 25 hours)
  delete from auth.users where last_sign_in_at is null and created_at < now() - interval '24 hours';
  -- signed in, but the setup (display name + confirmations) was never finished: 30 days after the last sign-in
  delete from auth.users u
   where u.last_sign_in_at < now() - interval '30 days'
     and u.created_at < now() - interval '30 days'
     and not exists (select 1 from public.consents c where c.profile_id = u.id);
$$;
-- unchanged: only the migration / cron owner may run it (re-stated so this file stands on its own)
revoke execute on function private.purge_unconfirmed_users() from public, anon, authenticated;
