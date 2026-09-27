-- Verify both operations committed after serialization; fixture cleanup is caller-owned.
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
\if :{?site_id}
\else
  \quit 3
\endif
\if :{?apply_batch_id}
\else
  \quit 3
\endif
\if :{?revert_batch_id}
\else
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and (select b.status from public.import_batches b
        where b.id=:'revert_batch_id'::uuid
          and b.restaurant_id=:'site_id'::uuid)='reverted'
  and not exists(
    select 1 from public.import_batch_rows r
     where r.batch_id=:'revert_batch_id'::uuid
       and r.restaurant_id=:'site_id'::uuid
       and r.apply_status='applied'
  )
  and (select pg_catalog.count(*) from public.import_batch_rows r
        where r.batch_id=:'apply_batch_id'::uuid
          and r.restaurant_id=:'site_id'::uuid
          and r.apply_status='applied'
          and r.applied_inventory_item_id is not null)=2
  and (select pg_catalog.count(*) from public.inventory_items i
        join public.import_batch_rows r
          on r.applied_inventory_item_id=i.id
         and r.restaurant_id=i.restaurant_id
       where r.batch_id=:'apply_batch_id'::uuid
         and r.restaurant_id=:'site_id'::uuid)=2
then 1 else 0 end as c09_0164_apply_revert_serialized;
\echo C09_0164_APPLY_REVERT_RACE_VERIFY_PASS
