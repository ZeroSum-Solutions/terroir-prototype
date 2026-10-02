-- 0162 paired down/up cycle. The transaction restores the applied state.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C07_0162_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C07_0162_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
\if :{?source_0162_sha256}
\else
  \echo C07_0162_UP_SOURCE_PIN_REQUIRED
  \quit 3
\endif
\if :{?source_0162_down_sha256}
\else
  \echo C07_0162_DOWN_SOURCE_PIN_REQUIRED
  \quit 3
\endif

select 1 / case when
  current_database()=:'expected_database'
  and current_user='postgres'
  and session_user='postgres'
  and :'target_admitted'='on'
  and :'source_0162_sha256'='c899f1f5113773f0cc826a227bc0c800c4303cc2a6bc5a945bd5b040ced01955'
  and :'source_0162_down_sha256'='6e1b440085f3474c48b84194dc4a02021a54ee7e9aa4b9ce1adfd821638fc53f'
  and pg_catalog.to_regprocedure(
    'public.mirror_bin_code_to_inventory_items()'
  ) is not null
then 1 else 0 end as c07_0162_cycle_target_admitted;

begin;
set local statement_timeout='30s';
set local lock_timeout='5s';

create temporary table c07_0162_data_before(value jsonb) on commit drop;
insert into c07_0162_data_before(value)
select pg_catalog.jsonb_build_object(
  'bins',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.id)
      from public.bins b
  ),'[]'::jsonb),
  'inventory',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ii) order by ii.id)
      from public.inventory_items ii
  ),'[]'::jsonb)
);

\ir ../../migrations/down/0162_bin_code_inventory_mirror.down.sql

do $c07_0162_cycle_down$
begin
  if pg_catalog.to_regprocedure(
       'public.mirror_bin_code_to_inventory_items()'
     ) is not null
     or exists (
       select 1 from pg_catalog.pg_trigger t
        where t.tgrelid=pg_catalog.to_regclass('public.bins')
          and t.tgname='bins_mirror_code_to_inventory_items'
          and not t.tgisinternal
     ) then
    raise exception 'C07_0162_CYCLE_DOWN_FAILED';
  end if;
end;
$c07_0162_cycle_down$;

\ir ../../migrations/0162_bin_code_inventory_mirror.sql

do $c07_0162_cycle_up_and_data$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select value into strict v_before from c07_0162_data_before;
  select pg_catalog.jsonb_build_object(
    'bins',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.id)
        from public.bins b
    ),'[]'::jsonb),
    'inventory',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ii) order by ii.id)
        from public.inventory_items ii
    ),'[]'::jsonb)
  ) into v_after;
  if pg_catalog.to_regprocedure(
       'public.mirror_bin_code_to_inventory_items()'
     ) is null
     or not exists (
       select 1 from pg_catalog.pg_trigger t
        where t.tgrelid=pg_catalog.to_regclass('public.bins')
          and t.tgname='bins_mirror_code_to_inventory_items'
          and not t.tgisinternal
     )
     or v_after is distinct from v_before then
    raise exception 'C07_0162_CYCLE_UP_OR_DATA_FAILED';
  end if;
end;
$c07_0162_cycle_up_and_data$;

rollback;
\echo C07_0162_MIGRATION_CYCLE_PASS
