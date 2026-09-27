\set ON_ERROR_STOP on
\pset pager off

select 'C04_0154_DATA' as evidence,
       count(*) as grant_rows,
       count(*) filter (where revoked_at is null) as current_grant_rows,
       md5(coalesce(string_agg(
         concat_ws('|', id, workspace_id, restaurant_id, workspace_membership_id,
           membership_id, subject_user_id, site_lifecycle_generation,
           workspace_lifecycle_generation, capability_key, granted_at,
           granted_by_user_id, grant_reason, source, expires_at, revoked_at,
           revoked_by_user_id, revoke_reason, revoke_cause),
         E'\n' order by id
       ), '')) as grant_rows_md5
from public.membership_capability_grants;

select 'C04_0154_COLUMNS' as evidence,
       md5(string_agg(
         concat_ws('|', a.attrelid::regclass::text, a.attnum, a.attname,
           pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid)),
         E'\n' order by a.attrelid::regclass::text, a.attnum
       )) as columns_md5
from pg_catalog.pg_attribute a
left join pg_catalog.pg_attrdef d
  on d.adrelid = a.attrelid and d.adnum = a.attnum
where a.attrelid in (
  'public.memberships'::regclass,
  'public.workspace_memberships'::regclass,
  'public.membership_capability_grants'::regclass
)
  and a.attnum > 0 and not a.attisdropped;

select 'C04_0154_ROUTINES' as evidence,
       md5(string_agg(pg_catalog.pg_get_functiondef(p.oid), E'\n'
         order by p.oid::regprocedure::text)) as routines_md5
from pg_catalog.pg_proc p
where p.oid in (
  'public.retire_membership_capability_grants(uuid[],uuid,text,text)'::regprocedure,
  'public.guard_membership_capability_grant_history()'::regprocedure,
  'public.enforce_site_membership_capability_lifecycle()'::regprocedure,
  'public.enforce_workspace_membership_capability_lifecycle()'::regprocedure,
  'public.effective_site_capability(uuid,text)'::regprocedure,
  'public.effective_site_ids(text)'::regprocedure,
  'public.replace_member_site_capabilities(uuid,text[],timestamp with time zone,text)'::regprocedure,
  'public.read_pricing_recommendations(uuid)'::regprocedure
);

select 'C04_0154_TRIGGERS' as evidence,
       md5(string_agg(pg_catalog.pg_get_triggerdef(t.oid), E'\n'
         order by t.tgrelid::regclass::text, t.tgname)) as triggers_md5
from pg_catalog.pg_trigger t
where not t.tgisinternal
  and t.tgname in (
    'membership_capability_grants_guard_history',
    'memberships_z_capability_lifecycle',
    'workspace_memberships_z_capability_lifecycle'
  );

select 'C04_0154_LEGACY_SELECT' as evidence,
       has_table_privilege(
         'authenticated', 'public.pricing_recommendations', 'SELECT'
       ) as authenticated_select,
       exists (
         select 1 from pg_catalog.pg_policy p
          where p.polrelid = 'public.pricing_recommendations'::regclass
            and p.polname = 'members can read pricing_recommendations'
            and p.polcmd = 'r'
       ) as policy_present;
