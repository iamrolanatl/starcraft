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
notify pgrst, 'reload schema';
