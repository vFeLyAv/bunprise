-- Fixture migration 1 of 2 (used by test/harness.test.ts, NOT a real migration).
create table public.things (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null
);

alter table public.things enable row level security;
alter table public.things force row level security;

create policy things_own on public.things
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());
