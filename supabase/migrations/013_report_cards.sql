-- Crystal 013: Education › Report Cards. PDFs live in the private 'raw' bucket under report-cards/.
-- History is permanent: no delete for anyone (trigger blocks it, even service_role). Safe to re-run.
create table if not exists public.report_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'report_card' check (source in ('report_card','document')),
  school_year text,
  period text,
  period_gu text,
  document_gu text,
  issue_date date,
  file_name text,
  storage_path text not null check (storage_path like 'report-cards/%.pdf'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);
alter table public.report_cards enable row level security;
drop policy if exists "report_cards own read" on public.report_cards;
create policy "report_cards own read" on public.report_cards for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.report_cards from anon, authenticated;
grant select on public.report_cards to authenticated;

create or replace function public.report_cards_no_delete() returns trigger language plpgsql as $$
begin raise exception 'report_cards history is permanent; deletes are not allowed'; end $$;
drop trigger if exists report_cards_no_delete on public.report_cards;
create trigger report_cards_no_delete before delete on public.report_cards for each row execute function public.report_cards_no_delete();

-- let the owner sign URLs for (only) their own report-card PDFs in the private raw bucket
drop policy if exists "report card pdf owner read" on storage.objects;
create policy "report card pdf owner read" on storage.objects for select to authenticated
  using (bucket_id = 'raw' and name like 'report-cards/%'
         and exists (select 1 from public.report_cards r where r.storage_path = storage.objects.name and r.user_id = (select auth.uid())));
notify pgrst, 'reload schema';
