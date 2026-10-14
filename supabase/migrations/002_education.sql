-- Crystal Phase 2: Education module (school data) with row-level security.
-- Run AFTER 001_tasks.sql in Supabase Dashboard > SQL Editor. Idempotent.
-- Readers: the signed-in owner only (user_id = auth.uid()).
-- Writers: the box sync job (sync/school_sync.py) using the service_role key, which bypasses RLS.
create extension if not exists pgcrypto;

create table if not exists public.edu_students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,               -- stable key, e.g. 'cobb:eli'
  name text not null, grade text, school text, district text,
  attendance_totals jsonb not null default '{}'::jsonb,
  reporting_period jsonb not null default '{}'::jsonb,
  last_fetched_at timestamptz, last_synced_at timestamptz,
  unique (user_id, source_key)
);

create table if not exists public.edu_grades (       -- append-only snapshots -> trends
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.edu_students(id) on delete cascade,
  captured_at timestamptz not null, term text not null,
  course_key text not null, course text not null, period text, teacher text, teacher_email text,
  percent numeric(5,2), mark text, is_final boolean not null default false,
  unique (student_id, course_key, term, captured_at)
);
create index if not exists edu_grades_user on public.edu_grades (user_id, student_id, captured_at desc);

create table if not exists public.edu_assignments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.edu_students(id) on delete cascade,
  source text not null, ext_id text not null,
  course text, name text not null, kind text, assigned_date date, due_date date,
  score_display text, score_pct numeric(6,2), points_possible numeric,
  missing boolean not null default false, zero boolean not null default false, late boolean not null default false,
  status text, updated_at timestamptz not null default now(),
  unique (student_id, source, ext_id)
);
create index if not exists edu_assign_user on public.edu_assignments (user_id, student_id, due_date);

create table if not exists public.edu_attendance (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.edu_students(id) on delete cascade,
  date date not null, kind text not null, reason text, note text, periods jsonb not null default '[]'::jsonb,
  unique (student_id, date, kind)
);

create table if not exists public.edu_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.edu_students(id) on delete cascade,
  source text not null, ext_id text not null, sent_at timestamptz,
  sender text, subject text, body text, course text, url text, unread boolean,
  unique (student_id, source, ext_id)
);
create index if not exists edu_msg_user on public.edu_messages (user_id, student_id, sent_at desc);

create table if not exists public.edu_calendar (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.edu_students(id) on delete cascade,
  date date not null, title text not null, kind text, source text not null default 'ParentVUE',
  unique (student_id, date, title)
);

create table if not exists public.edu_sync_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid references public.edu_students(id) on delete cascade,
  ran_at timestamptz not null default now(), fetched_at timestamptz,
  source text, status text not null, counts jsonb not null default '{}'::jsonb, error text
);

do $$ declare t text; begin
  foreach t in array array['edu_students','edu_grades','edu_assignments','edu_attendance','edu_messages','edu_calendar','edu_sync_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s select own" on public.%I', t, t);
    execute format('create policy "%s select own" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
