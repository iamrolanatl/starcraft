\set ON_ERROR_STOP 0
\set QUIET 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111','iamrolan@gmail.com'),('22222222-2222-2222-2222-222222222222','other@x.com');
-- service role seeds
set role service_role; select set_config('request.jwt.claim.role','service_role',false);
insert into mail_messages(user_id,gmail_id,thread_id,"from",subject,school_tag) values ('11111111-1111-1111-1111-111111111111','g1','t1','Ms. Sparks <sparks@cobbk12.org>','Math test','teacher'),('22222222-2222-2222-2222-222222222222','g2','t2','x@cobbk12.org','other','teacher');
insert into mail_outbox(user_id,thread_id,in_reply_to,"to",subject,body,status,drafted_by,draft_original) values ('11111111-1111-1111-1111-111111111111','t1','g1','sparks@cobbk12.org','Re: Math test','Hello Ms. Sparks, thank you so much for reaching out.','draft','crystal','Hello Ms. Sparks, thank you so much for reaching out.');
insert into storage.objects(bucket_id,name) values ('mail','11111111-1111-1111-1111-111111111111/g1/a.pdf'),('mail','22222222-2222-2222-2222-222222222222/g2/b.pdf');
reset role;
\echo == anon sees nothing
set role anon; select set_config('request.jwt.claim.role','anon',false), set_config('request.jwt.claim.sub','',false) \g /dev/null
select 'anon_msgs='||count(*) from mail_messages; select 'anon_outbox='||count(*) from mail_outbox; select 'anon_objs='||count(*) from storage.objects where bucket_id='mail';
reset role;
\echo == user 1
set role authenticated; select set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \g /dev/null
select 'u1_msgs='||count(*) from mail_messages; select 'u1_objs='||count(*) from storage.objects where bucket_id='mail';
update mail_messages set is_read=true where gmail_id='g1'; select 'u1_read='||is_read from mail_messages where gmail_id='g1';
\echo expect error: changing subject
update mail_messages set subject='hacked' where gmail_id='g1';
\echo expect 0 rows: other user msg
update mail_messages set is_read=true where gmail_id='g2';
\echo expect error: insert as sent
insert into mail_outbox("to",subject,body,status) values ('a@b.co','x','y','sent');
\echo expect error: insert fake crystal draft
insert into mail_outbox("to",subject,body,status,drafted_by) values ('a@b.co','x','y','queued','crystal');
insert into mail_outbox("to",cc,subject,body) values ('sparks@cobbk12.org',null,'Re: hi','Thanks!') returning 'u1_insert_status='||status;
\echo expect error: user sets sent
update mail_outbox set status='sent', sent_gmail_id='zz' where body='Thanks!';
update mail_outbox set status='cancelled' where body='Thanks!' returning 'u1_cancel='||status;
\echo expect error: un-cancel
update mail_outbox set status='queued' where body='Thanks!';
\echo == draft edit + send records a style edit
update mail_outbox set regen_requested=true where drafted_by='crystal' returning 'regen='||regen_requested;
\echo expect error: change draft_original
update mail_outbox set draft_original='x' where drafted_by='crystal';
update mail_outbox set body=E'Hi Ms. Sparks,\nThanks. We will review tonight.\nRolan' , status='queued' where drafted_by='crystal' returning 'draft_sent='||status||' regen='||regen_requested;
select 'style_edits='||count(*) from mail_style_edits;
\echo expect error: user calls claim
select * from mail_outbox_claim(5);
reset role;
\echo == user 2 isolation
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false) \g /dev/null
select 'u2_outbox='||count(*) from mail_outbox; select 'u2_style='||count(*) from mail_style_edits; select 'u2_objs='||count(*) from storage.objects where bucket_id='mail';
reset role;
\echo == service claim / mark
set role service_role; select set_config('request.jwt.claim.role','service_role',false) \g /dev/null
insert into mail_outbox(user_id,"to",subject,body) values ('11111111-1111-1111-1111-111111111111','a@b.co','s','b');
select 'claim1='||count(*) from mail_outbox_claim(10);
select 'claim2='||count(*) from mail_outbox_claim(10);
select 'drafts_never_claimed='||count(*) from mail_outbox where status='draft';
update mail_outbox set status='sent', sent_gmail_id='sg1', sent_at=now() where status='sending' and "to"='a@b.co' returning 'marked='||status;
reset role;
