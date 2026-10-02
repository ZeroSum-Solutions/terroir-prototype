-- Expected failure: owner, ACL, or search-path drift must block the 0164 down.
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
  and :'drift_kind' in ('owner','acl','search_path')
then 1 else 0 end as c09_0164_down_metadata_target;
begin;
select :'drift_kind'='owner' as is_owner,
       :'drift_kind'='acl' as is_acl
\gset
\if :is_owner
  -- authenticated cannot ordinarily own a public-schema function on the
  -- admitted baseline. Granting CREATE and changing ownership in this same
  -- uncommitted transaction makes the catalog drift executable; the expected
  -- down-migration refusal closes the connection and rolls both changes back.
  grant create on schema public to authenticated;
  alter function public.revert_import_batch_private(uuid) owner to authenticated;
\elif :is_acl
  grant execute on function public.revert_import_batch_core_private(uuid,uuid[])
    to authenticated;
\else
  alter function public.revert_import_batch_private(uuid) set search_path=public;
\endif
\ir ../../migrations/down/0164_import_revert_cleanup.down.sql
\echo C09_0164_ERROR_DOWN_ACCEPTED_METADATA_DRIFT
\quit 1
