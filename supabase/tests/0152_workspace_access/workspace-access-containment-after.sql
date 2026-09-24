\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

begin isolation level repeatable read read only;

select
  (select count(*) from public.restaurants) as restaurants,
  (select count(*) from public.workspaces where kind = 'restaurant') as restaurant_workspaces,
  (select count(*) from public.memberships) as site_memberships,
  (select count(*) from public.workspace_memberships) as workspace_memberships,
  (select count(*) from public.workspaces where expanded_at is not null) as expanded_workspaces,
  (select count(*)
     from public.restaurants r
     left join public.workspaces w
       on w.id = r.workspace_id and w.kind = 'restaurant'
    where w.id is null) as invalid_restaurant_links,
  (select count(*)
     from public.memberships m
     join public.restaurants r on r.id = m.restaurant_id
     left join public.workspace_memberships wm
       on wm.id = m.workspace_membership_id
      and wm.workspace_id = r.workspace_id
      and wm.user_id = m.user_id
    where wm.id is null) as invalid_membership_links;

select (
  not exists (
    select 1
      from public.restaurants r
      join public.workspaces w on w.id = r.workspace_id
     where r.workspace_id <> r.id
        or w.kind <> 'restaurant'
        or w.expanded_at is not null
  )
  and not exists (
    select 1
      from public.memberships m
      join public.restaurants r on r.id = m.restaurant_id
      left join public.workspace_memberships wm
        on wm.id = m.workspace_membership_id
       and wm.workspace_id = r.workspace_id
       and wm.user_id = m.user_id
     where wm.id is null
        or m.status <> 'active'
        or m.expires_at is not null
        or m.revoked_at is not null
        or m.granted_by is not null
        or wm.status <> 'active'
        or wm.expires_at is not null
        or wm.revoked_at is not null
        or wm.created_by is not null
        or wm.governance_role is distinct from case
          when m.role = 'owner' then 'workspace_owner'::text
          else null::text
        end
  )
  and not has_table_privilege('authenticated', 'public.workspaces', 'select')
  and not has_table_privilege('authenticated', 'public.workspaces', 'insert')
  and not has_table_privilege('authenticated', 'public.workspace_memberships', 'select')
  and not has_table_privilege('authenticated', 'public.workspace_memberships', 'update')
  and has_function_privilege(
    'authenticated', 'public.shadow_effective_site_access(uuid)', 'execute'
  )
  and not exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid in ('public.restaurants'::regclass, 'public.memberships'::regclass)
       and c.conname in (
         'restaurants_workspace_kind_fkey',
         'memberships_status_check',
         'memberships_revocation_pair_check',
         'memberships_workspace_membership_fkey',
         'memberships_granted_by_fkey'
       )
       and not c.convalidated
  )
) as containment_ok
\gset

\if :containment_ok
  \echo C04_CONTAINMENT_PASS
\else
  \echo C04_CONTAINMENT_FAIL
  \quit 3
\endif

commit;
