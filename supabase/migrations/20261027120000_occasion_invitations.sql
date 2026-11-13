-- =============================================================================
-- Bunprise: IN-APP INVITATIONS to an occasion ("Freunde einladen") — docs/spec/in-app-invites-design.md v1.1.
-- Felix 26.10: Р1 «да» (guests invite only when the host switched on "Gäste dürfen Freunde einladen", default
-- OFF); Р2–Р14 «делай пока дефолтно» = the "Рекомендую" column of §12. Forward only. NOT applied to the hosted
-- project by agents: Felix runs `npx supabase db push`.
--
-- CREATED SWITCHED OFF, SWITCHED ON WITH THE 4TH RELEASE: private.features.occasion_invitations defaults to FALSE —
-- while it is off every invitation RPC refuses (not_found / invite_invalid / an empty inbox / can_invite false), the
-- two new settings cannot be changed (trigger invitation_settings_guard), no invitation row can come into existence
-- and nothing is shown. Felix 26.10 («так включи приглашения и исправь Datenschutz и AGB»): the invitations are
-- released WITH the 4th release, together with the pilot-4 legal texts (privacy notice AND terms with the invitation
-- paragraphs, 20261026200000_legal_versions_pilot_4.sql) and VITE_INVITES=1 in the client. Switching the database on
-- stays its own explicit step: 20261027130000_occasion_invitations_on.sql, exactly this statement (template
-- supabase/emergency/occasion_invitations_on.sql):
--     update private.features set occasion_invitations = true;
-- The client hides everything behind VITE_INVITES (apps/web/src/features/invitations/flag.ts).
--
-- What a person can do (design §2)
--   * the host always, an active guest only while occasions.guests_can_invite = true, invites FRIENDS = people they
--     follow and who follow them back (accepted both ways). No search, no free text.
--   * the invitee sees a card on Start (title, day/time, the host's NAME only — no id, no photo — and the inviter),
--     then joins ("Beitreten": a normal membership, like the link) or declines silently ("Ablehnen").
--   * the sender sees "Eingeladen · bis …" until expires_at whatever happens: waiting, declined, ignored, silently
--     suppressed, voided for a reason the sender cannot see. Only their own "Zurückgezogen" and an acceptance (the
--     person appears in "Wer kommt") show. ONE projection for every answer: private.invitation_sender_state().
--   * after a decline: this occasion is closed for the invitee for as long as it exists (occasion_invite_refusals,
--     Р14) and the decliner hears nothing from that sender for 30 days (invitation_cooldowns, in every occasion).
--
-- Tables (all five RPC-ONLY, like follows: no privilege of any kind for anon / authenticated / PUBLIC, RLS enabled +
-- forced and NOT ONE policy; not in any publication; only the security definer functions below read or write them):
--   occasion_invitations      one row per attempt (occasion, inviter, invitee); delivered = false is a silent
--                             suppression (no reason stored); outcome pending | accepted | declined | withdrawn | void
--   invitation_attempts       the sender's quota ledger (5 / minute, 10 / 24 h, 30 / 7 days): survives the occasion's
--                             deletion and every recipient outcome (Codex B #3); purged after 7 days
--   occasion_invite_refusals  "this occasion is closed for this person" (lives as long as the occasion, Р14)
--   invitation_cooldowns      30 days of silence from one sender after a decline (like follow_cooldowns, INV-6:
--                             `until` only grows; block / unblock never shorten it)
--   member_invited_by         "eingeladen von Anna" for the HOST (Р3). A table, not a column of occasion_members:
--                             8 functions declare occasion_members%rowtype and that table has REST grants (Codex B #11)
-- Columns: occasions.guests_can_invite (host, REST, default false); profiles.invitations_from ('friends' | 'nobody',
-- the person's own REST write, no SELECT grant: the own value comes from get_me); private.features.occasion_invitations
-- (the database red button, supabase/emergency/occasion_invitations_off.sql).
--
-- RPCs (security definer, search_path '', authenticated only):
--   get_invite_candidates(p_occasion_id)            -> [{ profile: card, state: none|invited|withdrawn, expires_at }]
--   send_occasion_invites(p_occasion_id, uuid[])    -> [{ profile_id, state, expires_at }]  (≤ 10 ids)
--   withdraw_occasion_invite(p_occasion_id, p_profile_id) -> { ok: true }
--   get_sent_invitations(p_occasion_id)             -> [{ profile_id, display_name, state, expires_at }]
--   get_my_invitations()                            -> [{ id, occasion{id,title,starts_at,tz,all_day}, host_name,
--                                                         from_host, inviter: card, expires_at, created_at }]  (≤ 20)
--   respond_occasion_invite(p_invitation_id, p_accept) -> { occasion_id } | { ok: true }
--   get_occasion_invite_info(p_occasion_id)         -> { guests_can_invite, can_invite, invited_by[] (host only) }
--   export_my_invitations()                         -> the caller's own invitation data (Art. 15 / 20)
--   get_me()                                        + inbox.occasion_invites, + profile.invitations_from
-- Error codes: the contract's not_found / validation / limit_reached / consent_required / profile_incomplete /
-- invite_invalid — nothing new.
--
-- COORDINATION (26.10, three agents at once): the design (§4.2) changes get_occasion_screen, accept_invite,
-- export_my_data and purge_expired_records. Those belong to other work today, so this migration does NOT re-create
-- them. Instead:
--   * accept_invite (20261026190000) is untouched: a trigger on occasion_members does its part — any membership that
--     becomes active voids the person's pending invitations into that occasion and erases an old "eingeladen von";
--     a membership that stops being active voids what that person sent into the occasion (and what they received).
--   * get_occasion_screen (20261026180000) is untouched: get_occasion_invite_info() answers guests_can_invite,
--     can_invite and the host's "eingeladen von" (the client asks it lazily, after the first paint).
--   * export_my_data is untouched: export_my_invitations() is added to the download by the client (like
--     export_my_potluck, 20261025150000).
--   * purge_expired_records is untouched: private.purge_invitations() runs as its own daily pg_cron job.
--
-- SECRECY OF RESERVATIONS (design §5): nothing here reads or writes reservations, wishes or wishlists; no column,
-- foreign key or trigger leads there; the text of every function of this file never names them (meta test IS4).
-- Every decision (candidates, delivery, visibility, voiding, quotas, order) is computed from follows, blocks,
-- follow_cooldowns, the new tables, the occasion row, occasion_members statuses and profiles.invitations_from only.
--
-- LOCKS (design §4.3, Codex B #9 — implicit FK KEY SHARE locks and cascades included). Global order:
--   advisory 'invite-sender' -> advisory 'invite-recipient' (by key) -> profiles -> the switch's row
--   (private.features, FOR SHARE in send) -> occasion -> membership row -> follow rows -> invitation rows.
--   * send: the sender's advisory lock, the recipients' (key order), profiles FOR KEY SHARE (never waits for a
--     reservation: those take FOR NO KEY UPDATE; account deletion's FOR UPDATE does conflict), the occasion FOR SHARE
--     (a date change / cancellation / the guests switch / remove_member / a link join wait for us or we for them),
--     a guest's own membership row FOR SHARE (leave / removal / block wait), the follow rows of each pair FOR KEY
--     SHARE (unfollow / remove_follower / block delete them: they wait), then fresh checks and the inserts.
--   * decline: the recipient's advisory lock (serialises with sends: the 20-inbox limit, the decline <-> send race,
--     Codex B #4), profiles FOR KEY SHARE, the occasion FOR SHARE, the invitation row FOR UPDATE.
--   * accept: profiles (invitee, host, inviter) FOR NO KEY UPDATE in id order — like lock_profile_pair, so block_user /
--     unfollow / leave / accept_invite / account deletion of any of the three serialise with it — then the occasion
--     FOR UPDATE, the invitation row, the membership row. Residual timing risk of class S8 (design §5 item 7): the
--     invitee's own profile lock can wait a few milliseconds for a reservation on the invitee's OWN list.
--   * withdraw: profiles FOR KEY SHARE, the occasion FOR SHARE, the invitation row FOR UPDATE.
--   * the void triggers: blocks (AFTER INSERT) and profiles (invitations_from -> 'nobody') take the recipient
--     advisory lock(s) — the transactions that fire them hold no occasion, membership or follow row a send could be
--     waiting for. occasions / occasion_members / follows triggers take NO advisory lock (send waits for exactly
--     those rows, so it would deadlock): they are serialised with send by the row locks above.
--   * every read re-checks everything (private.invitation_visible), so even an unforeseen interleaving can only
--     leave a row that nobody sees and that expires.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.occasions add column guests_can_invite boolean not null default false;
comment on column public.occasions.guests_can_invite is
  '"Gäste dürfen Freunde einladen" (Р1): the host''s explicit permission, default off. Switching it off voids every pending invitation sent by a guest (trigger occasions_invitations); switching it on again restores nothing.';
-- column grants like the other occasion fields (policy occasions_update: the host only); guests may know it
grant select (guests_can_invite) on public.occasions to authenticated;
grant update (guests_can_invite) on public.occasions to authenticated;

alter table public.profiles add column invitations_from text not null default 'friends'
  check (invitations_from in ('friends', 'nobody'));
comment on column public.profiles.invitations_from is
  '"Einladungen in Anlässe" (Р8): friends (default) | nobody (only by link). nobody suppresses new invitations silently and voids the pending ones (trigger profiles_invitations_from). The person''s own REST write only; no SELECT grant (get_me serves it).';
grant update (invitations_from) on public.profiles to authenticated;   -- no SELECT grant (like in_suggestions)

-- the database switch (design §8 item 6): off = no candidate, no send, no inbox, no acceptance, no setting changes.
-- DEFAULT FALSE: shipped switched off (header); 20261027130000 switches it on together with the pilot-4 texts.
alter table private.features add column occasion_invitations boolean not null default false;
comment on column private.features.occasion_invitations is
  'In-app invitations. false (the default: shipped off) closes every invitation path. Switched on by 20261027130000_occasion_invitations_on.sql together with the pilot-4 legal texts (template supabase/emergency/occasion_invitations_on.sql); off again with supabase/emergency/occasion_invitations_off.sql. The VITE_INVITES flag only hides the interface.';

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
create table public.occasion_invitations (
  id           uuid primary key default gen_random_uuid(),
  occasion_id  uuid not null references public.occasions(id) on delete cascade,
  inviter_id   uuid not null references public.profiles(id) on delete cascade,
  invitee_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default clock_timestamp(),
  expires_at   timestamptz not null,               -- least(now() + 7 days, cutoff); only ever decreases
  delivered    boolean not null,                   -- false = silently suppressed (no reason is stored)
  outcome      text not null default 'pending'
               check (outcome in ('pending', 'accepted', 'declined', 'withdrawn', 'void')),
  decided_at   timestamptz,
  withdrawn_at timestamptz,                        -- the sender's own "Zurückziehen" (also on a declined / void row)
  live         boolean not null default true,      -- the triple (occasion, inviter, invitee) is busy until expires_at
  check (inviter_id <> invitee_id),
  check ((outcome = 'pending') = (decided_at is null)),
  check (outcome <> 'withdrawn' or withdrawn_at is not null)
);
-- the delivery slot: at most one pending delivered invitation per occasion and invitee (expired ones are closed
-- under the recipient's lock before every send and by the daily purge, so an expired row never holds the slot)
create unique index occasion_invitations_slot on public.occasion_invitations (occasion_id, invitee_id)
  where delivered and outcome = 'pending';
-- one live attempt per (occasion, sender, invitee) whatever its outcome: a withdrawn or declined row keeps the triple
-- busy until expires_at ("einladen — zurückziehen — einladen" is not a way to send dots)
create unique index occasion_invitations_attempt on public.occasion_invitations (occasion_id, inviter_id, invitee_id)
  where live;
create index occasion_invitations_inbox    on public.occasion_invitations (invitee_id) where delivered and outcome = 'pending';
create index occasion_invitations_sent     on public.occasion_invitations (inviter_id, occasion_id);
create index occasion_invitations_invitee  on public.occasion_invitations (invitee_id, occasion_id);   -- cascades, export
create index occasion_invitations_occasion on public.occasion_invitations (occasion_id);               -- cascades, triggers
comment on table public.occasion_invitations is
  'In-app invitations to an occasion (one row per attempt). RPC-only: no grants, RLS forced without a policy. Never linked to wishes, wishlists or reservations.';

create table public.invitation_attempts (
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index invitation_attempts_idx on public.invitation_attempts (sender_id, attempted_at);
comment on table public.invitation_attempts is
  'Quota ledger of invitation attempts (one row = one recipient in one call). Independent of occasion and recipient; purged after 7 days; deleted with the account. RPC-only.';

create table public.occasion_invite_refusals (
  occasion_id uuid not null references public.occasions(id) on delete cascade,
  invitee_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- the title the person saw when declining (their own export shows THIS, never a later rename: they are no member)
  occasion_title text not null,
  primary key (occasion_id, invitee_id)
);
create index occasion_invite_refusals_invitee_idx on public.occasion_invite_refusals (invitee_id);
comment on table public.occasion_invite_refusals is
  '"This occasion is closed for this person" after a decline (Р14): lives as long as the occasion. RPC-only.';

create table public.invitation_cooldowns (
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  until      timestamptz not null,                 -- only grows
  primary key (invitee_id, inviter_id),
  check (invitee_id <> inviter_id)
);
create index invitation_cooldowns_inviter_idx on public.invitation_cooldowns (inviter_id);
create index invitation_cooldowns_until_idx   on public.invitation_cooldowns (until);
comment on table public.invitation_cooldowns is
  '30 days of silence after a decline: new invitations from inviter_id to invitee_id are suppressed until `until`. The inviter never sees it. RPC-only.';

create table public.member_invited_by (
  occasion_id uuid not null,
  profile_id  uuid not null,
  inviter_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (occasion_id, profile_id),
  foreign key (occasion_id, profile_id) references public.occasion_members (occasion_id, profile_id) on delete cascade
);
create index member_invited_by_inviter_idx on public.member_invited_by (inviter_id);
comment on table public.member_invited_by is
  '"eingeladen von" for the host (Р3): set when a GUEST''s invitation is accepted; erased whenever the membership stops being active or becomes active again by any other way. Shown only to the host, only while the inviter is an active member without a block. RPC-only.';

-- RPC only: RLS enabled and forced, NOT ONE privilege and NOT ONE policy (deny by default)
revoke all on public.occasion_invitations, public.invitation_attempts, public.occasion_invite_refusals,
  public.invitation_cooldowns, public.member_invited_by from public, anon, authenticated;
alter table public.occasion_invitations     enable row level security;  alter table public.occasion_invitations     force row level security;
alter table public.invitation_attempts      enable row level security;  alter table public.invitation_attempts      force row level security;
alter table public.occasion_invite_refusals enable row level security;  alter table public.occasion_invite_refusals force row level security;
alter table public.invitation_cooldowns     enable row level security;  alter table public.invitation_cooldowns     force row level security;
alter table public.member_invited_by        enable row level security;  alter table public.member_invited_by        force row level security;

-- -----------------------------------------------------------------------------
-- 3. Helpers (definer; NEVER executable by an API role: they answer questions about ANY two people)
-- -----------------------------------------------------------------------------
create or replace function private.invitations_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.occasion_invitations from private.features f), false);
$$;

-- friends = accepted follows in both directions
create or replace function private.is_mutual_follow(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and private.is_accepted_follower(p_a, p_b) and private.is_accepted_follower(p_b, p_a);
$$;

-- the moment after which nobody can be invited any more: the start; an all-day occasion: the end of its local day
create or replace function private.invitation_cutoff(p_starts timestamptz, p_tz text, p_all_day boolean)
returns timestamptz language sql stable set search_path = '' as $$
  select case when p_all_day then (((p_starts at time zone p_tz)::date + 1)::timestamp at time zone p_tz) else p_starts end;
$$;

-- one advisory lock key per (space, person); a hash collision only serialises a little more
create or replace function private.invite_lock_key(p_space text, p_id uuid)
returns bigint language sql immutable set search_path = '' as $$
  select hashtextextended(p_space || ':' || p_id::text, 0);
$$;

-- may p_uid invite into the occasion right now? The host always; an active guest while the host allows it and there
-- is no block with the host. Never for a cancelled occasion or after its cutoff, never while the red button is off.
create or replace function private.may_invite(p_uid uuid, p_occasion uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid is not null and private.invitations_on() and exists (
    select 1 from public.occasions o
     where o.id = p_occasion and o.cancelled_at is null
       and private.invitation_cutoff(o.starts_at, o.tz, o.all_day) > now()
       and (o.host_id = p_uid
            or (o.guests_can_invite
                and exists (select 1 from public.occasion_members m
                             where m.occasion_id = o.id and m.profile_id = p_uid
                               and m.status = 'active' and m.role = 'member')
                and not private.is_blocked_pair(p_uid, o.host_id))));
$$;

-- a candidate of the sender: a friend (mutual follow, no block) who is not an active member of the occasion.
-- Deliberately NOT in it (design §2.2, Codex A #2): the host's relations with the person, the person's settings,
-- silences, inbox and other occasions — those decide delivery silently, so a guest cannot probe them.
create or replace function private.is_invite_candidate(p_sender uuid, p_person uuid, p_occasion uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_person is not null and p_sender is not null and p_person <> p_sender
     and private.is_mutual_follow(p_sender, p_person)
     and not private.is_blocked_pair(p_sender, p_person)
     and not exists (select 1 from public.occasion_members m
                      where m.occasion_id = p_occasion and m.profile_id = p_person and m.status = 'active');
$$;

-- THE visibility rule (design §3.1: one function for the counter, the list and the acceptance). An invitation the
-- invitee sees: delivered, pending, not expired, the inviter may still invite, still friends, no block with the
-- inviter or the host, the person still accepts invitations, the occasion is not closed for them, not a member yet,
-- and — when the host removed them — only a later invitation of the host.
create or replace function private.invitation_visible(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.invitations_on() and exists (
    select 1
      from public.occasion_invitations i
      join public.occasions o on o.id = i.occasion_id
      join public.profiles p on p.id = i.invitee_id
     where i.id = p_id and i.delivered and i.outcome = 'pending' and i.expires_at > now()
       and p.invitations_from = 'friends'
       and private.may_invite(i.inviter_id, i.occasion_id)
       and private.is_mutual_follow(i.inviter_id, i.invitee_id)
       and not private.is_blocked_pair(i.invitee_id, i.inviter_id)
       and not private.is_blocked_pair(i.invitee_id, o.host_id)
       and not exists (select 1 from public.occasion_invite_refusals r
                        where r.occasion_id = i.occasion_id and r.invitee_id = i.invitee_id)
       and not exists (select 1 from public.occasion_members m
                        where m.occasion_id = i.occasion_id and m.profile_id = i.invitee_id
                          and (m.status = 'active'
                               or (m.status = 'removed' and (i.inviter_id <> o.host_id or i.created_at <= m.updated_at)))));
$$;

-- THE sender's projection (design §2.5, Codex B #2): waiting, declined, ignored, suppressed and voided all read as
-- 'invited' with the unchanged expires_at. Only the sender's own withdrawal and an acceptance differ.
create or replace function private.invitation_sender_state(p_withdrawn_at timestamptz, p_outcome text, p_expires_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select case when p_outcome = 'accepted' then 'accepted'
              when p_expires_at <= now() then 'expired'
              when p_withdrawn_at is not null then 'withdrawn'
              else 'invited' end;
$$;

-- can a new invitation from p_sender reach p_invitee in this occasion? (design §2.4, the 8 silent reasons). Called
-- by send_occasion_invites under the recipient's advisory lock, after the expired rows were closed.
create or replace function private.invitation_deliverable(p_sender uuid, p_invitee uuid, p_occasion uuid, p_host uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.invitations_from = 'friends' from public.profiles p where p.id = p_invitee), false)  -- 3
     and not private.is_blocked_pair(p_invitee, p_host)                                                          -- 1
     and not (p_sender <> p_host and exists (select 1 from public.occasion_members m
                                              where m.occasion_id = p_occasion and m.profile_id = p_invitee
                                                and m.status = 'removed'))                                       -- 2
     and not exists (select 1 from public.occasion_invite_refusals r
                      where r.occasion_id = p_occasion and r.invitee_id = p_invitee)                              -- 4
     and not exists (select 1 from public.invitation_cooldowns c
                      where c.invitee_id = p_invitee and c.inviter_id = p_sender and c.until > now())             -- 5
     and not exists (select 1 from public.occasion_invitations i
                      where i.occasion_id = p_occasion and i.invitee_id = p_invitee
                        and i.delivered and i.outcome = 'pending')                                                -- 6
     and (select count(*) from public.occasion_invitations i
           where i.invitee_id = p_invitee and i.delivered and i.outcome = 'pending' and i.expires_at > now()
             and private.invitation_visible(i.id)) < 20                                                           -- 7
     and not private.has_follow_cooldown(p_invitee, p_sender);                                                   -- 8
$$;

-- the invitations the person sees, newest first (≤ 20)
create or replace function private.visible_invitation_ids(p_uid uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select i.id from public.occasion_invitations i
   where i.invitee_id = p_uid and i.delivered and i.outcome = 'pending' and i.expires_at > now()
     and private.invitation_visible(i.id)
   order by i.created_at desc, i.id
   limit 20;
$$;

-- -----------------------------------------------------------------------------
-- 4. Void triggers (design §2.4 table; terminal — nothing is ever resurrected)
-- -----------------------------------------------------------------------------

-- a membership changes (leave_occasion, remove_member, block_user, accept_invite, respond_occasion_invite):
--   becomes active  -> the person's pending invitations into the occasion are done; an old "eingeladen von" goes
--                      (respond_occasion_invite writes a new one AFTER the membership)
--   stops being active -> what the person sent into the occasion and what they received there is void
create or replace function private.invitations_on_membership()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare v_was_active boolean := false;
begin
  if tg_op = 'UPDATE' then
    if old.status = new.status then return null; end if;
    v_was_active := old.status = 'active';
  end if;
  if new.status = 'active' then
    update public.occasion_invitations i set outcome = 'void', decided_at = now()
     where i.occasion_id = new.occasion_id and i.invitee_id = new.profile_id and i.outcome = 'pending';
    delete from public.member_invited_by b where b.occasion_id = new.occasion_id and b.profile_id = new.profile_id;
  elsif v_was_active then
    update public.occasion_invitations i set outcome = 'void', decided_at = now()
     where i.occasion_id = new.occasion_id and i.outcome = 'pending'
       and (i.inviter_id = new.profile_id or i.invitee_id = new.profile_id);
    delete from public.member_invited_by b where b.occasion_id = new.occasion_id and b.profile_id = new.profile_id;
  end if;
  return null;
end $$;
create trigger occasion_members_invitations after insert or update of status on public.occasion_members
  for each row execute function private.invitations_on_membership();

-- the occasion changes (REST, the host): cancelled -> all void; date / time / zone -> expires_at only shrinks (void when
-- the new cutoff has passed); guests_can_invite off -> every guest's pending invitation is void
create or replace function private.invitations_on_occasion_change()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare v_cut timestamptz;
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.occasion_invitations i set outcome = 'void', decided_at = now()
     where i.occasion_id = new.id and i.outcome = 'pending';
  end if;
  if new.starts_at is distinct from old.starts_at or new.tz is distinct from old.tz or new.all_day is distinct from old.all_day then
    v_cut := private.invitation_cutoff(new.starts_at, new.tz, new.all_day);
    update public.occasion_invitations i
       set expires_at = v_cut,
           live       = i.live and v_cut > now(),
           outcome    = case when i.outcome = 'pending' and v_cut <= now() then 'void' else i.outcome end,
           decided_at = case when i.outcome = 'pending' and v_cut <= now() then now() else i.decided_at end
     where i.occasion_id = new.id and i.expires_at > v_cut;
  end if;
  if old.guests_can_invite and not new.guests_can_invite then
    update public.occasion_invitations i set outcome = 'void', decided_at = now()
     where i.occasion_id = new.id and i.outcome = 'pending' and i.inviter_id <> new.host_id;
  end if;
  return null;
end $$;
create trigger occasions_invitations after update on public.occasions
  for each row execute function private.invitations_on_occasion_change();

-- an accepted follow ends (unfollow, remove_follower, block_user, an account's cascade): the two are no longer friends.
-- No advisory lock here (see LOCKS): send holds the follow rows FOR KEY SHARE, so the delete waits for it.
create or replace function private.invitations_on_unfollow()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if old.status = 'accepted' then
    update public.occasion_invitations i set outcome = 'void', decided_at = now()
     where i.outcome = 'pending'
       and ((i.inviter_id = old.follower_id and i.invitee_id = old.followee_id)
            or (i.inviter_id = old.followee_id and i.invitee_id = old.follower_id));
  end if;
  return null;
end $$;
create trigger follows_invitations after delete on public.follows
  for each row execute function private.invitations_on_unfollow();

-- a block (block_user inserts it right after the profile-pair lock, before any membership or follow row):
-- every pending invitation where the pair meets as (invitee, inviter) or (invitee, host)
create or replace function private.invitations_on_block()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare v_key bigint;
begin
  for v_key in select k from (values (private.invite_lock_key('invite-recipient', new.blocker_id)),
                                     (private.invite_lock_key('invite-recipient', new.blocked_id))) x(k)
               group by k order by k loop
    perform pg_advisory_xact_lock(v_key);
  end loop;
  update public.occasion_invitations i set outcome = 'void', decided_at = now()
   where i.outcome = 'pending'
     and ((i.invitee_id = new.blocker_id and i.inviter_id = new.blocked_id)
          or (i.invitee_id = new.blocked_id and i.inviter_id = new.blocker_id)
          or exists (select 1 from public.occasions o
                      where o.id = i.occasion_id
                        and ((i.invitee_id = new.blocker_id and o.host_id = new.blocked_id)
                             or (i.invitee_id = new.blocked_id and o.host_id = new.blocker_id))));
  return null;
end $$;
create trigger blocks_invitations after insert on public.blocks
  for each row execute function private.invitations_on_block();

-- "Einladungen in Anlässe: Niemand": every pending invitation to the person is void
create or replace function private.invitations_on_nobody()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if new.invitations_from = 'nobody' and old.invitations_from is distinct from 'nobody' then
    perform pg_advisory_xact_lock(private.invite_lock_key('invite-recipient', new.id));
    update public.occasion_invitations i set outcome = 'void', decided_at = now()
     where i.invitee_id = new.id and i.outcome = 'pending';
  end if;
  return null;
end $$;
create trigger profiles_invitations_from after update of invitations_from on public.profiles
  for each row execute function private.invitations_on_nobody();

-- While the database switch is off (the default: shipped off, see the header) the feature's two settings cannot be
-- set through REST either — nothing about invitations is processed before the release. One answer: not_allowed.
create or replace function private.invitation_settings_guard()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.invitations_on() then
    raise exception using message = 'not_allowed';
  end if;
  return new;
end $$;
create trigger occasions_invitation_settings_guard before update of guests_can_invite on public.occasions
  for each row when (old.guests_can_invite is distinct from new.guests_can_invite)
  execute function private.invitation_settings_guard();
create trigger occasions_invitation_settings_insert_guard before insert on public.occasions
  for each row when (new.guests_can_invite)
  execute function private.invitation_settings_guard();
create trigger profiles_invitation_settings_guard before update of invitations_from on public.profiles
  for each row when (old.invitations_from is distinct from new.invitations_from)
  execute function private.invitation_settings_guard();

-- -----------------------------------------------------------------------------
-- 5. RPCs: the sender
-- -----------------------------------------------------------------------------

-- get_invite_candidates(p_occasion_id): my friends minus the active members, by name, id. state through the ONE
-- sender projection of my live row (expired -> none). Reading needs no consents. Not allowed to invite: not_found.
create or replace function public.get_invite_candidates(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_occasion_id is null or not private.may_invite(v_uid, p_occasion_id) then
    raise exception using message = 'not_found';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'profile', private.profile_card(c.id),
             'state', case when i.id is null then 'none'
                           else (case private.invitation_sender_state(i.withdrawn_at, i.outcome, i.expires_at)
                                   when 'invited' then 'invited' when 'withdrawn' then 'withdrawn' else 'none' end) end,
             'expires_at', case when i.id is not null and i.expires_at > now() and i.outcome <> 'accepted'
                                then i.expires_at end)
             order by c.display_name, c.id), '[]'::jsonb)
      from (select p.id, p.display_name
              from public.follows f
              join public.profiles p on p.id = f.followee_id
             where f.follower_id = v_uid and f.status = 'accepted'
               and private.is_invite_candidate(v_uid, f.followee_id, p_occasion_id)) c
      left join public.occasion_invitations i
        on i.occasion_id = p_occasion_id and i.inviter_id = v_uid and i.invitee_id = c.id and i.live);
end $$;

-- send_occasion_invites(p_occasion_id, p_profile_ids): 1..10 ids. Every id must be a candidate, else the whole call
-- is not_found (unknown, foreign, blocked, a member: one answer). For each id the same answer whether it was
-- delivered or silently suppressed; a repeat while my row is live is idempotent (no new attempt, same answer).
-- Quotas (only the caller's own numbers, design §2.6): 5 / minute, 10 / 24 h, 30 / 7 days attempts, 30 open rows.
create or replace function public.send_occasion_invites(p_occasion_id uuid, p_profile_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_ids  uuid[];
  v_new  uuid[];
  v_occ  record;
  v_exp  timestamptz;
  v_key  bigint;
  v_id   uuid;
  v_ok   boolean;
  v_n    integer;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  if p_profile_ids is null or cardinality(p_profile_ids) not between 1 and 10
     or array_position(p_profile_ids, null) is not null then
    raise exception using message = 'validation';
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_profile_ids) x;
  if p_occasion_id is null or not private.may_invite(v_uid, p_occasion_id) then   -- early answer; again under the locks
    raise exception using message = 'not_found';
  end if;
  -- early too (only the sender's own relations): nobody's lock is taken for an id that is not my friend
  if exists (select 1 from unnest(v_ids) x where not private.is_invite_candidate(v_uid, x, p_occasion_id)) then
    raise exception using message = 'not_found';
  end if;

  -- locks, in the global order (header)
  perform pg_advisory_xact_lock(private.invite_lock_key('invite-sender', v_uid));
  for v_key in select k from (select private.invite_lock_key('invite-recipient', x) k from unnest(v_ids) x) s
               group by k order by k loop
    perform pg_advisory_xact_lock(v_key);
  end loop;
  perform p.id from public.profiles p where p.id = any(v_ids || v_uid) order by p.id for key share;
  perform private.require_user();                         -- the caller's account may have gone while we waited
  -- the switch's row FOR SHARE: the emergency switch (UPDATE private.features) waits for every running send and
  -- then voids what it inserted, or the send waits for the switch and sees it off — never a delivered invitation
  -- that slipped past the switch and would come back when it is switched on again (Codex review 27.10 #3). AFTER the
  -- profile rows: supabase/emergency/follower_lists_off.sql locks profiles and follows EXCLUSIVE before it updates
  -- the same row, so a send must not hold this row while it waits for those tables.
  perform f.singleton from private.features f for share;
  if not private.invitations_on() then raise exception using message = 'not_found'; end if;
  select o.id, o.host_id, o.starts_at, o.tz, o.all_day into v_occ
    from public.occasions o where o.id = p_occasion_id for share;
  if not found then raise exception using message = 'not_found'; end if;
  if v_occ.host_id <> v_uid then
    perform m.profile_id from public.occasion_members m
     where m.occasion_id = p_occasion_id and m.profile_id = v_uid and m.status = 'active' for share;
  end if;
  if not private.may_invite(v_uid, p_occasion_id) then raise exception using message = 'not_found'; end if;
  perform f.follower_id from public.follows f
   where (f.follower_id = v_uid and f.followee_id = any(v_ids)) or (f.followee_id = v_uid and f.follower_id = any(v_ids))
   order by f.follower_id, f.followee_id for key share;

  if exists (select 1 from unnest(v_ids) x where not private.is_invite_candidate(v_uid, x, p_occasion_id)) then
    raise exception using message = 'not_found';
  end if;

  -- close what has expired: in THIS occasion, for the requested people only (my triples and their delivery slots —
  -- every such row is covered by the recipients' advisory locks). Never my rows in other occasions: block_user's
  -- trigger may hold one of those while it waits for my membership row FOR SHARE (a deadlock, Codex review 27.10
  -- #2); expired rows elsewhere count nowhere and the daily purge closes them.
  update public.occasion_invitations i
     set live       = false,
         outcome    = case when i.outcome = 'pending' then 'void' else i.outcome end,
         decided_at = case when i.outcome = 'pending' then now() else i.decided_at end
   where i.occasion_id = p_occasion_id and i.invitee_id = any(v_ids)
     and i.expires_at <= now() and (i.live or i.outcome = 'pending');

  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_new from unnest(v_ids) x
   where not exists (select 1 from public.occasion_invitations i
                      where i.occasion_id = p_occasion_id and i.inviter_id = v_uid and i.invitee_id = x and i.live);
  v_n := cardinality(v_new);
  if v_n > 0 and (
       (select count(*) from public.invitation_attempts a
         where a.sender_id = v_uid and a.attempted_at > now() - interval '1 minute') + v_n > 5
    or (select count(*) from public.invitation_attempts a
         where a.sender_id = v_uid and a.attempted_at > now() - interval '24 hours') + v_n > 10
    or (select count(*) from public.invitation_attempts a
         where a.sender_id = v_uid and a.attempted_at > now() - interval '7 days') + v_n > 30
    or (select count(*) from public.occasion_invitations i
         where i.inviter_id = v_uid and i.live and i.expires_at > now()
           and i.outcome <> 'accepted' and i.withdrawn_at is null) + v_n > 30) then
    raise exception using message = 'limit_reached';
  end if;

  v_exp := least(now() + interval '7 days', private.invitation_cutoff(v_occ.starts_at, v_occ.tz, v_occ.all_day));
  foreach v_id in array v_new loop
    insert into public.invitation_attempts (sender_id) values (v_uid);
    v_ok := private.invitation_deliverable(v_uid, v_id, p_occasion_id, v_occ.host_id);
    begin
      insert into public.occasion_invitations (occasion_id, inviter_id, invitee_id, expires_at, delivered)
      values (p_occasion_id, v_uid, v_id, v_exp, v_ok);
    exception when unique_violation then
      -- the delivery slot is taken after all: a silent suppression, never an error
      insert into public.occasion_invitations (occasion_id, inviter_id, invitee_id, expires_at, delivered)
      values (p_occasion_id, v_uid, v_id, v_exp, false);
    end;
  end loop;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'profile_id', x,
             'state', private.invitation_sender_state(i.withdrawn_at, i.outcome, i.expires_at),
             'expires_at', i.expires_at) order by x), '[]'::jsonb)
      from unnest(v_ids) x
      join public.occasion_invitations i
        on i.occasion_id = p_occasion_id and i.inviter_id = v_uid and i.invitee_id = x and i.live);
end $$;

-- withdraw_occasion_invite(p_occasion_id, p_profile_id): my live, not accepted, not expired row — the same
-- { ok: true } for a waiting, declined, suppressed or voided one (and again for an already withdrawn one). The triple
-- stays busy until expires_at. No consents (it narrows). Anything else: not_found.
create or replace function public.withdraw_occasion_invite(p_occasion_id uuid, p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
begin
  if p_occasion_id is null or p_profile_id is null then raise exception using message = 'not_found'; end if;
  perform p.id from public.profiles p where p.id in (v_uid, p_profile_id) order by p.id for key share;
  perform private.require_user();
  perform o.id from public.occasions o where o.id = p_occasion_id for share;
  if not found then raise exception using message = 'not_found'; end if;
  select i.id into v_id from public.occasion_invitations i
   where i.occasion_id = p_occasion_id and i.inviter_id = v_uid and i.invitee_id = p_profile_id and i.live
     and i.expires_at > now() and i.outcome <> 'accepted'
   for update;
  if v_id is null or not private.may_invite(v_uid, p_occasion_id)
     or not private.is_mutual_follow(v_uid, p_profile_id) or private.is_blocked_pair(v_uid, p_profile_id) then
    raise exception using message = 'not_found';
  end if;
  update public.occasion_invitations i
     set withdrawn_at = coalesce(i.withdrawn_at, now()),
         outcome      = case when i.outcome = 'pending' then 'withdrawn' else i.outcome end,
         decided_at   = case when i.outcome = 'pending' then now() else i.decided_at end
   where i.id = v_id;
  return jsonb_build_object('ok', true);
end $$;

-- get_sent_invitations(p_occasion_id): my rows of this occasion through the sender projection — the newest row per
-- person, only while we are friends without a block (a former friend's name never shows, Codex B #8); live ones and
-- accepted ones. Order: created_at, id.
create or replace function public.get_sent_invitations(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_occasion_id is null or not private.may_invite(v_uid, p_occasion_id) then
    raise exception using message = 'not_found';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'profile_id', s.invitee_id, 'display_name', p.display_name,
             'state', private.invitation_sender_state(s.withdrawn_at, s.outcome, s.expires_at),
             'expires_at', s.expires_at) order by s.created_at, s.id), '[]'::jsonb)
      from (select distinct on (i.invitee_id) i.id, i.invitee_id, i.withdrawn_at, i.outcome, i.expires_at, i.created_at
              from public.occasion_invitations i
             where i.occasion_id = p_occasion_id and i.inviter_id = v_uid
               and (i.outcome = 'accepted' or (i.live and i.expires_at > now()))
             order by i.invitee_id, i.created_at desc, i.id desc) s
      join public.profiles p on p.id = s.invitee_id
     where private.is_mutual_follow(v_uid, s.invitee_id) and not private.is_blocked_pair(v_uid, s.invitee_id));
end $$;

-- -----------------------------------------------------------------------------
-- 6. RPCs: the invitee
-- -----------------------------------------------------------------------------

-- get_my_invitations(): the invitations I see (private.invitation_visible), newest first, at most 20. The host only
-- by NAME (no id, no photo — Р13, Codex B #7); the inviter is my friend: their card. Nothing about the place,
-- the description, the guests, the list or the cover.
create or replace function public.get_my_invitations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id,
             'occasion', jsonb_build_object('id', o.id, 'title', o.title, 'starts_at', o.starts_at, 'tz', o.tz,
                                            'all_day', o.all_day),
             'host_name', h.display_name,
             -- the inviter IS the host (the sheet's privacy text: "… sieht, dass Anna dich eingeladen hat" only if not)
             'from_host', i.inviter_id = o.host_id,
             'inviter', private.profile_card(i.inviter_id),
             'expires_at', i.expires_at,
             'created_at', i.created_at)
             order by i.created_at desc, i.id), '[]'::jsonb)
      from private.visible_invitation_ids(v_uid) v(id)
      join public.occasion_invitations i on i.id = v.id
      join public.occasions o on o.id = i.occasion_id
      join public.profiles h on h.id = o.host_id);
end $$;

-- respond_occasion_invite(p_invitation_id, p_accept):
--   accept  -> consents and a name first (they do not depend on the invitation), then under the locks (header)
--              every rule again; a membership like accept_invite (member, rsvp none; 'left' / 'removed' come back);
--              "eingeladen von" only for a guest's invitation. -> { occasion_id }
--   decline -> no consents (narrowing); the invitation is done, this occasion is closed for me (refusal) and its
--              sender is silent towards me for 30 days. -> { ok: true }
-- Any invitation that is not mine, not visible, already answered or gone: invite_invalid (one answer).
create or replace function public.respond_occasion_invite(p_invitation_id uuid, p_accept boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_inv     record;
  v_host    uuid;
begin
  if p_accept is null then raise exception using message = 'validation'; end if;
  if p_accept then
    if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
    if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  end if;
  if p_invitation_id is null then raise exception using message = 'invite_invalid'; end if;
  select i.occasion_id, i.inviter_id, o.host_id into v_inv
    from public.occasion_invitations i join public.occasions o on o.id = i.occasion_id
   where i.id = p_invitation_id and i.invitee_id = v_uid;
  if not found then raise exception using message = 'invite_invalid'; end if;

  if p_accept then
    perform p.id from public.profiles p where p.id in (v_uid, v_inv.host_id, v_inv.inviter_id) order by p.id for no key update;
    perform private.require_user();
    select o.host_id into v_host from public.occasions o
     where o.id = v_inv.occasion_id and o.host_id = v_inv.host_id for update;
    if not found then raise exception using message = 'invite_invalid'; end if;
    perform i.id from public.occasion_invitations i where i.id = p_invitation_id and i.invitee_id = v_uid for update;
    if not found then raise exception using message = 'invite_invalid'; end if;
    perform m.profile_id from public.occasion_members m
     where m.occasion_id = v_inv.occasion_id and m.profile_id = v_uid for update;
    if not private.invitation_visible(p_invitation_id) then raise exception using message = 'invite_invalid'; end if;

    update public.occasion_invitations set outcome = 'accepted', decided_at = now(), live = false
     where id = p_invitation_id;
    -- (the membership trigger voids every other pending invitation into this occasion and erases an old
    --  "eingeladen von"; the new one is written after it)
    insert into public.occasion_members as m (occasion_id, profile_id, role, rsvp, status, invited_via)
    values (v_inv.occasion_id, v_uid, 'member', 'none', 'active', null)
    on conflict (occasion_id, profile_id) do update
      set status = 'active', invited_via = null, rsvp = 'none', joined_at = now()
      where m.status in ('left', 'removed');
    if v_inv.inviter_id <> v_inv.host_id then
      insert into public.member_invited_by (occasion_id, profile_id, inviter_id)
      values (v_inv.occasion_id, v_uid, v_inv.inviter_id);
    end if;
    return jsonb_build_object('occasion_id', v_inv.occasion_id);
  end if;

  -- decline
  perform pg_advisory_xact_lock(private.invite_lock_key('invite-recipient', v_uid));
  perform p.id from public.profiles p where p.id in (v_uid, v_inv.inviter_id) order by p.id for key share;
  perform private.require_user();
  perform o.id from public.occasions o where o.id = v_inv.occasion_id for share;
  if not found then raise exception using message = 'invite_invalid'; end if;
  perform i.id from public.occasion_invitations i where i.id = p_invitation_id and i.invitee_id = v_uid for update;
  if not found or not private.invitation_visible(p_invitation_id) then
    raise exception using message = 'invite_invalid';
  end if;
  update public.occasion_invitations set outcome = 'declined', decided_at = now() where id = p_invitation_id;
  insert into public.occasion_invite_refusals (occasion_id, invitee_id, occasion_title)
  select v_inv.occasion_id, v_uid, o.title from public.occasions o where o.id = v_inv.occasion_id
  on conflict do nothing;
  insert into public.invitation_cooldowns as c (invitee_id, inviter_id, until)
  values (v_uid, v_inv.inviter_id, now() + interval '30 days')
  on conflict (invitee_id, inviter_id) do update set until = greatest(c.until, excluded.until);
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 7. RPC: the occasion screen's invitation part (instead of new keys in get_occasion_screen — see COORDINATION)
--    Same gate as the occasion screen: an active member without a block with the host, else not_found.
--    guests_can_invite: everybody in the occasion may know it. can_invite: private.may_invite for the caller.
--    invited_by: ONLY for the host — [{ profile_id, inviter{id, display_name} }] for guests who joined through a
--    guest's invitation, only while that inviter is an active member and nobody of the three is blocked (Р3, Codex B #8).
-- -----------------------------------------------------------------------------
create or replace function public.get_occasion_invite_info(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_host uuid;
  v_gci  boolean;
begin
  select o.host_id, o.guests_can_invite into v_host, v_gci from public.occasions o where o.id = p_occasion_id;
  if not found or not private.is_active_member(p_occasion_id, v_uid) or private.is_blocked_pair(v_uid, v_host) then
    raise exception using message = 'not_found';
  end if;
  return jsonb_build_object(
    'guests_can_invite', v_gci,
    'can_invite', private.may_invite(v_uid, p_occasion_id),
    'invited_by', case when v_uid = v_host and private.invitations_on() then (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'profile_id', b.profile_id,
                 'inviter', jsonb_build_object('id', b.inviter_id, 'display_name', ip.display_name))
                 order by b.profile_id), '[]'::jsonb)
          from public.member_invited_by b
          join public.occasion_members gm on gm.occasion_id = b.occasion_id and gm.profile_id = b.profile_id
                                         and gm.status = 'active'
          join public.occasion_members im on im.occasion_id = b.occasion_id and im.profile_id = b.inviter_id
                                         and im.status = 'active'
          join public.profiles ip on ip.id = b.inviter_id
         where b.occasion_id = p_occasion_id
           and not private.is_blocked_pair(b.inviter_id, v_host)
           and not private.is_blocked_pair(b.profile_id, v_host))
           -- deliberately NO check between the two guests: the label must not vanish when one of them blocks the
           -- other, or the host would learn of a block between two people who both stay (Codex review 27.10 #1)
      else '[]'::jsonb end);
end $$;

-- -----------------------------------------------------------------------------
-- 8. Own data (Art. 15 / 20): export_my_invitations() — added to the download by the client (export_my_data is not
--    changed, see COORDINATION). Never: another person's decline, silence or suppression reason; never a hidden
--    occasion's place or list. [PRÜFEN] Art. 15 Abs. 4 DSGVO for the sender's limited view (design §4.5).
--      received[]        my delivered invitations: created_at, expires_at, my decision (open | accepted | declined |
--                        closed); the occasion's title and the host's name only while I may see them (open, or I am
--                        a member; a declined one: the title as I saw it), the inviter's name only while I know them
--                        (private.knows_profile) — never a rename I could not see otherwise (Codex review 27.10)
--      (NOT the invitations that were silently kept from me: the privacy notice (pilot-4, §8,
--       apps/web/src/legal/privacy_notice.privacy-2026-10-pilot-4.*) promises received invitations
--       with my answers; a list of suppressed attempts could hint that an unknown host blocked or removed me. A full
--       Art. 15 request by e-mail covers them.)
--      sent[]          mine through the sender projection: profile_id, name only while we are friends, occasion
--                        title only while I am still in it, state (invited | withdrawn | accepted | expired)
--      refusals[]        occasions closed for me after my decline: the title as I saw it then, created_at
--      silences[]        my 30-day silences: inviter name, until
--      attempts[]        my quota ledger (timestamps)
--      settings          { invitations_from }
--      hosted[]          my occasions' "Gäste dürfen Freunde einladen" (title, guests_can_invite)
--      invited_by[]      "eingeladen von" about me (occasion title, inviter name while I know them)
--      joined_through_me[] who joined through my invitation (title while I am in it, name while I know them)
-- -----------------------------------------------------------------------------
create or replace function public.export_my_invitations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'format', 'bunprise-invitations-v1',
    'settings', (select jsonb_build_object('invitations_from', p.invitations_from) from public.profiles p where p.id = v_uid),
    'received', (
      select coalesce(jsonb_agg(jsonb_build_object(
               -- the live title / host name only while I may see them (the invitation is open, or I am in the
               -- occasion); a declined one: the title I saw (refusal snapshot); never a later rename otherwise
               'occasion_title', case when (i.outcome = 'pending' and private.invitation_visible(i.id))
                                        or (i.outcome = 'accepted' and private.is_active_member(o.id, v_uid)) then o.title
                                      when i.outcome = 'declined' then r.occasion_title end,
               'host_name', case when (i.outcome = 'pending' and private.invitation_visible(i.id))
                                   or (i.outcome = 'accepted' and private.is_active_member(o.id, v_uid)) then h.display_name end,
               'inviter_name', case when private.knows_profile(v_uid, i.inviter_id) then ip.display_name end,
               'created_at', i.created_at, 'expires_at', i.expires_at,
               'decision', case when i.outcome = 'accepted' then 'accepted'
                                when i.outcome = 'declined' then 'declined'
                                when i.outcome = 'pending' and private.invitation_visible(i.id) then 'open'
                                else 'closed' end)
               order by i.created_at, i.id), '[]'::jsonb)
        from public.occasion_invitations i
        join public.occasions o on o.id = i.occasion_id
        join public.profiles h on h.id = o.host_id
        join public.profiles ip on ip.id = i.inviter_id
        left join public.occasion_invite_refusals r on r.occasion_id = i.occasion_id and r.invitee_id = i.invitee_id
       where i.invitee_id = v_uid and i.delivered),
    'sent', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'profile_id', i.invitee_id,
               'display_name', case when private.is_mutual_follow(v_uid, i.invitee_id)
                                         and not private.is_blocked_pair(v_uid, i.invitee_id) then p.display_name end,
               'occasion_title', case when private.is_active_member(o.id, v_uid) then o.title end,
               'state', private.invitation_sender_state(i.withdrawn_at, i.outcome, i.expires_at),
               'created_at', i.created_at, 'expires_at', i.expires_at)
               order by i.created_at, i.id), '[]'::jsonb)
        from public.occasion_invitations i
        join public.occasions o on o.id = i.occasion_id
        join public.profiles p on p.id = i.invitee_id
       where i.inviter_id = v_uid),
    'refusals', (
      select coalesce(jsonb_agg(jsonb_build_object('occasion_title', r.occasion_title, 'created_at', r.created_at)
               order by r.created_at, r.occasion_id), '[]'::jsonb)
        from public.occasion_invite_refusals r
       where r.invitee_id = v_uid),
    'silences', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'inviter_name', case when private.knows_profile(v_uid, c.inviter_id) then p.display_name end,
               'until', c.until) order by c.until, c.inviter_id), '[]'::jsonb)
        from public.invitation_cooldowns c join public.profiles p on p.id = c.inviter_id
       where c.invitee_id = v_uid),
    'attempts', (
      select coalesce(jsonb_agg(a.attempted_at order by a.attempted_at), '[]'::jsonb)
        from public.invitation_attempts a where a.sender_id = v_uid),
    -- (Codex review 27.10 #4) the settings of the occasions I host, and the "eingeladen von" records about me — as
    -- the one invited and as the one who invited — names only of people I may see (private.knows_profile)
    'hosted', (
      select coalesce(jsonb_agg(jsonb_build_object('occasion_title', o.title, 'guests_can_invite', o.guests_can_invite)
               order by o.starts_at, o.id), '[]'::jsonb)
        from public.occasions o where o.host_id = v_uid),
    'invited_by', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'occasion_title', o.title,
               'inviter_name', case when private.knows_profile(v_uid, b.inviter_id) then p.display_name end)
               order by o.starts_at, o.id), '[]'::jsonb)
        from public.member_invited_by b
        join public.occasions o on o.id = b.occasion_id
        join public.profiles p on p.id = b.inviter_id
       where b.profile_id = v_uid),
    'joined_through_me', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'occasion_title', case when private.is_active_member(o.id, v_uid) then o.title end,
               'display_name', case when private.knows_profile(v_uid, b.profile_id) then p.display_name end)
               order by o.starts_at, o.id, b.profile_id), '[]'::jsonb)
        from public.member_invited_by b
        join public.occasions o on o.id = b.occasion_id
        join public.profiles p on p.id = b.profile_id
       where b.inviter_id = v_uid));
end $$;

-- -----------------------------------------------------------------------------
-- 9. get_me(): the 20261024120000 body + profile.invitations_from (the own switch; no SELECT grant) and
--    inbox.occasion_invites = the number of invitations I see (the dot on Start; the same rule as the list).
-- -----------------------------------------------------------------------------
create or replace function public.get_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                                          'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner,
                                          'in_suggestions', p.in_suggestions,
                                          'photo', private.profile_photo_meta(p.id, 'avatar'),
                                          'banner_photo', private.profile_photo_meta(p.id, 'banner'),
                                          'invitations_from', p.invitations_from)
                from public.profiles p where p.id = v_uid),
    'consents_ok', private.has_consents(v_uid),
    'legal_versions', jsonb_build_object(
      'terms',   (select lv.version from public.legal_versions lv where lv.kind = 'terms'),
      'privacy', (select lv.version from public.legal_versions lv where lv.kind = 'privacy_notice'),
      'age',     (select lv.version from public.legal_versions lv where lv.kind = 'age_18plus')),
    'inbox', jsonb_build_object(
      'follow_requests', (select count(*) from public.follows f
                           where f.followee_id = v_uid and private.visible_request(f.follower_id, v_uid)),
      'occasion_invites', (select count(*) from private.visible_invitation_ids(v_uid))));
end $$;

-- -----------------------------------------------------------------------------
-- 10. Retention (design §4.4): its own daily job (purge_expired_records belongs to other work today). Rows already
--     locked by a running RPC are skipped (SKIP LOCKED): the job never waits, so it can never be part of a deadlock;
--     what it skips today it closes tomorrow (and every send closes the rows it needs itself).
-- -----------------------------------------------------------------------------
create or replace function private.purge_invitations()
returns void language sql volatile security definer set search_path = '' as $$
  update public.occasion_invitations i
     set live       = false,
         outcome    = case when i.outcome = 'pending' then 'void' else i.outcome end,
         decided_at = case when i.outcome = 'pending' then now() else i.decided_at end
   where i.id in (select x.id from public.occasion_invitations x
                   where x.expires_at <= now() and (x.live or x.outcome = 'pending')
                   for update skip locked);
  delete from public.occasion_invitations i
   where i.id in (select x.id from public.occasion_invitations x
                   where x.created_at < now() - interval '30 days' for update skip locked);
  delete from public.invitation_attempts a where a.attempted_at < now() - interval '7 days';
  delete from public.invitation_cooldowns c where c.until < now();
$$;

do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable - invitation retention scheduling skipped (expected on PGlite)';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $cmd$select cron.unschedule(jobid) from cron.job where jobname = 'bunprise_purge_invitations'$cmd$;
  execute $cmd$select cron.schedule('bunprise_purge_invitations', '47 3 * * *', 'select private.purge_invitations()')$cmd$;
end
$cron$;

-- -----------------------------------------------------------------------------
-- 11. Privileges: the new RPCs for authenticated only; every new helper and trigger function for nobody but the
--     definer code (CREATE OR REPLACE keeps get_me's grants).
-- -----------------------------------------------------------------------------
revoke execute on function
  public.get_invite_candidates(uuid), public.send_occasion_invites(uuid, uuid[]),
  public.withdraw_occasion_invite(uuid, uuid), public.get_sent_invitations(uuid), public.get_my_invitations(),
  public.respond_occasion_invite(uuid, boolean), public.get_occasion_invite_info(uuid), public.export_my_invitations()
  from public, anon;
grant execute on function
  public.get_invite_candidates(uuid), public.send_occasion_invites(uuid, uuid[]),
  public.withdraw_occasion_invite(uuid, uuid), public.get_sent_invitations(uuid), public.get_my_invitations(),
  public.respond_occasion_invite(uuid, boolean), public.get_occasion_invite_info(uuid), public.export_my_invitations()
  to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  private.invitations_on(), private.is_mutual_follow(uuid, uuid), private.invitation_cutoff(timestamptz, text, boolean),
  private.invite_lock_key(text, uuid), private.may_invite(uuid, uuid), private.is_invite_candidate(uuid, uuid, uuid),
  private.invitation_visible(uuid), private.invitation_sender_state(timestamptz, text, timestamptz),
  private.invitation_deliverable(uuid, uuid, uuid, uuid), private.visible_invitation_ids(uuid),
  private.invitations_on_membership(), private.invitations_on_occasion_change(), private.invitations_on_unfollow(),
  private.invitations_on_block(), private.invitations_on_nobody(), private.purge_invitations(),
  private.invitation_settings_guard()
  from authenticated;
