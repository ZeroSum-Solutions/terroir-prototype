-- Expected failure on a pre-0164 baseline: prerequisite drift must block DDL.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
\if :{?drift_kind}
\else
  \echo C09_0164_DRIFT_KIND_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'drift_kind' in ('helper_body','apply_owner','trigger','constraint')
  and pg_catalog.to_regprocedure(
    'public.revert_import_batch_private(uuid)'
  ) is null
then 1 else 0 end as c09_0164_forward_refusal_target;
begin;
select :'drift_kind'='helper_body' as helper_body,
       :'drift_kind'='apply_owner' as apply_owner,
       :'drift_kind'='trigger' as trigger_drift,
       :'drift_kind'='constraint' as constraint_drift
\gset
\if :helper_body
  create or replace function public.current_site_role_at_least(
    p_restaurant_id uuid,p_required public.membership_role
  ) returns boolean language sql stable security definer set search_path=''
  as $$ select false $$;
\elif :apply_owner
  -- The temporary schema capability and owner drift are transaction-local:
  -- the expected forward-migration refusal rolls both back on disconnect.
  grant create on schema public to authenticated;
  alter function public.apply_import_batch_chunk(uuid,integer)
    owner to authenticated;
\elif :trigger_drift
  alter table public.inventory_items
    disable trigger inventory_items_reflect_import_delete;
\else
  alter table public.import_batch_rows
    drop constraint import_batch_rows_applied_has_inventory_id;
\endif
\ir ../../migrations/0164_import_revert_cleanup.sql
\echo C09_0164_ERROR_FORWARD_ACCEPTED_PREREQUISITE_DRIFT
\quit 1
