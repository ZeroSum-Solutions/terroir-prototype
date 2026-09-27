-- Connection B: opposite operation; exact expected post-wait refusal is caught.
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
\if :{?race_mode}
\else
  \quit 3
\endif
select 1/case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and :'race_mode' in ('open_first','revert_first')
then 1 else 0 end as c09_0164_physical_b_target;
begin;
set local role authenticated;
set local statement_timeout='25s';
set local lock_timeout='20s';
select pg_catalog.set_config('application_name','c09_0164_physical_b',true);
select pg_catalog.set_config(
  'request.jwt.claim.sub','16460000-0000-4000-8000-000000000001',true
);
select :'race_mode'='open_first' as open_first \gset
\if :open_first
  do $c09_0164_waiting_revert$
  declare v_refused boolean:=false;
  begin
    begin
      perform public.revert_import_batch_private(
        '16460000-0000-4000-8000-000000000060'
      );
    exception when sqlstate 'P04D3' then
      if sqlerrm<>'physical_bottle_dependency' then raise; end if;
      v_refused:=true;
    end;
    if not v_refused then
      raise exception 'C09_0164_WAITING_REVERT_NOT_REFUSED' using errcode='P0099';
    end if;
  end;
  $c09_0164_waiting_revert$;
\else
  do $c09_0164_waiting_open$
  declare v_refused boolean:=false;
  begin
    begin
      perform public.execute_physical_bottle_command(
        '16460000-0000-4000-8000-000000000080',
        '16460000-0000-4000-8000-000000000020',
        'open',
        (select r.applied_wine_id from public.import_batch_rows r
          where r.id='16460000-0000-4000-8000-000000000070')
      );
    exception when sqlstate 'P0001' then
      if sqlerrm<>'no_inventory' then raise; end if;
      v_refused:=true;
    end;
    if not v_refused then
      raise exception 'C09_0164_WAITING_OPEN_NOT_REFUSED' using errcode='P0099';
    end if;
  end;
  $c09_0164_waiting_open$;
\endif
commit;
\echo C09_0164_PHYSICAL_RACE_B_PASS
