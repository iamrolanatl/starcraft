-- Crystal: richer profiles (names from the Google identity, never the email). Run after 015.
-- profiles already exists from 001 (id, display_name, timezone, created_at, RLS "own profile").
alter table public.profiles add column if not exists first_name text check (char_length(first_name) <= 60);
alter table public.profiles add column if not exists last_name text check (char_length(last_name) <= 60);
alter table public.profiles add column if not exists nickname text check (char_length(nickname) <= 40);
alter table public.profiles add column if not exists avatar_url text check (char_length(avatar_url) <= 1000);
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles alter column timezone set default 'America/New_York';
grant select, insert, update on public.profiles to authenticated;

-- New users: raw Google names (the app normalizes capitalization on first load). No email fallback (the app greets "Commander" instead).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_n text := nullif(coalesce(m->>'full_name', m->>'name'), '');
begin
  if full_n like '%@%' then full_n := null; end if;
  insert into public.profiles (id, display_name, first_name, last_name, avatar_url, timezone)
  values (new.id, full_n, nullif(coalesce(m->>'given_name', split_part(full_n, ' ', 1)), ''),
          nullif(m->>'family_name', ''), nullif(coalesce(m->>'avatar_url', m->>'picture'), ''), 'America/New_York')
  on conflict (id) do nothing;
  return new;
end $$;

-- Backfill: clear display names that were copied from the email local part.
update public.profiles p set display_name = null
  from auth.users u where u.id = p.id and p.display_name = split_part(u.email, '@', 1);
