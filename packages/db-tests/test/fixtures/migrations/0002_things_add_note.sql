-- Fixture migration 2 of 2: must run after 0001 (depends on public.things).
alter table public.things add column note text;
