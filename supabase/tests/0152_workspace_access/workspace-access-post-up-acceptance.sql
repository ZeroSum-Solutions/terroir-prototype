\set ON_ERROR_STOP on
\pset pager off

begin;

do $acceptance$
declare
  v_owner_user_id     uuid;
  v_manager_user_id   uuid;
  v_staff_user_id     uuid;
  v_restaurant_id     uuid;
  v_workspace_id      uuid;
  v_child_id          uuid;
  v_personal_id       uuid := gen_random_uuid();
  v_other_users       uuid[];
  v_caps              text[];
  v_ids               uuid[];
  v_role_name         text;
  v_table_name        text;
  v_privilege_name    text;
  v_noise             integer;
begin
  select m.user_id, r.id, r.workspace_id
    into v_owner_user_id, v_restaurant_id, v_workspace_id
    from public.memberships m
    join public.restaurants r on r.id = m.restaurant_id
    join public.workspaces w on w.id = r.workspace_id
    join public.workspace_memberships wm on wm.id = m.workspace_membership_id
   where m.role = 'owner'
     and r.id = r.workspace_id
     and w.kind = 'restaurant'
     and w.expanded_at is null
     and wm.governance_role = 'workspace_owner'
     and not exists (
       select 1 from public.memberships other
        where other.restaurant_id = r.id and other.id <> m.id
     )
   order by r.id
   limit 1;

  if v_owner_user_id is null then
    raise exception 'C04_ACCEPTANCE_NEEDS_SINGLETON_OWNER' using errcode = 'P0001';
  end if;

  select array_agg(id order by id)
    into v_other_users
    from (
      select u.id from auth.users u
       where u.id <> v_owner_user_id
       order by u.id
       limit 2
    ) picked;
  if coalesce(array_length(v_other_users, 1), 0) <> 2 then
    raise exception 'C04_ACCEPTANCE_NEEDS_TWO_OTHER_USERS' using errcode = 'P0001';
  end if;
  v_manager_user_id := v_other_users[1];
  v_staff_user_id := v_other_users[2];

  insert into public.restaurants (name, workspace_id)
  values ('C04 explain child ' || v_owner_user_id::text, v_workspace_id)
  returning id into v_child_id;

  insert into public.workspace_memberships (
    workspace_id, user_id, governance_role
  ) values (
    v_workspace_id, v_manager_user_id, 'group_admin'
  );

  perform set_config('request.jwt.claim.sub', v_manager_user_id::text, true);
  if exists (
    select 1 from public.shadow_effective_site_access(v_restaurant_id)
  ) then
    raise exception 'C04_GROUP_ADMIN_IMPLICIT_SITE_ACCESS' using errcode = 'P0001';
  end if;

  insert into public.memberships (user_id, restaurant_id, role)
  values (v_manager_user_id, v_restaurant_id, 'manager');
  insert into public.memberships (user_id, restaurant_id, role)
  values (v_staff_user_id, v_restaurant_id, 'staff');

  perform set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  select a.capabilities into v_caps
    from public.shadow_effective_site_access(v_restaurant_id) a;
  if v_caps is distinct from array[
    'site.read', 'inventory.service', 'inventory.manage',
    'receiving.capture', 'receiving.cost_capture', 'count.capture',
    'discrepancy.approve', 'cost.read', 'margin.read',
    'pricing.manage', 'team.site.manage', 'group.manage'
  ]::text[] then
    raise exception 'C04_OWNER_CAPABILITIES_NOT_EXACT: %', v_caps using errcode = 'P0001';
  end if;
  if exists (select 1 from public.shadow_effective_site_access(v_child_id)) then
    raise exception 'C04_OWNER_IMPLICIT_CHILD_SITE_ACCESS' using errcode = 'P0001';
  end if;

  perform set_config('request.jwt.claim.sub', v_manager_user_id::text, true);
  select a.capabilities into v_caps
    from public.shadow_effective_site_access(v_restaurant_id) a;
  if v_caps is distinct from array[
    'site.read', 'inventory.service', 'inventory.manage',
    'receiving.capture', 'receiving.cost_capture', 'count.capture',
    'discrepancy.approve', 'cost.read', 'margin.read', 'pricing.manage'
  ]::text[] then
    raise exception 'C04_MANAGER_CAPABILITIES_NOT_EXACT: %', v_caps using errcode = 'P0001';
  end if;
  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_ids
    from public.shadow_effective_site_ids('site.read') id;
  if not (v_restaurant_id = any(v_ids)) or v_child_id = any(v_ids) then
    raise exception 'C04_MANAGER_SITE_IDS_NOT_EXPLICIT_ONLY: %', v_ids using errcode = 'P0001';
  end if;
  if public.shadow_has_site_capability(v_restaurant_id, 'invented.capability') then
    raise exception 'C04_UNKNOWN_CAPABILITY_ALLOWED' using errcode = 'P0001';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_user_id::text, true);
  select a.capabilities into v_caps
    from public.shadow_effective_site_access(v_restaurant_id) a;
  if v_caps is distinct from array['site.read', 'inventory.service']::text[] then
    raise exception 'C04_STAFF_CAPABILITIES_NOT_EXACT: %', v_caps using errcode = 'P0001';
  end if;

  insert into public.workspaces (id, kind, name)
  values (v_personal_id, 'personal', 'C04 personal misuse');
  insert into public.workspace_memberships (workspace_id, user_id, governance_role)
  values (v_personal_id, v_staff_user_id, null);
  begin
    insert into public.restaurants (name, workspace_id)
    values ('C04 invalid personal site', v_personal_id);
    raise exception 'C04_PERSONAL_WORKSPACE_OWNED_SITE' using errcode = 'P0001';
  exception
    when foreign_key_violation then null;
  end;

  foreach v_role_name in array array['authenticated', 'anon']::text[] loop
    foreach v_table_name in array array['public.workspaces', 'public.workspace_memberships']::text[] loop
      foreach v_privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[] loop
        if has_table_privilege(v_role_name, v_table_name, v_privilege_name) then
          raise exception 'C04_UNEXPECTED_TABLE_PRIVILEGE: %.% %',
            v_role_name, v_table_name, v_privilege_name using errcode = 'P0001';
        end if;
        if not has_table_privilege('service_role', v_table_name, v_privilege_name) then
          raise exception 'C04_MISSING_SERVICE_TABLE_PRIVILEGE: % %',
            v_table_name, v_privilege_name using errcode = 'P0001';
        end if;
      end loop;
    end loop;
  end loop;

  if exists (
    select 1
      from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) acl
     where c.oid in (
       'public.workspaces'::regclass,
       'public.workspace_memberships'::regclass
     )
       and acl.grantee = 0
       and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'C04_PUBLIC_BASE_TABLE_PRIVILEGE' using errcode = 'P0001';
  end if;

  if not has_function_privilege(
    'authenticated', 'public.shadow_effective_site_access(uuid)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.shadow_has_site_capability(uuid,text)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.shadow_effective_site_ids(text)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.shadow_effective_site_access(uuid)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.shadow_has_site_capability(uuid,text)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'public.shadow_effective_site_ids(text)', 'EXECUTE'
  ) then
    raise exception 'C04_SHADOW_FUNCTION_PRIVILEGE_MISMATCH' using errcode = 'P0001';
  end if;

  -- Make the query-plan fixture large enough that bounded user/site indexes are
  -- economically visible to the planner rather than hidden by tiny-table scans.
  perform set_config('request.jwt.claim.sub', '', true);
  for v_noise in 1..2048 loop
    insert into auth.users (id, email, raw_user_meta_data)
    values (
      gen_random_uuid(),
      format('c04-plan-noise-%s-%s@terroir.test', v_noise, gen_random_uuid()),
      jsonb_build_object('restaurant_name', format('C04 plan noise %s', v_noise))
    );
  end loop;
end;
$acceptance$;

commit;

\echo C04_POST_UP_ACCEPTANCE_PASS
