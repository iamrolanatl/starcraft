-- Local RLS test for 017 (Postgres 17 + Supabase auth/storage stubs). Simulates PostgREST: role authenticated + JWT sub.
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond then raise notice 'PASS  %', msg; else raise exception 'FAIL  %', msg; end if; end $$;
create or replace function pg_temp.err(q text, msg text) returns void language plpgsql as $$
declare st text; begin execute q; raise exception 'FAIL  % (no error)', msg;
exception when insufficient_privilege then raise notice 'PASS  % (42501)', msg; when others then get stacked diagnostics st = returned_sqlstate;
  if st = 'P0001' and sqlerrm like 'FAIL%' then raise; end if; raise notice 'PASS  % (%: %)', msg, st, sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false); perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;
grant execute on all functions in schema pg_temp to public;

-- users: P parent, K Eli's login, T tutor, G grandmother, S shopping-list friend, O outsider
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','rolan@example.com','{"full_name":"Rolan Chowdhury"}'),
 ('00000000-0000-0000-0000-00000000000b','eli@example.com','{"full_name":"Eli Chowdhury"}'),
 ('00000000-0000-0000-0000-00000000000c','tutor@example.com','{"full_name":"Tina Tutor"}'),
 ('00000000-0000-0000-0000-00000000000d','grandma@example.com','{"full_name":"Gail Grandma"}'),
 ('00000000-0000-0000-0000-00000000000e','friend@example.com','{"full_name":"Sam Friend"}'),
 ('00000000-0000-0000-0000-00000000000f','out@example.com','{"full_name":"Oscar Outsider"}');
insert into public.profiles (id, first_name, last_name) select id, split_part(raw_user_meta_data->>'full_name',' ',1), split_part(raw_user_meta_data->>'full_name',' ',2) from auth.users on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name;
-- pre-017 data exactly as the sync writes it today (no child_id)
insert into public.edu_students (id, user_id, source_key, name, grade, school, district, perm_id) values
 ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','cobb:eli','Eli','7','Dickerson','Cobb','1351101');
insert into public.edu_grades (user_id, student_id, captured_at, term, course_key, course, percent) values
 ('00000000-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000001', now(), 'Q2', 'math', 'Math', 76.8);
insert into public.edu_schedule (user_id, period, course) values ('00000000-0000-0000-0000-00000000000a', 1, 'Math');
insert into public.report_cards (user_id, period, storage_path, sha256) values ('00000000-0000-0000-0000-00000000000a','Q1','report-cards/eli-q1.pdf', repeat('a',64));
insert into storage.objects (bucket_id, name) values ('raw','report-cards/eli-q1.pdf'), ('raw','report-cards/mia-q1.pdf');
insert into public.bills (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'Mortgage');
insert into public.tasks (user_id, title) values ('00000000-0000-0000-0000-00000000000a','Sign field trip form');
insert into public.comms_notes (user_id, title) values ('00000000-0000-0000-0000-00000000000a','private note');
insert into public.meds (user_id, name) values ('00000000-0000-0000-0000-00000000000a','x');
insert into public.shop_items (user_id, list, name) values ('00000000-0000-0000-0000-00000000000a','shopping','Milk'), ('00000000-0000-0000-0000-00000000000a','wish','Telescope');
