-- Crystal Phase 1: profiles + tasks with row-level security.
-- Run in Supabase Dashboard > SQL Editor (or `supabase db push`).
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  notes text,
  due_date date,
  priority smallint not null default 2 check (priority between 1 and 3),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_user_due on public.tasks (user_id, done, due_date);
alter table public.tasks enable row level security;

drop policy if exists "tasks select own" on public.tasks;
drop policy if exists "tasks insert own" on public.tasks;
drop policy if exists "tasks update own" on public.tasks;
drop policy if exists "tasks delete own" on public.tasks;
create policy "tasks select own" on public.tasks for select to authenticated using (user_id = (select auth.uid()));
create policy "tasks insert own" on public.tasks for insert to authenticated with check (user_id = (select auth.uid()));
create policy "tasks update own" on public.tasks for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "tasks delete own" on public.tasks for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update on public.profiles to authenticated;
