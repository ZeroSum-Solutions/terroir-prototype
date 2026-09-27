-- Connection B: wait on A, then independently refuse the shared source.
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
then 1 else 0 end as c09_0164_source_conflict_b_target;
begin;
set local role authenticated;
set local statement_timeout='25s';
set local lock_timeout='20s';
select pg_catalog.set_config('application_name','c09_0164_source_conflict_b',true);
select pg_catalog.set_config(
  'request.jwt.claim.sub','16470000-0000-4000-8000-000000000001',true
);
select :'race_kind'='batch' as batch_kind \gset
\if :batch_kind
  do $c09_0164_source_conflict_b_batch$
  declare v_refused boolean:=false;
  begin
    begin
      perform public.revert_import_batch_private(
        '16470000-0000-4000-8000-000000000061'
      );
    exception when sqlstate 'P04I2' then
      if sqlerrm<>'import_source_conflict' then raise; end if;
      v_refused:=true;
    end;
    if not v_refused then
      raise exception 'C09_0164_SOURCE_CONFLICT_B_BATCH_NOT_REFUSED'
        using errcode='P0099';
    end if;
  end;
  $c09_0164_source_conflict_b_batch$;
\else
  do $c09_0164_source_conflict_b_session$
  declare v_refused boolean:=false;
  begin
    begin
      perform public.revert_import_session(
        '16470000-0000-4000-8000-000000000051'
      );
    exception when sqlstate 'P04I2' then
      if sqlerrm<>'import_source_conflict' then raise; end if;
      v_refused:=true;
    end;
    if not v_refused then
      raise exception 'C09_0164_SOURCE_CONFLICT_B_SESSION_NOT_REFUSED'
        using errcode='P0099';
    end if;
  end;
  $c09_0164_source_conflict_b_session$;
\endif
commit;
\echo C09_0164_SOURCE_CONFLICT_RACE_B_PASS
