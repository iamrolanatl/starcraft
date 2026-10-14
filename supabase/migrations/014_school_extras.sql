-- Crystal 014: Education › Schedule + Attendance (per-period detail). Run after 013. Safe to re-run.
-- Box (service_role) writes; Rolan reads only his own rows; history is permanent (no deletes).
create table if not exists public.edu_schedule (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null default '',
  period int not null,
  course text not null,
  course_key text,
  room text,
  teacher text,
  teacher_email text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, term, period, course)
);
create table if not exists public.edu_attendance_periods (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  period int not null,
  code text,
  reason text,
  note text,
  course text,
  teacher text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date, period)
);
do $$ declare t text; begin
  foreach t in array array['edu_schedule','edu_attendance_periods'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s own read" on public.%I', t, t);
    execute format('create policy "%s own read" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.edu_graded_no_delete()', t || '_no_delete', t);
  end loop; end $$;
alter table public.edu_attendance_periods add column if not exists kind text;     -- absence | tardy
alter table public.edu_attendance_periods add column if not exists status text;   -- excused | unexcused | activity | unknown (from the ParentVUE code)
alter table public.edu_students add column if not exists full_name text;          -- ParentVUE ChildName (for excuse letters)
alter table public.edu_students add column if not exists perm_id text;            -- ParentVUE ChildPermID (student ID)

-- Excuse letters: Rolan drafts in Crystal, presses Send -> a NEW (non-reply) mail_outbox row (012) queued for the 5-minute
-- Gmail routine. This table links that outbox row to the absence/tardy dates. Never auto-sent; never deleted.
create table if not exists public.edu_attendance_excuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dates date[] not null check (cardinality(dates) between 1 and 30),
  periods text,
  kind text not null check (kind in ('absence','tardy')),
  reason_choice text not null check (reason_choice in ('illness','appointment','family','other')),
  outbox_id uuid not null references public.mail_outbox(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.edu_attendance_excuses enable row level security;
drop policy if exists "excuses own read" on public.edu_attendance_excuses;
create policy "excuses own read" on public.edu_attendance_excuses for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "excuses own insert" on public.edu_attendance_excuses;
create policy "excuses own insert" on public.edu_attendance_excuses for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.mail_outbox o where o.id = outbox_id and o.user_id = (select auth.uid())));
revoke all on public.edu_attendance_excuses from anon, authenticated;
grant select, insert on public.edu_attendance_excuses to authenticated;
drop trigger if exists edu_attendance_excuses_no_delete on public.edu_attendance_excuses;
create trigger edu_attendance_excuses_no_delete before delete on public.edu_attendance_excuses for each row execute function public.edu_graded_no_delete();
notify pgrst, 'reload schema';
