-- 021 Health dashboard: synthetic checks (5-min cron worker), app events / error log, usage snapshots, status + de-duplicated alerts.
-- Run in Supabase Dashboard > SQL Editor after 019 (admin) and 018 (support / outbox kind). Idempotent.
-- Writes come ONLY through health_record()/health_events(), which need a server-held key (sha256 below; the raw key lives
-- only in the Pages secret HEALTH_KEY and the crystal-health worker secret). Reads are owner-only via admin_guard().
create table if not exists public.health_config (k text primary key, v text not null);
alter table public.health_config enable row level security; revoke all on public.health_config from anon, authenticated;
insert into public.health_config(k, v) values ('key_sha256', 'a262fcf2d2f8cc7726a589aebf36fd5beabf04e3a3cda1157bd0bfa63f75cfd2') on conflict (k) do update set v = excluded.v;

create table if not exists public.health_checks (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  target text not null check (target ~ '^[a-z0-9_:.-]{1,40}$'), kind text not null default 'route', ok boolean not null,
  status int, ms int, detail text check (length(detail) <= 300));
create index if not exists health_checks_t on public.health_checks(target, at desc);
create index if not exists health_checks_at on public.health_checks(at desc);
create table if not exists public.app_events (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  severity text not null check (severity in ('debug','info','warn','error','critical','security')),
  source text not null check (source ~ '^[a-z_]{2,20}$'),           -- client, api, cron, auth, ratelimit, admin
  route text check (length(route) <= 120), code int, message text check (length(message) <= 500),
  request_id text check (length(request_id) <= 64), meta jsonb not null default '{}'::jsonb);
create index if not exists app_events_at on public.app_events(at desc);
create index if not exists app_events_rid on public.app_events(request_id);
create table if not exists public.health_snapshots (k text primary key, at timestamptz not null default now(), v jsonb not null);
create table if not exists public.health_state (k text primary key, state text not null, since timestamptz not null default now(), detail jsonb, alerted_at timestamptz);
do $$ declare t text; begin foreach t in array array['health_checks','app_events','health_snapshots','health_state'] loop
  execute format('alter table public.%I enable row level security', t); execute format('revoke all on public.%I from anon, authenticated', t); end loop; end $$;

-- allow 'alert' self-notifications on the outbox (018 allowed only 'support')
do $$ begin
  if to_regclass('public.mail_outbox') is not null then
    alter table public.mail_outbox add column if not exists kind text;
    alter table public.mail_outbox drop constraint if exists mail_outbox_kind_chk;
    alter table public.mail_outbox add constraint mail_outbox_kind_chk check (kind is null or kind = 'invite' or (kind in ('support','alert') and lower("to") = 'iamrolan@gmail.com'));
  end if; end $$;

create or replace function public.health_key_ok(p_key text) returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') = (select v from public.health_config where k = 'key_sha256') $$;
create or replace function public.health_scrub(s text) returns text language sql immutable as $$
  select left(regexp_replace(regexp_replace(regexp_replace(coalesce(s, ''),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<email>', 'g'),
    'eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+){0,2}', '<jwt>', 'g'),
    '([?&](code|token|key|access_token|refresh_token)=)[^&\s]+', '\1<redacted>', 'gi'), 500) $$;

create or replace function public.health_events(p_key text, p_events jsonb) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; begin
  if not public.health_key_ok(p_key) then raise exception 'bad_key' using errcode = '42501'; end if;
  insert into public.app_events(severity, source, route, code, message, request_id, meta)
  select coalesce(e ->> 'severity', 'info'), left(coalesce(e ->> 'source', 'api'), 20), left(public.health_scrub(e ->> 'route'), 120), nullif(e ->> 'code', '')::int,
    public.health_scrub(e ->> 'message'), left(e ->> 'request_id', 64), coalesce(e -> 'meta', '{}') - array['email','token','authorization','cookie']
  from (select * from jsonb_array_elements(case when jsonb_typeof(p_events) = 'array' then p_events else '[]' end) limit 50) x(e);
  get diagnostics n = row_count;
  if random() < 0.02 then delete from public.app_events where at < now() - interval '30 days'; end if;
  return n; end $$;

-- Overall status: red / yellow / green with reasons
create or replace function public.health_status() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare red text[] := '{}'; yel text[] := '{}'; r record; u jsonb; q jsonb;
begin
  for r in select target, kind, (array_agg(ok order by at desc, id desc))[1:2] last2, max(at) last_at from public.health_checks where at > now() - interval '30 minutes' group by 1, 2 loop
    if r.last2[1] = false and coalesce(r.last2[2], false) = false then
      if r.target in ('site','app','supabase_rest','supabase_auth','api_admin') then red := red || (r.target || ' down'); else yel := yel || (r.target || ' failing'); end if;
    elsif r.last2[1] = false then yel := yel || (r.target || ' flapping'); end if; end loop;
  if not exists (select 1 from public.health_checks where at > now() - interval '15 minutes') then yel := yel || 'no health checks in 15 min (cron?)'::text; end if;
  if (select count(*) from public.app_events where at > now() - interval '1 hour' and code >= 500) >= 20 then red := red || '5xx spike (>=20 in 1h)'::text;
  elsif (select count(*) from public.app_events where at > now() - interval '1 hour' and code >= 500) >= 5 then yel := yel || '5xx elevated'::text; end if;
  select v into u from public.health_snapshots where k = 'quotas';
  if u is not null then for q in select * from jsonb_array_elements(u -> 'items') loop
    if (q ->> 'pct')::numeric >= 90 then red := red || ((q ->> 'name') || ' ' || (q ->> 'pct') || '%'); elsif (q ->> 'pct')::numeric >= 70 then yel := yel || ((q ->> 'name') || ' ' || (q ->> 'pct') || '%'); end if; end loop; end if;
  if pg_database_size(current_database()) >= 0.9 * 500 * 1024 * 1024 then red := red || 'database size >=90% of 500 MB'::text;
  elsif pg_database_size(current_database()) >= 0.7 * 500 * 1024 * 1024 then yel := yel || 'database size >=70% of 500 MB'::text; end if;
  if to_regclass('public.edu_sync_runs') is not null and coalesce(public.admin_max_ts('edu_sync_runs'), 'epoch') < now() - interval '36 hours' then yel := yel || 'school sync stale >36h'::text; end if;
  return jsonb_build_object('state', case when cardinality(red) > 0 then 'red' when cardinality(yel) > 0 then 'yellow' else 'green' end, 'red', to_jsonb(red), 'yellow', to_jsonb(yel), 'at', now());
exception when undefined_column then return jsonb_build_object('state', 'yellow', 'red', '[]'::jsonb, 'yellow', jsonb_build_array('status calc: schema mismatch'), 'at', now()); end $$;

create or replace function public.health_record(p_key text, p_checks jsonb, p_snapshots jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb; prev public.health_state; owner uuid; sk text;
begin
  if not public.health_key_ok(p_key) then raise exception 'bad_key' using errcode = '42501'; end if;
  insert into public.health_checks(target, kind, ok, status, ms, detail)
  select left(c ->> 'target', 40), coalesce(c ->> 'kind', 'route'), coalesce((c ->> 'ok')::boolean, false), nullif(c ->> 'status', '')::int, nullif(c ->> 'ms', '')::int, left(public.health_scrub(c ->> 'detail'), 300)
  from (select * from jsonb_array_elements(case when jsonb_typeof(p_checks) = 'array' then p_checks else '[]' end) limit 60) x(c);
  for sk in select jsonb_object_keys(coalesce(p_snapshots, '{}')) loop
    insert into public.health_snapshots(k, at, v) values (left(sk, 40), now(), p_snapshots -> sk) on conflict on constraint health_snapshots_pkey do update set at = now(), v = excluded.v; end loop;
  if random() < 0.01 then delete from public.health_checks where at < now() - interval '35 days'; end if;
  s := public.health_status(); select * into prev from public.health_state hs where hs.k = 'overall';
  if prev.k is null then insert into public.health_state(k, state, detail) values ('overall', s ->> 'state', s);
  elsif prev.state is distinct from s ->> 'state' then
    update public.health_state set state = s ->> 'state', since = now(), detail = s,
      alerted_at = case when prev.alerted_at is null or prev.alerted_at < now() - interval '10 minutes' or s ->> 'state' = 'red' then now() else health_state.alerted_at end where health_state.k = 'overall';
    -- alert only on a state change, and at most once per 10 min unless escalating to red
    if (prev.alerted_at is null or prev.alerted_at < now() - interval '10 minutes' or s ->> 'state' = 'red') and to_regclass('public.mail_outbox') is not null then
      select id into owner from auth.users where lower(email) = 'iamrolan@gmail.com';
      if owner is not null then
        execute 'insert into public.mail_outbox(user_id, "to", subject, body, status, kind) values ($1, ''iamrolan@gmail.com'', $2, $3, ''queued'', ''alert'')' using owner,
          format('Crystal health: %s → %s', upper(prev.state), upper(s ->> 'state')),
          format(E'Crystal status changed from %s to %s at %s ET.\n\nRed: %s\nYellow: %s\n\nDashboard: https://crystal-7ot.pages.dev/admin/?tab=HEALTH',
            prev.state, s ->> 'state', to_char(now() at time zone 'America/New_York', 'Mon DD HH12:MI AM'), coalesce(nullif(s ->> 'red', '[]'), 'none'), coalesce(nullif(s ->> 'yellow', '[]'), 'none'));
      end if; end if;
    insert into public.app_events(severity, source, message, meta) values (case s ->> 'state' when 'red' then 'critical' when 'yellow' then 'warn' else 'info' end, 'cron', 'status ' || prev.state || ' -> ' || (s ->> 'state'), s);
  end if;
  return s; end $$;

-- Owner dashboard payload
create or replace function public.admin_health() returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare j jsonb; begin perform public.admin_guard();
  select jsonb_build_object(
    'status', public.health_status(),
    'targets', (select coalesce(jsonb_agg(t order by t.kind, t.target), '[]') from (
      select target, kind,
        (array_agg(ok order by at desc))[1] as ok, (array_agg(status order by at desc))[1] as status, (array_agg(detail order by at desc))[1] as detail, max(at) as last_at,
        percentile_cont(.5) within group (order by ms) filter (where at > now() - interval '24 hours') as p50,
        percentile_cont(.95) within group (order by ms) filter (where at > now() - interval '24 hours') as p95,
        round(100.0 * count(*) filter (where ok and at > now() - interval '24 hours') / nullif(count(*) filter (where at > now() - interval '24 hours'), 0), 2) as up_24h,
        round(100.0 * count(*) filter (where ok and at > now() - interval '7 days') / nullif(count(*) filter (where at > now() - interval '7 days'), 0), 2) as up_7d,
        round(100.0 * count(*) filter (where ok) / nullif(count(*), 0), 2) as up_30d,
        (select coalesce(jsonb_agg(jsonb_build_array(extract(epoch from b.at)::bigint, b.ms, b.ok) order by b.at), '[]') from (select at, ms, ok from public.health_checks h2 where h2.target = h.target and h2.at > now() - interval '24 hours' order by at desc limit 288) b) as series
      from public.health_checks h where at > now() - interval '30 days' group by target, kind) t),
    'incidents', (select coalesce(jsonb_agg(i order by i.started desc), '[]') from (
      select target, min(at) started, max(at) last_fail, count(*) checks, (array_agg(detail order by at desc))[1] detail from (
        select *, sum(case when ok then 1 else 0 end) over (partition by target order by at) grp from public.health_checks where at > now() - interval '30 days') x
      where not ok group by target, grp order by min(at) desc limit 50) i),
    'errors_by_route', (select coalesce(jsonb_agg(e), '[]') from (select coalesce(route, '?') route, code, source, count(*) n, max(at) last from public.app_events
      where at > now() - interval '24 hours' and (code >= 400 or severity in ('error','critical')) group by 1, 2, 3 order by n desc limit 40) e),
    'errors_hourly', (select coalesce(jsonb_agg(jsonb_build_array(extract(epoch from h)::bigint, c4, c5, cj) order by h), '[]') from (
      select date_trunc('hour', at) h, count(*) filter (where code between 400 and 499) c4, count(*) filter (where code >= 500) c5, count(*) filter (where source = 'client') cj
      from public.app_events where at > now() - interval '24 hours' group by 1) e),
    'snapshots', (select coalesce(jsonb_object_agg(k, v || jsonb_build_object('_at', at)), '{}') from public.health_snapshots),
    'db', jsonb_build_object('size_bytes', pg_database_size(current_database()), 'limit_bytes', 500 * 1024 * 1024,
      'connections', (select count(*) from pg_stat_activity), 'max_connections', current_setting('max_connections')::int,
      'auth_users', (select count(*) from auth.users), 'mau_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
      'storage_bytes', case when to_regclass('storage.objects') is null then null else (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects) end,
      'buckets', case when to_regclass('storage.objects') is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'objects', n, 'bytes', b)), '[]') from (select bucket_id, count(*) n, coalesce(sum((metadata ->> 'size')::bigint), 0) b from storage.objects group by 1) s) end,
      'top_tables', (select jsonb_agg(jsonb_build_object('name', relname, 'bytes', pg_total_relation_size(relid), 'rows', n_live_tup) order by pg_total_relation_size(relid) desc) from (select * from pg_stat_user_tables where schemaname = 'public' order by pg_total_relation_size(relid) desc limit 12) t)),
    'pipeline', jsonb_build_object(
      'school', public.admin_recent('edu_sync_runs', 5), 'ext', (select coalesce(jsonb_agg(x), '[]') from (select distinct on (source, kind) source, kind, status, coalesce(to_jsonb(r) ->> 'finished_at', to_jsonb(r) ->> 'created_at') last, to_jsonb(r) ->> 'pulled' pulled from public.ext_sync_runs r order by source, kind, id desc) x),
      'crystal_sync', case when to_regclass('public.sync_runs') is null then null else (select coalesce(jsonb_agg(x), '[]') from (select distinct on (child_id) child_id, status, finished_at, requested_at, counts, error from public.sync_runs order by child_id, requested_at desc) x) end,
      'devices', case when to_regclass('public.sync_devices') is null then null else (select jsonb_build_object('total', count(*), 'active', count(*) filter (where revoked_at is null), 'seen_1h', count(*) filter (where revoked_at is null and last_seen_at > now() - interval '1 hour'), 'revoked_7d', count(*) filter (where revoked_at > now() - interval '7 days')) from public.sync_devices) end,
      'quarantine', case when to_regclass('public.ext_quarantine') is null then null else (select count(*) from public.ext_quarantine) end,
      'outbox', case when to_regclass('public.mail_outbox') is null then null else (select jsonb_build_object('queued', count(*) filter (where status = 'queued'), 'failed', count(*) filter (where status = 'failed'), 'oldest_queued', min(queued_at) filter (where status = 'queued')) from public.mail_outbox) end,
      'support_open', case when to_regclass('public.support_tickets') is null then null else (select count(*) from public.support_tickets where status <> 'closed') end,
      'gmail_last', public.admin_max_ts('mail_messages'), 'calendar_last', public.admin_max_ts('ext_sync_runs'),
      'deltas_24h', (select jsonb_object_agg(t, public.admin_count_since(t)) from unnest(array['edu_grades','edu_assignments','edu_attendance','edu_calendar','ext_items','mail_messages','tasks','app_events']) t where to_regclass('public.' || t) is not null)),
    'security', jsonb_build_object(
      'failed_logins_24h', (select count(*) from public.app_events where source = 'auth' and at > now() - interval '24 hours'),
      'rate_limited_24h', (select count(*) from public.app_events where (source = 'ratelimit' or code = 429) and at > now() - interval '24 hours'),
      'forbidden_24h', (select count(*) from public.app_events where code in (401, 403) and at > now() - interval '24 hours'),
      'admin_actions_24h', (select count(*) from public.admin_audit where at > now() - interval '24 hours'),
      'admin_recent', (select coalesce(jsonb_agg(jsonb_build_object('at', at, 'action', action, 'actor', actor_email)), '[]') from (select * from public.admin_audit order by at desc limit 8) a),
      'revoked_devices_7d', case when to_regclass('public.sync_devices') is null then null else (select count(*) from public.sync_devices where revoked_at > now() - interval '7 days') end),
    'state', (select to_jsonb(s) from public.health_state s where k = 'overall'),
    'at', now()) into j; return j; end $$;

create or replace function public.admin_max_ts(t text) returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare c text; r timestamptz; begin if to_regclass('public.' || quote_ident(t)) is null then return null; end if; c := public.admin_tscol(t);
  if c is null then return null; end if; execute format('select max(%I)::timestamptz from public.%I', c, t) into r; return r; end $$;
create or replace function public.admin_count_since(t text) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare c text; n bigint; begin
  select column_name into c from information_schema.columns where table_schema = 'public' and table_name = t and column_name in ('created_at','at','synced_at','fetched_at','queued_at') limit 1;
  if c is null then return null; end if; execute format('select count(*) from public.%I where %I > now() - interval ''24 hours''', t, c) into n; return n; end $$;

create or replace function public.admin_logs(p_q text default '', p_sev text default '', p_src text default '', p_rid text default '', p_limit int default 200, p_before bigint default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j jsonb; begin perform public.admin_guard();
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') into j from (select * from public.app_events
    where (coalesce(p_q, '') = '' or message ilike '%' || p_q || '%' or route ilike '%' || p_q || '%')
      and (coalesce(p_sev, '') = '' or severity = p_sev) and (coalesce(p_src, '') = '' or source = p_src)
      and (coalesce(p_rid, '') = '' or request_id = p_rid) and (p_before is null or id < p_before)
    order by id desc limit least(greatest(p_limit, 1), 500)) e; return j; end $$;

revoke all on function public.health_key_ok(text), public.health_status(), public.admin_count_since(text), public.admin_max_ts(text) from public, anon, authenticated;
revoke all on function public.health_events(text, jsonb), public.health_record(text, jsonb, jsonb), public.admin_health(), public.admin_logs(text, text, text, text, int, bigint) from public;
grant execute on function public.health_events(text, jsonb), public.health_record(text, jsonb, jsonb) to anon, authenticated;
revoke all on function public.admin_health(), public.admin_logs(text, text, text, text, int, bigint) from anon;
grant execute on function public.admin_health(), public.admin_logs(text, text, text, text, int, bigint) to authenticated;
notify pgrst, 'reload schema';
