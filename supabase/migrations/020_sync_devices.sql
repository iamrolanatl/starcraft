-- Crystal 020: Crystal Sync devices (least privilege). Safe to re-run. Run after 017 (018/019 optional).
-- A parent creates a short-lived single-use PAIRING CODE in Crystal. The installed Crystal Sync app
-- exchanges it (via /api/sync/*) for a DEVICE KEY. Only sha256(key) is stored. A device key can ONLY:
--   poll its own commands, start/finish/log its own runs, and upload school rows for the child_ids it was
--   paired to. It cannot read any family data. Revocable, rotatable, rate-limited; every upload is logged.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.sync_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  code_hash bytea not null unique, hint text,
  child_ids uuid[] not null check (cardinality(child_ids) between 1 and 10),
  created_by uuid not null, created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz, device_id uuid);

create table if not exists public.sync_devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text check (char_length(name) <= 80), platform text check (char_length(platform) <= 40), agent_version text check (char_length(agent_version) <= 20),
  key_hash bytea not null unique, key_hint text,
  child_ids uuid[] not null,
  created_by uuid, created_at timestamptz not null default now(),
  last_seen_at timestamptz, rotated_at timestamptz, revoked_at timestamptz, revoked_by uuid,
  rate_n int not null default 0, rate_win timestamptz not null default now(),
  uploads_n int not null default 0, uploads_win timestamptz not null default now());

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  device_id uuid references public.sync_devices(id) on delete set null,
  trigger text not null default 'schedule' check (trigger in ('schedule','manual','first_run')),
  status text not null default 'queued' check (status in ('queued','running','ok','failed','quarantined','expired')),
  requested_by uuid, requested_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb, error text check (char_length(error) <= 2000));
create index if not exists sync_runs_child on public.sync_runs (child_id, requested_at desc);
create index if not exists sync_runs_queue on public.sync_runs (family_id, status) where status = 'queued';

create table if not exists public.sync_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.sync_runs(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  device_id uuid, at timestamptz not null default now(),
  level text not null default 'info' check (level in ('debug','info','warn','error','ok')),
  step text check (char_length(step) <= 30), msg text not null check (char_length(msg) <= 1000));
create index if not exists sync_logs_run on public.sync_logs (run_id, id);

alter table public.sync_runs add column if not exists slot timestamptz;
alter table public.sync_runs add column if not exists target_device uuid;
-- Leader lease: one ParentVUE login per family per scheduled slot, even with several paired computers.
create table if not exists public.sync_leases (
  family_id uuid not null references public.families(id) on delete cascade,
  slot timestamptz not null,
  device_id uuid references public.sync_devices(id) on delete set null,
  claimed_at timestamptz not null default now(), takeovers int not null default 0, done_at timestamptz,
  primary key (family_id, slot));

create table if not exists public.sync_pair_attempts (ip text primary key, failures int not null default 0, win timestamptz not null default now());

-- ---------- RLS: family owner reads its own devices/runs/logs; nobody writes directly ----------
do $$ declare t text; begin
  foreach t in array array['sync_pairing_codes','sync_devices','sync_runs','sync_logs','sync_pair_attempts','sync_leases'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop; end $$;
grant select (id, family_id, name, platform, agent_version, key_hint, child_ids, created_at, last_seen_at, rotated_at, revoked_at) on public.sync_devices to authenticated;
grant select on public.sync_runs, public.sync_logs, public.sync_leases to authenticated;
drop policy if exists "sync leases owner" on public.sync_leases;
create policy "sync leases owner" on public.sync_leases for select to authenticated using (family_id = (select public.my_family_id()));
grant select (id, family_id, hint, child_ids, created_at, expires_at, used_at, device_id) on public.sync_pairing_codes to authenticated;
drop policy if exists "sync devices owner" on public.sync_devices;
create policy "sync devices owner" on public.sync_devices for select to authenticated using (family_id = (select public.my_family_id()));
drop policy if exists "sync runs owner" on public.sync_runs;
create policy "sync runs owner" on public.sync_runs for select to authenticated using (family_id = (select public.my_family_id()));
drop policy if exists "sync logs owner" on public.sync_logs;
create policy "sync logs owner" on public.sync_logs for select to authenticated using (family_id = (select public.my_family_id()));
drop policy if exists "sync codes owner" on public.sync_pairing_codes;
create policy "sync codes owner" on public.sync_pairing_codes for select to authenticated using (family_id = (select public.my_family_id()));

-- ---------- helpers ----------
create or replace function public.sync_mask(t text) returns text language sql immutable set search_path = '' as $$
  select left(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
    '((password|passwd|pwd|secret|token|apikey|api_key|authorization|cookie|key)["'']?\s*[:=]\s*["'']?)[^\s"''&,;}]+', '\1****', 'gi'),
    '<password>[^<]*</password>', '<password>****</password>', 'gi'),
    '[A-Za-z0-9_\-]{32,}', '****', 'g'), 1000) $$;

create or replace function public.sync_admin_ok() returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', '')); ok boolean := false;
begin
  if e = '' then return false; end if;
  if to_regclass('public.admins') is not null then
    execute 'select exists (select 1 from public.admins where email = $1)' into ok using e;
    return ok; end if;
  return e = 'iamrolan@gmail.com'; end $$;

-- device auth: valid, not revoked, 120 calls/min. Internal (not granted to anon).
create or replace function public.sync_device(p_key text) returns public.sync_devices
language plpgsql security definer set search_path = '' as $$
declare d public.sync_devices;
begin
  if p_key is null or p_key !~ '^csd_[0-9a-f]{64}$' then raise exception 'bad_device_key' using errcode = '28000'; end if;
  select * into d from public.sync_devices where key_hash = extensions.digest(p_key, 'sha256') for update;
  if d.id is null then raise exception 'bad_device_key' using errcode = '28000'; end if;
  if d.revoked_at is not null then raise exception 'device_revoked' using errcode = '28000'; end if;
  update public.sync_devices set last_seen_at = now(),
    rate_n = case when rate_win < now() - interval '1 minute' then 1 else rate_n + 1 end,
    rate_win = case when rate_win < now() - interval '1 minute' then now() else rate_win end
    where id = d.id returning * into d;
  if d.rate_n > 120 then raise exception 'device_rate_limited' using errcode = 'P0429'; end if;
  return d; end $$;
revoke all on function public.sync_device(text) from public, anon, authenticated;

-- primary = active device with the most recent successful run (ties: most recently seen); the rest are standby.
create or replace function public.sync_device_roles(p_family uuid) returns table (device_id uuid, role text, last_ok_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with d as (select x.id, x.last_seen_at, (select max(r.finished_at) from public.sync_runs r where r.device_id = x.id and r.status = 'ok') as ok
             from public.sync_devices x where x.family_id = p_family and x.revoked_at is null)
  select id, case when row_number() over (order by ok desc nulls last, last_seen_at desc nulls last) = 1 then 'primary' else 'standby' end, ok from d $$;
revoke all on function public.sync_device_roles(uuid) from public, anon, authenticated;

create or replace function public.sync_my_devices() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'platform', d.platform, 'agent_version', d.agent_version, 'child_ids', d.child_ids,
    'last_seen_at', d.last_seen_at, 'revoked_at', d.revoked_at, 'created_at', d.created_at, 'role', coalesce(r.role, 'revoked'), 'last_ok_at', r.last_ok_at)
    order by (r.role = 'primary') desc nulls last, d.created_at desc), '[]'::jsonb)
  from public.sync_devices d left join public.sync_device_roles(d.family_id) r on r.device_id = d.id
  where d.family_id = (select public.my_family_id()) $$;

-- ---------- parent RPCs ----------
create or replace function public.sync_pair_create(p_child_ids uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare fam uuid := public.my_family_id(); c text; b bytea; exp timestamptz; i int; n int;
begin
  if fam is null then raise exception 'add a child first' using errcode = '42501'; end if;
  if p_child_ids is null or cardinality(p_child_ids) = 0 then
    select array_agg(id order by sort, created_at) into p_child_ids from public.children where family_id = fam; end if;
  if p_child_ids is null then raise exception 'add a child first' using errcode = '22023'; end if;
  select count(*) into n from public.children where family_id = fam and id = any(p_child_ids);
  if n <> cardinality(p_child_ids) then raise exception 'not your child' using errcode = '42501'; end if;
  select count(*) into n from public.sync_pairing_codes where family_id = fam and created_at > now() - interval '1 hour';
  if n >= 10 then raise exception 'too many pairing codes, try again later' using errcode = 'P0429'; end if;
  update public.sync_pairing_codes set expires_at = now() where family_id = fam and used_at is null and expires_at > now();  -- one live code at a time
  b := extensions.gen_random_bytes(8); c := '';
  for i in 0..7 loop c := c || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1); end loop;
  insert into public.sync_pairing_codes (family_id, code_hash, hint, child_ids, created_by)
    values (fam, extensions.digest(c, 'sha256'), right(c, 2), p_child_ids, auth.uid()) returning expires_at into exp;
  return jsonb_build_object('code', left(c, 4) || '-' || right(c, 4), 'expires_at', exp, 'children', cardinality(p_child_ids));
end $$;

create or replace function public.sync_request_now(p_child uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare fam uuid := public.my_family_id(); r uuid; n int;
begin
  if fam is null or not exists (select 1 from public.children where id = p_child and family_id = fam) then raise exception 'not your child' using errcode = '42501'; end if;
  if not exists (select 1 from public.sync_devices where family_id = fam and revoked_at is null and p_child = any(child_ids)) then
    raise exception 'no Crystal Sync device is paired for this child yet' using errcode = '22023'; end if;
  update public.sync_runs set status = 'expired', finished_at = now() where child_id = p_child and status = 'queued' and requested_at < now() - interval '30 minutes';
  select id into r from public.sync_runs where child_id = p_child and status in ('queued','running') and requested_at > now() - interval '30 minutes' order by requested_at desc limit 1;
  if r is not null then return jsonb_build_object('run_id', r, 'already', true); end if;
  select count(*) into n from public.sync_runs where child_id = p_child and trigger = 'manual' and requested_at > now() - interval '1 hour';
  if n >= 6 then raise exception 'Sync Now limit reached (6 per hour)' using errcode = 'P0429'; end if;
  insert into public.sync_runs (family_id, child_id, trigger, requested_by, target_device)
    values (fam, p_child, 'manual', auth.uid(), (select x.device_id from public.sync_device_roles(fam) x join public.sync_devices d on d.id = x.device_id
                                                 where p_child = any(d.child_ids) order by (x.role = 'primary') desc, d.last_seen_at desc nulls last limit 1)) returning id into r;
  return jsonb_build_object('run_id', r, 'already', false);
end $$;

create or replace function public.sync_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  with fam as (
    select f.id, f.owner from public.families f where f.owner = (select auth.uid())
    union select f.id, f.owner from public.families f join public.family_members m on m.family_id = f.id
      where m.user_id = (select auth.uid()) and m.status = 'active')
  select coalesce(jsonb_agg(jsonb_build_object(
    'child_id', c.id, 'name', c.first_name, 'grade', c.grade,
    'devices', (select count(*) from public.sync_devices d where d.family_id = c.family_id and d.revoked_at is null and c.id = any(d.child_ids)),
    'device_seen_at', (select max(d.last_seen_at) from public.sync_devices d where d.family_id = c.family_id and d.revoked_at is null and c.id = any(d.child_ids)),
    'last_ok_at', greatest((select max(r.finished_at) from public.sync_runs r where r.child_id = c.id and r.status = 'ok'),
                           (select s.last_synced_at from public.edu_students s where s.id = c.edu_student_id)),
    'last', (select jsonb_build_object('id', r.id, 'status', r.status, 'trigger', r.trigger, 'at', coalesce(r.finished_at, r.started_at, r.requested_at), 'error', r.error)
             from public.sync_runs r where r.child_id = c.id order by r.requested_at desc limit 1)
  ) order by c.sort, c.created_at), '[]'::jsonb)
  from public.children c join fam on fam.id = c.family_id $$;

create or replace function public.sync_device_revoke(p_device uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare fam uuid;
begin
  select family_id into fam from public.sync_devices where id = p_device;
  if fam is null or not (fam = public.my_family_id() or public.sync_admin_ok()) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.sync_devices set revoked_at = coalesce(revoked_at, now()), revoked_by = auth.uid() where id = p_device;
  update public.sync_runs set status = 'expired', finished_at = now() where device_id = p_device and status in ('queued','running');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sync_admin_devices() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.sync_admin_ok() then raise exception 'admin_forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'family_id', d.family_id, 'owner_email', u.email, 'name', d.name, 'platform', d.platform,
    'agent_version', d.agent_version, 'key_hint', d.key_hint, 'child_ids', d.child_ids, 'created_at', d.created_at, 'last_seen_at', d.last_seen_at,
    'revoked_at', d.revoked_at, 'role', coalesce((select x.role from public.sync_device_roles(d.family_id) x where x.device_id = d.id), 'revoked'), 'runs_24h', (select count(*) from public.sync_runs r where r.device_id = d.id and r.requested_at > now() - interval '24 hours'),
    'last_run', (select jsonb_build_object('status', r.status, 'at', coalesce(r.finished_at, r.started_at), 'error', r.error) from public.sync_runs r where r.device_id = d.id order by r.requested_at desc limit 1))
    order by d.created_at desc), '[]'::jsonb)
    from public.sync_devices d join public.families f on f.id = d.family_id left join auth.users u on u.id = f.owner);
end $$;

-- ---------- device RPCs (anon role + device key; called only from /api/sync/*) ----------
create or replace function public.sync_pair_exchange(p_code text, p_name text, p_platform text, p_version text, p_ip text default '') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c text := public.family_norm(p_code); pc public.sync_pairing_codes; a public.sync_pair_attempts; k text; dev uuid;
begin
  insert into public.sync_pair_attempts (ip) values (coalesce(nullif(p_ip, ''), '?')) on conflict (ip) do nothing;
  select * into a from public.sync_pair_attempts where ip = coalesce(nullif(p_ip, ''), '?') for update;
  if a.win < now() - interval '15 minutes' then update public.sync_pair_attempts set failures = 0, win = now() where ip = a.ip; a.failures := 0; end if;
  if a.failures >= 10 then raise exception 'too many attempts, wait 15 minutes' using errcode = 'P0429'; end if;
  select * into pc from public.sync_pairing_codes where code_hash = extensions.digest(c, 'sha256') for update;
  if pc.id is null or pc.used_at is not null or pc.expires_at < now() then
    update public.sync_pair_attempts set failures = failures + 1 where ip = a.ip;
    return jsonb_build_object('error', 'That pairing code is wrong, used, or expired. Create a new one in Crystal > Downloads.'); end if;
  k := 'csd_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.sync_devices (family_id, name, platform, agent_version, key_hash, key_hint, child_ids, created_by)
    values (pc.family_id, left(coalesce(nullif(trim(p_name), ''), 'Crystal Sync'), 80), left(p_platform, 40), left(p_version, 20),
            extensions.digest(k, 'sha256'), right(k, 4), pc.child_ids, pc.created_by) returning id into dev;
  update public.sync_pairing_codes set used_at = now(), device_id = dev where id = pc.id;
  insert into public.family_events (family_id, actor, kind, detail) values (pc.family_id, pc.created_by, 'sync_paired', jsonb_build_object('device', dev, 'platform', left(p_platform, 40)));
  return jsonb_build_object('device_id', dev, 'device_key', k,
    'children', (select jsonb_agg(jsonb_build_object('id', id, 'name', first_name, 'grade', grade, 'school', school, 'student_id', student_id)) from public.children where id = any(pc.child_ids)));
end $$;

create or replace function public.sync_rotate(p_key text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.sync_devices := public.sync_device(p_key); k text := 'csd_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  update public.sync_devices set key_hash = extensions.digest(k, 'sha256'), key_hint = right(k, 4), rotated_at = now() where id = d.id;
  return jsonb_build_object('device_key', k); end $$;

create or replace function public.sync_poll(p_key text, p_version text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.sync_devices := public.sync_device(p_key); cmds jsonb;
begin
  if p_version is not null then update public.sync_devices set agent_version = left(p_version, 20) where id = d.id; end if;
  update public.sync_runs set status = 'expired', finished_at = now() where family_id = d.family_id and child_id = any(d.child_ids) and status = 'queued' and requested_at < now() - interval '30 minutes';
  select coalesce(jsonb_agg(jsonb_build_object('run_id', id, 'child_id', child_id, 'trigger', trigger) order by requested_at), '[]'::jsonb) into cmds
    from public.sync_runs r where r.family_id = d.family_id and r.child_id = any(d.child_ids) and r.status = 'queued'
      and (r.target_device is null or r.target_device = d.id or r.requested_at < now() - interval '2 minutes'
           or not exists (select 1 from public.sync_devices t where t.id = r.target_device and t.revoked_at is null and t.last_seen_at > now() - interval '2 minutes'));
  return jsonb_build_object('device_id', d.id, 'commands', cmds,
    'children', (select jsonb_agg(jsonb_build_object('id', id, 'name', first_name, 'grade', grade)) from public.children where id = any(d.child_ids)));
end $$;

create or replace function public.sync_run_start(p_key text, p_child uuid, p_run uuid default null, p_trigger text default 'schedule', p_slot timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.sync_devices := public.sync_device(p_key); r uuid;
begin
  if not (p_child = any(d.child_ids)) then raise exception 'child not paired to this device' using errcode = '42501'; end if;
  if p_run is not null then
    update public.sync_runs set status = 'running', started_at = now(), device_id = d.id
      where id = p_run and child_id = p_child and family_id = d.family_id and status = 'queued' returning id into r;
    if r is null then raise exception 'command not found or already taken' using errcode = '22023'; end if;
  else
    if p_slot is not null and not exists (select 1 from public.sync_leases where family_id = d.family_id and slot = p_slot and device_id = d.id and done_at is null) then
      raise exception 'not the leader for this slot' using errcode = '42501'; end if;
    insert into public.sync_runs (family_id, child_id, device_id, trigger, status, started_at, slot)
      values (d.family_id, p_child, d.id, case when p_trigger in ('schedule','first_run') then p_trigger else 'schedule' end, 'running', now(), p_slot) returning id into r;
  end if;
  return jsonb_build_object('run_id', r); end $$;

-- Leader lease for a scheduled slot (05:40 / 17:40 local). First claimer wins and is the only device that logs in to
-- ParentVUE. If the leader hasn't finished within 10 minutes of claiming, the next claimer takes over (counted in takeovers).
create or replace function public.sync_claim(p_key text, p_slot timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.sync_devices := public.sync_device(p_key); l public.sync_leases;
begin
  if p_slot is null or p_slot > now() + interval '5 minutes' or p_slot < now() - interval '12 hours' then raise exception 'bad slot' using errcode = '22023'; end if;
  insert into public.sync_leases (family_id, slot, device_id) values (d.family_id, p_slot, d.id) on conflict do nothing;
  select * into l from public.sync_leases where family_id = d.family_id and slot = p_slot for update;
  if l.done_at is not null then return jsonb_build_object('leader', false, 'done', true, 'by', l.device_id); end if;
  if l.device_id = d.id then return jsonb_build_object('leader', true, 'done', false); end if;
  if l.device_id is null or l.claimed_at < now() - interval '10 minutes'
     or exists (select 1 from public.sync_devices x where x.id = l.device_id and x.revoked_at is not null) then
    update public.sync_leases set device_id = d.id, claimed_at = now(), takeovers = takeovers + 1 where family_id = l.family_id and slot = l.slot;
    return jsonb_build_object('leader', true, 'done', false, 'takeover', true); end if;
  return jsonb_build_object('leader', false, 'done', false, 'retry_after', greatest(0, extract(epoch from (l.claimed_at + interval '10 minutes' - now()))::int));
end $$;

create or replace function public.sync_log(p_key text, p_run uuid, p_lines jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.sync_devices := public.sync_device(p_key); n int;
begin
  if not exists (select 1 from public.sync_runs where id = p_run and device_id = d.id and status = 'running') then raise exception 'run not active' using errcode = '22023'; end if;
  select count(*) into n from public.sync_logs where run_id = p_run;
  if n > 2000 then return jsonb_build_object('stored', 0, 'note', 'log cap reached'); end if;
  insert into public.sync_logs (run_id, family_id, device_id, level, step, msg)
    select p_run, d.family_id, d.id, case when l->>'level' in ('debug','info','warn','error','ok') then l->>'level' else 'info' end,
           left(l->>'step', 30), public.sync_mask(l->>'msg')
    from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) with ordinality as x(l, i) where i <= 200;
  get diagnostics n = row_count; return jsonb_build_object('stored', n); end $$;

create or replace function public.sync_run_finish(p_key text, p_run uuid, p_status text, p_counts jsonb default '{}', p_error text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.sync_devices := public.sync_device(p_key); r uuid;
begin
  update public.sync_runs set status = case when p_status in ('ok','failed','quarantined') then p_status else 'failed' end, finished_at = now(),
    counts = coalesce(counts, '{}') || coalesce(p_counts, '{}'), error = public.sync_mask(p_error)
    where id = p_run and device_id = d.id and status = 'running' returning id into r;
  if r is null then raise exception 'run not active' using errcode = '22023'; end if;
  if p_status = 'ok' then
    update public.sync_leases l set done_at = now() from public.sync_runs x
      where x.id = r and x.slot is not null and l.family_id = x.family_id and l.slot = x.slot and l.device_id = d.id
        and not exists (select 1 from unnest(d.child_ids) c where not exists (select 1 from public.sync_runs y where y.device_id = d.id and y.slot = x.slot and y.child_id = c and y.status = 'ok'));
  end if;
  return jsonb_build_object('ok', true); end $$;

-- Upload one child's normalized pull. Rows are forced to the family owner + that child's edu_students row.
create or replace function public.sync_upload(p_key text, p_run uuid, p_child uuid, p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d public.sync_devices := public.sync_device(p_key); ch public.children; uid uuid; sid uuid; s jsonb := coalesce(p_payload->'student', '{}');
        f_at timestamptz := nullif(p_payload->>'fetched_at', '')::timestamptz; cnt jsonb := '{}'; n int;
begin
  if not (p_child = any(d.child_ids)) then raise exception 'child not paired to this device' using errcode = '42501'; end if;
  if not exists (select 1 from public.sync_runs where id = p_run and device_id = d.id and child_id = p_child and status = 'running') then raise exception 'run not active' using errcode = '22023'; end if;
  update public.sync_devices set uploads_n = case when uploads_win < now() - interval '1 hour' then 1 else uploads_n + 1 end,
    uploads_win = case when uploads_win < now() - interval '1 hour' then now() else uploads_win end where id = d.id returning uploads_n into n;
  if n > 12 then raise exception 'upload limit reached (12 per hour)' using errcode = 'P0429'; end if;
  if pg_column_size(p_payload) > 4000000 then raise exception 'payload too large' using errcode = '54000'; end if;
  select * into ch from public.children where id = p_child and family_id = d.family_id;
  select owner into uid from public.families where id = d.family_id;
  sid := ch.edu_student_id;
  if sid is null then
    insert into public.edu_students (user_id, source_key, name) values (uid, 'child:' || ch.id, ch.first_name)
      on conflict (user_id, source_key) do update set name = excluded.name returning id into sid;
    update public.children set edu_student_id = sid where id = ch.id;
  end if;
  update public.edu_students set grade = coalesce(nullif(s->>'grade', ''), grade), school = coalesce(nullif(s->>'school', ''), school),
    district = coalesce(nullif(s->>'district', ''), district), attendance_totals = coalesce(s->'attendance_totals', attendance_totals),
    reporting_period = coalesce(s->'reporting_period', reporting_period), last_fetched_at = coalesce(f_at, last_fetched_at), last_synced_at = now() where id = sid;

  insert into public.edu_grades (user_id, student_id, captured_at, term, course_key, course, period, teacher, teacher_email, percent, mark, is_final)
    select uid, sid, x.captured_at, x.term, left(x.course_key, 40), left(x.course, 200), x.period, x.teacher, x.teacher_email, x.percent, x.mark, coalesce(x.is_final, false)
    from jsonb_to_recordset(coalesce(p_payload->'grades', '[]')) as x(captured_at timestamptz, term text, course_key text, course text, period text, teacher text, teacher_email text, percent numeric, mark text, is_final boolean)
    where x.captured_at is not null and x.term is not null and x.course_key is not null and x.course is not null and (x.percent is null or x.percent between 0 and 150)
    limit 3000 on conflict (student_id, course_key, term, captured_at) do nothing;
  get diagnostics n = row_count; cnt := cnt || jsonb_build_object('grades', n);

  insert into public.edu_assignments (user_id, student_id, source, ext_id, course, name, kind, assigned_date, due_date, score_display, score_pct, points_possible, missing, zero, late, status, updated_at)
    select distinct on (x.source, x.ext_id) uid, sid, x.source, x.ext_id, x.course, left(x.name, 300), x.kind, x.assigned_date, x.due_date, x.score_display, x.score_pct, x.points_possible,
           coalesce(x.missing, false), coalesce(x.zero, false), coalesce(x.late, false), x.status, coalesce(x.updated_at, now())
    from jsonb_to_recordset(coalesce(p_payload->'assignments', '[]')) as x(source text, ext_id text, course text, name text, kind text, assigned_date date, due_date date, score_display text,
           score_pct numeric, points_possible numeric, missing boolean, zero boolean, late boolean, status text, updated_at timestamptz)
    where x.source is not null and x.ext_id is not null and x.name is not null and (x.score_pct is null or x.score_pct between 0 and 1000)
    limit 5000 on conflict (student_id, source, ext_id) do update set course = excluded.course, name = excluded.name, kind = excluded.kind, assigned_date = excluded.assigned_date,
      due_date = excluded.due_date, score_display = excluded.score_display, score_pct = excluded.score_pct, points_possible = excluded.points_possible, missing = excluded.missing,
      zero = excluded.zero, late = excluded.late, status = excluded.status, updated_at = excluded.updated_at;
  get diagnostics n = row_count; cnt := cnt || jsonb_build_object('assignments', n);

  insert into public.edu_attendance (user_id, student_id, date, kind, reason, note, periods)
    select distinct on (x.date, x.kind) uid, sid, x.date, x.kind, x.reason, x.note, coalesce(x.periods, '[]')
    from jsonb_to_recordset(coalesce(p_payload->'attendance', '[]')) as x(date date, kind text, reason text, note text, periods jsonb)
    where x.date is not null and x.kind is not null limit 2000
    on conflict (student_id, date, kind) do update set reason = excluded.reason, note = excluded.note, periods = excluded.periods;
  get diagnostics n = row_count; cnt := cnt || jsonb_build_object('attendance', n);

  insert into public.edu_messages (user_id, student_id, source, ext_id, sent_at, sender, subject, body, course, url, unread)
    select distinct on (x.source, x.ext_id) uid, sid, x.source, x.ext_id, x.sent_at, x.sender, x.subject, left(x.body, 8000), x.course, x.url, x.unread
    from jsonb_to_recordset(coalesce(p_payload->'messages', '[]')) as x(source text, ext_id text, sent_at timestamptz, sender text, subject text, body text, course text, url text, unread boolean)
    where x.source is not null and x.ext_id is not null limit 2000
    on conflict (student_id, source, ext_id) do update set sent_at = excluded.sent_at, sender = excluded.sender, subject = excluded.subject, body = excluded.body, course = excluded.course, unread = excluded.unread;
  get diagnostics n = row_count; cnt := cnt || jsonb_build_object('messages', n);

  insert into public.edu_calendar (user_id, student_id, date, title, kind, source)
    select distinct on (x.date, x.title) uid, sid, x.date, left(x.title, 300), x.kind, coalesce(x.source, 'ParentVUE')
    from jsonb_to_recordset(coalesce(p_payload->'calendar', '[]')) as x(date date, title text, kind text, source text)
    where x.date is not null and x.title is not null limit 2000
    on conflict (student_id, date, title) do update set kind = excluded.kind;
  get diagnostics n = row_count; cnt := cnt || jsonb_build_object('calendar', n);

  insert into public.edu_sync_runs (user_id, student_id, fetched_at, source, status, counts) values (uid, sid, f_at, 'crystal-sync:' || d.id, 'ok', cnt);
  update public.sync_runs set counts = counts || cnt where id = p_run;
  insert into public.sync_logs (run_id, family_id, device_id, level, step, msg) values (p_run, d.family_id, d.id, 'ok', 'upload', 'server stored ' || cnt::text);
  return jsonb_build_object('ok', true, 'counts', cnt);
end $$;

revoke all on function public.sync_my_devices(), public.sync_pair_create(uuid[]), public.sync_request_now(uuid), public.sync_status(), public.sync_device_revoke(uuid), public.sync_admin_devices(),
  public.sync_pair_exchange(text, text, text, text, text), public.sync_rotate(text), public.sync_poll(text, text), public.sync_run_start(text, uuid, uuid, text, timestamptz), public.sync_claim(text, timestamptz),
  public.sync_log(text, uuid, jsonb), public.sync_run_finish(text, uuid, text, jsonb, text), public.sync_upload(text, uuid, uuid, jsonb), public.sync_admin_ok() from public;
grant execute on function public.sync_pair_create(uuid[]), public.sync_request_now(uuid), public.sync_status(), public.sync_device_revoke(uuid), public.sync_admin_devices(), public.sync_admin_ok(), public.sync_my_devices() to authenticated;
grant execute on function public.sync_pair_exchange(text, text, text, text, text), public.sync_rotate(text), public.sync_poll(text, text), public.sync_run_start(text, uuid, uuid, text, timestamptz), public.sync_claim(text, timestamptz),
  public.sync_log(text, uuid, jsonb), public.sync_run_finish(text, uuid, text, jsonb, text), public.sync_upload(text, uuid, uuid, jsonb) to anon, authenticated;
