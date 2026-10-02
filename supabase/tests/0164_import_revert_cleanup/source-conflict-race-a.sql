-- Connection A: refuse the first shared-source revert and retain site serialization.
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
\if :{?race_kind}
\else
  \quit 3
\endif
select 1/case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and :'race_kind' in ('batch','session')
then 1 else 0 end as c09_0164_source_conflict_a_target;
begin;
set local role authenticated;
set local statement_timeout='25s';
set local lock_timeout='20s';
select pg_catalog.set_config('application_name','c09_0164_source_conflict_a',true);
select pg_catalog.set_config(
  'request.jwt.claim.sub','16470000-0000-4000-8000-000000000001',true
);
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'import-mutation:16470000-0000-4000-8000-000000000020',0
  )
);
select :'race_kind'='batch' as batch_kind \gset
\if :batch_kind
  do $c09_0164_source_conflict_a_batch$
  declare v_refused boolean:=false;
  begin
    begin
      perform public.revert_import_batch_private(
        '16470000-0000-4000-8000-000000000060'
      );
    exception when sqlstate 'P04I2' then
      if sqlerrm<>'import_source_conflict' then raise; end if;
      v_refused:=true;
    end;
    if not v_refused then
      raise exception 'C09_0164_SOURCE_CONFLICT_A_BATCH_NOT_REFUSED'
        using errcode='P0099';
    end if;
  end;
  $c09_0164_source_conflict_a_batch$;
\else
  do $c09_0164_source_conflict_a_session$
  declare v_refused boolean:=false;
  begin
    begin
      perform public.revert_import_session(
        '16470000-0000-4000-8000-000000000050'
      );
    exception when sqlstate 'P04I2' then
      if sqlerrm<>'import_source_conflict' then raise; end if;
      v_refused:=true;
    end;
    if not v_refused then
      raise exception 'C09_0164_SOURCE_CONFLICT_A_SESSION_NOT_REFUSED'
        using errcode='P0099';
    end if;
  end;
  $c09_0164_source_conflict_a_session$;
\endif
select pg_catalog.pg_sleep(8);
commit;
\echo C09_0164_SOURCE_CONFLICT_RACE_A_PASS
