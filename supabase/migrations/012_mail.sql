-- Crystal Comm > Email: school-related Gmail mirror + 5-minute reply outbox.
-- Run in Supabase Dashboard > SQL Editor after 001-011. Idempotent. RLS on, owner-only.
-- Writers: the box routine (service role) ingests mail and sends outbox rows.
-- The signed-in user may: read own mail, toggle is_read, insert outbox rows (status queued), cancel queued rows.
create extension if not exists pgcrypto;

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_id text not null unique,
  thread_id text not null,
  rfc_message_id text,
  "from" text, "to" text, cc text,
  subject text, date timestamptz, snippet text,
  body_text text, body_html text,             -- body_html is sanitized on the box before insert
  labels text[] not null default '{}',
  is_read boolean not null default false,
  school_tag text check (school_tag in ('teacher','school','CTLS','district')),
  has_attachments boolean not null default false,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index if not exists mail_messages_user_date on public.mail_messages(user_id, date desc);
create index if not exists mail_messages_thread on public.mail_messages(user_id, thread_id);

create table if not exists public.mail_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.mail_messages(id) on delete cascade,
  gmail_id text not null,
  attachment_key text not null,               -- stable per message: gmail attachmentId or filename#index
  filename text not null, mime_type text, size bigint,
  storage_path text not null,                 -- mail/<user_id>/<gmail_id>/<file>
  created_at timestamptz not null default now(),
  unique (gmail_id, attachment_key));

create table if not exists public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  thread_id text,
  in_reply_to text,                           -- gmail_id of the message being answered
  "to" text not null check (length("to") between 3 and 2000),
  cc text check (cc is null or length(cc) <= 2000),
  subject text not null check (length(subject) <= 500),
  body text not null check (length(body) between 1 and 100000),
  status text not null default 'queued' check (status in ('draft','queued','sending','sent','failed','cancelled')),
  drafted_by text check (drafted_by in ('crystal')),  -- 'crystal' = auto-drafted; never sent until the user presses Send
  draft_original text,                        -- Crystal's original text, kept to learn the user's edits
  draft_model text, regen_requested boolean not null default false,
  error text, sent_gmail_id text, attempts int not null default 0,
  queued_at timestamptz not null default now(), claimed_at timestamptz, sent_at timestamptz);
create unique index if not exists mail_outbox_one_auto_draft on public.mail_outbox(in_reply_to, drafted_by);  -- nulls distinct: only one Crystal draft per message
create index if not exists mail_outbox_status on public.mail_outbox(status, queued_at);

alter table public.mail_messages enable row level security;
alter table public.mail_attachments enable row level security;
alter table public.mail_outbox enable row level security;

-- Style learning: Crystal's draft vs what the user actually sent (written by trigger when a Crystal draft is queued).
create table if not exists public.mail_style_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outbox_id uuid references public.mail_outbox(id) on delete set null,
  original text not null, final text not null,
  created_at timestamptz not null default now());
create index if not exists mail_style_edits_user on public.mail_style_edits(user_id, created_at desc);
alter table public.mail_style_edits enable row level security;
drop policy if exists mail_style_sel on public.mail_style_edits;
create policy mail_style_sel on public.mail_style_edits for select using (user_id = auth.uid());
drop policy if exists mail_style_del on public.mail_style_edits;
create policy mail_style_del on public.mail_style_edits for delete using (user_id = auth.uid());

drop policy if exists mail_messages_sel on public.mail_messages;
create policy mail_messages_sel on public.mail_messages for select using (user_id = auth.uid());
drop policy if exists mail_messages_upd on public.mail_messages;
create policy mail_messages_upd on public.mail_messages for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists mail_att_sel on public.mail_attachments;
create policy mail_att_sel on public.mail_attachments for select using (user_id = auth.uid());
drop policy if exists mail_outbox_sel on public.mail_outbox;
create policy mail_outbox_sel on public.mail_outbox for select using (user_id = auth.uid());
drop policy if exists mail_outbox_ins on public.mail_outbox;
create policy mail_outbox_ins on public.mail_outbox for insert with check (user_id = auth.uid() and status = 'queued' and drafted_by is null and sent_gmail_id is null and sent_at is null and claimed_at is null and error is null);
drop policy if exists mail_outbox_cancel on public.mail_outbox;
create policy mail_outbox_cancel on public.mail_outbox for update using (user_id = auth.uid() and status in ('draft','queued')) with check (user_id = auth.uid() and status in ('draft','queued','cancelled'));

-- Column guards for non-service callers (RLS can't compare old/new per column).
create or replace function public.mail_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is null or auth.role() = 'service_role' then  -- no JWT = direct DB admin session; PostgREST always sets one
    if tg_table_name = 'mail_messages' then new.updated_at := now(); end if; return new; end if;
  if tg_table_name = 'mail_messages' then
    if (to_jsonb(new) - 'is_read' - 'updated_at') <> (to_jsonb(old) - 'is_read' - 'updated_at') then raise exception 'only is_read can be changed'; end if;
    new.updated_at := now();
  elsif old.status = 'queued' then -- only queued -> cancelled
    if (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') or new.status <> 'cancelled' then raise exception 'you can only cancel a queued message'; end if;
  elsif old.status = 'draft' then -- edit to/cc/subject/body, ask for a regenerate, Send (-> queued) or discard (-> cancelled)
    if (to_jsonb(new) - array['to','cc','subject','body','status','regen_requested']) <> (to_jsonb(old) - array['to','cc','subject','body','status','regen_requested'])
       or new.status not in ('draft','queued','cancelled') then raise exception 'drafts: only recipients, subject, body and status can change'; end if;
    if new.status = 'queued' then
      new.queued_at := now(); new.regen_requested := false;
      if old.draft_original is not null then
        insert into public.mail_style_edits(user_id, outbox_id, original, final) values (old.user_id, old.id, old.draft_original, new.body);
      end if;
    end if;
  else raise exception 'this message can no longer be changed';
  end if;
  return new;
end $$;
drop trigger if exists mail_messages_guard on public.mail_messages;
create trigger mail_messages_guard before update on public.mail_messages for each row execute function public.mail_guard();
drop trigger if exists mail_outbox_guard on public.mail_outbox;
create trigger mail_outbox_guard before update on public.mail_outbox for each row execute function public.mail_guard();

-- Atomic claim for the sender (service role only): queued -> sending, SKIP LOCKED so two runs never get the same row.
-- Also re-queues nothing: a row stuck in 'sending' > 30 min is marked failed (never resent automatically, to avoid duplicates).
create or replace function public.mail_outbox_claim(max_rows int default 10) returns setof public.mail_outbox
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service role only'; end if;
  update public.mail_outbox set status = 'failed', error = 'stuck in sending >30 min; not retried to avoid a duplicate send'
   where status = 'sending' and claimed_at < now() - interval '30 minutes';
  return query
  update public.mail_outbox o set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
   where o.id in (select id from public.mail_outbox where status = 'queued' order by queued_at limit greatest(1, least(max_rows, 50)) for update skip locked)
  returning o.*;
end $$;
revoke all on function public.mail_outbox_claim(int) from public, anon, authenticated;
grant execute on function public.mail_outbox_claim(int) to service_role;

-- Private storage bucket for attachments; owner may read files under their own <user_id>/ folder.
insert into storage.buckets (id, name, public) values ('mail', 'mail', false) on conflict (id) do update set public = false;
drop policy if exists mail_bucket_read on storage.objects;
create policy mail_bucket_read on storage.objects for select using (bucket_id = 'mail' and (storage.foldername(name))[1] = auth.uid()::text);

-- Realtime for live status in the UI (ignore if already added).
do $$ begin
  begin alter publication supabase_realtime add table public.mail_outbox; exception when others then null; end;
  begin alter publication supabase_realtime add table public.mail_messages; exception when others then null; end;
end $$;
