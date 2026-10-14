-- 020: let parents read which child each login invite is for (017 left child_id out of the column grant).
grant select (child_id) on public.family_invites to authenticated;
notify pgrst, 'reload schema';
