-- Restore the exact authenticated ACL profile present before 0155. Run this
-- before the guarded 0153 down.
--
-- REQUIRES one caller-owned transaction: run with
-- `psql -X -v ON_ERROR_STOP=1 --single-transaction` and mutate the 0155
-- schema_migrations row in that same transaction. This file deliberately owns
-- no BEGIN/COMMIT so a failed ledger write also rolls back this ACL change.

do $preimage$
declare
  v_view_oid oid;
  v_owner_oid oid;
  v_executor_oid oid;
  v_authenticated_oid oid;
  v_service_role_oid oid;
  v_acl_profiles text[];
  v_acl_profile text;
begin
  select c.oid, c.relowner
    into strict v_view_oid, v_owner_oid
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'effective_service_pour_events'
     and c.relkind = 'v';

  select oid into strict v_executor_oid
    from pg_catalog.pg_roles where rolname = current_user;
  select oid into strict v_authenticated_oid
    from pg_catalog.pg_roles where rolname = 'authenticated';
  select oid into strict v_service_role_oid
    from pg_catalog.pg_roles where rolname = 'service_role';

  if v_owner_oid <> v_executor_oid then
    raise exception 'C06_0155_DOWN_EXECUTOR_NOT_DIRECT_VIEW_OWNER'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_class c
     where c.oid = v_view_oid
       and c.reloptions = array['security_invoker=true']
       and pg_catalog.obj_description(c.oid, 'pg_class') =
         'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_viewdef(c.oid, false))
  ) then
    raise exception 'C06_0155_DOWN_EFFECTIVE_VIEW_DEFINITION_DRIFT'
      using errcode = 'P0001';
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
    union all
    select p.profile, v_owner_oid, v_service_role_oid, 'SELECT'::text, false
      from profiles p
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
    raise exception 'C06_0155_DOWN_PREIMAGE_ACL_DRIFT'
      using errcode = 'P0001';
  end if;

  v_acl_profile := v_acl_profiles[1];
  perform pg_catalog.set_config(
    'terroir.c06_0155_authenticated_acl_profile',
    v_acl_profile,
    true
  );
end;
$preimage$;

do $outer_transaction_guard$
declare
  v_acl_profile text;
begin
  v_acl_profile := pg_catalog.current_setting(
    'terroir.c06_0155_authenticated_acl_profile',
    true
  );
  if v_acl_profile is null
     or v_acl_profile = ''
     or v_acl_profile not in ('select_only', 'supabase_five') then
    raise exception 'C06_0155_DOWN_OUTER_TRANSACTION_REQUIRED'
      using errcode = 'P0001';
  end if;
end;
$outer_transaction_guard$;

revoke select on table public.effective_service_pour_events from service_role;

do $postimage$
declare
  v_view_oid oid;
  v_owner_oid oid;
  v_executor_oid oid;
  v_authenticated_oid oid;
  v_acl_profile text;
begin
  select c.oid, c.relowner
    into strict v_view_oid, v_owner_oid
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'effective_service_pour_events'
     and c.relkind = 'v';
  select oid into strict v_executor_oid
    from pg_catalog.pg_roles where rolname = current_user;
  select oid into strict v_authenticated_oid
    from pg_catalog.pg_roles where rolname = 'authenticated';

  if v_owner_oid <> v_executor_oid then
    raise exception 'C06_0155_DOWN_EXECUTOR_CHANGED_DURING_MIGRATION'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_class c
     where c.oid = v_view_oid
       and c.reloptions = array['security_invoker=true']
       and pg_catalog.obj_description(c.oid, 'pg_class') =
         'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_viewdef(c.oid, false))
  ) then
    raise exception 'C06_0155_DOWN_EFFECTIVE_VIEW_DEFINITION_CHANGED'
      using errcode = 'P0001';
  end if;

  v_acl_profile := pg_catalog.current_setting(
    'terroir.c06_0155_authenticated_acl_profile',
    true
  );
  if v_acl_profile is null
     or v_acl_profile not in ('select_only', 'supabase_five') then
    raise exception 'C06_0155_DOWN_ACL_PROFILE_CONTEXT_MISSING'
      using errcode = 'P0001';
  end if;

  if exists (
    with actual as (
      select acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
        from pg_catalog.pg_class c
        cross join lateral pg_catalog.aclexplode(
          coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
        ) acl
       where c.oid = v_view_oid
    ), expected as (
      select owner_acl.grantor, owner_acl.grantee,
             owner_acl.privilege_type, owner_acl.is_grantable
        from pg_catalog.aclexplode(
          pg_catalog.acldefault('r', v_owner_oid)
        ) owner_acl
       where owner_acl.grantee = v_owner_oid
      union all
      select v_owner_oid, v_authenticated_oid, 'SELECT'::text, false
      union all
      select v_owner_oid, v_authenticated_oid, extra.privilege_type, false
        from (values
          ('MAINTAIN'::text),
          ('REFERENCES'::text),
          ('TRIGGER'::text),
          ('TRUNCATE'::text)
        ) extra(privilege_type)
       where v_acl_profile = 'supabase_five'
    ), mismatch as (
      (select * from actual except select * from expected)
      union all
      (select * from expected except select * from actual)
    )
    select 1 from mismatch
  ) then
    raise exception 'C06_0155_DOWN_POSTIMAGE_ACL_DRIFT'
      using errcode = 'P0001';
  end if;
end;
$postimage$;
