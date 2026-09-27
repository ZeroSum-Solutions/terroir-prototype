-- Connection B: wait, then prove the fresh authority statement sees revocation.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
\if :{?target_admitted}
\else
  \quit 3
\endif
\if :{?actor_id}
\else
  \quit 3
\endif
\if :{?batch_id}
\else
  \quit 3
\endif
\if :{?site_id}
\else
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and exists(select 1 from public.import_batches b
              where b.id=:'batch_id'::uuid
                and b.restaurant_id=:'site_id'::uuid)
then 1 else 0 end as c09_0164_authority_wait_b_target;
begin;
set local role authenticated;
set local statement_timeout='20s';
set local lock_timeout='15s';
select pg_catalog.set_config('application_name','c09_0164_auth_wait_b',true);
select pg_catalog.set_config('request.jwt.claim.sub',:'actor_id',true);
select pg_catalog.set_config('c09_0164.batch_id',:'batch_id',true);
do $c09_0164_waiting_authority$
begin
  begin
    perform public.revert_import_batch_private(
      pg_catalog.current_setting('c09_0164.batch_id')::uuid
    );
    raise exception 'C09_0164_EXPECTED_POST_WAIT_AUTHORITY_REFUSAL';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'import_batch_not_found' then raise; end if;
  end;
end;
$c09_0164_waiting_authority$;
commit;
\echo C09_0164_AUTHORITY_WAIT_B_PASS
