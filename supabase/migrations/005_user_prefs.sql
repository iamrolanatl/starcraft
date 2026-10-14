-- Crystal v4: per-user UI prefs (HUD tile layout, favorites, glass clarity). Run after 004.
create table if not exists public.user_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb check (pg_column_size(prefs) < 32768),
  updated_at timestamptz not null default now());
alter table public.user_prefs enable row level security;
drop policy if exists "owner all" on public.user_prefs;
create policy "owner all" on public.user_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.user_prefs to authenticated;
