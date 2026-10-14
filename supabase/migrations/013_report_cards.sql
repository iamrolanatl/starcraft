-- Crystal 013: Education › Report Cards. PDFs live in the private 'raw' bucket under report-cards/.
-- History is permanent: no delete for anyone (trigger blocks it, even service_role). Safe to re-run.
create table if not exists public.report_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'report_card' check (source in ('report_card','document')),
  school_year text,
  period text,
  period_gu text,
  document_gu text,
  issue_date date,
  file_name text,
  storage_path text not null check (storage_path like 'report-cards/%.pdf'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);
alter table public.report_cards enable row level security;
drop policy if exists "report_cards own read" on public.report_cards;
create policy "report_cards own read" on public.report_cards for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.report_cards from anon, authenticated;
grant select on public.report_cards to authenticated;

create or replace function public.report_cards_no_delete() returns trigger language plpgsql as $$
begin raise exception 'report_cards history is permanent; deletes are not allowed'; end $$;
drop trigger if exists report_cards_no_delete on public.report_cards;
create trigger report_cards_no_delete before delete on public.report_cards for each row execute function public.report_cards_no_delete();

-- the private raw bucket must accept PDFs (it was zip-only); applied via the Storage API on 2026-10-14
update storage.buckets set allowed_mime_types = array(select distinct unnest(coalesce(allowed_mime_types, '{}') || array['application/pdf'])) where id = 'raw' and allowed_mime_types is not null;

-- let the owner sign URLs for (only) their own report-card PDFs in the private raw bucket
drop policy if exists "report card pdf owner read" on storage.objects;
create policy "report card pdf owner read" on storage.objects for select to authenticated
  using (bucket_id = 'raw' and name like 'report-cards/%'
         and exists (select 1 from public.report_cards r where r.storage_path = storage.objects.name and r.user_id = (select auth.uid())));
notify pgrst, 'reload schema';

-- Graded assignments history (Education › Grades › each class). One row per class + period + ParentVUE GradebookID.
-- Kept permanently; the box upserts and never blanks an existing score with an empty one (007 rules). Owner read-only.
create table if not exists public.edu_graded_assignments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_name text not null,
  period_index int,
  course_key text not null,
  course text,
  teacher text,
  gradebook_id text not null,
  name text,
  category text,
  assigned_date date,
  due_date date,
  score_display text,
  points_display text,
  earned numeric,
  possible numeric,
  percent numeric,
  notes text,
  graded boolean not null default false,
  missing boolean not null default false,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, course_key, period_name, gradebook_id)
);
-- Category weights per class + period from ParentVUE GradeCalculationSummary/AssignmentGradeCalc (the primary truth).
create table if not exists public.edu_grade_calc (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_name text not null,
  course_key text not null,
  category text not null,
  weight numeric,
  points numeric,
  points_possible numeric,
  weighted_pct numeric,
  calculated_mark text,
  updated_at timestamptz not null default now(),
  unique (user_id, course_key, period_name, category)
);
do $$ declare t text; begin
  foreach t in array array['edu_graded_assignments','edu_grade_calc'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s own read" on public.%I', t, t);
    execute format('create policy "%s own read" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop; end $$;
create or replace function public.edu_graded_no_delete() returns trigger language plpgsql as $$
begin raise exception 'graded assignment history is permanent; deletes are not allowed'; end $$;
drop trigger if exists edu_graded_no_delete on public.edu_graded_assignments;
create trigger edu_graded_no_delete before delete on public.edu_graded_assignments for each row execute function public.edu_graded_no_delete();
notify pgrst, 'reload schema';
