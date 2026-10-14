#!/usr/bin/env bash
# Local test for 019: builds on run_local.sh's DB, applies 018+019 twice, checks admin guard + actions.
set -e; H=$(cd "$(dirname "$0")" && pwd); D=/tmp/pgfam; bash $H/run_local.sh >/dev/null 2>&1 || true
P="psql -h $D -p 55432 -U postgres -q -v ON_ERROR_STOP=1"
$P -c "alter table auth.users add column if not exists created_at timestamptz default now(), add column if not exists last_sign_in_at timestamptz, add column if not exists banned_until timestamptz, add column if not exists email_confirmed_at timestamptz, add column if not exists raw_app_meta_data jsonb;
 create table if not exists auth.sessions(id uuid default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz, not_after timestamptz, user_agent text);"
[ -f $H/../migrations/018_support.sql ] && $P -f $H/../migrations/018_support.sql >/dev/null 2>&1 || true
$P -f $H/../migrations/019_admin.sql >/dev/null && $P -f $H/../migrations/019_admin.sql >/dev/null && echo "019 applied twice OK"
$P <<'SQL'
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000aa','iamrolan@gmail.com'),('00000000-0000-0000-0000-0000000000bb','victim@example.com') on conflict do nothing;
insert into auth.sessions(user_id) values ('00000000-0000-0000-0000-0000000000bb');
create or replace function pg_temp.as_user(sub text, em text, r text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', json_build_object('sub',sub,'email',em,'role',r)::text, false); end $$;
do $$ declare ok boolean; begin
  -- anon: no execute
  set role anon; begin perform public.admin_overview(); raise exception 'FAIL anon allowed'; exception when insufficient_privilege then raise notice 'PASS anon denied'; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000bb','victim@example.com','authenticated');
  set role authenticated; begin perform public.admin_overview(); raise exception 'FAIL non-admin allowed'; exception when insufficient_privilege then raise notice 'PASS non-admin denied'; end;
  begin perform public.admin_guard(); raise exception 'FAIL guard callable'; exception when insufficient_privilege then raise notice 'PASS guard not directly callable'; end;
  begin perform * from public.admin_audit; raise exception 'FAIL audit readable'; exception when insufficient_privilege then raise notice 'PASS audit table closed'; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000aa','iamrolan@gmail.com','authenticated');
  set role authenticated;
  raise notice 'PASS admin overview users=%', public.admin_overview()->>'users';
  raise notice 'PASS tables=%', jsonb_array_length(public.admin_tables());
  perform public.admin_browse('family_invites'); perform public.admin_table_info('children'); perform public.admin_sync(); perform public.admin_user_detail('00000000-0000-0000-0000-0000000000bb');
  begin perform public.admin_action('disable','00000000-0000-0000-0000-0000000000bb','{}','wrong'); raise exception 'FAIL no confirm'; exception when others then if sqlerrm like 'confirm_mismatch%' then raise notice 'PASS confirm required'; else raise; end if; end;
  perform public.admin_action('disable','00000000-0000-0000-0000-0000000000bb','{}','victim@example.com');
  begin perform public.admin_action('hard_delete','00000000-0000-0000-0000-0000000000bb','{}','victim@example.com'); raise exception 'FAIL hard w/o soft'; exception when others then if sqlerrm like 'soft_delete_first%' then raise notice 'PASS hard delete needs soft delete'; else raise; end if; end;
  begin perform public.admin_action('disable','00000000-0000-0000-0000-0000000000aa','{}','iamrolan@gmail.com'); raise exception 'FAIL self'; exception when others then if sqlerrm = 'cannot_target_self' then raise notice 'PASS cannot disable self'; else raise; end if; end;
  begin perform public.admin_row_update('admins','x','{}','EDIT'); raise exception 'FAIL'; exception when others then if sqlerrm='table_not_editable' then raise notice 'PASS non-whitelisted edit blocked'; else raise; end if; end;
  reset role;
  if (select banned_until from auth.users where email='victim@example.com') = 'infinity' and not exists(select 1 from auth.sessions where user_id='00000000-0000-0000-0000-0000000000bb') then raise notice 'PASS disabled + sessions cleared'; else raise exception 'FAIL disable'; end if;
  raise notice 'PASS audit rows=%', (select count(*) from public.admin_audit);
end $$;
SQL
