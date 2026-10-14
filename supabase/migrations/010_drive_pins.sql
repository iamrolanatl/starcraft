-- Crystal 010: Drive section pins (pin a Google Drive file to a module, e.g. School Hub). Run after 009. Safe to re-run.
create table if not exists public.drive_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_id text not null check (file_id ~ '^[A-Za-z0-9_-]{5,200}$'),
  name text not null check (char_length(name) between 1 and 500),
  mime text, web_link text check (web_link is null or web_link like 'https://%'),
  module text not null default 'school' check (module in ('school','comms','finance','health','shopping','home')),
  created_at timestamptz not null default now(),
  unique (user_id, file_id, module)
);
alter table public.drive_pins enable row level security;
drop policy if exists "drive_pins own" on public.drive_pins;
create policy "drive_pins own" on public.drive_pins for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.drive_pins from anon;
grant select, insert, update, delete on public.drive_pins to authenticated;
notify pgrst, 'reload schema';
