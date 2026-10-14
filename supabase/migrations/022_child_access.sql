-- 022: Same app for every role + Shopping/Wish lists shared with the family by default.
-- Every family member (parent and approved child logins) can view, add and delete items on each other's Shopping List
-- and Wish List, with the existing activity log. Each member can opt their own lists out (family_set_list_sharing).
-- Trusted adults and list-share guests are NOT family members; they keep only what was explicitly shared with them.
-- Nothing private (bills, credit, health, meds, mail, comms notes) changes: those tables stay owner-only.

alter table public.family_members add column if not exists share_lists boolean not null default true;

-- true when the caller and p_owner are both ACTIVE members of the same family and p_owner shares lists with the family
create or replace function public.family_list_peer(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner <> (select auth.uid()) and exists (
    select 1 from public.family_members me join public.family_members o on o.family_id = me.family_id
     where me.user_id = (select auth.uid()) and me.status = 'active'
       and o.user_id = p_owner and o.status = 'active' and o.share_lists) $$;
revoke all on function public.family_list_peer(uuid) from public, anon;
grant execute on function public.family_list_peer(uuid) to authenticated;

-- explicit share OR family peer (family peers can edit: add / check / delete)
create or replace function public.can_list(p_owner uuid, p_list text, p_edit boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_list in ('shopping','wish') and public.family_list_peer(p_owner))
      or exists (select 1 from public.list_shares s where s.owner = p_owner and s.list = p_list and s.member = (select auth.uid())
                 and s.status = 'active' and (not p_edit or s.perm = 'edit')) $$;

-- whose family lists I can see (for the list switcher)
create or replace function public.family_list_owners() returns table (owner uuid, owner_name text, role text)
language sql stable security definer set search_path = '' as $$
  select o.user_id, coalesce(nullif(o.display_name, ''), c.first_name, split_part(u.email, '@', 1), 'Family'), o.role
    from public.family_members me join public.family_members o on o.family_id = me.family_id
    left join public.children c on c.id = o.child_id
    left join auth.users u on u.id = o.user_id
   where me.user_id = (select auth.uid()) and me.status = 'active'
     and o.user_id <> me.user_id and o.status = 'active' and o.share_lists $$;
revoke all on function public.family_list_owners() from public, anon;
grant execute on function public.family_list_owners() to authenticated;

-- my own opt-out switch (true = family can see and edit my lists)
create or replace function public.family_set_list_sharing(p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.family_members set share_lists = coalesce(p_on, true) where user_id = auth.uid();
  if not found then raise exception 'you are not in a family yet' using errcode = 'P0002'; end if;
  return coalesce(p_on, true); end $$;
revoke all on function public.family_set_list_sharing(boolean) from public, anon;
grant execute on function public.family_set_list_sharing(boolean) to authenticated;

notify pgrst, 'reload schema';
