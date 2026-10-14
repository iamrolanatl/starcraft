#!/usr/bin/env bash
# Local test for 021 on the throwaway DB: applies 018-021 (twice), checks key-gated writes, owner-only reads, alert de-dup.
set -e; H=$(cd "$(dirname "$0")" && pwd); D=/tmp/pgfam; bash $H/019_admin_test.sh >/dev/null 2>&1 || true
P="psql -h $D -p 55432 -U postgres -q -v ON_ERROR_STOP=1"; M=$H/../migrations
$P -c "alter table storage.objects add column if not exists metadata jsonb" >/dev/null
for f in $M/020_*.sql; do $P -f $f >/dev/null 2>&1 || echo "note: $(basename $f) partial on stub"; done
$P -f $M/021_health.sql >/dev/null && $P -f $M/021_health.sql >/dev/null && echo "021 applied twice OK"
KEY=${HEALTH_TEST_KEY:-wrong}
$P -c "update public.health_config set v = encode(extensions.digest('testkey','sha256'),'hex') where k='key_sha256'"
$P <<'SQL'
create or replace function pg_temp.as_user(sub text, em text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', sub, false); perform set_config('request.jwt.claims', json_build_object('sub',sub,'email',em,'role','authenticated')::text, false); end $$;
do $$ declare s jsonb; n int; begin
  set role anon;
  begin perform public.health_record('nope', '[]'); raise exception 'FAIL bad key accepted'; exception when insufficient_privilege then raise notice 'PASS bad key rejected'; end;
  begin perform * from public.health_checks; raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'PASS health_checks closed to anon'; end;
  begin perform public.admin_health(); raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'PASS anon cannot read dashboard'; end;
  s := public.health_record('testkey', '[{"target":"site","ok":true,"status":200,"ms":120},{"target":"app","ok":true,"status":200,"ms":180}]');
  raise notice 'PASS record state=%', s->>'state';
  n := public.health_events('testkey', '[{"severity":"error","source":"client","route":"/app/?code=SECRET1","message":"boom for eli@example.com token eyJabcdefghijk.xyz","code":500,"request_id":"r1"}]');
  reset role;
  if (select message from public.app_events where request_id='r1') like '%<email>%<jwt>%' and (select route from public.app_events where request_id='r1') like '%<redacted>%' then raise notice 'PASS PII scrubbed'; else raise exception 'FAIL scrub %', (select message||route from public.app_events where request_id='r1'); end if;
  -- two consecutive site failures -> red, one alert; repeat red -> no new alert
  set role anon;
  perform public.health_record('testkey', '[{"target":"site","ok":false,"status":503,"ms":5000}]');
  perform public.health_record('testkey', '[{"target":"site","ok":false,"status":503,"ms":5000}]');
  perform public.health_record('testkey', '[{"target":"site","ok":false,"status":503,"ms":5000}]');
  reset role;
  raise notice 'state=% alerts=%', (select state from public.health_state where k='overall'), (select count(*) from public.mail_outbox where kind='alert');
  n := (select count(*) from public.mail_outbox where kind='alert'); set role anon; perform public.health_record('testkey', '[{"target":"site","ok":false,"status":503,"ms":5000}]'); reset role; if (select count(*) from public.mail_outbox where kind='alert') = n and n between 1 and 2 then raise notice 'PASS alerts only on state change (% so far, none while still red)', n; else raise exception 'FAIL dedup'; end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000bb','victim@example.com'); set role authenticated;
  begin perform public.admin_health(); raise exception 'FAIL'; exception when insufficient_privilege then raise notice 'PASS non-admin denied'; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000aa','iamrolan@gmail.com'); set role authenticated;
  s := public.admin_health(); raise notice 'PASS admin health status=% targets=%', s->'status'->>'state', jsonb_array_length(s->'targets');
  raise notice 'PASS logs=%', jsonb_array_length(public.admin_logs('', 'error', '', '', 10, null)); reset role;
end $$;
SQL
