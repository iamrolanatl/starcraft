-- Crystal 017: Family sharing. A parent invites a child with a short code; the child joins (PENDING);
-- the parent approves after matching a 6-digit confirmation code shown on both screens. Only ACTIVE
-- child members get read access to the parent's school/calendar/to-do data. Safe to re-run. Run after 016.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null unique references auth.users(id) on delete cascade,
  name text check (char_length(name) <= 80),
  created_at timestamptz not null default now());

create table if not exists public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,   -- one family per account
  role text not null default 'child' check (role in ('parent','child')),
  status text not null default 'pending' check (status in ('pending','active','denied','revoked')),
  confirm_code text check (confirm_code ~ '^[0-9]{6}$'),
  display_name text, email text,
  invite_id uuid, child_id uuid,                                            -- the children row this login IS
  joined_at timestamptz not null default now(), decided_at timestamptz,
  primary key (family_id, user_id));

create table if not exists public.family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  code_hash bytea not null unique,
  hint text,                                                                 -- last 2 chars, for the list
  child_id uuid,                                                             -- which child this login is for
  email text check (email is null or email like '%@%'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz, used_by uuid, revoked_at timestamptz);

create table if not exists public.family_join_attempts (                    -- rate limit per signed-in account
  user_id uuid primary key references auth.users(id) on delete cascade,
  failures int not null default 0, locked_until timestamptz, last_at timestamptz not null default now());

create table if not exists public.family_events (
  id bigint generated always as identity primary key,
  family_id uuid references public.families(id) on delete cascade,
  owner uuid references auth.users(id) on delete cascade,                 -- list-share events: the list owner
  actor uuid, target uuid,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),   -- invite, join, approve, deny, revoke, leave, share_*, viewer_*, child_*, view
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now());


-- ================= Children (a child can exist without a login) + trusted-adult viewers =================
create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name text check (char_length(last_name) <= 60),
  grade text check (char_length(grade) <= 20), school text check (char_length(school) <= 120), district text check (char_length(district) <= 120),
  student_id text check (char_length(student_id) <= 40),
  avatar_color text not null default '#7dd3fc' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  user_id uuid unique references auth.users(id) on delete set null,          -- linked login after the parent approves
  edu_student_id uuid unique references public.edu_students(id) on delete set null,  -- ParentVUE student this child maps to
  sort int not null default 0,
  created_at timestamptz not null default now());
create table if not exists public.child_viewers (                            -- RLS grants for trusted adults
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  relationship text not null check (relationship in ('Mother','Father','Grandmother','Grandfather','Aunt','Uncle','Babysitter','Tutor','Other')),
  scopes text[] not null check (scopes <@ array['grades','assignments','report_cards','attendance','schedule','calendar','learn']::text[] and cardinality(scopes) > 0),
  status text not null default 'pending' check (status in ('pending','active','paused','denied','revoked')),
  expires_at timestamptz,
  confirm_code text check (confirm_code ~ '^[0-9]{6}$'),
  viewer_name text, viewer_email text, owner_name text, child_name text, invite_id uuid,
  last_viewed_at timestamptz, joined_at timestamptz not null default now(), decided_at timestamptz,
  unique (child_id, user_id));
create table if not exists public.viewer_invites (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  relationship text not null, scopes text[] not null, access_expires_at timestamptz,
  code_hash bytea not null unique, hint text,
  outbox_id uuid references public.mail_outbox(id) on delete set null,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz, used_by uuid, revoked_at timestamptz);

-- ---------- helpers (SECURITY DEFINER so policies never recurse) ----------
create or replace function public.is_family_member(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members m join public.families f on f.id = m.family_id
                 where f.owner = is_family_member.owner and m.user_id = (select auth.uid())
                   and m.status = 'active' and m.role = 'child') $$;
create or replace function public.is_family_parent_of(child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members m join public.families f on f.id = m.family_id
                 where m.user_id = is_family_parent_of.child and m.status = 'active' and f.owner = (select auth.uid())) $$;
create or replace function public.my_family_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.families where owner = (select auth.uid()) $$;
revoke all on function public.is_family_member(uuid), public.is_family_parent_of(uuid), public.my_family_id() from public, anon;
grant execute on function public.is_family_member(uuid), public.is_family_parent_of(uuid), public.my_family_id() to authenticated;

-- ---------- RLS on the family tables (all writes go through the RPCs below) ----------
do $$ declare t text; begin
  foreach t in array array['families','family_members','family_invites','family_join_attempts','family_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop; end $$;
grant select on public.families, public.family_members, public.family_events to authenticated;
grant select (id, family_id, hint, email, created_at, expires_at, used_at, used_by, revoked_at) on public.family_invites to authenticated;  -- never code_hash
drop policy if exists "families read" on public.families;
create policy "families read" on public.families for select to authenticated
  using (owner = (select auth.uid()) or exists (select 1 from public.family_members m where m.family_id = families.id and m.user_id = (select auth.uid())));
drop policy if exists "members read" on public.family_members;
create policy "members read" on public.family_members for select to authenticated
  using (user_id = (select auth.uid()) or family_id = (select public.my_family_id()));
drop policy if exists "invites read" on public.family_invites;
create policy "invites read" on public.family_invites for select to authenticated using (family_id = (select public.my_family_id()));
drop policy if exists "events read" on public.family_events;
create policy "events read" on public.family_events for select to authenticated using (family_id = (select public.my_family_id()) or owner = (select auth.uid()));

-- ---------- RPCs ----------
create or replace function public.family_norm(code text) returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Parent: create a one-time invite. Returns the plain code ONCE (only its sha256 is stored).
drop function if exists public.family_create_invite(text);
create or replace function public.family_create_invite(p_child uuid, p_email text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); fam uuid; a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea; c text := ''; i int; inv uuid; exp timestamptz;
begin
  if uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if exists (select 1 from public.family_members where user_id = uid and role = 'child' and status in ('pending','active')) then
    raise exception 'child accounts cannot invite' using errcode = '42501'; end if;
  insert into public.families (owner) values (uid) on conflict (owner) do nothing;
  select id into fam from public.families where owner = uid;
  insert into public.family_members (family_id, user_id, role, status, decided_at) values (fam, uid, 'parent', 'active', now()) on conflict do nothing;
  if (select count(*) from public.family_invites where family_id = fam and used_at is null and revoked_at is null and expires_at > now()) >= 5 then
    raise exception 'too many open invites; revoke one first' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.children where id = p_child and family_id = fam) then raise exception 'pick one of your children' using errcode = '42501'; end if;
  if exists (select 1 from public.family_members where child_id = p_child and status in ('pending','active')) then raise exception 'this child already has a login'; end if;
  b := extensions.gen_random_bytes(8);
  for i in 0..7 loop c := c || substr(a, 1 + (get_byte(b, i) % 31), 1); end loop;
  insert into public.family_invites (family_id, code_hash, hint, email, child_id)
    values (fam, extensions.digest(c, 'sha256'), right(c, 2), nullif(trim(p_email), ''), p_child) returning id, expires_at into inv, exp;
  insert into public.family_events (family_id, actor, kind, detail) values (fam, uid, 'invite', jsonb_build_object('invite_id', inv));
  return jsonb_build_object('id', inv, 'code', left(c, 4) || '-' || right(c, 4), 'expires_at', exp);
end $$;

-- Child: redeem a code -> PENDING membership + 6-digit confirmation code. 5 wrong tries locks for 1 hour.
create or replace function public.family_join_core(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); c text := public.family_norm(p_code); inv public.family_invites; att public.family_join_attempts;
  conf text; nm text; em text;
begin
  if uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into public.family_join_attempts (user_id) values (uid) on conflict (user_id) do nothing;
  select * into att from public.family_join_attempts where user_id = uid for update;
  if att.locked_until > now() then return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', att.locked_until); end if;
  select * into inv from public.family_invites where code_hash = extensions.digest(c, 'sha256') for update;
  if inv.id is null and exists (select 1 from public.list_invites where code_hash = extensions.digest(c, 'sha256')) then
    return public.list_join_core(c, uid);                                    -- a Shopping/Wish List share code
  end if;
  if inv.id is null and exists (select 1 from public.viewer_invites where code_hash = extensions.digest(c, 'sha256')) then
    return public.viewer_join_core(c, uid);                                  -- a trusted-adult (Share Child's Education) code
  end if;
  if inv.id is not null and inv.used_at is null and inv.revoked_at is null and inv.expires_at > now() then
    if exists (select 1 from public.families where owner = uid) then return jsonb_build_object('ok', false, 'error', 'parent_account'); end if;
    if exists (select 1 from public.family_members where user_id = uid and status in ('pending','active')) then return jsonb_build_object('ok', false, 'error', 'already_member'); end if;
  end if;
  if inv.id is null or inv.used_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
    update public.family_join_attempts set failures = case when att.locked_until is not null and att.locked_until <= now() then 1 else failures + 1 end,
      locked_until = case when (case when att.locked_until is not null and att.locked_until <= now() then 1 else failures + 1 end) >= 5 then now() + interval '1 hour' else null end,
      last_at = now() where user_id = uid returning * into att;
    insert into public.family_events (family_id, actor, kind, detail) values (inv.family_id, uid, case when att.locked_until is not null then 'locked' else 'join_failed' end,
      jsonb_build_object('reason', case when inv.id is null then 'bad_code' when inv.used_at is not null then 'used' when inv.revoked_at is not null then 'revoked' else 'expired' end));
    return jsonb_build_object('ok', false, 'error', case when att.locked_until is not null then 'locked' when inv.id is null then 'bad_code' when inv.used_at is not null then 'used' when inv.revoked_at is not null then 'revoked' else 'expired' end,
      'tries_left', greatest(0, 5 - att.failures), 'locked_until', att.locked_until);
  end if;
  update public.family_join_attempts set failures = 0, locked_until = null, last_at = now() where user_id = uid;
  update public.family_invites set used_at = now(), used_by = uid where id = inv.id;
  conf := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name), u.email into nm, em
    from auth.users u left join public.profiles p on p.id = u.id where u.id = uid;
  delete from public.family_members where user_id = uid and status in ('denied','revoked');
  insert into public.family_members (family_id, user_id, role, status, confirm_code, display_name, email, invite_id, child_id)
    values (inv.family_id, uid, 'child', 'pending', conf, nm, em, inv.id, inv.child_id);
  insert into public.family_events (family_id, actor, kind, detail) values (inv.family_id, uid, 'join', jsonb_build_object('invite_id', inv.id));
  return jsonb_build_object('ok', true, 'kind', 'family', 'status', 'pending', 'confirm_code', conf);
end $$;

-- Parent: approve or deny a pending child.
create or replace function public.family_decide(p_user uuid, p_approve boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare fam uuid := public.my_family_id(); n int;
begin
  if fam is null then raise exception 'not a family owner' using errcode = '42501'; end if;
  update public.family_members set status = case when p_approve then 'active' else 'denied' end, decided_at = now(), confirm_code = null
    where family_id = fam and user_id = p_user and status = 'pending' and role = 'child';
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'no_pending_member'); end if;
  if p_approve then update public.children c set user_id = p_user from public.family_members m where m.user_id = p_user and m.family_id = fam and c.id = m.child_id; end if;
  insert into public.family_events (family_id, actor, target, kind) values (fam, auth.uid(), p_user, case when p_approve then 'approve' else 'deny' end);
  return jsonb_build_object('ok', true);
end $$;

-- Parent: remove a member (any status) at any time. Access ends immediately.
create or replace function public.family_revoke_member(p_user uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare fam uuid := public.my_family_id(); n int;
begin
  if fam is null then raise exception 'not a family owner' using errcode = '42501'; end if;
  update public.family_members set status = 'revoked', decided_at = now(), confirm_code = null
    where family_id = fam and user_id = p_user and role = 'child' and status in ('pending','active');
  get diagnostics n = row_count;
  if n > 0 then update public.children set user_id = null where family_id = fam and user_id = p_user;
    insert into public.family_events (family_id, actor, target, kind) values (fam, auth.uid(), p_user, 'revoke'); end if;
  return jsonb_build_object('ok', n > 0);
end $$;

create or replace function public.family_revoke_invite(p_invite uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare fam uuid := public.my_family_id(); n int;
begin
  update public.family_invites set revoked_at = now() where id = p_invite and family_id = fam and used_at is null and revoked_at is null;
  get diagnostics n = row_count;
  if n > 0 then insert into public.family_events (family_id, actor, kind, detail) values (fam, auth.uid(), 'invite_revoked', jsonb_build_object('invite_id', p_invite)); end if;
  return jsonb_build_object('ok', n > 0);
end $$;

-- Child: leave the family (or cancel a pending join).
create or replace function public.family_leave() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m public.family_members;
begin
  update public.family_members set status = 'revoked', decided_at = now(), confirm_code = null
    where user_id = auth.uid() and role = 'child' and status in ('pending','active') returning * into m;
  if m.user_id is not null then update public.children set user_id = null where user_id = auth.uid();
    insert into public.family_events (family_id, actor, target, kind) values (m.family_id, auth.uid(), auth.uid(), 'leave'); end if;
  return jsonb_build_object('ok', m.user_id is not null);
end $$;

-- Anyone: my role. {role:'solo'|'parent'|'child', status, confirm_code (pending child only), owner_name}
create or replace function public.family_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('role', 'parent', 'status', 'active', 'family_id', f.id) from public.families f where f.owner = auth.uid()),
    (select jsonb_build_object('role', 'child', 'status', m.status, 'family_id', m.family_id, 'confirm_code', case when m.status = 'pending' then m.confirm_code end,
            'child_id', m.child_id, 'owner_name', coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(left(p.last_name, 1) || '.', '')), ''), p.display_name, 'your parent'))
       from public.family_members m join public.families f on f.id = m.family_id left join public.profiles p on p.id = f.owner
      where m.user_id = auth.uid() and m.role = 'child' order by m.joined_at desc limit 1),
    jsonb_build_object('role', 'solo')) $$;

revoke all on function public.family_create_invite(uuid, text), public.family_decide(uuid, boolean), public.family_revoke_member(uuid),
  public.family_revoke_invite(uuid), public.family_leave(), public.family_status() from public, anon;
grant execute on function public.family_create_invite(uuid, text), public.family_decide(uuid, boolean), public.family_revoke_member(uuid),
  public.family_revoke_invite(uuid), public.family_leave(), public.family_status() to authenticated;

-- ================= Shopping / Wish List shares (same code + 6-digit confirm flow) =================
create table if not exists public.list_invites (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list text not null check (list in ('shopping','wish')),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  perm text not null default 'view' check (perm in ('view','edit')),
  code_hash bytea not null unique, hint text,
  outbox_id uuid references public.mail_outbox(id) on delete set null,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz, used_by uuid, revoked_at timestamptz);
create table if not exists public.list_shares (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  list text not null check (list in ('shopping','wish')),
  member uuid not null references auth.users(id) on delete cascade,
  perm text not null default 'view' check (perm in ('view','edit')),
  status text not null default 'pending' check (status in ('pending','active','denied','revoked')),
  confirm_code text check (confirm_code ~ '^[0-9]{6}$'),
  member_name text, member_email text, owner_name text, invite_id uuid,
  joined_at timestamptz not null default now(), decided_at timestamptz,
  unique (owner, list, member));
do $$ declare t text; begin foreach t in array array['list_invites','list_shares'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from anon, authenticated', t); end loop; end $$;
grant select (id, owner, list, email, perm, hint, outbox_id, created_at, expires_at, used_at, used_by, revoked_at) on public.list_invites to authenticated;
grant select on public.list_shares to authenticated;
drop policy if exists "list invites owner" on public.list_invites;
create policy "list invites owner" on public.list_invites for select to authenticated using (owner = (select auth.uid()));
drop policy if exists "list shares read" on public.list_shares;
create policy "list shares read" on public.list_shares for select to authenticated using (owner = (select auth.uid()) or member = (select auth.uid()));

create or replace function public.can_list(p_owner uuid, p_list text, p_edit boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.list_shares s where s.owner = p_owner and s.list = p_list and s.member = (select auth.uid())
                 and s.status = 'active' and (not p_edit or s.perm = 'edit')) $$;
revoke all on function public.can_list(uuid, text, boolean) from public, anon;
grant execute on function public.can_list(uuid, text, boolean) to authenticated;

-- shop_items: shared members read (view) or read+write (edit) ONLY that owner's list rows.
grant select, insert, update, delete on public.shop_items to authenticated;
drop policy if exists "shop shared read" on public.shop_items;
create policy "shop shared read" on public.shop_items for select to authenticated using ((select public.can_list(user_id, list, false)));
drop policy if exists "shop shared insert" on public.shop_items;
create policy "shop shared insert" on public.shop_items for insert to authenticated with check ((select public.can_list(user_id, list, true)));
drop policy if exists "shop shared update" on public.shop_items;
create policy "shop shared update" on public.shop_items for update to authenticated using ((select public.can_list(user_id, list, true))) with check ((select public.can_list(user_id, list, true)));
drop policy if exists "shop shared delete" on public.shop_items;
create policy "shop shared delete" on public.shop_items for delete to authenticated using ((select public.can_list(user_id, list, true)));

-- Owner pressed "SEND INVITE": create the invite and queue ONE new email (empty thread) in the 012 outbox.
-- The owner's click is the send action; the box sender delivers queued rows. Cancel = list_invite_revoke (cancels while queued).
create or replace function public.list_share_invite(p_list text, p_email text, p_perm text, p_app_url text default 'https://crystal-7ot.pages.dev') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea; c text := ''; i int; inv uuid; ob uuid; nm text; em text := lower(trim(p_email)); code text; lbl text;
begin
  if uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_list not in ('shopping','wish') or p_perm not in ('view','edit') then raise exception 'bad list or permission'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email'; end if;
  if em = lower((select email from auth.users where id = uid)) then raise exception 'that is your own email'; end if;
  if p_app_url !~ '^https://[a-z0-9.-]+(:[0-9]+)?$' then p_app_url := 'https://crystal-7ot.pages.dev'; end if;
  if (select count(*) from public.list_invites where owner = uid and created_at > now() - interval '1 day') >= 20 then raise exception 'too many invites today'; end if;
  b := extensions.gen_random_bytes(8);
  for i in 0..7 loop c := c || substr(a, 1 + (get_byte(b, i) % 31), 1); end loop;
  code := left(c, 4) || '-' || right(c, 4);
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), display_name, 'A Crystal user') into nm from public.profiles where id = uid;
  nm := coalesce(nm, 'A Crystal user'); lbl := case p_list when 'wish' then 'Wish List' else 'Shopping List' end;
  insert into public.mail_outbox (user_id, thread_id, "to", subject, body, status)
    values (uid, null, em, nm || ' shared a ' || lbl || ' with you on Crystal',
      'Hi,' || chr(10) || chr(10) || nm || ' invited you to ' || case p_perm when 'edit' then 'view and edit' else 'view' end || ' their ' || lbl || ' on Crystal.' || chr(10) || chr(10)
      || 'Your invite code: ' || code || chr(10) || 'Open: ' || p_app_url || '/join?code=' || code || chr(10) || chr(10)
      || 'Sign in, enter the code, then read the 6-digit confirmation number to ' || nm || ' so they can approve you. The code works once and expires in 7 days.' || chr(10),
      'queued') returning id into ob;
  insert into public.list_invites (owner, list, email, perm, code_hash, hint, outbox_id) values (uid, p_list, em, p_perm, extensions.digest(c, 'sha256'), right(c, 2), ob) returning id into inv;
  insert into public.family_events (owner, actor, kind, detail) values (uid, uid, 'share_invite', jsonb_build_object('invite_id', inv, 'list', p_list, 'perm', p_perm, 'email', em));
  return jsonb_build_object('id', inv, 'code', code, 'outbox_id', ob);
end $$;

create or replace function public.list_join_core(c text, uid uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare inv public.list_invites; conf text; nm text; em text; onm text;
begin
  select * into inv from public.list_invites where code_hash = extensions.digest(c, 'sha256') for update;
  if inv.used_at is not null or inv.revoked_at is not null or inv.expires_at <= now() or inv.owner = uid then
    update public.family_join_attempts set failures = failures + 1, locked_until = case when failures + 1 >= 5 then now() + interval '1 hour' end, last_at = now() where user_id = uid;
    return jsonb_build_object('ok', false, 'error', case when inv.owner = uid then 'own_list' when inv.used_at is not null then 'used' when inv.revoked_at is not null then 'revoked' else 'expired' end);
  end if;
  update public.family_join_attempts set failures = 0, locked_until = null, last_at = now() where user_id = uid;
  update public.list_invites set used_at = now(), used_by = uid where id = inv.id;
  conf := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name), u.email into nm, em from auth.users u left join public.profiles p on p.id = u.id where u.id = uid;
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(left(last_name, 1) || '.', '')), ''), display_name, 'the owner') into onm from public.profiles where id = inv.owner;
  insert into public.list_shares (owner, list, member, perm, status, confirm_code, member_name, member_email, owner_name, invite_id)
    values (inv.owner, inv.list, uid, inv.perm, 'pending', conf, nm, em, coalesce(onm, 'the owner'), inv.id)
    on conflict (owner, list, member) do update set perm = excluded.perm, status = 'pending', confirm_code = excluded.confirm_code, invite_id = excluded.invite_id, joined_at = now(), decided_at = null;
  insert into public.family_events (owner, actor, kind, detail) values (inv.owner, uid, 'share_join', jsonb_build_object('invite_id', inv.id, 'list', inv.list));
  return jsonb_build_object('ok', true, 'kind', 'list', 'list', inv.list, 'perm', inv.perm, 'status', 'pending', 'confirm_code', conf, 'owner_name', coalesce(onm, 'the owner'));
end $$;
revoke all on function public.list_join_core(text, uuid) from public, anon, authenticated;

-- Owner: approve/deny, change permission, revoke. Member: leave.
create or replace function public.list_share_decide(p_share uuid, p_approve boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.list_shares;
begin
  update public.list_shares set status = case when p_approve then 'active' else 'denied' end, decided_at = now(), confirm_code = null
   where id = p_share and owner = auth.uid() and status = 'pending' returning * into s;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'no_pending_share'); end if;
  insert into public.family_events (owner, actor, target, kind, detail) values (s.owner, auth.uid(), s.member, case when p_approve then 'share_approve' else 'share_deny' end, jsonb_build_object('list', s.list));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.list_share_set_perm(p_share uuid, p_perm text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.list_shares;
begin
  if p_perm not in ('view','edit') then raise exception 'bad permission'; end if;
  update public.list_shares set perm = p_perm where id = p_share and owner = auth.uid() and status in ('pending','active') returning * into s;
  if s.id is null then return jsonb_build_object('ok', false); end if;
  insert into public.family_events (owner, actor, target, kind, detail) values (s.owner, auth.uid(), s.member, 'share_perm', jsonb_build_object('list', s.list, 'perm', p_perm));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.list_share_revoke(p_share uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.list_shares;
begin
  update public.list_shares set status = 'revoked', decided_at = now(), confirm_code = null
   where id = p_share and (owner = auth.uid() or member = auth.uid()) and status in ('pending','active') returning * into s;
  if s.id is null then return jsonb_build_object('ok', false); end if;
  insert into public.family_events (owner, actor, target, kind, detail) values (s.owner, auth.uid(), s.member, case when s.member = auth.uid() then 'share_leave' else 'share_revoke' end, jsonb_build_object('list', s.list));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.list_invite_revoke(p_invite uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare i public.list_invites;
begin
  update public.list_invites set revoked_at = now() where id = p_invite and owner = auth.uid() and used_at is null and revoked_at is null returning * into i;
  if i.id is null then return jsonb_build_object('ok', false); end if;
  update public.mail_outbox set status = 'cancelled' where id = i.outbox_id and status = 'queued';   -- Cancel before the sender picks it up
  insert into public.family_events (owner, actor, kind, detail) values (i.owner, auth.uid(), 'share_invite_revoked', jsonb_build_object('invite_id', i.id, 'list', i.list));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.list_share_invite(text, text, text, text), public.list_share_decide(uuid, boolean), public.list_share_set_perm(uuid, text),
  public.list_share_revoke(uuid), public.list_invite_revoke(uuid) from public, anon;
grant execute on function public.list_share_invite(text, text, text, text), public.list_share_decide(uuid, boolean), public.list_share_set_perm(uuid, text),
  public.list_share_revoke(uuid), public.list_invite_revoke(uuid) to authenticated;

-- Live updates for shared lists (Supabase Realtime respects RLS).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shop_items') then
    execute 'alter publication supabase_realtime add table public.shop_items'; end if; end $$;


-- ---- Shopping / Wish List redesign: richer fields, soft delete, and an ACTIVITY log ----
alter table public.shop_items add column if not exists quantity text check (char_length(quantity) <= 60);
alter table public.shop_items add column if not exists store text check (char_length(store) <= 80);
alter table public.shop_items add column if not exists added_by uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.shop_items add column if not exists deleted_at timestamptz;              -- soft delete (Undo for 5 seconds; hidden after)
alter table public.shop_items add column if not exists updated_at timestamptz not null default now();
update public.shop_items set quantity = qty::text where quantity is null and qty is not null and qty <> 1;
update public.shop_items set added_by = user_id where added_by is null;
create index if not exists shop_items_owner_list on public.shop_items (user_id, list) where deleted_at is null;

create table if not exists public.list_activity (
  id bigint generated always as identity primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  list text not null check (list in ('shopping','wish')),
  actor uuid, actor_name text,
  action text not null check (action in ('added','checked','unchecked','edited','deleted','restored','moved')),
  item_id uuid, item_name text, detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now());
alter table public.list_activity enable row level security;
revoke all on public.list_activity from anon, authenticated;
grant select on public.list_activity to authenticated;
drop policy if exists "list activity read" on public.list_activity;
create policy "list activity read" on public.list_activity for select to authenticated
  using (owner = (select auth.uid()) or (select public.can_list(owner, list, false)));
create index if not exists list_activity_owner on public.list_activity (owner, list, at desc);

create or replace function public.shop_items_activity() returns trigger language plpgsql security definer set search_path = '' as $$
declare a uuid := auth.uid(); nm text; act text; r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if a is null then return case when tg_op = 'DELETE' then old else new end; end if;   -- service/box writes are not logged
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(left(last_name, 1) || '.', '')), ''), display_name, 'Someone') into nm from public.profiles where id = a;
  act := case
    when tg_op = 'INSERT' then 'added'
    when tg_op = 'DELETE' then 'deleted'
    when old.deleted_at is null and new.deleted_at is not null then 'deleted'
    when old.deleted_at is not null and new.deleted_at is null then 'restored'
    when old.list <> new.list then 'moved'
    when old.done <> new.done then case when new.done then 'checked' else 'unchecked' end
    when (to_jsonb(new) - 'updated_at') <> (to_jsonb(old) - 'updated_at') then 'edited' end;
  if act is not null and not (tg_op = 'DELETE' and old.deleted_at is not null) then
    insert into public.list_activity (owner, list, actor, actor_name, action, item_id, item_name, detail)
      values (r.user_id, r.list, a, coalesce(nm, 'Someone'), act, r.id, r.name, case when act = 'moved' then jsonb_build_object('from', old.list) else '{}'::jsonb end);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists shop_items_activity_b on public.shop_items;
create trigger shop_items_activity_b before update on public.shop_items for each row execute function public.shop_items_activity();
drop trigger if exists shop_items_activity_a on public.shop_items;
create trigger shop_items_activity_a after insert or delete on public.shop_items for each row execute function public.shop_items_activity();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'list_activity') then
    execute 'alter publication supabase_realtime add table public.list_activity'; end if; end $$;

-- Single entry point for ANY code (family or list share). Kept the old name for the UI.
create or replace function public.family_join(p_code text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select public.family_join_core(p_code) $$;
revoke all on function public.family_join(text), public.family_join_core(text) from public, anon;
grant execute on function public.family_join(text) to authenticated;

-- ================= Children: RLS, RPCs, child_id columns, backfill, default trigger =================
do $$ declare t text; begin foreach t in array array['children','child_viewers','viewer_invites'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from anon, authenticated', t); end loop; end $$;
grant select, insert, update, delete on public.children to authenticated;
grant select on public.child_viewers to authenticated;
grant select (id, child_id, owner, email, relationship, scopes, access_expires_at, hint, outbox_id, created_at, expires_at, used_at, used_by, revoked_at) on public.viewer_invites to authenticated;

-- access test used by every child-scoped policy. scope 'login' = only the child's own login (messages, alerts, sync runs).
create or replace function public.can_child(p_owner uuid, p_child uuid, p_scope text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_child is not null and (
    exists (select 1 from public.family_members m join public.families f on f.id = m.family_id
             where f.owner = p_owner and m.user_id = (select auth.uid()) and m.role = 'child' and m.status = 'active' and m.child_id = p_child)
    or (p_scope <> 'login' and exists (select 1 from public.child_viewers v
             where v.owner = p_owner and v.child_id = p_child and v.user_id = (select auth.uid()) and v.status = 'active'
               and (v.expires_at is null or v.expires_at > now()) and (p_scope = 'any' or p_scope = any(v.scopes))))) $$;
revoke all on function public.can_child(uuid, uuid, text) from public, anon;
grant execute on function public.can_child(uuid, uuid, text) to authenticated;

drop policy if exists "children parent all" on public.children;
create policy "children parent all" on public.children for all to authenticated
  using (family_id = (select public.my_family_id())) with check (family_id = (select public.my_family_id()));
drop policy if exists "children self read" on public.children;
create policy "children self read" on public.children for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.child_viewers v where v.child_id = children.id and v.user_id = (select auth.uid())
         and v.status = 'active' and (v.expires_at is null or v.expires_at > now())));
drop policy if exists "viewers read" on public.child_viewers;
create policy "viewers read" on public.child_viewers for select to authenticated using (owner = (select auth.uid()) or user_id = (select auth.uid()));
drop policy if exists "viewer invites owner" on public.viewer_invites;
create policy "viewer invites owner" on public.viewer_invites for select to authenticated using (owner = (select auth.uid()));

-- Parent: make sure a family exists (Add Child calls this first).
create or replace function public.family_ensure() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); fam uuid;
begin
  if uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if exists (select 1 from public.family_members where user_id = uid and role = 'child' and status in ('pending','active')) then raise exception 'child accounts cannot add children' using errcode = '42501'; end if;
  insert into public.families (owner) values (uid) on conflict (owner) do nothing;
  select id into fam from public.families where owner = uid;
  insert into public.family_members (family_id, user_id, role, status, decided_at) values (fam, uid, 'parent', 'active', now()) on conflict do nothing;
  return fam;
end $$;
revoke all on function public.family_ensure() from public, anon; grant execute on function public.family_ensure() to authenticated;

-- ---- Trusted adults: invite by email (queued in the 012 outbox ONLY when the parent presses SEND INVITE) ----
create or replace function public.viewer_invite(p_child uuid, p_email text, p_relationship text, p_scopes text[], p_access_expires timestamptz default null,
  p_app_url text default 'https://crystal-7ot.pages.dev') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); fam uuid := public.my_family_id(); ch public.children; a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea; c text := ''; i int;
  em text := lower(trim(p_email)); code text; nm text; inv uuid; ob uuid;
begin
  if fam is null then raise exception 'add a child first' using errcode = '42501'; end if;
  select * into ch from public.children where id = p_child and family_id = fam;
  if ch.id is null then raise exception 'pick one of your children' using errcode = '42501'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email'; end if;
  if p_relationship not in ('Mother','Father','Grandmother','Grandfather','Aunt','Uncle','Babysitter','Tutor','Other') then raise exception 'pick a relationship'; end if;
  if p_scopes is null or cardinality(p_scopes) = 0 or not (p_scopes <@ array['grades','assignments','report_cards','attendance','schedule','calendar','learn']::text[]) then raise exception 'pick at least one section'; end if;
  if p_access_expires is not null and p_access_expires <= now() then raise exception 'the access end date must be in the future'; end if;
  if p_app_url !~ '^https://[a-z0-9.-]+(:[0-9]+)?$' then p_app_url := 'https://crystal-7ot.pages.dev'; end if;
  if (select count(*) from public.viewer_invites where owner = uid and created_at > now() - interval '1 day') >= 20 then raise exception 'too many invites today'; end if;
  b := extensions.gen_random_bytes(8);
  for i in 0..7 loop c := c || substr(a, 1 + (get_byte(b, i) % 31), 1); end loop;
  code := left(c, 4) || '-' || right(c, 4);
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), display_name) into nm from public.profiles where id = uid;
  nm := coalesce(nm, 'A Crystal parent');
  insert into public.mail_outbox (user_id, thread_id, "to", subject, body, status)
    values (uid, null, em, nm || ' shared ' || ch.first_name || '''s school progress with you on Crystal',
      'Hi,' || chr(10) || chr(10) || nm || ' invited you (' || p_relationship || ') to view ' || ch.first_name || '''s school information on Crystal (read-only).' || chr(10) || chr(10)
      || 'Your invite code: ' || code || chr(10) || 'Open: ' || p_app_url || '/join?code=' || code || chr(10) || chr(10)
      || 'Sign in, enter the code, then read the 6-digit confirmation number to ' || nm || ' so they can approve you. The code works once and expires in 7 days.' || chr(10),
      'queued') returning id into ob;
  insert into public.viewer_invites (child_id, owner, email, relationship, scopes, access_expires_at, code_hash, hint, outbox_id)
    values (p_child, uid, em, p_relationship, p_scopes, p_access_expires, extensions.digest(c, 'sha256'), right(c, 2), ob) returning id into inv;
  insert into public.family_events (family_id, owner, actor, kind, detail) values (fam, uid, uid, 'viewer_invite',
    jsonb_build_object('invite_id', inv, 'child_id', p_child, 'email', em, 'relationship', p_relationship, 'scopes', p_scopes));
  return jsonb_build_object('id', inv, 'code', code, 'outbox_id', ob);
end $$;

create or replace function public.viewer_join_core(c text, uid uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare inv public.viewer_invites; conf text; nm text; em text; onm text; cn text;
begin
  select * into inv from public.viewer_invites where code_hash = extensions.digest(c, 'sha256') for update;
  if inv.used_at is not null or inv.revoked_at is not null or inv.expires_at <= now() or inv.owner = uid
     or exists (select 1 from public.family_members where user_id = uid and role = 'child' and status in ('pending','active')) then
    update public.family_join_attempts set failures = failures + 1, locked_until = case when failures + 1 >= 5 then now() + interval '1 hour' end, last_at = now() where user_id = uid;
    return jsonb_build_object('ok', false, 'error', case when inv.owner = uid then 'own_child' when inv.used_at is not null then 'used' when inv.revoked_at is not null then 'revoked' when inv.expires_at <= now() then 'expired' else 'child_account' end);
  end if;
  update public.family_join_attempts set failures = 0, locked_until = null, last_at = now() where user_id = uid;
  update public.viewer_invites set used_at = now(), used_by = uid where id = inv.id;
  conf := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name), u.email into nm, em from auth.users u left join public.profiles p on p.id = u.id where u.id = uid;
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(left(last_name, 1) || '.', '')), ''), display_name, 'the parent') into onm from public.profiles where id = inv.owner;
  select first_name into cn from public.children where id = inv.child_id;
  insert into public.child_viewers (child_id, owner, user_id, relationship, scopes, status, expires_at, confirm_code, viewer_name, viewer_email, owner_name, child_name, invite_id)
    values (inv.child_id, inv.owner, uid, inv.relationship, inv.scopes, 'pending', inv.access_expires_at, conf, nm, em, coalesce(onm, 'the parent'), cn, inv.id)
    on conflict (child_id, user_id) do update set relationship = excluded.relationship, scopes = excluded.scopes, status = 'pending', expires_at = excluded.expires_at,
      confirm_code = excluded.confirm_code, invite_id = excluded.invite_id, joined_at = now(), decided_at = null;
  insert into public.family_events (family_id, owner, actor, kind, detail) values ((select family_id from public.children where id = inv.child_id), inv.owner, uid, 'viewer_join', jsonb_build_object('invite_id', inv.id, 'child_id', inv.child_id));
  return jsonb_build_object('ok', true, 'kind', 'viewer', 'status', 'pending', 'confirm_code', conf, 'owner_name', coalesce(onm, 'the parent'), 'child_name', cn);
end $$;
revoke all on function public.viewer_join_core(text, uuid) from public, anon, authenticated;

-- Parent: approve/deny, edit (relationship/scopes/expiry), pause/resume, revoke. Viewer: leave. Viewer: touch (last viewed).
create or replace function public.viewer_manage(p_viewer uuid, p_action text, p_scopes text[] default null, p_relationship text default null,
  p_expires timestamptz default null, p_clear_expiry boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v public.child_viewers; uid uuid := auth.uid();
begin
  select * into v from public.child_viewers where id = p_viewer for update;
  if v.id is null or (v.owner <> uid and not (p_action = 'leave' and v.user_id = uid)) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_action = 'approve' and v.status = 'pending' then update public.child_viewers set status = 'active', decided_at = now(), confirm_code = null where id = v.id;
  elsif p_action = 'deny' and v.status = 'pending' then update public.child_viewers set status = 'denied', decided_at = now(), confirm_code = null where id = v.id;
  elsif p_action = 'pause' and v.status = 'active' then update public.child_viewers set status = 'paused' where id = v.id;
  elsif p_action = 'resume' and v.status = 'paused' then update public.child_viewers set status = 'active' where id = v.id;
  elsif p_action in ('revoke','leave') and v.status in ('pending','active','paused') then update public.child_viewers set status = 'revoked', decided_at = now(), confirm_code = null where id = v.id;
  elsif p_action = 'edit' and v.status in ('pending','active','paused') then
    if p_scopes is not null and (cardinality(p_scopes) = 0 or not (p_scopes <@ array['grades','assignments','report_cards','attendance','schedule','calendar','learn']::text[])) then raise exception 'pick at least one section'; end if;
    update public.child_viewers set scopes = coalesce(p_scopes, scopes), relationship = coalesce(p_relationship, relationship),
      expires_at = case when p_clear_expiry then null else coalesce(p_expires, expires_at) end where id = v.id;
  else return jsonb_build_object('ok', false, 'error', 'not_allowed_now'); end if;
  insert into public.family_events (family_id, owner, actor, target, kind, detail) values ((select family_id from public.children where id = v.child_id), v.owner, uid, v.user_id,
    'viewer_' || p_action, jsonb_build_object('viewer_id', v.id, 'child_id', v.child_id, 'scopes', coalesce(p_scopes, v.scopes)));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.viewer_invite_revoke(p_invite uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare i public.viewer_invites;
begin
  update public.viewer_invites set revoked_at = now() where id = p_invite and owner = auth.uid() and used_at is null and revoked_at is null returning * into i;
  if i.id is null then return jsonb_build_object('ok', false); end if;
  update public.mail_outbox set status = 'cancelled' where id = i.outbox_id and status = 'queued';
  insert into public.family_events (owner, actor, kind, detail) values (i.owner, auth.uid(), 'viewer_invite_revoked', jsonb_build_object('invite_id', i.id, 'child_id', i.child_id));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.viewer_touch(p_child uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.child_viewers;
begin
  update public.child_viewers set last_viewed_at = now() where child_id = p_child and user_id = auth.uid() and status = 'active'
     and (last_viewed_at is null or last_viewed_at < now() - interval '10 minutes') returning * into v;
  if v.id is not null then insert into public.family_events (owner, actor, kind, detail) values (v.owner, auth.uid(), 'view', jsonb_build_object('child_id', p_child)); end if;
end $$;
revoke all on function public.viewer_invite(uuid, text, text, text[], timestamptz, text), public.viewer_manage(uuid, text, text[], text, timestamptz, boolean),
  public.viewer_invite_revoke(uuid), public.viewer_touch(uuid) from public, anon;
grant execute on function public.viewer_invite(uuid, text, text, text[], timestamptz, text), public.viewer_manage(uuid, text, text[], text, timestamptz, boolean),
  public.viewer_invite_revoke(uuid), public.viewer_touch(uuid) to authenticated;

-- My viewer grants (for the UI of a trusted adult): which children, which sections.
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', public.family_status(),
    'viewing', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'child_id', v.child_id, 'child_name', v.child_name, 'owner_name', v.owner_name,
        'relationship', v.relationship, 'scopes', v.scopes, 'status', v.status, 'expires_at', v.expires_at,
        'confirm_code', case when v.status = 'pending' then v.confirm_code end))
      from public.child_viewers v where v.user_id = auth.uid() and v.status in ('pending','active','paused')), '[]'::jsonb)) $$;
revoke all on function public.my_access() from public, anon; grant execute on function public.my_access() to authenticated;

-- ---- child_id on child-specific tables ----
do $$ declare t text; begin
  foreach t in array array['edu_students','edu_grades','edu_assignments','edu_attendance','edu_messages','edu_calendar','edu_sync_runs','edu_alerts',
                           'edu_graded_assignments','edu_grade_calc','edu_schedule','edu_attendance_periods','edu_attendance_excuses','report_cards',
                           'learn_units','learn_resources','learn_history','edu_checkins'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists child_id uuid references public.children(id) on delete set null', t);
      execute format('create index if not exists %I on public.%I (child_id)', t || '_child_idx', t);
    end if;
  end loop; end $$;

-- Default child: the ParentVUE student's child, else the family's first child. Keeps the existing sync scripts working unchanged.
-- TODO(ParentVUE pull): once a 2nd child syncs, tag rows with child_id explicitly (map ChildPermID -> children.student_id).
create or replace function public.child_for(p_owner uuid, p_student uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.id from public.children c where c.edu_student_id = p_student),
                  (select c.id from public.children c join public.families f on f.id = c.family_id where f.owner = p_owner order by c.sort, c.created_at limit 1)) $$;
revoke all on function public.child_for(uuid, uuid) from public, anon, authenticated;
create or replace function public.default_child_id() returns trigger language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if new.child_id is null then
    if tg_table_name = 'edu_students' then sid := new.id; else
      begin sid := (to_jsonb(new) ->> 'student_id')::uuid; exception when others then sid := null; end; end if;
    new.child_id := public.child_for(new.user_id, sid);
  end if;
  return new;
end $$;
-- INSERT only: removing a child sets child_id to null and must never re-tag those rows to a sibling.
do $$ declare t text; begin
  foreach t in array array['edu_students','edu_grades','edu_assignments','edu_attendance','edu_messages','edu_calendar','edu_sync_runs','edu_alerts',
                           'edu_graded_assignments','edu_grade_calc','edu_schedule','edu_attendance_periods','edu_attendance_excuses','report_cards',
                           'learn_units','learn_resources','learn_history','edu_checkins'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_default_child', t);
      execute format('create trigger %I before insert on public.%I for each row execute function public.default_child_id()', t || '_default_child', t);
    end if;
  end loop; end $$;

-- ---- Backfill: one family per user with ParentVUE students, one child per student; Eli gets his full record. ----
do $$ declare r record; fam uuid; begin
  for r in select distinct user_id from public.edu_students loop
    insert into public.families (owner) values (r.user_id) on conflict (owner) do nothing;
    select id into fam from public.families where owner = r.user_id;
    insert into public.family_members (family_id, user_id, role, status, decided_at) values (fam, r.user_id, 'parent', 'active', now()) on conflict do nothing;
    insert into public.children (family_id, first_name, last_name, grade, school, district, student_id, edu_student_id)
      select fam, split_part(coalesce(nullif(s.full_name, ''), s.name), ' ', 1), nullif(regexp_replace(coalesce(nullif(s.full_name, ''), s.name), '^\S+\s*', ''), ''),
             s.grade, s.school, s.district, s.perm_id, s.id
        from public.edu_students s where s.user_id = r.user_id
         and not exists (select 1 from public.children c where c.edu_student_id = s.id);
  end loop;
  update public.children set first_name = 'Eli', last_name = 'J. Chowdhury', grade = '7', school = 'Dickerson Middle School', district = 'Cobb', student_id = '1351101'
   where edu_student_id in (select id from public.edu_students where perm_id = '1351101' or source_key ilike '%eli%' or name ilike 'eli%');
end $$;
do $$ declare t text; begin   -- tag every existing untagged row (first run only; later runs leave removed-child rows untagged)
  foreach t in array array['edu_students','edu_grades','edu_assignments','edu_attendance','edu_messages','edu_calendar','edu_sync_runs','edu_alerts',
                           'edu_graded_assignments','edu_grade_calc','edu_schedule','edu_attendance_periods','edu_attendance_excuses','report_cards',
                           'learn_units','learn_resources','learn_history','edu_checkins'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I disable trigger user', t);       -- skip audit/no-delete/guard triggers during the backfill
      execute format('update public.%I x set child_id = public.child_for(x.user_id, %s) where child_id is null and not exists (select 1 from public.family_events e where e.kind = ''child_backfill_done'')',
        t, case when t = 'edu_students' then 'x.id' when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'student_id') then 'x.student_id' else 'null' end);
      execute format('alter table public.%I enable trigger user', t);
    end if;
  end loop; end $$;

insert into public.family_events (kind, detail) select 'child_backfill_done', '{}'::jsonb where not exists (select 1 from public.family_events where kind = 'child_backfill_done');

-- ---------- Additive READ policies (scoped per table) ----------
-- Never shared with children or viewers: bills, credit_scores, stocks, mail_*, health_logs, meds, comms_notes, drive_pins,
-- google tokens, edu_attendance_excuses (excuse letters), learn_history, chat_escalations, ext_quarantine, user_prefs, sync_requests.
do $$ declare r record; begin
  for r in select * from (values
      ('edu_students','any'), ('edu_grades','grades'), ('edu_grade_calc','grades'),
      ('edu_assignments','assignments'), ('edu_graded_assignments','assignments'),
      ('report_cards','report_cards'), ('edu_attendance','attendance'), ('edu_attendance_periods','attendance'),
      ('edu_schedule','schedule'), ('edu_calendar','calendar'), ('learn_units','learn'), ('learn_resources','learn'),
      ('edu_messages','login'), ('edu_alerts','login'), ('edu_sync_runs','login')) v(t, scope) loop
    if to_regclass('public.' || r.t) is not null then
      execute format('drop policy if exists "%s family read" on public.%I', r.t, r.t);
      execute format('create policy "%s family read" on public.%I for select to authenticated using ((select public.can_child(user_id, child_id, %L)))', r.t, r.t, r.scope);
    end if;
  end loop;
  -- family-wide (child LOGIN only, never trusted adults): the parent's to-do list and calendar
  foreach r.t in array array['tasks','ext_items','ext_sync_runs'] loop
    execute format('drop policy if exists "%s family read" on public.%I', r.t, r.t);
    execute format('create policy "%s family read" on public.%I for select to authenticated using ((select public.is_family_member(user_id)))', r.t, r.t);
  end loop; end $$;
-- check-ins: the child writes their own (existing "owner all"); the parent may read the child's.
drop policy if exists "edu_checkins parent read" on public.edu_checkins;
create policy "edu_checkins parent read" on public.edu_checkins for select to authenticated using ((select public.is_family_parent_of(user_id)));

-- Report-card PDFs: an active child login / viewer with report_cards may sign URLs for that child's PDFs only.
drop policy if exists "report card pdf family read" on storage.objects;
create policy "report card pdf family read" on storage.objects for select to authenticated
  using (bucket_id = 'raw' and name like 'report-cards/%'
         and exists (select 1 from public.report_cards r where r.storage_path = storage.objects.name and public.can_child(r.user_id, r.child_id, 'report_cards')));
notify pgrst, 'reload schema';
