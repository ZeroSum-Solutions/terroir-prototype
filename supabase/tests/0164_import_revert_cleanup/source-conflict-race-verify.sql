-- Verify both exact P04I2 refusals left the committed fixture byte-for-byte unchanged.
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
\if :{?before_state_sha256}
\else
  \quit 3
\endif
select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  pg_catalog.jsonb_build_object(
    'sessions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.id)
                           from public.import_sessions s
                          where s.id between '16470000-0000-4000-8000-000000000050'
                                         and '16470000-0000-4000-8000-000000000051'),'[]'::jsonb),
    'batches',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.id)
                 from public.import_batches b
                where b.id between '16470000-0000-4000-8000-000000000060'
                               and '16470000-0000-4000-8000-000000000063'),
    'rows',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id)
              from public.import_batch_rows r
             where r.id between '16470000-0000-4000-8000-000000000070'
                            and '16470000-0000-4000-8000-000000000073'),
    'inventory',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.id)
                   from public.inventory_items i
                  where i.restaurant_id='16470000-0000-4000-8000-000000000020'),
    'wines',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.id)
               from public.wines w
              where w.restaurant_id='16470000-0000-4000-8000-000000000020')
  )::text,'UTF8')),'hex') as after_state_sha256 \gset
select 1/case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and :'race_kind' in ('batch','session')
  and :'after_state_sha256'=:'before_state_sha256'
then 1 else 0 end as c09_0164_source_conflict_state_conserved;
select :'race_kind'='batch' as batch_kind \gset
\if :batch_kind
  select 1/case when
    (select pg_catalog.count(*) from public.import_batches b
      where b.id in (
        '16470000-0000-4000-8000-000000000060',
        '16470000-0000-4000-8000-000000000061'
      ) and b.status='completed')=2
    and (select pg_catalog.count(*) from public.import_batch_rows r
          where r.id in (
            '16470000-0000-4000-8000-000000000070',
            '16470000-0000-4000-8000-000000000071'
          ) and r.apply_status='applied'
            and r.applied_inventory_item_id is not null)=2
    and (select pg_catalog.count(distinct r.applied_inventory_item_id)
          from public.import_batch_rows r
         where r.id in (
           '16470000-0000-4000-8000-000000000070',
           '16470000-0000-4000-8000-000000000071'
         ))=1
  then 1 else 0 end as c09_0164_batch_source_conflict_exact_state;
\else
  select 1/case when
    (select pg_catalog.count(*) from public.import_sessions s
      where s.id in (
        '16470000-0000-4000-8000-000000000050',
        '16470000-0000-4000-8000-000000000051'
      ) and s.status='completed')=2
    and (select pg_catalog.count(*) from public.import_batches b
      where b.id between '16470000-0000-4000-8000-000000000060'
                     and '16470000-0000-4000-8000-000000000063'
        and b.status='completed')=4
    and (select pg_catalog.count(*) from public.import_batch_rows r
      where r.id between '16470000-0000-4000-8000-000000000070'
                     and '16470000-0000-4000-8000-000000000073'
        and r.apply_status='applied'
        and r.applied_inventory_item_id is not null)=4
    and (select pg_catalog.count(*) from (
      select r.applied_inventory_item_id
        from public.import_batch_rows r
       where r.id between '16470000-0000-4000-8000-000000000070'
                      and '16470000-0000-4000-8000-000000000073'
       group by r.applied_inventory_item_id
      having pg_catalog.count(*)=2
    ) shared)=2
  then 1 else 0 end as c09_0164_session_source_conflict_exact_state;
\endif
\echo C09_0164_SOURCE_CONFLICT_RACE_VERIFY_PASS :after_state_sha256
