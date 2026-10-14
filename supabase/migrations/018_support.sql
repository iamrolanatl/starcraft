-- Crystal support tickets: error-page "Talk to support" chats -> queue + email to Rolan via the 012 mail outbox.
-- Run in Supabase Dashboard > SQL Editor after 012. Idempotent.
-- Writes happen ONLY through public.support_submit(), called by the /api/support Pages Function with a server-held key
-- (sha256 stored below; the raw key lives only in the Pages secret SUPPORT_KEY). No direct insert/update for anon/auth.
-- Only the owner (iamrolan@gmail.com) can read tickets or change their status.
create extension if not exists pgcrypto;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  secret uuid not null default gen_random_uuid(),          -- returned to the browser; required to append to the ticket
  user_id uuid references auth.users(id) on delete set null,
  user_name text check (length(user_name) <= 120),
  user_email text check (length(user_email) <= 200),
  error_code text check (length(error_code) <= 16),
  url text check (length(url) <= 500),
  ua text check (length(ua) <= 160),
  messages jsonb not null default '[]'::jsonb,              -- [{role:'user'|'assistant', content, at}]
  status text not null default 'queued' check (status in ('queued','open','closed')),
  outbox_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index if not exists support_tickets_status on public.support_tickets(status, created_at desc);
alter table public.support_tickets enable row level security;

-- 'support' kind on the outbox so the send routine can recognise self-notifications.
alter table public.mail_outbox add column if not exists kind text;
do $$ begin
  alter table public.mail_outbox add constraint mail_outbox_kind_chk check (kind is null or (kind = 'support' and lower("to") = 'iamrolan@gmail.com'));
exception when duplicate_object then null; end $$;

create or replace function public.support_is_owner() returns boolean language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') = 'iamrolan@gmail.com' $$;

drop policy if exists support_sel on public.support_tickets;
create policy support_sel on public.support_tickets for select using (public.support_is_owner());
drop policy if exists support_upd on public.support_tickets;
create policy support_upd on public.support_tickets for update using (public.support_is_owner()) with check (public.support_is_owner());
revoke insert, delete on public.support_tickets from anon, authenticated;

create table if not exists public.support_config (k text primary key, v text not null);
alter table public.support_config enable row level security;          -- no policies: invisible to anon/auth
insert into public.support_config(k, v) values ('key_sha256', '21b2c0cfa375ecc54d7d258913c82b0c5e2ec36e08c2d69141834c7265a03c4f') on conflict (k) do update set v = excluded.v;

-- Create (p_id null) or append to a ticket. Returns {id, secret, new}. First message queues ONE email to Rolan.
create or replace function public.support_submit(p_key text, p_id uuid, p_secret uuid, p_code text, p_url text, p_ua text,
  p_name text, p_email text, p_messages jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets; owner_id uuid; ob uuid; body text; uid uuid := auth.uid(); m jsonb;
begin
  if encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') is distinct from (select v from support_config where k = 'key_sha256') then
    raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 40 or length(p_messages::text) > 40000 then
    raise exception 'bad messages'; end if;
  if p_id is not null then
    update support_tickets set messages = p_messages, updated_at = now()
     where id = p_id and secret = p_secret and status <> 'closed' returning * into t;
    if not found then raise exception 'ticket not found' using errcode = 'P0002'; end if;
    return jsonb_build_object('id', t.id, 'secret', t.secret, 'new', false);
  end if;
  insert into support_tickets(user_id, user_name, user_email, error_code, url, ua, messages)
  values (uid, left(p_name, 120), left(p_email, 200), left(p_code, 16), left(p_url, 500), left(p_ua, 160), p_messages) returning * into t;
  select id into owner_id from auth.users where lower(email) = 'iamrolan@gmail.com' limit 1;
  if owner_id is not null then
    body := 'New Crystal support ticket (queued)' || chr(10) || chr(10)
      || 'Error: ' || coalesce(t.error_code, '?') || chr(10) || 'Page: ' || coalesce(t.url, '?') || chr(10)
      || 'When: ' || to_char(t.created_at at time zone 'America/New_York', 'YYYY-MM-DD HH12:MI AM') || ' ET' || chr(10)
      || 'From: ' || coalesce(nullif(t.user_name, ''), 'anonymous') || coalesce(' <' || nullif(t.user_email, '') || '>', '') || chr(10)
      || 'Device: ' || coalesce(t.ua, '?') || chr(10) || chr(10) || 'Conversation so far:' || chr(10);
    for m in select * from jsonb_array_elements(p_messages) loop
      body := body || case when m->>'role' = 'user' then 'Visitor: ' else 'Crystal: ' end || left(coalesce(m->>'content', ''), 2000) || chr(10);
    end loop;
    body := body || chr(10) || 'Full conversation and status: https://crystal-7ot.pages.dev/support?t=' || t.id || chr(10) || 'Ticket ' || t.id;
    begin
      insert into mail_outbox(user_id, thread_id, "to", subject, body, status, kind)
      values (owner_id, null, 'iamrolan@gmail.com', left('[Crystal support] ' || coalesce(t.error_code, 'help') || ' - ' || coalesce(nullif(t.user_name, ''), 'anonymous'), 500), left(body, 100000), 'queued', 'support')
      returning id into ob;
      update support_tickets set outbox_id = ob where id = t.id;
    exception when others then null; end;   -- never lose the ticket because the email could not be queued
  end if;
  return jsonb_build_object('id', t.id, 'secret', t.secret, 'new', true);
end $$;
revoke all on function public.support_submit(text, uuid, uuid, text, text, text, text, text, jsonb) from public;
grant execute on function public.support_submit(text, uuid, uuid, text, text, text, text, text, jsonb) to anon, authenticated, service_role;
