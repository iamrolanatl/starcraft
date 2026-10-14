-- 019 Admin command center (/admin). Run in Supabase Dashboard > SQL Editor after 017 (and 018 if present). Idempotent.
-- Every admin RPC is SECURITY DEFINER, callable only by `authenticated`, and starts with admin_guard(), which requires the
-- caller's verified JWT email to be in public.admins. The /api/admin Pages Function also checks ADMIN_EMAILS first.
-- No service-role key is needed anywhere. Destructive actions need a typed confirmation and are written to admin_audit.
create table if not exists public.admins (email text primary key check (email = lower(email)), added_at timestamptz not null default now());
insert into public.admins(email) values ('iamrolan@gmail.com') on conflict do nothing;
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  actor uuid, actor_email text, action text not null, target text,
  before jsonb, after jsonb, detail jsonb not null default '{}'::jsonb, ok boolean not null default true,
  at timestamptz not null default now());
create index if not exists admin_audit_at on public.admin_audit(at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

create table if not exists public.admin_user_flags (           -- soft delete marker (hard delete is a separate step)
  user_id uuid primary key references auth.users(id) on delete cascade,
  disabled_at timestamptz, deleted_at timestamptz, note text);
alter table public.admin_user_flags enable row level security;
revoke all on public.admin_user_flags from anon, authenticated;

create table if not exists public.admin_rate (actor uuid primary key, n int not null default 0, win timestamptz not null default now());
alter table public.admin_rate enable row level security;
revoke all on public.admin_rate from anon, authenticated;

create or replace function public.admin_guard() returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare e text := lower(coalesce(auth.jwt() ->> 'email', '')); u uuid := auth.uid(); r public.admin_rate;
begin
  if u is null or e = '' or not exists (select 1 from public.admins where email = e) then
    raise exception 'admin_forbidden' using errcode = '42501'; end if;
  insert into public.admin_rate(actor) values (u) on conflict (actor) do nothing;
  update public.admin_rate set n = case when win < now() - interval '1 minute' then 1 else n + 1 end,
    win = case when win < now() - interval '1 minute' then now() else win end where actor = u returning * into r;
  if r.n > 120 then raise exception 'admin_rate_limited' using errcode = 'P0429'; end if;
  return u; end $$;

create or replace function public.admin_log(p_action text, p_target text, p_before jsonb, p_after jsonb, p_detail jsonb default '{}') returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.admin_audit(actor, actor_email, action, target, before, after, detail)
  values (auth.uid(), lower(auth.jwt() ->> 'email'), p_action, p_target, p_before, p_after, coalesce(p_detail, '{}')) $$;

-- helpers: count / recent rows of any public table, tolerant of tables that don't exist yet
create or replace function public.admin_count(t text) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint; begin if to_regclass('public.' || quote_ident(t)) is null then return null; end if;
  execute format('select count(*) from public.%I', t) into n; return n; end $$;
create or replace function public.admin_tscol(t text) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select column_name::text from information_schema.columns where table_schema = 'public' and table_name = t
   and column_name in ('finished_at','created_at','started_at','updated_at','at','ts','sent_at','ran_at','joined_at')
  order by array_position(array['finished_at','started_at','created_at','at','ts','ran_at','sent_at','updated_at','joined_at']::text[], column_name::text) limit 1 $$;
create or replace function public.admin_recent(t text, n int default 20) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c text; r jsonb; begin if to_regclass('public.' || quote_ident(t)) is null then return null; end if;
  c := public.admin_tscol(t);
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (select * from public.%I %s limit %s) x', t,
    case when c is null then '' else format('order by %I desc nulls last', c) end, least(greatest(n,1),200)) into r; return r; end $$;
create or replace function public.admin_uidcol(t text) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select column_name::text from information_schema.columns where table_schema = 'public' and table_name = t and data_type = 'uuid'
   and column_name in ('user_id','owner','member') order by array_position(array['user_id','owner','member']::text[], column_name::text) limit 1 $$;

create or replace function public.admin_overview() returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare j jsonb; begin perform public.admin_guard();
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'users_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'disabled', (select count(*) from public.admin_user_flags where disabled_at is not null or deleted_at is not null),
    'sessions', case when to_regclass('auth.sessions') is null then null else (select count(*) from auth.sessions where coalesce(not_after, 'infinity') > now()) end,
    'families', public.admin_count('families'), 'children', public.admin_count('children'),
    'viewers', public.admin_count('child_viewers'), 'list_shares', public.admin_count('list_shares'),
    'support_open', case when to_regclass('public.support_tickets') is null then null else (select count(*) from public.support_tickets where status <> 'closed') end,
    'outbox', case when to_regclass('public.mail_outbox') is null then null else (select coalesce(jsonb_object_agg(s, n), '{}') from (select coalesce(status,'?') s, count(*) n from public.mail_outbox group by 1) q) end,
    'edu_sync', public.admin_recent('edu_sync_runs', 1), 'sync_log', public.admin_recent('sync_log', 1), 'ext_sync', public.admin_recent('ext_sync_runs', 1),
    'audit_24h', (select count(*) from public.admin_audit where at > now() - interval '1 day'),
    'at', now()) into j; return j; end $$;

create or replace function public.admin_users(p_q text default '', p_limit int default 50) returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare j jsonb; begin perform public.admin_guard();
  select coalesce(jsonb_agg(x order by x.last_sign_in_at desc nulls last), '[]') into j from (
    select u.id, u.email, u.raw_user_meta_data ->> 'full_name' as name, u.created_at, u.last_sign_in_at, u.banned_until,
      f.disabled_at, f.deleted_at, (select role from public.family_members m where m.user_id = u.id) as family_role,
      exists (select 1 from public.families fa where fa.owner = u.id) as family_owner
    from auth.users u left join public.admin_user_flags f on f.user_id = u.id
    where coalesce(p_q, '') = '' or u.email ilike '%' || p_q || '%' or u.id::text = p_q or (u.raw_user_meta_data ->> 'full_name') ilike '%' || p_q || '%'
    limit least(greatest(p_limit, 1), 200)) x; return j; end $$;

create or replace function public.admin_user_detail(p_uid uuid) returns jsonb language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare j jsonb; fam uuid; counts jsonb := '{}'; t text; c text; n bigint; begin perform public.admin_guard();
  select coalesce((select id from public.families where owner = p_uid), (select family_id from public.family_members where user_id = p_uid)) into fam;
  -- "view as" (read-only): row counts this user owns in every public table keyed by user_id/owner/member
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not like 'admin%' order by 1 loop
    c := public.admin_uidcol(t); if c is null then continue; end if;
    execute format('select count(*) from public.%I where %I = $1', t, c) into n using p_uid;
    if n > 0 then counts := counts || jsonb_build_object(t, n); end if; end loop;
  select jsonb_build_object(
    'auth', (select jsonb_build_object('id', id, 'email', email, 'meta', raw_user_meta_data, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at,
       'email_confirmed_at', email_confirmed_at, 'banned_until', banned_until, 'provider', raw_app_meta_data ->> 'provider') from auth.users where id = p_uid),
    'flags', (select to_jsonb(f) from public.admin_user_flags f where user_id = p_uid),
    'sessions', case when to_regclass('auth.sessions') is null then null else (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'updated_at', updated_at, 'user_agent', left(user_agent, 120))), '[]') from auth.sessions where user_id = p_uid) end,
    'family', (select to_jsonb(f) from public.families f where id = fam),
    'membership', (select to_jsonb(m) - 'confirm_code' from public.family_members m where user_id = p_uid),
    'members', (select coalesce(jsonb_agg(to_jsonb(m) - 'confirm_code'), '[]') from public.family_members m where family_id = fam),
    'children', (select coalesce(jsonb_agg(to_jsonb(c2) order by c2.sort), '[]') from public.children c2 where family_id = fam),
    'viewers', (select coalesce(jsonb_agg(to_jsonb(v) - 'confirm_code'), '[]') from public.child_viewers v where v.owner = p_uid or v.user_id = p_uid),
    'shares', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.list_shares s where s.owner = p_uid or s.member = p_uid),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', 'family', 'hint', i.hint, 'email', i.email, 'created_at', i.created_at, 'expires_at', i.expires_at, 'used_at', i.used_at, 'revoked_at', i.revoked_at)), '[]') from public.family_invites i where i.family_id = fam),
    'prefs', (select to_jsonb(p) from public.user_prefs p where user_id = p_uid),
    'activity', (select coalesce(jsonb_agg(to_jsonb(e) order by e.at desc), '[]') from (select * from public.family_events where actor = p_uid or target = p_uid or owner = p_uid order by at desc limit 25) e),
    'view_as', counts) into j;
  return j; end $$;

-- One dispatcher for every write. p_confirm must equal the target's email (users) or the literal word in the action list.
create or replace function public.admin_action(p_action text, p_target uuid, p_args jsonb default '{}', p_confirm text default '') returns jsonb
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare me uuid := public.admin_guard(); em text; b jsonb; a jsonb; fam uuid; n int := 0;
begin
  p_args := coalesce(p_args, '{}');
  if p_action in ('disable','enable','signout','reset_prefs','soft_delete','restore','hard_delete') then
    select email into em from auth.users where id = p_target; if em is null then raise exception 'no_such_user'; end if;
    if p_action in ('disable','soft_delete','hard_delete','reset_prefs','signout') and lower(coalesce(p_confirm,'')) <> lower(em) then raise exception 'confirm_mismatch: type the user''s email'; end if;
    if p_target = me and p_action in ('disable','soft_delete','hard_delete') then raise exception 'cannot_target_self'; end if;
    select jsonb_build_object('banned_until', u.banned_until, 'flags', to_jsonb(f)) into b from auth.users u left join public.admin_user_flags f on f.user_id = u.id where u.id = p_target;
  end if;
  case p_action
  when 'disable' then
    update auth.users set banned_until = 'infinity' where id = p_target;
    insert into public.admin_user_flags(user_id, disabled_at, note) values (p_target, now(), p_args ->> 'note') on conflict (user_id) do update set disabled_at = now(), note = coalesce(excluded.note, admin_user_flags.note);
    if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using p_target; end if;
  when 'enable', 'restore' then
    update auth.users set banned_until = null where id = p_target;
    update public.admin_user_flags set disabled_at = null, deleted_at = null where user_id = p_target;
  when 'signout' then
    if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using p_target; get diagnostics n = row_count; end if;
    if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id = $1::text' using p_target; end if;
  when 'reset_prefs' then
    select to_jsonb(p) into a from public.user_prefs p where user_id = p_target; b := coalesce(b, '{}') || jsonb_build_object('prefs', a); a := null;
    delete from public.user_prefs where user_id = p_target;
  when 'soft_delete' then
    update auth.users set banned_until = 'infinity' where id = p_target;
    insert into public.admin_user_flags(user_id, disabled_at, deleted_at) values (p_target, now(), now()) on conflict (user_id) do update set disabled_at = now(), deleted_at = now();
    if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using p_target; end if;
  when 'hard_delete' then
    if not exists (select 1 from public.admin_user_flags where user_id = p_target and deleted_at < now() - interval '1 minute') then raise exception 'soft_delete_first: soft-delete, wait 1 minute, then hard delete'; end if;
    perform public.admin_log('hard_delete', p_target::text, b, null, jsonb_build_object('email', em));
    delete from auth.users where id = p_target; return jsonb_build_object('ok', true, 'action', p_action);
  when 'assign_child', 'move_child' then  -- p_target = child id; args.family_id or args.parent_user_id
    if lower(coalesce(p_confirm,'')) <> 'move' then raise exception 'confirm_mismatch: type MOVE'; end if;
    select to_jsonb(c) into b from public.children c where id = p_target; if b is null then raise exception 'no_such_child'; end if;
    fam := coalesce((p_args ->> 'family_id')::uuid, (select id from public.families where owner = (p_args ->> 'parent_user_id')::uuid));
    if fam is null and p_args ? 'parent_user_id' then insert into public.families(owner) values ((p_args ->> 'parent_user_id')::uuid) returning id into fam; end if;
    if fam is null then raise exception 'no_target_family'; end if;
    update public.children set family_id = fam where id = p_target;
    update public.family_members set family_id = fam where child_id = p_target;
    update public.child_viewers set owner = (select owner from public.families where id = fam) where child_id = p_target;
  when 'create_child' then  -- p_target = parent user id; args.first_name
    if lower(coalesce(p_confirm,'')) <> 'create' then raise exception 'confirm_mismatch: type CREATE'; end if;
    select id into fam from public.families where owner = p_target;
    if fam is null then insert into public.families(owner) values (p_target) returning id into fam; end if;
    insert into public.children(family_id, first_name, last_name, grade, school) values (fam, p_args ->> 'first_name', p_args ->> 'last_name', p_args ->> 'grade', p_args ->> 'school') returning to_jsonb(children.*) into a;
  when 'viewer_add' then  -- p_target = child id; args.user_id, relationship, scopes[], expires_at
    if lower(coalesce(p_confirm,'')) <> 'grant' then raise exception 'confirm_mismatch: type GRANT'; end if;
    insert into public.child_viewers(child_id, owner, user_id, relationship, scopes, status, expires_at, viewer_email, child_name)
    select c.id, f.owner, (p_args ->> 'user_id')::uuid, coalesce(p_args ->> 'relationship', 'Other'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(p_args -> 'scopes') x), array['grades']), 'active', nullif(p_args ->> 'expires_at','')::timestamptz,
      (select email from auth.users where id = (p_args ->> 'user_id')::uuid), c.first_name
    from public.children c join public.families f on f.id = c.family_id where c.id = p_target
    on conflict (child_id, user_id) do update set scopes = excluded.scopes, status = 'active', expires_at = excluded.expires_at returning to_jsonb(child_viewers.*) into a;
  when 'viewer_remove' then  -- p_target = child_viewers id
    if lower(coalesce(p_confirm,'')) <> 'revoke' then raise exception 'confirm_mismatch: type REVOKE'; end if;
    select to_jsonb(v) into b from public.child_viewers v where id = p_target; update public.child_viewers set status = 'revoked', decided_at = now() where id = p_target;
  when 'share_revoke' then
    if lower(coalesce(p_confirm,'')) <> 'revoke' then raise exception 'confirm_mismatch: type REVOKE'; end if;
    select to_jsonb(s) into b from public.list_shares s where id = p_target; update public.list_shares set status = 'revoked' where id = p_target;
  when 'invite_revoke' then
    if lower(coalesce(p_confirm,'')) <> 'revoke' then raise exception 'confirm_mismatch: type REVOKE'; end if;
    update public.family_invites set revoked_at = now() where id = p_target and revoked_at is null; get diagnostics n = row_count;
    if n = 0 then update public.viewer_invites set revoked_at = now() where id = p_target and revoked_at is null; get diagnostics n = row_count; end if;
    if n = 0 then update public.list_invites set revoked_at = now() where id = p_target and revoked_at is null; get diagnostics n = row_count; end if;
  else raise exception 'unknown_action %', p_action; end case;
  if a is null and p_action in ('disable','enable','restore','soft_delete','signout') then
    select jsonb_build_object('banned_until', u.banned_until, 'flags', to_jsonb(f)) into a from auth.users u left join public.admin_user_flags f on f.user_id = u.id where u.id = p_target; end if;
  if a is null and p_action in ('assign_child','move_child') then select to_jsonb(c) into a from public.children c where id = p_target; end if;
  perform public.admin_log(p_action, p_target::text, b, a, p_args || jsonb_build_object('rows', n));
  return jsonb_build_object('ok', true, 'action', p_action, 'after', a, 'rows', n); end $$;

-- Data explorer
create or replace function public.admin_tables() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j jsonb; begin perform public.admin_guard();
  select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'rls', c.relrowsecurity, 'est', c.reltuples::bigint, 'rows', public.admin_count(c.relname),
    'policies', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
    'editable', c.relname = any(public.admin_editable())) order by c.relname), '[]') into j
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'; return j; end $$;
create or replace function public.admin_editable() returns text[] language sql immutable as $$
  select array['children','families','family_members','child_viewers','list_shares','user_prefs','support_tickets','tasks','shop_items','profiles','mail_outbox']::text[] $$;
create or replace function public.admin_table_info(t text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j jsonb; begin perform public.admin_guard();
  if to_regclass('public.' || quote_ident(t)) is null then raise exception 'no_such_table'; end if;
  select jsonb_build_object('name', t,
    'columns', (select jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable = 'YES', 'default', column_default) order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = t),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check)), '[]') from pg_policies where schemaname = 'public' and tablename = t),
    'pk', (select jsonb_agg(a.attname) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = ('public.' || quote_ident(t))::regclass and i.indisprimary),
    'editable', t = any(public.admin_editable())) into j; return j; end $$;
create or replace function public.admin_browse(t text, p_col text default null, p_val text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j jsonb; n bigint; w text := ''; c text; begin perform public.admin_guard();
  if to_regclass('public.' || quote_ident(t)) is null then raise exception 'no_such_table'; end if;
  if coalesce(p_col, '') <> '' then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = p_col) then raise exception 'no_such_column'; end if;
    w := format(' where %I::text ilike %L', p_col, '%' || coalesce(p_val, '') || '%'); end if;
  c := public.admin_tscol(t);
  execute format('select count(*) from public.%I%s', t, w) into n;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (select * from public.%I%s %s limit %s offset %s) x', t, w,
    case when c is null then '' else format('order by %I desc nulls last', c) end, least(greatest(p_limit, 1), 200), greatest(p_offset, 0)) into j;
  -- never ship secrets to the browser even to the admin
  select coalesce(jsonb_agg(r - array['code_hash','secret','token','token_hash','confirm_code','access_token','refresh_token']), '[]') into j from jsonb_array_elements(j) r;
  return jsonb_build_object('total', n, 'rows', j); end $$;
create or replace function public.admin_row_update(t text, p_id text, p_patch jsonb, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b jsonb; a jsonb; k text; sets text := ''; pk text; begin perform public.admin_guard();
  if not (t = any(public.admin_editable())) then raise exception 'table_not_editable'; end if;
  if lower(coalesce(p_confirm, '')) <> 'edit' then raise exception 'confirm_mismatch: type EDIT'; end if;
  select a2.attname into pk from pg_index i join pg_attribute a2 on a2.attrelid = i.indrelid and a2.attnum = any(i.indkey) where i.indrelid = ('public.' || quote_ident(t))::regclass and i.indisprimary limit 1;
  if pk is null then raise exception 'no_pk'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k = pk or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = k) then raise exception 'bad_column %', k; end if;
    sets := sets || case when sets = '' then '' else ', ' end || format('%1$I = (jsonb_populate_record(null::public.%2$I, $1)).%1$I', k, t); end loop;
  if sets = '' then raise exception 'empty_patch'; end if;
  execute format('select to_jsonb(x) from public.%I x where %I::text = $1', t, pk) into b using p_id;
  if b is null then raise exception 'no_such_row'; end if;
  execute format('update public.%I set %s where %I::text = $2 returning to_jsonb(%I.*)', t, sets, pk, t) into a using p_patch, p_id;
  perform public.admin_log('row_update', t || ':' || p_id, b, a, jsonb_build_object('table', t, 'cols', (select jsonb_agg(x) from jsonb_object_keys(p_patch) x)));
  return jsonb_build_object('ok', true, 'after', a); end $$;

create or replace function public.admin_sync(p_limit int default 60) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j jsonb; begin perform public.admin_guard();
  select jsonb_build_object('edu_sync_runs', public.admin_recent('edu_sync_runs', p_limit), 'sync_log', public.admin_recent('sync_log', p_limit),
    'ext_sync_runs', public.admin_recent('ext_sync_runs', p_limit), 'mail_outbox', public.admin_recent('mail_outbox', 30),
    'sync_requests', public.admin_recent('sync_requests', 20), 'health_ingest_log', public.admin_recent('health_ingest_log', 20)) into j;
  -- strip bodies from outbox rows
  j := jsonb_set(j, '{mail_outbox}', coalesce((select jsonb_agg(r - array['body','html','text']) from jsonb_array_elements(j -> 'mail_outbox') r), 'null'));
  return j; end $$;

create or replace function public.admin_audit_list(p_limit int default 100, p_q text default '') returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j jsonb; begin perform public.admin_guard();
  select coalesce(jsonb_agg(to_jsonb(a) order by a.at desc), '[]') into j from (select * from public.admin_audit
    where coalesce(p_q,'') = '' or action ilike '%'||p_q||'%' or target ilike '%'||p_q||'%' or actor_email ilike '%'||p_q||'%' order by at desc limit least(greatest(p_limit,1),500)) a; return j; end $$;

create or replace function public.admin_whoami() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.admin_guard(); return jsonb_build_object('admin', true, 'email', lower(auth.jwt() ->> 'email'), 'migration', '019'); end $$;

do $$ declare f text; begin
  foreach f in array array['admin_guard()','admin_log(text,text,jsonb,jsonb,jsonb)','admin_count(text)','admin_tscol(text)','admin_recent(text,int)','admin_uidcol(text)',
    'admin_overview()','admin_users(text,int)','admin_user_detail(uuid)','admin_action(text,uuid,jsonb,text)','admin_tables()','admin_editable()','admin_table_info(text)',
    'admin_browse(text,text,text,int,int)','admin_row_update(text,text,jsonb,text)','admin_sync(int)','admin_audit_list(int,text)','admin_whoami()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f); end loop;
  foreach f in array array['admin_overview()','admin_users(text,int)','admin_user_detail(uuid)','admin_action(text,uuid,jsonb,text)','admin_tables()','admin_table_info(text)',
    'admin_browse(text,text,text,int,int)','admin_row_update(text,text,jsonb,text)','admin_sync(int)','admin_audit_list(int,text)','admin_whoami()'] loop
    execute format('grant execute on function public.%s to authenticated', f); end loop; end $$;
notify pgrst, 'reload schema';
