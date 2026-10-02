-- Guarded down for 0154_site_capability_authority.sql.
-- Refuses durable history and contract-B state; all drops use RESTRICT inside
-- one transaction so an unexpected dependency rolls back every prior step.

begin;

lock table public.memberships in access exclusive mode nowait;
lock table public.workspace_memberships in access exclusive mode nowait;
lock table public.membership_capability_grants in access exclusive mode nowait;
lock table public.workspaces in share mode nowait;
lock table public.restaurants in share mode nowait;
lock table public.pricing_recommendations in share mode nowait;
lock table public.wines in share mode nowait;

do $down_guard$
begin
  if exists (select 1 from public.membership_capability_grants) then
    raise exception 'C04_CANNOT_DOWN_0154_GRANT_HISTORY_EXISTS'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policy p
     where p.polrelid = 'public.pricing_recommendations'::regclass
       and p.polname = 'members can read pricing_recommendations'
       and p.polcmd = 'r'
       and p.polpermissive
       and p.polroles = array[0::oid]
       and pg_catalog.pg_get_expr(p.polqual, p.polrelid) =
         '(restaurant_id IN ( SELECT member_restaurant_ids() AS member_restaurant_ids))'
       and p.polwithcheck is null
  ) or not has_table_privilege(
    'authenticated', 'public.pricing_recommendations', 'SELECT'
  ) then
    raise exception 'C04_CANNOT_DOWN_0154_CONTRACT_B_OR_LEGACY_SELECT_DRIFT'
      using errcode = 'P0001';
  end if;
end;
$down_guard$;

drop function public.read_pricing_recommendations(uuid) restrict;
drop function public.effective_site_ids(text) restrict;
drop function public.replace_member_site_capabilities(uuid,text[],timestamptz,text) restrict;
drop function public.effective_site_capability(uuid,text) restrict;

drop trigger workspace_memberships_z_capability_lifecycle
  on public.workspace_memberships;
drop trigger memberships_z_capability_lifecycle on public.memberships;
drop function public.enforce_workspace_membership_capability_lifecycle() restrict;
drop function public.enforce_site_membership_capability_lifecycle() restrict;

drop function public.retire_membership_capability_grants(uuid[],uuid,text,text) restrict;
drop trigger membership_capability_grants_guard_history
  on public.membership_capability_grants;
drop function public.guard_membership_capability_grant_history() restrict;

drop table public.membership_capability_grants restrict;

alter table public.workspace_memberships
  drop column lifecycle_generation;
alter table public.memberships
  drop column lifecycle_generation;

commit;
