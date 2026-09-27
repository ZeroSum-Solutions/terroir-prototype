-- Verify exact committed winner and complete loser conservation after both exit.
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
select :'race_mode'='open_first' as open_first \gset
\if :open_first
  select 1/case when current_database()=:'expected_database'
    and :'target_admitted'='on'
    and exists(
      select 1 from public.import_batches b
      join public.import_batch_rows r on r.batch_id=b.id
      join public.inventory_items i on i.id=r.applied_inventory_item_id
      join public.wines w on w.id=r.applied_wine_id
      join public.open_bottles ob
        on ob.source_inventory_item_id=i.id and ob.wine_id=w.id
       and ob.restaurant_id=r.restaurant_id
      join public.inventory_command_receipts cr
        on cr.restaurant_id=r.restaurant_id
       and cr.operation_id='16460000-0000-4000-8000-000000000080'
      join public.pour_events pe
        on pe.operation_id=cr.operation_id and pe.open_bottle_id=ob.id
       and pe.restaurant_id=cr.restaurant_id
      join public.inventory_command_bottle_effects e
        on e.restaurant_id=cr.restaurant_id and e.operation_id=cr.operation_id
       and e.open_bottle_id=ob.id
     where b.id='16460000-0000-4000-8000-000000000060'
       and b.status='completed'
       and r.id='16460000-0000-4000-8000-000000000070'
       and r.apply_status='applied' and r.applied_inventory_item_id=i.id
       and i.quantity=0 and r.applied_wine_id=w.id
       and w.lwin_id='LWIN-PHYSICAL-RACE'
       and w.lwin_match_score=0.9::real
       and ob.identity_contract=2 and ob.identity_origin='native'
       and ob.remaining_ml=750 and ob.state_version=0
       and cr.command_type='open' and cr.command_version=2
       and cr.scope_kind='single_wine' and cr.result_payload is not null
       and cr.completed_at is not null
       and pe.kind='new_bottle' and pe.ml_delta=-750
       and pe.event_contract=2 and pe.operation_entry_ordinal=0
       and e.effect_type='open' and e.entry_ordinal=0
    )
    and (select pg_catalog.count(*) from public.open_bottles ob
          where ob.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.inventory_command_receipts cr
          where cr.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.pour_events pe
          where pe.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.inventory_command_bottle_effects e
          where e.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.inventory_items i
          where i.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.wines w
          where w.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.import_batches b
          where b.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.import_batch_rows r
          where r.restaurant_id='16460000-0000-4000-8000-000000000020')=1
  then 1 else 0 end as c09_0164_open_first_exact_state;
\else
  select 1/case when current_database()=:'expected_database'
    and :'target_admitted'='on'
    and exists(
      select 1 from public.import_batches b
      join public.import_batch_rows r on r.batch_id=b.id
      join public.wines w on w.id=r.applied_wine_id
       and w.restaurant_id=r.restaurant_id
     where b.id='16460000-0000-4000-8000-000000000060'
       and b.status='reverted' and b.reverted_by='16460000-0000-4000-8000-000000000001'
       and r.id='16460000-0000-4000-8000-000000000070'
       and r.apply_status='reverted' and r.applied_inventory_item_id is null
       and w.lwin_id is null and w.lwin_match_score is null
    )
    and not exists(select 1 from public.inventory_items i
                    where i.restaurant_id='16460000-0000-4000-8000-000000000020')
    and not exists(select 1 from public.open_bottles ob
                    where ob.restaurant_id='16460000-0000-4000-8000-000000000020')
    and not exists(select 1 from public.inventory_command_receipts cr
                    where cr.restaurant_id='16460000-0000-4000-8000-000000000020')
    and not exists(select 1 from public.pour_events pe
                    where pe.restaurant_id='16460000-0000-4000-8000-000000000020')
    and not exists(select 1 from public.inventory_command_bottle_effects e
                    where e.restaurant_id='16460000-0000-4000-8000-000000000020')
    and (select pg_catalog.count(*) from public.wines w
          where w.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.import_batches b
          where b.restaurant_id='16460000-0000-4000-8000-000000000020')=1
    and (select pg_catalog.count(*) from public.import_batch_rows r
          where r.restaurant_id='16460000-0000-4000-8000-000000000020')=1
  then 1 else 0 end as c09_0164_revert_first_exact_state;
\endif
\echo C09_0164_PHYSICAL_RACE_VERIFY_PASS
