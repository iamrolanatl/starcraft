\set ON_ERROR_STOP 1
\set QUIET 1
\set P '''00000000-0000-0000-0000-00000000000a'''
\set O '''00000000-0000-0000-0000-00000000000f'''
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if coalesce(cond, false) then raise notice 'PASS  %', msg; else raise exception 'FAIL  %', msg; end if; end $$;
create or replace function pg_temp.denied(q text, msg text) returns void language plpgsql as $$
declare st text; begin execute q; raise exception 'FAIL  % (no error)', msg;
exception when others then if sqlerrm like 'FAIL%' then raise; end if; get stacked diagnostics st = returned_sqlstate; raise notice 'PASS  % (% %)', msg, st, sqlerrm; end $$;
grant execute on all functions in schema pg_temp to public;
set role authenticated; select set_config('request.jwt.claim.sub', :P, false);
select public.family_ensure() is not null as f \gset
select id as eli from public.children where first_name='Eli' \gset
insert into public.children (family_id, first_name, grade) values (public.my_family_id(), 'Sam', '10');
select id as sam from public.children where first_name='Sam' \gset
select pg_temp.denied($$select public.sync_request_now('$$ || :'sam' || $$')$$, 'Sync Now refused before any device is paired');
select (public.sync_pair_create(array[:'sam']::uuid[]))->>'code' as code \gset
select pg_temp.ok(length(:'code') = 9, 'pairing code issued (XXXX-XXXX)');
select pg_temp.ok((select count(*) from public.sync_pairing_codes) = 1, 'parent sees own pairing code row (no hash column)');
select pg_temp.denied('select code_hash from public.sync_pairing_codes', 'parent cannot read code_hash');
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok((public.sync_pair_exchange('WRONG-CODE','t','linux','0.1','1.2.3.4')) ? 'error', 'wrong code rejected');
select (public.sync_pair_exchange(lower(:'code'),'Test laptop','linux','0.1','1.2.3.4'))->>'device_key' as key \gset
select pg_temp.ok(:'key' ~ '^csd_[0-9a-f]{64}$', 'code exchanged for device key');
select pg_temp.ok((public.sync_pair_exchange(:'code','again','linux','0.1','1.2.3.5')) ? 'error', 'pairing code is single-use');
select pg_temp.denied('select * from public.sync_devices', 'anon cannot read devices');
select pg_temp.denied('select * from public.edu_grades', 'anon cannot read grades');
select pg_temp.denied($$select public.sync_device('$$ || :'key' || $$')$$, 'internal device auth not callable by anon');
select pg_temp.denied($$select public.sync_run_start('$$ || :'key' || $$', '$$ || :'eli' || $$')$$, 'device cannot start run for unpaired child (Eli)');
select (public.sync_run_start(:'key', :'sam'))->>'run_id' as run \gset
select pg_temp.denied($$select public.sync_upload('$$ || :'key' || $$', '$$ || :'run' || $$', '$$ || :'eli' || $$', '{}')$$, 'device cannot upload for Eli');
select public.sync_log(:'key', :'run', '[{"level":"info","step":"login","msg":"login user=sam password=hunter2 ok"}]');
select (public.sync_upload(:'key', :'run', :'sam', '{"fetched_at":"2026-10-14T08:10:00Z","student":{"grade":"10","school":"Test HS"},"grades":[{"captured_at":"2026-10-14T08:10:00Z","term":"S1","course_key":"bio","course":"Biology","percent":88,"mark":"B"}],"assignments":[{"source":"ParentVUE","ext_id":"a1","name":"Lab 1","score_pct":95}],"calendar":[{"date":"2026-10-20","title":"No school"}]}'))->'counts' as c \gset
select pg_temp.ok((:'c')::jsonb->>'grades' = '1' and (:'c')::jsonb->>'assignments' = '1', 'upload stored rows: ' || :'c');
select public.sync_run_finish(:'key', :'run', 'ok', '{}');
reset role;
select pg_temp.ok((select msg from public.sync_logs where step='login') not like '%hunter2%', 'password masked in stored log');
select pg_temp.ok((select e.user_id = :P from public.edu_grades g join public.edu_students e on e.id = g.student_id where g.course_key='bio'), 'rows owned by family owner');
select pg_temp.ok((select child_id from public.edu_grades where course_key='bio') = :'sam', 'rows tagged to Sam, not Eli');
set role authenticated; select set_config('request.jwt.claim.sub', :P, false);
select pg_temp.ok((select count(*) from public.edu_grades where course_key='bio') = 1, 'parent reads the uploaded grade');
select pg_temp.ok((select (x->>'last_ok_at') is not null from jsonb_array_elements(public.sync_status()) x where x->>'child_id' = :'sam'), 'status shows last ok for Sam');
select (public.sync_request_now(:'sam'))->>'run_id' as q \gset
select pg_temp.ok(((public.sync_request_now(:'sam'))->>'already')::boolean, 'second Sync Now reuses queued command');
select set_config('request.jwt.claim.sub', :O, false);
select pg_temp.ok((select count(*) from public.sync_runs) = 0 and (select count(*) from public.sync_logs) = 0, 'other user sees no runs/logs');
select pg_temp.denied($$select public.sync_device_revoke((select id from public.sync_devices limit 1))$$, 'other user cannot revoke');
reset role; set role anon;
select pg_temp.ok((public.sync_poll(:'key'))->'commands'->0->>'run_id' = :'q', 'device polls queued Sync Now command');
select (public.sync_rotate(:'key'))->>'device_key' as key2 \gset
select pg_temp.denied($$select public.sync_poll('$$ || :'key' || $$')$$, 'old key dead after rotate');
reset role; set role authenticated; select set_config('request.jwt.claim.sub', :P, false);
select public.sync_device_revoke((select id from public.sync_devices limit 1));
reset role; set role anon;
select pg_temp.denied($$select public.sync_poll('$$ || :'key2' || $$')$$, 'revoked key refused');
