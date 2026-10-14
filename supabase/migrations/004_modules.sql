-- Crystal Phases 3-5: Health, Finance, Shopping, Communications, Education check-ins.
-- Every table: owner user_id defaults to auth.uid(), RLS on, owner-only access.
-- Run in Supabase Dashboard > SQL Editor after 001-003.
create extension if not exists pgcrypto;

create table if not exists public.health_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('steps','glucose','weight','note')),
  value numeric, unit text, note text,
  logged_on date not null default current_date,
  created_at timestamptz not null default now());

create table if not exists public.meds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(name) <= 200), dose text, schedule text,
  last_taken timestamptz, active boolean not null default true,
  created_at timestamptz not null default now());

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(name) <= 200), amount numeric(12,2), due_date date,
  autopay boolean not null default false, paid boolean not null default false,
  created_at timestamptz not null default now());

create table if not exists public.credit_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bureau text not null default 'manual', score int check (score between 300 and 850),
  checked_on date not null default current_date,
  created_at timestamptz not null default now());

create table if not exists public.stocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Za-z0-9.\-^=]{1,12}$'), shares numeric default 0, cost_basis numeric,
  created_at timestamptz not null default now());

create table if not exists public.shop_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list text not null default 'shopping' check (list in ('shopping','wish')),
  name text not null check (length(name) <= 300), qty int default 1, price numeric(12,2), url text,
  done boolean not null default false,
  created_at timestamptz not null default now());

create table if not exists public.comms_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel text not null default 'email' check (channel in ('mail','email','drive')),
  title text not null check (length(title) <= 300), body text, url text, due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now());

create table if not exists public.edu_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(title) <= 300), note text, file_path text,
  checkin_on date not null default current_date,
  created_at timestamptz not null default now());

do $$
declare t text;
begin
  foreach t in array array['health_logs','meds','bills','credit_scores','stocks','shop_items','comms_notes','edu_checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner all" on public.%I', t);
    execute format('create policy "owner all" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create index if not exists %I on public.%I (user_id, created_at desc)', t || '_user_idx', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Private storage bucket for school handouts; files live under <user_id>/...
insert into storage.buckets (id, name, public, file_size_limit)
values ('handouts', 'handouts', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "handouts owner read" on storage.objects;
drop policy if exists "handouts owner write" on storage.objects;
drop policy if exists "handouts owner delete" on storage.objects;
create policy "handouts owner read" on storage.objects for select to authenticated
  using (bucket_id = 'handouts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "handouts owner write" on storage.objects for insert to authenticated
  with check (bucket_id = 'handouts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "handouts owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'handouts' and (storage.foldername(name))[1] = (select auth.uid())::text);
