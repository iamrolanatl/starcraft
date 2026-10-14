-- 007_data_validation.sql  Non-destructive sync: last-good state, per-row seen/changed/missing tracking,
-- audit columns on runs, a "current grade" view, raw-zip retention. Idempotent. Run after 001-006.
-- See docs/data-validation-strategy.md.

alter table public.edu_students add column if not exists last_good jsonb not null default '{}'::jsonb;

do $$ declare t text; begin
  foreach t in array array['edu_assignments','edu_messages','edu_calendar','edu_attendance'] loop
    execute format('alter table public.%I add column if not exists last_seen_at timestamptz', t);
    execute format('alter table public.%I add column if not exists last_changed_at timestamptz', t);
    execute format('alter table public.%I add column if not exists missing_since timestamptz', t);
    execute format('alter table public.%I add column if not exists missing_count integer not null default 0', t);
    execute format('alter table public.%I add column if not exists archived_at timestamptz', t);
  end loop;
end $$;

-- grade history is immutable: no updates or deletes, even for service_role
create or replace function private.edu_grades_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'edu_grades is append-only'; end $$;
drop trigger if exists edu_grades_no_change on public.edu_grades;
create trigger edu_grades_no_change before update or delete on public.edu_grades
  for each row when (pg_trigger_depth() = 0 and current_setting('crystal.allow_grade_purge', true) is distinct from 'on')
  execute function private.edu_grades_immutable();

-- current grade per course/term = the latest NON-EMPTY percent (and its mark); latest status mark kept separately
create or replace view public.edu_grades_current with (security_invoker = true) as
select distinct on (g.student_id, g.course_key, g.term)
  g.user_id, g.student_id, g.course_key, g.term, g.course, g.period, g.teacher, g.teacher_email, g.is_final,
  coalesce(n.percent, null) as percent, coalesce(n.mark, g.mark) as mark, n.captured_at as percent_as_of,
  g.mark as latest_status_mark, g.captured_at as last_seen_at
from public.edu_grades g
left join lateral (
  select x.percent, x.mark, x.captured_at from public.edu_grades x
  where x.student_id = g.student_id and x.course_key = g.course_key and x.term = g.term and x.percent is not null
  order by x.captured_at desc limit 1) n on true
order by g.student_id, g.course_key, g.term, g.captured_at desc;
grant select on public.edu_grades_current to authenticated;
revoke all on public.edu_grades_current from anon;

alter table public.edu_sync_runs add column if not exists fields_accepted integer;
alter table public.edu_sync_runs add column if not exists fields_kept integer;
alter table public.edu_sync_runs add column if not exists fields_rejected integer;
alter table public.edu_sync_runs add column if not exists reason text;
alter table public.edu_sync_runs add column if not exists raw_path text;

alter table public.sync_requests add column if not exists raw_purged_at timestamptz;
