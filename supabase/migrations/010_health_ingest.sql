-- 010: iPhone (Apple Health via iOS Shortcuts) step ingest.
-- Token is stored only as a SHA-256 hash. Ingest runs through a SECURITY DEFINER RPC so the
-- Pages Function needs only the anon key (no service key in Cloudflare).
create extension if not exists pgcrypto with schema extensions;

alter table public.health_logs add column if not exists source text;
alter table public.health_logs add column if not exists meta jsonb;
alter table public.health_logs add column if not exists updated_at timestamptz;
-- one iPhone row per user/day/kind
create unique index if not exists health_logs_src_day_uidx on public.health_logs (user_id, kind, logged_on, source) where source is not null;

create table if not exists public.health_ingest_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz);
alter table public.health_ingest_tokens enable row level security;
revoke all on public.health_ingest_tokens from anon, authenticated;

create table if not exists public.health_ingest_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  logged_on date, payload jsonb, result text not null, detail text);
alter table public.health_ingest_log enable row level security;
drop policy if exists "owner read" on public.health_ingest_log;
create policy "owner read" on public.health_ingest_log for select to authenticated using (user_id = (select auth.uid()));
grant select on public.health_ingest_log to authenticated;
create index if not exists health_ingest_log_user_idx on public.health_ingest_log (user_id, received_at desc);

-- Signed-in user: create/rotate token. Returns the plaintext ONCE; only the hash is kept.
create or replace function public.health_rotate_token() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  t := 'hst_' || encode(gen_random_bytes(24), 'hex');
  insert into health_ingest_tokens (user_id, token_hash) values (uid, encode(digest(t, 'sha256'), 'hex'))
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
  return t;
end $$;
revoke all on function public.health_rotate_token() from public, anon;
grant execute on function public.health_rotate_token() to authenticated;

create or replace function public.health_ingest_status() returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object('has_token', exists(select 1 from health_ingest_tokens where user_id = auth.uid()),
    'token_created_at', (select created_at from health_ingest_tokens where user_id = auth.uid()),
    'last_used_at', (select last_used_at from health_ingest_tokens where user_id = auth.uid()),
    'last_ok', (select max(received_at) from health_ingest_log where user_id = auth.uid() and result in ('inserted','updated','kept')));
$$;
revoke all on function public.health_ingest_status() from public, anon;
grant execute on function public.health_ingest_status() to authenticated;

-- Ingest one day. Never overwrites a larger/real value with blank/zero/smaller; logs every call.
create or replace function public.health_ingest(p_token text, p_date date, p_steps numeric,
  p_distance_km numeric default null, p_active_kcal numeric default null, p_flights numeric default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; cur public.health_logs%rowtype; res text; m jsonb; pl jsonb;
begin
  pl := jsonb_strip_nulls(jsonb_build_object('date', p_date, 'steps', p_steps, 'distance_km', p_distance_km, 'active_kcal', p_active_kcal, 'flights', p_flights));
  select user_id into uid from health_ingest_tokens where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
  if uid is null then
    insert into health_ingest_log (logged_on, payload, result) values (p_date, pl, 'bad_token');
    return jsonb_build_object('ok', false, 'error', 'invalid token');
  end if;
  update health_ingest_tokens set last_used_at = now() where user_id = uid;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 400 or p_steps is null or p_steps < 0 or p_steps > 200000 then
    insert into health_ingest_log (user_id, logged_on, payload, result, detail) values (uid, p_date, pl, 'rejected', 'bad date or steps');
    return jsonb_build_object('ok', false, 'error', 'bad date or steps');
  end if;
  select * into cur from health_logs where user_id = uid and kind = 'steps' and logged_on = p_date and source = 'iphone' for update;
  if not found then
    if p_steps = 0 then res := 'skipped_zero';
    else
      m := jsonb_strip_nulls(jsonb_build_object('distance_km', p_distance_km, 'active_kcal', p_active_kcal, 'flights', p_flights));
      insert into health_logs (user_id, kind, value, unit, logged_on, source, meta, note, updated_at)
      values (uid, 'steps', round(p_steps), 'steps', p_date, 'iphone', m, 'Apple Health', now());
      res := 'inserted';
    end if;
  else
    -- keep the larger value of each metric for the day
    m := coalesce(cur.meta, '{}'::jsonb);
    if coalesce(p_distance_km,0) > coalesce((m->>'distance_km')::numeric,0) then m := m || jsonb_build_object('distance_km', p_distance_km); end if;
    if coalesce(p_active_kcal,0) > coalesce((m->>'active_kcal')::numeric,0) then m := m || jsonb_build_object('active_kcal', p_active_kcal); end if;
    if coalesce(p_flights,0) > coalesce((m->>'flights')::numeric,0) then m := m || jsonb_build_object('flights', p_flights); end if;
    if round(p_steps) > coalesce(cur.value,0) or m is distinct from cur.meta then
      update health_logs set value = greatest(coalesce(cur.value,0), round(p_steps)), meta = m, updated_at = now() where id = cur.id;
      res := 'updated';
    else res := 'kept'; end if;
  end if;
  insert into health_ingest_log (user_id, logged_on, payload, result) values (uid, p_date, pl, res);
  return jsonb_build_object('ok', true, 'result', res, 'date', p_date);
end $$;
revoke all on function public.health_ingest(text, date, numeric, numeric, numeric, numeric) from public;
grant execute on function public.health_ingest(text, date, numeric, numeric, numeric, numeric) to anon, authenticated;
