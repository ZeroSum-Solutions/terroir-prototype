\set ON_ERROR_STOP on
\pset pager off

do $acceptance$
begin
  if (select governance_role from public.workspace_memberships
       where id = '15400000-0000-4000-8000-000000000022') is not null then
    raise exception 'C04_0154_GOVERNANCE_DEMOTION_NOT_COMMITTED';
  end if;
  if exists (
    select 1 from public.membership_capability_grants
     where membership_id = '15400000-0000-4000-8000-000000000024'
  ) then
    raise exception 'C04_0154_GOVERNANCE_RACE_APPENDED_GRANT';
  end if;
end;
$acceptance$;

\echo C04_0154_GOVERNANCE_RACE_ACCEPTANCE_PASS
