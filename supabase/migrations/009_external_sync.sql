-- Crystal 009: external to-do + calendar sync (Rolan Google Calendar/Tasks, Eli O365 calendar/To Do).
-- Run in Supabase Dashboard > SQL Editor. Safe to re-run. Requires 001.
-- Rules: rows are only written by the box sync (service_role); the signed-in owner can read them and
-- request complete / un-complete / delete (pending_action), which the box writes back to Google.
-- Blank pulls never overwrite: suspicious pulls go to ext_quarantine; missing rows are marked, never deleted.
create schema if not exists private;

create table if not exists public.ext_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('google','o365')),
  kind text not null check (kind in ('task','event')),
  ext_id text not null,
  list_id text,
  list_name text,
  title text not null check (char_length(title) between 1 and 500),
  notes text,
  due_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  url text,
  done boolean not null default false,
  ext_updated_at timestamptz,
  pending_action text check (pending_action in ('complete','uncomplete','delete')),
  pending_at timestamptz,
  writeback_error text,
  hidden boolean not null default false,
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  missing_since timestamptz,
  missing_count int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source, kind, ext_id)
);
create index if not exists ext_items_user_day on public.ext_items (user_id, kind, due_date, starts_at);
alter table public.ext_items enable row level security;
drop policy if exists "ext select own" on public.ext_items;
drop policy if exists "ext update own" on public.ext_items;
create policy "ext select own" on public.ext_items for select to authenticated using (user_id = (select auth.uid()));
create policy "ext update own" on public.ext_items for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.ext_items from anon, authenticated;
grant select on public.ext_items to authenticated;
-- The owner may only flag actions; titles/dates stay grounded in the source.
grant update (pending_action, pending_at, hidden) on public.ext_items to authenticated;

create table if not exists public.ext_sync_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null, kind text not null,
  status text not null check (status in ('ok','quarantined','failed','writeback')),
  pulled int, accepted int, kept_old int, missing int, archived int,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.ext_sync_runs enable row level security;
drop policy if exists "ext runs own" on public.ext_sync_runs;
create policy "ext runs own" on public.ext_sync_runs for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ext_sync_runs from anon, authenticated;
grant select on public.ext_sync_runs to authenticated;

create table if not exists public.ext_quarantine (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null, kind text not null,
  reason text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.ext_quarantine enable row level security;
drop policy if exists "ext quarantine own" on public.ext_quarantine;
create policy "ext quarantine own" on public.ext_quarantine for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ext_quarantine from anon, authenticated;
grant select on public.ext_quarantine to authenticated;

-- Google refresh token (from "Connect Google" with calendar + tasks scopes). Private schema: not exposed over REST.
create table if not exists private.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  scopes text,
  updated_at timestamptz not null default now()
);
revoke all on private.google_tokens from public, anon, authenticated;

create or replace function public.save_google_token(p_refresh text, p_scopes text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_refresh is null or char_length(p_refresh) < 20 then raise exception 'bad token'; end if;
  insert into private.google_tokens (user_id, refresh_token, scopes, updated_at) values (auth.uid(), p_refresh, p_scopes, now())
  on conflict (user_id) do update set refresh_token = excluded.refresh_token, scopes = coalesce(excluded.scopes, private.google_tokens.scopes), updated_at = now();
end $$;
revoke all on function public.save_google_token(text, text) from public, anon;
grant execute on function public.save_google_token(text, text) to authenticated;

create or replace function public.google_token_status() returns table (connected boolean, scopes text, updated_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select true, t.scopes, t.updated_at from private.google_tokens t where t.user_id = auth.uid()
$$;
revoke all on function public.google_token_status() from public, anon;
grant execute on function public.google_token_status() to authenticated;

-- Box only (service_role).
create or replace function public.svc_google_token(p_user uuid) returns text
language sql security definer set search_path = '' stable as $$
  select refresh_token from private.google_tokens where user_id = p_user
$$;
revoke all on function public.svc_google_token(uuid) from public, anon, authenticated;
grant execute on function public.svc_google_token(uuid) to service_role;

notify pgrst, 'reload schema';
