-- Verify the newer real-apply LWIN evidence wins in both serialized orders.
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
select 1/case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and (select b.status from public.import_batches b
        where b.id='16440000-0000-4000-8000-000000000060')='reverted'
  and (select b.status from public.import_batches b
        where b.id='16440000-0000-4000-8000-000000000061')='completed'
  and (select pg_catalog.count(*)
         from public.import_batch_rows old
        where old.batch_id='16440000-0000-4000-8000-000000000060'
          and old.apply_status='reverted'
          and old.applied_inventory_item_id is null
          and old.lwin_id in ('LWIN-OLD-X','LWIN-OLD-Y')
          and old.lwin_score=0.7::real)=2
  and (select pg_catalog.count(*)
         from public.import_batch_rows fresh
         join public.wines w on w.id=fresh.applied_wine_id
          and w.restaurant_id=fresh.restaurant_id
        where fresh.batch_id='16440000-0000-4000-8000-000000000061'
          and fresh.apply_status='applied'
          and fresh.applied_inventory_item_id is not null
          and fresh.lwin_id=w.lwin_id
          and fresh.lwin_score=w.lwin_match_score
          and fresh.updated_at=w.updated_at
          and ((w.id='16440000-0000-4000-8000-000000000050'
                and w.lwin_id='LWIN-NEW-X')
            or (w.id='16440000-0000-4000-8000-000000000051'
                and w.lwin_id='LWIN-NEW-Y'))
          and w.lwin_match_score=0.9::real)=2
  and (select pg_catalog.count(*) from public.inventory_items i
        where i.restaurant_id='16440000-0000-4000-8000-000000000020')=2
then 1 else 0 end as c09_0164_lwin_serialized_exact_state;
\echo C09_0164_LWIN_RACE_VERIFY_PASS
