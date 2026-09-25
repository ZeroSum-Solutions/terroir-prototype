\set ON_ERROR_STOP on
\pset pager off

do $acceptance$
declare
  v_view_oid oid;
  v_owner_oid oid;
  v_authenticated_oid oid;
  v_acl_profiles text[];
begin
  select c.oid, c.relowner
    into strict v_view_oid, v_owner_oid
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'effective_service_pour_events'
     and c.relkind = 'v';
  select oid into strict v_authenticated_oid
    from pg_catalog.pg_roles where rolname = 'authenticated';

  if not exists (
    select 1
      from pg_catalog.pg_class c
     where c.oid = v_view_oid
       and c.reloptions = array['security_invoker=true']
       and pg_catalog.obj_description(c.oid, 'pg_class') =
         'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_viewdef(c.oid, false))
  ) then
    raise exception 'C06_0155_DOWN_EFFECTIVE_VIEW_SEAL_MISMATCH';
  end if;

  with actual as (
    select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) acl
     where c.oid = v_view_oid
  ), profiles(profile) as (
    values ('select_only'::text), ('supabase_five'::text)
  ), expected as (
    select p.profile, owner_acl.grantor, owner_acl.grantee,
           owner_acl.privilege_type, owner_acl.is_grantable
      from profiles p
      cross join lateral pg_catalog.aclexplode(
        pg_catalog.acldefault('r', v_owner_oid)
      ) owner_acl
     where owner_acl.grantee = v_owner_oid
    union all
    select p.profile, v_owner_oid, v_authenticated_oid, 'SELECT'::text, false
      from profiles p
    union all
    select 'supabase_five'::text, v_owner_oid, v_authenticated_oid,
           extra.privilege_type, false
      from (values
        ('MAINTAIN'::text),
        ('REFERENCES'::text),
        ('TRIGGER'::text),
        ('TRUNCATE'::text)
      ) extra(privilege_type)
  ), matching as (
    select p.profile
      from profiles p
     where not exists (
       (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
          from actual a
        except
        select e.grantor, e.grantee, e.privilege_type, e.is_grantable
          from expected e where e.profile = p.profile)
       union all
       (select e.grantor, e.grantee, e.privilege_type, e.is_grantable
          from expected e where e.profile = p.profile
        except
        select a.grantor, a.grantee, a.privilege_type, a.is_grantable
          from actual a)
     )
  )
  select array_agg(profile order by profile)
    into v_acl_profiles
    from matching;

  if coalesce(cardinality(v_acl_profiles), 0) <> 1 then
    raise exception 'C06_0155_DOWN_EXACT_0153_ACL_MISMATCH';
  end if;

  raise notice 'C06_0155_DOWN_ACL_PROFILE=%', v_acl_profiles[1];
end;
$acceptance$;

\echo C06_0155_DOWN_ACCEPTANCE_PASS
