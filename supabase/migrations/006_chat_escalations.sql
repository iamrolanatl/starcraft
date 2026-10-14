-- Crystal: escalation path for hard chat questions. Run after 005.
-- The chat Pages Function inserts (as the signed-in user, so RLS applies) and enqueues the id on the
-- Cloudflare Queue "crystal-escalations"; the box worker (sync/escalation_worker.py, service role) claims,
-- answers and writes back. Users can read/insert/delete their own rows but never write an answer or status.
create table if not exists public.chat_escalations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 4000),
  history jsonb not null default '[]'::jsonb check (pg_column_size(history) < 65536),
  context text not null default '' check (char_length(context) < 200000),
  reason text,
  status text not null default 'queued' check (status in ('queued','working','answered','failed')),
  answer text, model text, error text, attempts int not null default 0,
  created_at timestamptz not null default now(),
  claimed_at timestamptz, answered_at timestamptz,
  updated_at timestamptz not null default now());
create index if not exists chat_escalations_status_idx on public.chat_escalations (status, created_at);
create index if not exists chat_escalations_user_idx on public.chat_escalations (user_id, created_at desc);
alter table public.chat_escalations enable row level security;
drop policy if exists "owner read" on public.chat_escalations;
drop policy if exists "owner insert queued" on public.chat_escalations;
drop policy if exists "owner delete" on public.chat_escalations;
create policy "owner read" on public.chat_escalations for select using (user_id = auth.uid());
create policy "owner insert queued" on public.chat_escalations for insert
  with check (user_id = auth.uid() and status = 'queued' and answer is null and claimed_at is null and answered_at is null);
create policy "owner delete" on public.chat_escalations for delete using (user_id = auth.uid());
revoke all on public.chat_escalations from anon;
grant select, insert, delete on public.chat_escalations to authenticated;
-- Realtime (client subscribes to its own row; RLS still applies). Ignore the error if already added.
do $$ begin
  alter publication supabase_realtime add table public.chat_escalations;
exception when duplicate_object then null; when undefined_object then null; end $$;
