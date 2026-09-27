-- Guarded rollback for 0157. Run only after callers have been restored to the
-- legacy interfaces. Actor-bound retry history is never discarded.

do $static_admission$
begin
  if to_regprocedure('public.current_site_role_at_least(uuid,public.membership_role)') is null
     or to_regprocedure('public.dismiss_pricing_alert_private(uuid,integer)') is null
     or to_regprocedure('public.claim_scan_idempotency(uuid,uuid,text)') is null
     or to_regprocedure('public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)') is null
     or to_regprocedure('public.create_import_batch_pre_0157(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)') is null
     or to_regprocedure('public.delete_invoice_scan_pre_0157(uuid)') is null
     or to_regprocedure('public.merge_wines_pre_0157(uuid,uuid)') is null then
    raise exception 'C04_0157_DOWN_REQUIRES_COMPLETE_ADDITIVE_STATE' using errcode='P0001';
  end if;
end;
$static_admission$;

lock table public.invoice_scans in share row exclusive mode nowait;
lock table public.wines in share row exclusive mode nowait;
lock table public.scan_idempotency in share row exclusive mode nowait;

do $history_guard$
begin
  if exists(select 1 from public.scan_idempotency c where c.claimed_by_user_id is not null) then
    raise exception 'C04_0157_DOWN_ACTOR_BOUND_CACHE_HISTORY_PRESENT' using errcode='P0001';
  end if;
end;
$history_guard$;

drop function public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric);
drop function public.set_restaurant_pricing_defaults(uuid,numeric,numeric);
drop function public.dismiss_pricing_alert_private(uuid,integer);
drop function public.set_wine_overpaid_flag(uuid,uuid,boolean);
drop function public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via);
drop function public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text);
drop function public.delete_wine_private(uuid,uuid,timestamp with time zone);

drop function public.create_invoice_scan_upload(uuid,uuid,text,text,text,date);
drop function public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb);
drop function public.commit_invoice_scan(uuid);
drop function public.request_invoice_scan_reextract(uuid);
drop function public.read_invoice_image_target(uuid,integer);

drop function public.claim_scan_idempotency(uuid,uuid,text);
drop function public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid);
drop function public.abandon_scan_idempotency(uuid,uuid,text);

drop function public.resolve_import_batch_row(uuid,text,numeric);
drop function public.bulk_resolve_import_batch_rows(uuid,text);
drop function public.accept_reconcile_batch(uuid,jsonb,uuid);
drop function public.undo_reconcile_batch(uuid);

drop function public.read_inventory_costs(uuid,uuid[]);
drop function public.read_wine_pricing_strategy(uuid,uuid[]);
drop function public.read_wine_cost_flags(uuid,uuid[]);
drop function public.read_restaurant_pricing_defaults(uuid);
drop function public.read_invoice_scan_private(uuid);
drop function public.read_invoice_scan_deletion_private(uuid);
drop function public.read_reconcile_action_private(uuid);
drop function public.read_identity_merge_private(uuid);
drop function public.read_import_batch_cost_rows(uuid,integer,integer);
drop function public.read_import_batch_display_rows(uuid,integer,integer);
drop function public.read_cellar_health_private(uuid,uuid[]);

drop function public.add_manual_overrides(uuid,text[]);
drop function public.enrich_wines_batch(uuid,jsonb);
drop function public.delete_invoice_scan(uuid);
drop function public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text);
drop function public.count_import_batch_rows(uuid);
drop function public.apply_import_batch_chunk(uuid,integer);
drop function public.revert_import_batch(uuid);
drop function public.revert_import_session(uuid);
drop function public.merge_wines(uuid,uuid);
drop function public.cleanup_scan_idempotency();

alter function public.add_manual_overrides_pre_0157(uuid,text[]) rename to add_manual_overrides;
alter function public.enrich_wines_batch_pre_0157(uuid,jsonb) rename to enrich_wines_batch;
alter function public.delete_invoice_scan_pre_0157(uuid) rename to delete_invoice_scan;
alter function public.create_import_batch_pre_0157(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)
  rename to create_import_batch;
alter function public.count_import_batch_rows_pre_0157(uuid) rename to count_import_batch_rows;
alter function public.apply_import_batch_chunk_pre_0157(uuid,integer) rename to apply_import_batch_chunk;
alter function public.revert_import_batch_pre_0157(uuid) rename to revert_import_batch;
alter function public.revert_import_session_pre_0157(uuid) rename to revert_import_session;
alter function public.merge_wines_pre_0157(uuid,uuid) rename to merge_wines;
alter function public.cleanup_scan_idempotency_pre_0157() rename to cleanup_scan_idempotency;

grant execute on function public.add_manual_overrides(uuid,text[]) to public;
grant execute on function public.enrich_wines_batch(uuid,jsonb) to public;
revoke all on function public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text) from public;
grant execute on function public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text) to authenticated;
revoke all on function public.count_import_batch_rows(uuid) from public;
grant execute on function public.count_import_batch_rows(uuid) to authenticated;
revoke all on function public.apply_import_batch_chunk(uuid,integer) from public;
grant execute on function public.apply_import_batch_chunk(uuid,integer) to authenticated;
revoke all on function public.revert_import_batch(uuid) from public,anon;
grant execute on function public.revert_import_batch(uuid) to authenticated;
revoke all on function public.revert_import_session(uuid) from public,anon;
grant execute on function public.revert_import_session(uuid) to authenticated;
revoke all on function public.delete_invoice_scan(uuid) from public,anon;
grant execute on function public.delete_invoice_scan(uuid) to authenticated;
revoke all on function public.merge_wines(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.merge_wines(uuid,uuid) to authenticated;
revoke all on function public.cleanup_scan_idempotency() from public;
grant execute on function public.cleanup_scan_idempotency() to service_role;

create or replace function public.read_pricing_recommendations(p_restaurant_id uuid)
returns table (
  wine_id uuid,class text,rationale text,evidence jsonb,timing text,
  computed_at timestamptz,wines jsonb
)
language plpgsql stable security definer set search_path = public
as $function$
begin
  if not public.effective_site_capability(p_restaurant_id, 'cost.read')
     or not public.effective_site_capability(p_restaurant_id, 'margin.read') then
    return;
  end if;

  return query
  select
    pr.wine_id,
    pr.class,
    pr.rationale,
    pr.evidence,
    pr.timing,
    pr.computed_at,
    jsonb_build_object(
      'name', w.name,
      'producer', w.producer,
      'vintage', w.vintage
    ) as wines
  from public.pricing_recommendations pr
  join public.wines w
    on w.id = pr.wine_id
   and w.restaurant_id = pr.restaurant_id
  where pr.restaurant_id = p_restaurant_id
  order by pr.class asc, pr.computed_at desc, pr.wine_id asc;
end;
$function$;
revoke all on function public.read_pricing_recommendations(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_pricing_recommendations(uuid) to authenticated;
alter function public.read_pricing_recommendations(uuid) owner to postgres;

alter table public.invoice_scans drop constraint invoice_scans_image_paths_valid_check;
drop function public.invoice_image_paths_valid(uuid,uuid,text,jsonb);
drop function public.invoice_line_items_valid(jsonb);
drop function public.invoice_edits_valid(jsonb);

alter table public.wines
  drop constraint wines_manual_overrides_valid_check,
  drop constraint wines_enrichment_metadata_valid_check;
drop function public.wine_manual_overrides_valid(text[]);
drop function public.wine_enrichment_metadata_valid(jsonb);

drop function public.current_site_role_at_least(uuid,public.membership_role);
drop index public.scan_idempotency_actor_created_idx;
alter table public.scan_idempotency drop column claimed_by_user_id;
