\set ON_ERROR_STOP 1
\set QUIET 1
\set P '''00000000-0000-0000-0000-00000000000a'''
\set K '''00000000-0000-0000-0000-00000000000b'''
\set T '''00000000-0000-0000-0000-00000000000c'''
\set G '''00000000-0000-0000-0000-00000000000d'''
\set S '''00000000-0000-0000-0000-00000000000e'''
\set O '''00000000-0000-0000-0000-00000000000f'''
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if coalesce(cond, false) then raise notice 'PASS  %', msg; else raise exception 'FAIL  %', msg; end if; end $$;
create or replace function pg_temp.denied(q text, msg text) returns void language plpgsql as $$
declare st text; begin execute q; raise exception 'FAIL  % (no error)', msg;
exception when insufficient_privilege then raise notice 'PASS  % (42501)', msg;
  when others then if sqlerrm like 'FAIL%' then raise; end if; get stacked diagnostics st = returned_sqlstate; raise notice 'PASS  % (% %)', msg, st, sqlerrm; end $$;
create or replace function pg_temp.n(q text) returns bigint language plpgsql as $$ declare c bigint; begin execute 'select count(*) from (' || q || ') x' into c; return c; end $$;
grant execute on all functions in schema pg_temp to public;
\set ON_ERROR_STOP 1

-- ===== backfill =====
select pg_temp.ok((select count(*) from public.children where first_name='Eli' and last_name='J. Chowdhury' and grade='7' and school='Dickerson Middle School' and district='Cobb' and student_id='1351101') = 1, 'backfill: Eli child record');
select pg_temp.ok((select count(*) from public.edu_grades where child_id is null) = 0 and (select count(*) from public.edu_schedule where child_id is null) = 0 and (select count(*) from public.report_cards where child_id is null) = 0, 'backfill: existing rows tagged with Eli');
select id as eli from public.children where first_name='Eli' \gset
-- sync unchanged: insert without child_id defaults to Eli
insert into public.edu_grades (user_id, student_id, captured_at, term, course_key, course, percent) values (:P,'11111111-0000-0000-0000-000000000001', now()+interval '1 min','Q2','sci','Science',91);
select pg_temp.ok((select child_id from public.edu_grades where course_key='sci') = :'eli', 'sync insert without child_id defaults to Eli');

-- ===== parent adds a sibling (no login) =====
set role authenticated; select set_config('request.jwt.claim.sub', :P, false);
select public.family_ensure() is not null as fam_ok \gset
insert into public.children (family_id, first_name, grade) values (public.my_family_id(), 'Mia', '3');
select pg_temp.ok((select count(*) from public.children) = 2, 'parent: sees 2 children');
reset role;
select id as mia from public.children where first_name='Mia' \gset
insert into public.edu_grades (user_id, student_id, captured_at, term, course_key, course, percent, child_id) values (:P,'11111111-0000-0000-0000-000000000001', now()+interval '2 min','Q2','read','Reading',88, :'mia');
insert into public.report_cards (user_id, period, storage_path, sha256, child_id) values (:P,'Q1','report-cards/mia-q1.pdf', repeat('b',64), :'mia');

-- ===== family invite for Eli's login: code -> pending -> 6-digit match -> approve =====
set role authenticated; select set_config('request.jwt.claim.sub', :P, false);
select (public.family_create_invite(:'eli'))->>'code' as code \gset
select pg_temp.ok(:'code' ~ '^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$', 'invite code is 8 chars, no ambiguous letters: ' || :'code');
select pg_temp.denied('select code_hash from public.family_invites', 'parent cannot read code_hash');
select pg_temp.ok(public.family_create_invite(:'eli') is not null, 'second open invite allowed');
-- lockout: 5 wrong tries
select set_config('request.jwt.claim.sub', :K, false);
select public.family_join('ZZZZ-ZZZZ'), public.family_join('ZZZZ-ZZZY'), public.family_join('ZZZZ-ZZZX'), public.family_join('ZZZZ-ZZZW') \gset junk_
select pg_temp.ok((public.family_join('ZZZZ-ZZZV'))->>'error' = 'locked', 'child: locked after 5 wrong codes');
select pg_temp.ok((public.family_join(:'code'))->>'error' = 'locked', 'child: even the right code is refused while locked');
reset role; update public.family_join_attempts set locked_until = now() - interval '1 second';   -- simulate 1 hour passing
set role authenticated; select set_config('request.jwt.claim.sub', :K, false);
select public.family_join(lower(replace(:'code','-',' '))) as j \gset
select pg_temp.ok((:'j'::jsonb)->>'status' = 'pending' and (:'j'::jsonb)->>'confirm_code' ~ '^[0-9]{6}$', 'child: code accepted (case/space-insensitive) -> pending + 6-digit code');
select (:'j'::jsonb)->>'confirm_code' as kconf \gset
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') = 0, 'pending child: still reads 0 grades');
select set_config('request.jwt.claim.sub', :O, false);
select pg_temp.ok((public.family_join(:'code'))->>'error' = 'used', 'outsider: single-use code refused');
select set_config('request.jwt.claim.sub', :P, false);
select pg_temp.ok((select confirm_code from public.family_members where user_id = :K) = :'kconf', 'parent: sees the same 6-digit code');
select pg_temp.ok((public.family_decide(:K, true))->>'ok' = 'true', 'parent: approve');
select pg_temp.ok((select user_id from public.children where id = :'eli') = :K, 'approve links Eli''s child record to his login');

-- ===== child login reads =====
select set_config('request.jwt.claim.sub', :K, false);
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') = 2, 'child: reads his own 2 grades');
select pg_temp.ok(pg_temp.n(format('select 1 from public.edu_grades where child_id = %L', :'mia')) = 0, 'child: 0 rows of sibling Mia');
select pg_temp.ok(pg_temp.n('select 1 from public.report_cards') = 1, 'child: reads his report card only');
select pg_temp.ok(pg_temp.n('select 1 from storage.objects where name = ''report-cards/eli-q1.pdf''') = 1 and pg_temp.n('select 1 from storage.objects where name = ''report-cards/mia-q1.pdf''') = 0, 'child: may sign his own PDF, not Mia''s');
select pg_temp.ok(pg_temp.n('select 1 from public.tasks') = 1 and pg_temp.n('select 1 from public.edu_schedule') = 1 and pg_temp.n('select 1 from public.edu_students') = 1, 'child: tasks, schedule, student shared');
select pg_temp.ok(pg_temp.n('select 1 from public.bills') + pg_temp.n('select 1 from public.meds') + pg_temp.n('select 1 from public.comms_notes') + pg_temp.n('select 1 from public.shop_items') + pg_temp.n('select 1 from public.mail_outbox') = 0, 'child: 0 rows bills/meds/comms/shop/mail');
select pg_temp.denied('select * from private.google_tokens', 'child: google tokens');
select pg_temp.ok(pg_temp.n('select 1 from public.edu_attendance_excuses') = 0 and pg_temp.n('select 1 from public.learn_history') = 0, 'child: 0 excuse letters / learn history');
update public.tasks set done = true where user_id = :P;
select pg_temp.ok(pg_temp.n(format('select 1 from public.tasks where user_id = %L and done', :P)) = 0, 'child: update of parent task affects 0 rows');
insert into public.tasks (title) values ('Study for math'); insert into public.edu_checkins (title) values ('Finished homework');
select pg_temp.ok(pg_temp.n('select 1 from public.tasks where done = false') = 2, 'child: can add own to-do');
update public.tasks set done = true where title = 'Study for math';
select pg_temp.ok(pg_temp.n('select 1 from public.tasks where done') = 1, 'child: can complete own to-do');
select pg_temp.denied('insert into public.edu_grades (user_id, student_id, captured_at, term, course_key, course) values (''00000000-0000-0000-0000-00000000000a'',''11111111-0000-0000-0000-000000000001'', now(), ''x'',''x'',''x'')', 'child: cannot write grades');
select pg_temp.denied(format('select public.family_create_invite(%L)', :'eli'), 'child: cannot invite');
select set_config('request.jwt.claim.sub', :P, false);
select pg_temp.ok(pg_temp.n('select 1 from public.edu_checkins') = 1, 'parent: reads child check-in');
select pg_temp.ok(pg_temp.n('select 1 from public.tasks') = 1, 'parent: does not see child''s private to-dos');

-- ===== trusted adults: tutor (Homework Helper) and grandmother (Full School View) =====
select (public.viewer_invite(:'eli', 'tutor@example.com', 'Tutor', array['assignments','learn','schedule','calendar'], now() + interval '90 days')) as vt \gset
select pg_temp.ok(pg_temp.n(format('select 1 from public.mail_outbox where id = %L and status = ''queued'' and thread_id is null', (:'vt'::jsonb)->>'outbox_id')) = 1, 'SEND INVITE queues one new outbox email (empty thread)');
select (public.viewer_invite(:'eli', 'grandma@example.com', 'Grandmother', array['grades','assignments','report_cards','attendance','schedule','calendar','learn'])) as vg \gset
select (public.viewer_invite(:'eli', 'x@example.com', 'Aunt', array['grades'])) as vx \gset
select pg_temp.ok((public.viewer_invite_revoke(((:'vx'::jsonb)->>'id')::uuid))->>'ok' = 'true' and pg_temp.n(format('select 1 from public.mail_outbox where id = %L and status = ''cancelled''', (:'vx'::jsonb)->>'outbox_id')) = 1, 'revoke invite cancels the queued email');
select set_config('request.jwt.claim.sub', :T, false);
select pg_temp.ok((public.family_join((:'vt'::jsonb)->>'code'))->>'status' = 'pending', 'tutor: code -> pending');
select pg_temp.ok(pg_temp.n('select 1 from public.edu_schedule') = 0, 'tutor pending: 0 rows');
select set_config('request.jwt.claim.sub', :G, false);
select pg_temp.ok((public.family_join((:'vg'::jsonb)->>'code'))->>'status' = 'pending', 'grandma: code -> pending');
select set_config('request.jwt.claim.sub', :P, false);
select pg_temp.ok((public.viewer_manage(id, 'approve'))->>'ok' = 'true', 'parent approves ' || relationship) from public.child_viewers;
select set_config('request.jwt.claim.sub', :T, false);
select public.viewer_touch(:'eli');
select pg_temp.ok(pg_temp.n('select 1 from public.edu_schedule') = 1, 'tutor: reads schedule');
select pg_temp.ok(pg_temp.n('select 1 from public.report_cards') = 0, 'tutor: 0 report cards');
select pg_temp.ok(pg_temp.n('select 1 from storage.objects') = 0, 'tutor: cannot sign report-card PDFs');
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') = 0 and pg_temp.n('select 1 from public.edu_attendance') = 0, 'tutor: 0 grades / attendance');
select pg_temp.ok(pg_temp.n('select 1 from public.tasks') + pg_temp.n('select 1 from public.ext_items') + pg_temp.n('select 1 from public.edu_messages') + pg_temp.n('select 1 from public.bills') + pg_temp.n('select 1 from public.mail_outbox') = 0, 'tutor: 0 tasks/calendar sync/messages/bills/mail');
select pg_temp.ok(pg_temp.n('select 1 from public.children') = 1, 'tutor: sees only Eli''s child card');
select pg_temp.denied('insert into public.edu_checkins (title, user_id) values (''x'', ''00000000-0000-0000-0000-00000000000a'')', 'tutor: read-only (cannot write as parent)');
select set_config('request.jwt.claim.sub', :G, false);
select pg_temp.ok(pg_temp.n('select 1 from public.report_cards') = 1 and pg_temp.n('select 1 from public.edu_grades') = 2, 'grandma: Full School View reads report card + Eli grades');
select pg_temp.ok(pg_temp.n(format('select 1 from public.edu_grades where child_id = %L', :'mia')) = 0 and pg_temp.n('select 1 from storage.objects where name like ''%%mia%%''') = 0, 'grandma: nothing of Mia');
select set_config('request.jwt.claim.sub', :P, false);
select pg_temp.ok((select last_viewed_at is not null from public.child_viewers where relationship = 'Tutor'), 'parent: sees tutor last viewed');
select public.viewer_manage(id, 'pause') from public.child_viewers where relationship = 'Grandmother';
select set_config('request.jwt.claim.sub', :G, false);
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') = 0, 'grandma paused: 0 rows');
select set_config('request.jwt.claim.sub', :P, false);
select public.viewer_manage(id, 'resume') from public.child_viewers where relationship = 'Grandmother';
select public.viewer_manage(id, 'edit', array['schedule']) from public.child_viewers where relationship = 'Grandmother';
select set_config('request.jwt.claim.sub', :G, false);
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') = 0 and pg_temp.n('select 1 from public.edu_schedule') = 1, 'grandma after edit to schedule only');
reset role; update public.child_viewers set expires_at = now() - interval '1 second' where relationship = 'Tutor';
set role authenticated; select set_config('request.jwt.claim.sub', :T, false);
select pg_temp.ok(pg_temp.n('select 1 from public.edu_schedule') = 0, 'tutor after expiry: 0 rows');

-- ===== Shopping / Wish List shares =====
select set_config('request.jwt.claim.sub', :P, false);
select (public.list_share_invite('shopping', 'friend@example.com', 'view')) as ls \gset
select set_config('request.jwt.claim.sub', :S, false);
select pg_temp.ok((public.family_join((:'ls'::jsonb)->>'code'))->>'kind' = 'list', 'friend: list code -> pending');
select pg_temp.ok(pg_temp.n('select 1 from public.shop_items') = 0, 'friend pending: 0 items');
select set_config('request.jwt.claim.sub', :P, false);
select public.list_share_decide(id, true) from public.list_shares;
select set_config('request.jwt.claim.sub', :S, false);
select pg_temp.ok(pg_temp.n('select 1 from public.shop_items') = 1 and pg_temp.n('select 1 from public.shop_items where list = ''wish''') = 0, 'friend: reads Shopping List only, not Wish List');
update public.shop_items set done = true where name = 'Milk';
reset role; select pg_temp.ok((select not done from public.shop_items where name = 'Milk'), 'friend (Can View): update silently affects 0 rows'); set role authenticated;
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') + pg_temp.n('select 1 from public.tasks') + pg_temp.n('select 1 from public.bills') = 0, 'friend: no other tables');
select set_config('request.jwt.claim.sub', :P, false);
select public.list_share_set_perm(id, 'edit') from public.list_shares;
select set_config('request.jwt.claim.sub', :S, false);
update public.shop_items set done = true where name = 'Milk';
insert into public.shop_items (user_id, list, name) values (:P, 'shopping', 'Eggs');
select pg_temp.ok(pg_temp.n('select 1 from public.shop_items where done or name = ''Eggs''') = 2, 'friend (Can Edit): toggles and adds');
select pg_temp.denied(format('insert into public.shop_items (user_id, list, name) values (%L, ''wish'', ''x'')', :P), 'friend (Can Edit): cannot write the Wish List');
insert into public.shop_items (user_id, list, name, quantity, store, price) values (:P, 'shopping', 'Whole milk', '2 gallons', 'Kroger', 3.49);
update public.shop_items set deleted_at = now() where name = 'Eggs';
select pg_temp.ok(pg_temp.n('select 1 from public.list_activity where actor_name = ''Sam F.'' and action in (''checked'',''added'',''deleted'')') >= 4, 'activity: friend''s add/check/delete logged as "Sam F."');
select pg_temp.ok(pg_temp.n('select 1 from public.list_activity where list = ''wish''') = 0, 'activity: friend sees no Wish List activity');
select pg_temp.ok((select added_by from public.shop_items where name = 'Whole milk') = auth.uid(), 'added_by = the friend');
select set_config('request.jwt.claim.sub', :O, false);
select pg_temp.ok(pg_temp.n('select 1 from public.list_activity') = 0, 'outsider: 0 activity rows');
select set_config('request.jwt.claim.sub', :P, false);
select public.list_share_revoke(id) from public.list_shares;
select set_config('request.jwt.claim.sub', :S, false);
select pg_temp.ok(pg_temp.n('select 1 from public.shop_items') = 0, 'friend revoked: 0 rows');
select pg_temp.ok(pg_temp.n('select 1 from public.list_activity') = 0, 'friend revoked: 0 activity rows');

-- ===== outsider + revoke child =====
select set_config('request.jwt.claim.sub', :O, false);
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') + pg_temp.n('select 1 from public.report_cards') + pg_temp.n('select 1 from public.children') + pg_temp.n('select 1 from public.family_members') + pg_temp.n('select 1 from public.child_viewers') + pg_temp.n('select 1 from public.family_events') + pg_temp.n('select 1 from public.tasks') + pg_temp.n('select 1 from storage.objects') = 0, 'outsider: 0 rows everywhere');
select pg_temp.denied('select public.family_decide(''00000000-0000-0000-0000-00000000000b'', false)', 'outsider: cannot decide');
select set_config('request.jwt.claim.sub', :P, false);
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') = 3 and pg_temp.n('select 1 from public.report_cards') = 2, 'parent: still reads everything');
select public.family_revoke_member(:K);
select set_config('request.jwt.claim.sub', :K, false);
select pg_temp.ok(pg_temp.n('select 1 from public.edu_grades') = 0 and pg_temp.n('select 1 from public.tasks where user_id <> auth.uid()') = 0, 'child revoked: access ends immediately');
select set_config('request.jwt.claim.sub', :P, false);
select pg_temp.ok((select count(distinct kind) from public.family_events) >= 12, 'events logged: ' || (select string_agg(distinct kind, ',') from public.family_events));
reset role;
-- removing a child never re-tags its rows to a sibling
insert into public.children (family_id, first_name) select family_id, 'Zed' from public.children limit 1;
insert into public.edu_grades (user_id, student_id, captured_at, term, course_key, course, percent, child_id) select :P,'11111111-0000-0000-0000-000000000001', now()+interval '9 min','Q2','zed','Zed class',70, id from public.children where first_name = 'Zed';
delete from public.children where first_name = 'Zed';
select pg_temp.ok((select child_id is null from public.edu_grades where course_key = 'zed'), 'removed child''s rows become untagged (not given to a sibling)');
\echo ALL TESTS DONE
