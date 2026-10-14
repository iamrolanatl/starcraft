-- 024: Kids' tutor conversation log. Each signed-in user writes their own turns; the family owner (parent) can read
-- their children's turns for review. Nobody can edit; only the owner of the row's family (parent) or the user may delete.
create table if not exists public.tutor_logs (
  id bigint generated always as identity primary key,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  question text not null check (char_length(question) <= 2000),
  answer text check (char_length(answer) <= 4000),
  provider text check (char_length(provider) <= 20),
  model text check (char_length(model) <= 80),
  flagged text check (char_length(flagged) <= 40),
  fell_back text check (char_length(fell_back) <= 200),
  voice boolean not null default false,
  ms int);
create index if not exists tutor_logs_owner_time on public.tutor_logs (owner, created_at desc);
alter table public.tutor_logs enable row level security;
drop policy if exists tutor_logs_insert on public.tutor_logs;
create policy tutor_logs_insert on public.tutor_logs for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists tutor_logs_read on public.tutor_logs;
create policy tutor_logs_read on public.tutor_logs for select to authenticated using (owner = (select auth.uid()) or public.is_family_parent_of(owner));
drop policy if exists tutor_logs_delete on public.tutor_logs;
create policy tutor_logs_delete on public.tutor_logs for delete to authenticated using (public.is_family_parent_of(owner));
revoke all on public.tutor_logs from anon;
grant select, insert, delete on public.tutor_logs to authenticated;
