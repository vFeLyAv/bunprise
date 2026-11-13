-- Supabase look-alike shims for PGlite.
-- Applied by src/harness.ts BEFORE the real migrations from supabase/migrations/.
-- Goal: migrations written for Supabase (auth.uid(), auth.users, roles anon /
-- authenticated / service_role, pgcrypto) run unchanged on a plain Postgres.
-- Everything here is idempotent, so it can be applied to a reused database.

-- Schemas that exist on every Supabase project.
create schema if not exists auth;
create schema if not exists extensions;

-- Extensions. The WASM bundles are registered in the PGlite constructor
-- (see src/harness.ts); this only enables them in the database.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- Minimal auth.users. Real GoTrue has ~35 columns; migrations should only ever
-- reference id / metadata, plus timestamps for the retention jobs.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
-- the invitation e-mail (20261028000000) sends only to a confirmed address. GoTrue sets it on the first successful
-- code / Google sign-in; in the tests every user is confirmed unless a test clears it.
alter table auth.users add column if not exists email_confirmed_at timestamptz default now();

-- JWT claim accessors, mirroring supabase/postgres. PostgREST exposes the
-- claims as request.jwt.claim.* / request.jwt.claims; the harness sets them
-- with set_config(..., true) inside a transaction.
-- NOTE: after a transaction has set a custom GUC locally, current_setting(x, true)
-- returns '' (empty string), not NULL -> every accessor must nullif('') first.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.role', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    ),
    ''
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- API roles. NOLOGIN NOINHERIT like on Supabase; service_role bypasses RLS.
-- CREATE ROLE has no IF NOT EXISTS, hence the DO block.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Grants, simplified from Supabase's bootstrap. Default privileges apply to
-- objects the current role (the superuser running the migrations) creates
-- later, i.e. to everything the migrations create in public.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Web Push (supabase/migrations/20261027150000_web_push.sql, docs/spec/web-push-design.md §4–§5). Stand-ins for what a
-- hosted Supabase project has and PGlite does not; only the columns / signatures the migration uses:
--   auth.sessions                one row per signed-in session (GoTrue); sign-out deletes it
--   net.http_post / _http_response   pg_net: queue an HTTP request, read its answer later. The stub only RECORDS the
--                                    request in net.shim_requests (no network); tests write answers themselves.
--   vault.decrypted_secrets      Supabase Vault (name + decrypted_secret); tests fill vault.shim_secrets.
create table if not exists auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz default now(),
  not_after  timestamptz
);

create schema if not exists net;
create table if not exists net.shim_requests (
  id                   bigserial primary key,
  url                  text not null,
  body                 jsonb,
  headers              jsonb,
  timeout_milliseconds integer,
  created              timestamptz not null default now()
);
create table if not exists net._http_response (
  id           bigint primary key,
  status_code  integer,
  content_type text,
  headers      jsonb,
  content      text,
  timed_out    boolean,
  error_msg    text,
  created      timestamptz not null default now()
);
create or replace function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000
) returns bigint language sql volatile as $$
  insert into net.shim_requests (url, body, headers, timeout_milliseconds)
  values (url, body, headers, timeout_milliseconds) returning id
$$;

create schema if not exists vault;
create table if not exists vault.shim_secrets (name text primary key, secret text not null);
create or replace view vault.decrypted_secrets as select s.name, s.secret as decrypted_secret from vault.shim_secrets s;
