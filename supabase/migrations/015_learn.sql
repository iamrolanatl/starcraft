-- Crystal 015: Education › Learn. Current unit per class + verified study links. Owner read-only; box (service role) writes.
-- History kept: rows are never deleted (trigger); superseded units get status='past' and an entry in learn_history. Safe to re-run.
create table if not exists public.learn_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_name text not null,
  teacher text,
  unit text not null,
  topic text, book text, pattern text,
  status text not null default 'current' check (status in ('current','upcoming','past','done','unknown')),
  source text not null,              -- 'from syllabus' | 'inferred from assignments' | 'from assignments (gradebook)' | 'no data'
  confidence text not null,
  evidence text not null,
  timeline jsonb not null default '[]'::jsonb,
  researched_at timestamptz not null default now(),
  unique (user_id, class_name, unit)
);
create table if not exists public.learn_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_name text not null,          -- 'All' = every class
  unit text,
  title text not null,
  url text not null check (url ~ '^https://'),
  type text not null check (type in ('Videos','Practice/Games','Readings','Cobb resources')),
  source text not null,
  for_assignment text,
  verified_at timestamptz not null,
  active boolean not null default true,  -- false = link failed a later check (kept for history)
  created_at timestamptz not null default now(),
  unique (user_id, class_name, url)
);
create table if not exists public.learn_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tbl text not null, row_id uuid not null, op text not null, old jsonb, new jsonb,
  at timestamptz not null default now()
);
do $$ declare t text; begin foreach t in array array['learn_units','learn_resources','learn_history'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from anon, authenticated', t);
  execute format('grant select on public.%I to authenticated', t);
  execute format('drop policy if exists "%s own read" on public.%I', t, t);
  execute format('create policy "%s own read" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
end loop; end $$;

create or replace function public.learn_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception '% history is permanent; deletes are not allowed', tg_table_name; end if;
  insert into public.learn_history(user_id, tbl, row_id, op, old, new)
  values (new.user_id, tg_table_name, new.id, tg_op, case when tg_op='UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
drop trigger if exists learn_units_audit on public.learn_units;
create trigger learn_units_audit before insert or update or delete on public.learn_units for each row execute function public.learn_audit();
drop trigger if exists learn_resources_audit on public.learn_resources;
create trigger learn_resources_audit before insert or update or delete on public.learn_resources for each row execute function public.learn_audit();
notify pgrst, 'reload schema';
