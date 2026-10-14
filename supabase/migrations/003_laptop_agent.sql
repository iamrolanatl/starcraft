-- 003_laptop_agent.sql  Laptop sync agent for Crystal (ported from EliDash 0001/0003/0005/0006).
-- Lets the existing Windows laptop scripts (C:\Users\iamro\EliDashboard\sync) work unchanged:
--   agent_begin_scheduled / agent_claim_sync -> running (+ one-time upload path in private bucket 'raw')
--   agent_log -> sync_log console lines; agent_finish_pull -> 'processing'; agent_finish_sync(ok=false) -> failed
-- The box cron (sync/process_jobs.sh) polls for 'processing', ingests the zip, runs school_sync.py, marks 'done'.
-- No webhook / pg_net. The agent secret is stored only as a SHA-256 hash. Idempotent: safe to re-run.
-- RUN in Supabase Dashboard > SQL Editor (project ogrrjkxkccbywbiikcak) after 001 and 002.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create table if not exists public.sync_requests (
  id           bigint generated always as identity primary key,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  status       text not null default 'pending',
  started_at   timestamptz, finished_at timestamptz, message text,
  kind         text not null default 'manual' check (kind in ('manual','scheduled')),
  raw_path     text, processed_at timestamptz, process_message text
);
alter table public.sync_requests drop constraint if exists sync_requests_status_check;
alter table public.sync_requests add constraint sync_requests_status_check
  check (status in ('pending','running','processing','done','failed'));
create index if not exists sync_requests_status_idx on public.sync_requests (status, requested_at);
drop index if exists public.sync_requests_one_active;
create unique index if not exists sync_requests_one_active on public.sync_requests ((true))
  where status in ('pending','running','processing');

create table if not exists public.sync_log (
  id bigserial primary key,
  request_id bigint not null references public.sync_requests(id) on delete cascade,
  ts timestamptz not null default now(),
  level text not null default 'info' check (level in ('info','step','ok','warn','err')),
  line text not null check (char_length(line) <= 500)
);
create index if not exists sync_log_request_idx on public.sync_log (request_id, id);

-- Who may read sync status / press Sync in Crystal: the owner account(s) below.
create table if not exists private.sync_owners (email text primary key check (email = lower(email)));
insert into private.sync_owners values ('iamrolan@gmail.com') on conflict do nothing;
create or replace function private.current_email() returns text language sql stable set search_path = '' as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '') $$;
create or replace function private.is_allowed() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.sync_owners o where o.email = private.current_email()) $$;
revoke all on function private.current_email(), private.is_allowed() from public;
grant execute on function private.current_email(), private.is_allowed() to authenticated, service_role;

revoke all on public.sync_requests, public.sync_log from anon, authenticated;
grant select on public.sync_requests, public.sync_log to authenticated;
grant all on public.sync_requests, public.sync_log to service_role;
grant usage, select on sequence public.sync_log_id_seq to service_role;
alter table public.sync_requests enable row level security;
alter table public.sync_log enable row level security;
drop policy if exists "owner read" on public.sync_requests;
create policy "owner read" on public.sync_requests for select to authenticated using (private.is_allowed());
drop policy if exists "owner read" on public.sync_log;
create policy "owner read" on public.sync_log for select to authenticated using (private.is_allowed());

create table if not exists private.agent_secrets (
  name        text primary key,
  secret_hash bytea not null unique,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  last_used_at timestamptz
);
create table if not exists private.upload_tickets (
  object_name text primary key,
  sync_id     bigint not null references public.sync_requests(id) on delete cascade,
  agent       text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
revoke all on private.agent_secrets, private.upload_tickets from public, anon, authenticated;

create or replace function private.agent_name(p_secret text) returns text
language plpgsql security definer set search_path = '' as $$
declare n text;
begin
  if p_secret is null or length(p_secret) < 40 then return null; end if;
  update private.agent_secrets set last_used_at = now()
   where secret_hash = extensions.digest(p_secret, 'sha256') and revoked_at is null
  returning name into n;
  return n;
end $$;
revoke all on function private.agent_name(text) from public, anon, authenticated;

create or replace function private.new_ticket(p_sync_id bigint, p_agent text) returns text
language plpgsql security definer set search_path = '' as $$
declare obj text;
begin
  obj := 'incoming/' || to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD"T"HH24MI') || '_'
         || p_sync_id || '_' || encode(extensions.gen_random_bytes(16), 'hex') || '.zip';
  insert into private.upload_tickets (object_name, sync_id, agent, expires_at)
  values (obj, p_sync_id, p_agent, now() + interval '15 minutes');
  return obj;
end $$;
revoke all on function private.new_ticket(bigint, text) from public, anon, authenticated;

-- used by the storage.objects policy (runs as anon during the upload)
create or replace function private.upload_ticket_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.upload_tickets t
                  where t.object_name = p_name and t.used_at is null and t.expires_at > now())
$$;
revoke all on function private.upload_ticket_ok(text) from public;
grant execute on function private.upload_ticket_ok(text) to anon, authenticated;

-- ---------- agent secret (hash only; plaintext lives at ~/.config/crystal/agent-secret.txt on the box) ----------
insert into private.agent_secrets (name, secret_hash) values ('rolan-laptop', decode('fb5367bee9332dde7c1f3b14f3b023cc2abdf698fef72bc256e4f520871b4449', 'hex'))
on conflict (name) do update set secret_hash = excluded.secret_hash, revoked_at = null;

-- 2) stale-run sweeper (used by request_sync and the agent RPCs): running > 20 min, processing > 40 min after start
create or replace function private.expire_stale_syncs() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.sync_requests set status = 'failed', finished_at = now(),
         message = coalesce(message || ' | ', '') || 'timed out (laptop did not finish within 20 min)'
   where status = 'running' and started_at < now() - interval '20 minutes';
  update public.sync_requests set status = 'failed', finished_at = now(),
         message = coalesce(message || ' | ', '') || 'timed out (server did not finish processing)'
   where status = 'processing' and started_at < now() - interval '40 minutes';
end $$;
revoke all on function private.expire_stale_syncs() from public, anon, authenticated;

-- 3) request_sync: 'processing' is active too (same as 0001 otherwise)
create or replace function public.request_sync(p_message text default null) returns public.sync_requests
language plpgsql security definer set search_path = '' as $$
declare r public.sync_requests; e text := private.current_email();
begin
  if not private.is_allowed() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.expire_stale_syncs();
  select * into r from public.sync_requests where status in ('pending','running','processing') order by id desc limit 1;
  if found then return r; end if;
  insert into public.sync_requests (requested_by, message) values (e, left(p_message, 500)) returning * into r;
  return r;
end $$;
revoke all on function public.request_sync(text) from public, anon;
grant execute on function public.request_sync(text) to authenticated;

-- 4) agent_claim_sync / agent_begin_scheduled: same as 0003, plus the processing sweep/guard
create or replace function public.agent_claim_sync(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a text := private.agent_name(p_secret); r public.sync_requests;
begin
  if a is null then raise exception 'invalid agent secret' using errcode = '28000'; end if;
  perform private.expire_stale_syncs();
  update public.sync_requests s set status = 'running', started_at = now(),
         message = coalesce(s.message || ' | ', '') || 'claimed by ' || a
   where s.id = (select id from public.sync_requests where status = 'pending' order by requested_at limit 1 for update skip locked)
  returning * into r;
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'requested_by', r.requested_by, 'upload_path', private.new_ticket(r.id, a));
end $$;

create or replace function public.agent_begin_scheduled(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a text := private.agent_name(p_secret); j jsonb; r public.sync_requests;
begin
  if a is null then raise exception 'invalid agent secret' using errcode = '28000'; end if;
  j := public.agent_claim_sync(p_secret);
  if j is not null then return j; end if;
  if exists (select 1 from public.sync_requests where status in ('running','processing')) then
    raise exception 'another sync is already running' using errcode = '55006';
  end if;
  insert into public.sync_requests (requested_by, status, started_at, kind, message)
  values ('laptop-schedule', 'running', now(), 'scheduled', 'scheduled pull by ' || a)
  returning * into r;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'requested_by', r.requested_by, 'upload_path', private.new_ticket(r.id, a));
end $$;

-- 5) agent_log: the laptop streams console lines (sync_log) with the agent secret instead of service_role.
create or replace function public.agent_log(p_secret text, p_id bigint, p_level text, p_line text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare a text := private.agent_name(p_secret); lvl text := lower(btrim(coalesce(p_level, 'info'))); ln text; new_id bigint;
begin
  if a is null then raise exception 'invalid agent secret' using errcode = '28000'; end if;
  if p_id is null or not exists (select 1 from public.sync_requests where id = p_id) then
    raise exception 'sync request % not found', p_id using errcode = 'P0002';
  end if;
  if lvl not in ('info','step','ok','warn','err') then lvl := 'info'; end if;
  ln := left(btrim(regexp_replace(coalesce(p_line, ''), '\s+', ' ', 'g')), 500);
  if ln = '' then ln := '>'; end if;
  insert into public.sync_log (request_id, level, line) values (p_id, lvl, ln) returning id into new_id;
  return new_id;
end $$;

-- 6) agent_finish_pull: laptop success path. running -> processing (+ raw_path); the trigger wakes the box.
create or replace function public.agent_finish_pull(p_secret text, p_id bigint, p_upload_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a text := private.agent_name(p_secret);
begin
  if a is null then raise exception 'invalid agent secret' using errcode = '28000'; end if;
  perform 1 from public.sync_requests where id = p_id and status = 'running' for update;
  if not found then raise exception 'sync request % is not running', p_id using errcode = '55000'; end if;
  if p_upload_path is null
     or not exists (select 1 from private.upload_tickets t where t.object_name = p_upload_path and t.sync_id = p_id)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'raw' and o.name = p_upload_path) then
    raise exception 'upload not found in storage for sync request %', p_id using errcode = 'P0002';
  end if;
  update private.upload_tickets set used_at = now() where sync_id = p_id and used_at is null;
  update public.sync_requests set status = 'processing', raw_path = p_upload_path,
         message = coalesce(message || ' | ', '') || 'raw uploaded by ' || a
   where id = p_id;
  return jsonb_build_object('id', p_id, 'status', 'processing');
end $$;

revoke all on function public.agent_log(text, bigint, text, text), public.agent_finish_pull(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.agent_log(text, bigint, text, text), public.agent_finish_pull(text, bigint, text)
  to anon, service_role;

-- agent_finish_sync: mark done/failed. If p_upload_path is given it must be this request's ticket and the
-- object must exist in bucket 'raw'; it is then recorded in sync_requests.raw_path and the ticket is burned.
create or replace function public.agent_finish_sync(p_secret text, p_id bigint, p_ok boolean,
                                                    p_message text default null, p_upload_path text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a text := private.agent_name(p_secret); ok boolean := p_ok; msg text := left(p_message, 2000); path text;
begin
  if a is null then raise exception 'invalid agent secret' using errcode = '28000'; end if;
  if not exists (select 1 from public.sync_requests where id = p_id and status = 'running') then
    raise exception 'sync request % is not running', p_id using errcode = '55000';
  end if;
  if p_upload_path is not null then
    if exists (select 1 from private.upload_tickets t where t.object_name = p_upload_path and t.sync_id = p_id)
       and exists (select 1 from storage.objects o where o.bucket_id = 'raw' and o.name = p_upload_path) then
      path := p_upload_path;
    else
      ok := false; msg := coalesce(msg || ' | ', '') || 'upload not found in storage';
    end if;
  elsif ok then
    ok := false; msg := coalesce(msg || ' | ', '') || 'no upload';
  end if;
  update private.upload_tickets set used_at = now() where sync_id = p_id and used_at is null;
  update public.sync_requests set status = case when ok then 'done' else 'failed' end, finished_at = now(),
         raw_path = path, message = coalesce(message || ' | ', '') || coalesce(msg, case when ok then 'ok' else 'failed' end)
   where id = p_id;
  return jsonb_build_object('id', p_id, 'status', case when ok then 'done' else 'failed' end, 'raw_path', path);
end $$;

revoke all on function public.agent_claim_sync(text), public.agent_begin_scheduled(text),
                       public.agent_finish_sync(text, bigint, boolean, text, text) from public, authenticated;
grant execute on function public.agent_claim_sync(text), public.agent_begin_scheduled(text),
                          public.agent_finish_sync(text, bigint, boolean, text, text) to anon, service_role;

-- ---------- storage: private bucket 'raw' ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('raw', 'raw', false, 20971520, array['application/zip','application/x-zip-compressed','application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "raw: agent upload with ticket" on storage.objects;
create policy "raw: agent upload with ticket" on storage.objects for insert to anon
  with check (bucket_id = 'raw' and private.upload_ticket_ok(name));
-- write-only for the laptop: no anon SELECT policy (tested: uploads succeed without it), so even during the
-- 15-min ticket window nobody holding the publishable key can list or download the zip.
drop policy if exists "raw: agent read own ticket" on storage.objects;
-- no other policies on bucket 'raw': authenticated users and anon cannot list/read/delete; the box uses service_role.

grant execute on function public.agent_claim_sync(text), public.agent_begin_scheduled(text) to anon, service_role;
revoke all on function public.agent_claim_sync(text), public.agent_begin_scheduled(text) from public, authenticated;

-- ---------- run log + alerts (shown in Crystal; owner-only RLS like 002) ----------
alter table public.edu_sync_runs add column if not exists job_id bigint references public.sync_requests(id) on delete set null;
alter table public.edu_sync_runs add column if not exists kind text;
create index if not exists edu_sync_runs_user on public.edu_sync_runs (user_id, ran_at desc);

create table if not exists public.edu_alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null,            -- laptop_failed | box_failed | missed_pull | stale_processing | poller_down
  job_id bigint references public.sync_requests(id) on delete set null,
  dedupe_key text not null,      -- one alert per incident
  message text not null,
  emailed_at timestamptz,
  unique (user_id, dedupe_key)
);
create index if not exists edu_alerts_user on public.edu_alerts (user_id, created_at desc);
alter table public.edu_alerts enable row level security;
drop policy if exists "edu_alerts select own" on public.edu_alerts;
create policy "edu_alerts select own" on public.edu_alerts for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.edu_alerts from anon, authenticated;
grant select on public.edu_alerts to authenticated;
grant all on public.edu_alerts, public.edu_sync_runs to service_role;
