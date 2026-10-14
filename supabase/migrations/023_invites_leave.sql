-- 023: (1) tag invite emails so the send routine never holds them for the school-hours window;
--      (2) a child login can no longer leave the family (only the parent removes a child).

-- (1) outbox kind 'invite' = Crystal invite codes (trusted adult, list share). Any recipient, any hour.
alter table public.mail_outbox drop constraint if exists mail_outbox_kind_chk;
alter table public.mail_outbox add constraint mail_outbox_kind_chk
  check (kind is null or kind = 'invite' or (kind = 'support' and lower("to") = 'iamrolan@gmail.com'));
create or replace function public.mail_outbox_tag_invite() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind is null and new.thread_id is null and new.body like '%/join?code=%' then new.kind := 'invite'; end if;
  return new; end $$;
drop trigger if exists mail_outbox_tag_invite on public.mail_outbox;
create trigger mail_outbox_tag_invite before insert on public.mail_outbox for each row execute function public.mail_outbox_tag_invite();
update public.mail_outbox set kind = 'invite' where kind is null and thread_id is null and body like '%/join?code=%';

-- (2) children cannot leave; a pending (not yet approved) request can still be withdrawn.
create or replace function public.family_leave() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m public.family_members;
begin
  if exists (select 1 from public.family_members where user_id = auth.uid() and role = 'child' and status = 'active') then
    raise exception 'Only a parent can remove a child from the family.' using errcode = '42501'; end if;
  update public.family_members set status = 'revoked', decided_at = now(), confirm_code = null
    where user_id = auth.uid() and role = 'child' and status = 'pending' returning * into m;
  if m.user_id is not null then
    insert into public.family_events (family_id, actor, target, kind) values (m.family_id, auth.uid(), auth.uid(), 'leave'); end if;
  return jsonb_build_object('ok', m.user_id is not null);
end $$;
revoke all on function public.family_leave() from public, anon;
grant execute on function public.family_leave() to authenticated;
notify pgrst, 'reload schema';
