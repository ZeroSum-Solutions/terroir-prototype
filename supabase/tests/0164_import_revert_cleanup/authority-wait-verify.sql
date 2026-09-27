-- Verify the refused revert changed no batch/import/inventory/wine state.
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
\if :{?before_state_sha256}
\else
  \quit 3
\endif
\if :{?batch_id}
\else
  \quit 3
\endif
\if :{?membership_id}
\else
  \quit 3
\endif
\if :{?actor_id}
\else
  \quit 3
\endif
\if :{?site_id}
\else
  \quit 3
\endif
with state as (
  select pg_catalog.jsonb_build_object(
    'batch',(select pg_catalog.to_jsonb(b) from public.import_batches b
              where b.id=:'batch_id'::uuid),
    'rows',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id)
              from public.import_batch_rows r
             where r.batch_id=:'batch_id'::uuid),
    'inventory',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.id)
                   from public.inventory_items i
                  where i.id in (select r.applied_inventory_item_id
                                   from public.import_batch_rows r
                                  where r.batch_id=:'batch_id'::uuid)),
    'wines',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.id)
               from public.wines w
              where w.id in (select r.applied_wine_id
                               from public.import_batch_rows r
                              where r.batch_id=:'batch_id'::uuid))
  ) as value
), digest as (
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(state.value::text,'UTF8')),'hex'
  ) as value from state
)
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and exists(select 1 from public.memberships m
              where m.id=:'membership_id'::uuid
                and m.user_id=:'actor_id'::uuid
                and m.restaurant_id=:'site_id'::uuid
                and m.status='revoked' and m.revoked_at is not null)
  and (select pg_catalog.count(*) from public.import_batch_rows r
        where r.batch_id=:'batch_id'::uuid and r.apply_status='applied')>0
  and (select digest.value from digest)=:'before_state_sha256'
then 1 else 0 end as c09_0164_post_wait_authority_conservation;
\echo C09_0164_AUTHORITY_WAIT_VERIFY_PASS
