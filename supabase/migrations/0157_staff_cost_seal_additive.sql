-- 0157_staff_cost_seal_additive.sql
--
-- C04 additive staff-cost boundary. This migration adds closed, exact-site
-- readers and useful operational mutations while retaining every legacy table
-- privilege for the compatible-application window. The later contract
-- migration owns all direct column/table revokes.

do $static_admission$
begin
  if to_regprocedure('public.effective_site_capability(uuid,text)') is null
     or to_regprocedure('public.effective_site_ids(text)') is null
     or to_regprocedure('public.read_pricing_recommendations(uuid)') is null
     or public.current_inventory_contract_version() <> 2 then
    raise exception 'C04_0157_REQUIRES_0154_AND_0156' using errcode = 'P0001';
  end if;

  if to_regclass('public.scan_idempotency') is null
     or to_regclass('public.invoice_scan_deletions') is null
     or to_regclass('public.identity_merge_log') is null
     or to_regclass('public.reconcile_actions') is null
     or to_regclass('public.import_batch_rows') is null then
    raise exception 'C04_0157_REQUIRED_RELATION_MISSING' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.scan_idempotency'::regclass
       and a.attname = 'claimed_by_user_id'
       and a.attnum > 0 and not a.attisdropped
  ) or to_regprocedure('public.current_site_role_at_least(uuid,public.membership_role)') is not null then
    raise exception 'C04_0157_ALREADY_OR_PARTIALLY_APPLIED' using errcode = 'P0001';
  end if;
end;
$static_admission$;

lock table public.invoice_scans in share row exclusive mode nowait;
lock table public.wines in share row exclusive mode nowait;
lock table public.scan_idempotency in share row exclusive mode nowait;

create function public.wine_manual_overrides_valid(p_value text[])
returns boolean
language sql
immutable
security definer
set search_path = ''
as $function$
  select p_value is null or (
    cardinality(p_value) <= 4
    and cardinality(p_value) = (
      select count(distinct f)::integer from unnest(p_value) as supplied(f)
    )
    and not exists (
      select 1 from unnest(p_value) as supplied(f)
       where f is null
          or f not in ('drink_window', 'region', 'country', 'varietal')
    )
  )
$function$;

create function public.wine_enrichment_metadata_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  v_timestamp_text text;
  v_timestamp timestamptz;
begin
  if p_value is null then
    return true;
  end if;
  if jsonb_typeof(p_value) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_value)) <> 3
     or not (p_value ?& array['source', 'fields_enriched', 'enriched_at'])
     or exists (
       select 1 from jsonb_object_keys(p_value) as supplied(k)
        where k not in ('source', 'fields_enriched', 'enriched_at')
     )
     or jsonb_typeof(p_value->'source') <> 'string'
     or p_value->>'source' not in ('rule_engine', 'lwin_fallback')
     or jsonb_typeof(p_value->'fields_enriched') <> 'array'
     or jsonb_typeof(p_value->'enriched_at') <> 'string' then
    return false;
  end if;
  if jsonb_array_length(p_value->'fields_enriched') > 10
     or exists (
       select 1 from jsonb_array_elements(p_value->'fields_enriched') as supplied(value)
        where jsonb_typeof(value) <> 'string'
           or value #>> '{}' not in (
             'drink_window', 'serving_temp', 'decant', 'peak_year',
             'rating_source', 'review_excerpt', 'region', 'country',
             'varietal', 'colour'
           )
     )
     or jsonb_array_length(p_value->'fields_enriched') <> (
       select count(distinct value)::integer
         from jsonb_array_elements(p_value->'fields_enriched')
     ) then
    return false;
  end if;

  v_timestamp_text := p_value->>'enriched_at';
  if octet_length(v_timestamp_text) > 32
     or v_timestamp_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' then
    return false;
  end if;
  begin
    v_timestamp := v_timestamp_text::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    return false;
  end;
  return extract(epoch from v_timestamp) >= extract(epoch from '2000-01-01T00:00:00Z'::timestamptz)
     and extract(epoch from v_timestamp) < extract(epoch from '2100-01-01T00:00:00Z'::timestamptz);
end;
$function$;

revoke all on function public.wine_manual_overrides_valid(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.wine_enrichment_metadata_valid(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.wine_manual_overrides_valid(text[])
  to authenticated, service_role;
grant execute on function public.wine_enrichment_metadata_valid(jsonb)
  to authenticated, service_role;

do $historical_metadata_preflight$
begin
  if exists (
    select 1 from public.wines w
     where not public.wine_manual_overrides_valid(w.manual_overrides)
  ) then
    raise exception 'C04_0157_HISTORICAL_MANUAL_OVERRIDES_INVALID' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.wines w
     where not public.wine_enrichment_metadata_valid(w.enrichment_metadata)
  ) then
    raise exception 'C04_0157_HISTORICAL_ENRICHMENT_METADATA_INVALID' using errcode = 'P0001';
  end if;
end;
$historical_metadata_preflight$;

alter table public.wines
  add constraint wines_manual_overrides_valid_check
    check (public.wine_manual_overrides_valid(manual_overrides)) not valid,
  add constraint wines_enrichment_metadata_valid_check
    check (public.wine_enrichment_metadata_valid(enrichment_metadata)) not valid;
alter table public.wines validate constraint wines_manual_overrides_valid_check;
alter table public.wines validate constraint wines_enrichment_metadata_valid_check;

alter table public.scan_idempotency
  add column claimed_by_user_id uuid;

create index scan_idempotency_actor_created_idx
  on public.scan_idempotency (claimed_by_user_id, created_at)
  where claimed_by_user_id is not null;

create function public.current_site_role_at_least(
  p_restaurant_id uuid,
  p_required public.membership_role
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1
      from public.memberships m
      join public.restaurants r
        on r.id = m.restaurant_id
       and r.id = p_restaurant_id
      join public.workspace_memberships wm
        on m.workspace_membership_id = wm.id
       and m.user_id = wm.user_id
       and r.workspace_id = wm.workspace_id
     where m.user_id = (select auth.uid())
       and m.restaurant_id = p_restaurant_id
       and m.status = 'active'
       and m.revoked_at is null
       and (m.expires_at is null or m.expires_at > statement_timestamp())
       and wm.status = 'active'
       and wm.revoked_at is null
       and (wm.expires_at is null or wm.expires_at > statement_timestamp())
       and (
         m.role = p_required
         or (p_required = 'manager' and m.role = 'owner')
         or (p_required = 'staff' and m.role in ('owner', 'manager'))
       )
  )
$function$;

revoke all on function public.current_site_role_at_least(uuid,public.membership_role)
  from public, anon, authenticated, service_role;

create function public.read_inventory_costs(
  p_restaurant_id uuid,
  p_wine_ids uuid[] default null
) returns table (
  inventory_item_id uuid,
  wine_id uuid,
  invoice_scan_id uuid,
  unit_cost numeric,
  currency text,
  added_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_wine_ids is not null and (
    cardinality(p_wine_ids) > 500
    or cardinality(p_wine_ids) <> (select count(distinct x)::integer from unnest(p_wine_ids) x)
    or exists (select 1 from unnest(p_wine_ids) x where x is null)
  ) then
    raise exception 'C04_WINE_FILTER_INVALID' using errcode = 'P0001';
  end if;
  if not public.effective_site_capability(p_restaurant_id, 'cost.read') then return; end if;
  return query
  select ii.id, ii.wine_id, ii.invoice_scan_id, ii.unit_cost, ii.currency, ii.added_at
    from public.inventory_items ii
    join public.wines w on w.id = ii.wine_id and w.restaurant_id = ii.restaurant_id
   where ii.restaurant_id = p_restaurant_id
     and (p_wine_ids is null or ii.wine_id = any(p_wine_ids))
   order by ii.wine_id asc, ii.added_at asc, ii.id asc;
end;
$function$;

create function public.read_wine_pricing_strategy(
  p_restaurant_id uuid,
  p_wine_ids uuid[] default null
) returns table (
  wine_id uuid,
  pricing_target_pour_cost_pct numeric,
  pricing_target_markup_ratio numeric,
  pricing_dismissed_until timestamptz
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if p_wine_ids is not null and (
    cardinality(p_wine_ids) > 500
    or cardinality(p_wine_ids) <> (select count(distinct x)::integer from unnest(p_wine_ids) x)
    or exists (select 1 from unnest(p_wine_ids) x where x is null)
  ) then raise exception 'C04_WINE_FILTER_INVALID' using errcode = 'P0001'; end if;
  if not public.effective_site_capability(p_restaurant_id, 'margin.read') then return; end if;
  return query
  select w.id, w.pricing_target_pour_cost_pct, w.pricing_target_markup_ratio,
         w.pricing_dismissed_until
    from public.wines w
   where w.restaurant_id = p_restaurant_id
     and (p_wine_ids is null or w.id = any(p_wine_ids))
   order by w.id asc;
end;
$function$;

create function public.read_wine_cost_flags(
  p_restaurant_id uuid,
  p_wine_ids uuid[] default null
) returns table (wine_id uuid, overpaid_flag boolean)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if p_wine_ids is not null and (
    cardinality(p_wine_ids) > 500
    or cardinality(p_wine_ids) <> (select count(distinct x)::integer from unnest(p_wine_ids) x)
    or exists (select 1 from unnest(p_wine_ids) x where x is null)
  ) then raise exception 'C04_WINE_FILTER_INVALID' using errcode = 'P0001'; end if;
  if not public.effective_site_capability(p_restaurant_id, 'cost.read') then return; end if;
  return query select w.id, w.overpaid_flag from public.wines w
   where w.restaurant_id = p_restaurant_id
     and (p_wine_ids is null or w.id = any(p_wine_ids))
   order by w.id asc;
end;
$function$;

create function public.read_restaurant_pricing_defaults(p_restaurant_id uuid)
returns table (
  restaurant_id uuid,
  default_target_pour_cost_pct numeric,
  default_target_markup_ratio numeric
)
language sql stable security definer set search_path = ''
as $function$
  select r.id, r.default_target_pour_cost_pct, r.default_target_markup_ratio
    from public.restaurants r
   where r.id = p_restaurant_id
     and public.effective_site_capability(p_restaurant_id, 'margin.read')
$function$;

create or replace function public.read_pricing_recommendations(p_restaurant_id uuid)
returns table (
  wine_id uuid, class text, rationale text, evidence jsonb, timing text,
  computed_at timestamptz, wines jsonb
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not public.effective_site_capability(p_restaurant_id, 'cost.read')
     or not public.effective_site_capability(p_restaurant_id, 'margin.read') then return; end if;
  return query
  select pr.wine_id, pr.class, pr.rationale, pr.evidence, pr.timing, pr.computed_at,
         jsonb_build_object('name', w.name, 'producer', w.producer, 'vintage', w.vintage)
    from public.pricing_recommendations pr
    join public.wines w on w.id = pr.wine_id and w.restaurant_id = pr.restaurant_id
   where pr.restaurant_id = p_restaurant_id
   order by pr.class asc, pr.computed_at desc, pr.wine_id asc;
end;
$function$;

create function public.read_invoice_scan_private(p_scan_id uuid)
returns table (
  scan_id uuid, restaurant_id uuid, distributor_name text, invoice_number text,
  invoice_date date, status text, status_reason text, accuracy_score real,
  item_count integer, created_at timestamptz, created_by uuid, updated_at timestamptz,
  committed_at timestamptz, parsed_line_items jsonb, final_line_items jsonb,
  edits jsonb, ocr_text jsonb, has_image boolean, image_count integer
)
language sql stable security definer set search_path = ''
as $function$
  select s.id, s.restaurant_id, s.distributor_name, s.invoice_number, s.invoice_date,
         s.status, s.status_reason, s.accuracy_score, s.item_count, s.created_at,
         s.created_by, s.updated_at, s.committed_at, s.parsed_line_items,
         s.final_line_items, s.edits, s.ocr_text,
         s.raw_image_path is not null,
         (case when s.raw_image_path is null then 0 else 1 end)
           + case when jsonb_typeof(s.extra_image_paths) = 'array'
                  then jsonb_array_length(s.extra_image_paths) else 0 end
    from public.invoice_scans s
   where s.id = p_scan_id
     and public.effective_site_capability(s.restaurant_id, 'cost.read')
$function$;

create function public.read_invoice_scan_deletion_private(p_deletion_id uuid)
returns table (
  deletion_id uuid, restaurant_id uuid, invoice_scan_id uuid, deleted_by uuid,
  deleted_at timestamptz, distributor_name text, invoice_number text,
  scan_status text, item_count integer, inventory_rows_deleted integer,
  bottles_removed integer, final_line_items jsonb
)
language sql stable security definer set search_path = ''
as $function$
  select d.id, d.restaurant_id, d.invoice_scan_id, d.deleted_by, d.deleted_at,
         d.distributor_name, d.invoice_number, d.scan_status, d.item_count,
         d.inventory_rows_deleted, d.bottles_removed, d.final_line_items
    from public.invoice_scan_deletions d
   where d.id = p_deletion_id
     and public.effective_site_capability(d.restaurant_id, 'cost.read')
$function$;

create function public.read_reconcile_action_private(p_batch_id uuid)
returns table (
  action_id uuid, batch_id uuid, restaurant_id uuid, action_type text,
  subject_table text, subject_id uuid, ordinal integer, prior_state jsonb,
  new_state jsonb, created_at timestamptz
)
language sql stable security definer set search_path = ''
as $function$
  select a.id, a.batch_id, a.restaurant_id, a.action_type, a.subject_table,
         a.subject_id, a.ordinal, a.prior_state, a.new_state, a.created_at
    from public.reconcile_actions a
    join public.reconcile_batches b on b.id = a.batch_id and b.restaurant_id = a.restaurant_id
   where a.batch_id = p_batch_id
     and public.effective_site_capability(a.restaurant_id, 'cost.read')
     and public.effective_site_capability(a.restaurant_id, 'margin.read')
   order by a.ordinal asc, a.id asc
$function$;

create function public.read_identity_merge_private(p_merge_id uuid)
returns table (
  merge_id uuid, merge_type text, source_id uuid, target_id uuid,
  restaurant_id uuid, source_snapshot jsonb, moved_counts jsonb,
  merged_by uuid, merged_at timestamptz
)
language sql stable security definer set search_path = ''
as $function$
  select l.id, l.merge_type, l.source_id, l.target_id, l.restaurant_id,
         l.source_snapshot, l.moved_counts, l.merged_by, l.merged_at
    from public.identity_merge_log l
   where l.id = p_merge_id
     and l.restaurant_id is not null
     and public.effective_site_capability(l.restaurant_id, 'cost.read')
     and public.effective_site_capability(l.restaurant_id, 'margin.read')
$function$;

create function public.read_import_batch_cost_rows(
  p_batch_id uuid,
  p_after_row_number integer default 0,
  p_limit integer default 100
) returns table (
  row_id uuid, batch_id uuid, restaurant_id uuid, row_number integer,
  raw jsonb, manual_unit_cost numeric, validation_errors jsonb,
  last_error_message text, cost_status text, resolution text,
  apply_status text, applied_inventory_item_id uuid, applied_wine_id uuid,
  apply_attempts integer, lwin_id text, lwin_score real, lwin_status text,
  duplicate_reason jsonb, row_state text, resolved_at timestamptz,
  resolved_by uuid, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $function$
declare v_restaurant_id uuid;
begin
  if p_after_row_number is null or p_limit is null
     or not (p_after_row_number >= 0) or not (p_limit between 1 and 500) then
    raise exception 'C04_IMPORT_PAGE_INVALID' using errcode = 'P0001';
  end if;
  select b.restaurant_id into v_restaurant_id from public.import_batches b where b.id = p_batch_id;
  if v_restaurant_id is null
     or not public.effective_site_capability(v_restaurant_id, 'cost.read') then return; end if;
  return query
  select r.id, r.batch_id, r.restaurant_id, r.row_number, r.raw, r.manual_unit_cost,
         r.validation_errors, r.last_error_message, r.cost_status, r.resolution,
         r.apply_status, r.applied_inventory_item_id, r.applied_wine_id,
         r.apply_attempts, r.lwin_id, r.lwin_score, r.lwin_status,
         r.duplicate_reason, r.row_state, r.resolved_at, r.resolved_by,
         r.created_at, r.updated_at
    from public.import_batch_rows r
   where r.batch_id = p_batch_id and r.restaurant_id = v_restaurant_id
     and r.row_number > p_after_row_number
   order by r.row_number asc, r.id asc limit p_limit;
end;
$function$;

create function public.read_cellar_health_private(
  p_restaurant_id uuid,
  p_wine_ids uuid[] default null
) returns table (
  health_id uuid, restaurant_id uuid, wine_id uuid, segment text,
  reason text, computed_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if p_wine_ids is not null and (
    cardinality(p_wine_ids) > 500
    or cardinality(p_wine_ids) <> (select count(distinct x)::integer from unnest(p_wine_ids) x)
    or exists (select 1 from unnest(p_wine_ids) x where x is null)
  ) then raise exception 'C04_WINE_FILTER_INVALID' using errcode = 'P0001'; end if;
  if not public.effective_site_capability(p_restaurant_id, 'cost.read') then return; end if;
  return query
  select h.id, h.restaurant_id, h.wine_id, h.segment, h.reason, h.computed_at
    from public.cellar_health h
    join public.wines w on w.id = h.wine_id and w.restaurant_id = h.restaurant_id
   where h.restaurant_id = p_restaurant_id
     and (p_wine_ids is null or h.wine_id = any(p_wine_ids))
   order by h.wine_id asc, h.id asc;
end;
$function$;

create function public.set_wine_pricing_strategy(
  p_restaurant_id uuid,
  p_wine_id uuid,
  p_target_pour_cost_pct numeric,
  p_target_markup_ratio numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
begin
  if not public.effective_site_capability(p_restaurant_id, 'pricing.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_target_pour_cost_pct is not null
     and not (p_target_pour_cost_pct > 0 and p_target_pour_cost_pct < 100) then
    raise exception 'C04_PRICING_TARGET_INVALID' using errcode = 'P0001';
  end if;
  if p_target_markup_ratio is not null
     and not (p_target_markup_ratio between 1 and 10) then
    raise exception 'C04_PRICING_TARGET_INVALID' using errcode = 'P0001';
  end if;
  update public.wines w
     set pricing_target_pour_cost_pct = p_target_pour_cost_pct,
         pricing_target_markup_ratio = p_target_markup_ratio
   where w.id = p_wine_id and w.restaurant_id = p_restaurant_id;
  if not found then raise exception 'wine_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('wineId', p_wine_id, 'updated', true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'wine_not_found' using errcode='P0002';
  when others then raise exception 'C04_PRICING_UPDATE_REFUSED' using errcode='P0001';
end;
$function$;

create function public.set_restaurant_pricing_defaults(
  p_restaurant_id uuid,
  p_target_pour_cost_pct numeric,
  p_target_markup_ratio numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
begin
  if not public.effective_site_capability(p_restaurant_id, 'pricing.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_target_pour_cost_pct is not null
     and not (p_target_pour_cost_pct > 0 and p_target_pour_cost_pct < 100) then
    raise exception 'C04_PRICING_TARGET_INVALID' using errcode = 'P0001';
  end if;
  if p_target_markup_ratio is not null
     and not (p_target_markup_ratio between 1 and 10) then
    raise exception 'C04_PRICING_TARGET_INVALID' using errcode = 'P0001';
  end if;
  update public.restaurants r
     set default_target_pour_cost_pct = p_target_pour_cost_pct,
         default_target_markup_ratio = p_target_markup_ratio
   where r.id = p_restaurant_id;
  if not found then raise exception 'restaurant_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('restaurantId', p_restaurant_id, 'updated', true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'restaurant_not_found' using errcode='P0002';
  when others then raise exception 'C04_PRICING_UPDATE_REFUSED' using errcode='P0001';
end;
$function$;

create function public.dismiss_pricing_alert_private(
  p_wine_id uuid,
  p_days integer default 30
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_restaurant_id uuid;
begin
  if p_days is null or p_days < 0 or p_days > 365 then
    raise exception 'C04_PRICING_DISMISSAL_INVALID' using errcode = 'P0001';
  end if;
  select w.restaurant_id into v_restaurant_id from public.wines w where w.id = p_wine_id;
  if v_restaurant_id is null
     or not public.effective_site_capability(v_restaurant_id, 'pricing.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.wines w
     set pricing_dismissed_until = case when p_days=0 then null
                                       else statement_timestamp()+make_interval(days=>p_days) end
   where w.id = p_wine_id and w.restaurant_id = v_restaurant_id;
  if not found then raise exception 'wine_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('wineId', p_wine_id, 'updated', true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'wine_not_found' using errcode='P0002';
  when others then raise exception 'C04_PRICING_DISMISS_REFUSED' using errcode='P0001';
end;
$function$;

create function public.set_wine_overpaid_flag(
  p_restaurant_id uuid,
  p_wine_id uuid,
  p_flag boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
begin
  if p_flag is null then raise exception 'C04_FLAG_REQUIRED' using errcode = 'P0001'; end if;
  if not public.effective_site_capability(p_restaurant_id, 'pricing.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.wines w set overpaid_flag = p_flag
   where w.id = p_wine_id and w.restaurant_id = p_restaurant_id;
  if not found then raise exception 'wine_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('wineId', p_wine_id, 'updated', true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'wine_not_found' using errcode='P0002';
  when others then raise exception 'C04_PRICING_FLAG_REFUSED' using errcode='P0001';
end;
$function$;

create function public.create_inventory_item_private(
  p_restaurant_id uuid,
  p_wine_id uuid,
  p_quantity integer,
  p_unit_cost numeric default 0,
  p_currency text default null,
  p_bin_id uuid default null,
  p_bin_location text default null,
  p_section text default null,
  p_format text default null,
  p_invoice_scan_id uuid default null,
  p_added_via public.added_via default 'manual'::public.added_via
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_id uuid;
begin
  if not public.current_site_role_at_least(p_restaurant_id, 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_unit_cost is null then
    -- Omission takes the function default; an explicit SQL null is refused.
    raise exception 'C04_UNIT_COST_REQUIRED' using errcode = 'P0001';
  end if;
  if not (p_quantity between 0 and 100000)
     or not (p_unit_cost between 0 and 1000000)
     or (p_currency is not null and p_currency not in ('USD','EUR','GBP','CAD','AUD','CHF','JPY'))
     or (p_bin_location is not null and octet_length(p_bin_location) > 500)
     or (p_section is not null and octet_length(p_section) > 500)
     or (p_format is not null and octet_length(p_format) > 100) then
    raise exception 'C04_INVENTORY_VALUE_INVALID' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.wines w where w.id = p_wine_id and w.restaurant_id = p_restaurant_id
  ) or (p_bin_id is not null and not exists (
    select 1 from public.bins b where b.id = p_bin_id and b.restaurant_id = p_restaurant_id
  )) or (p_invoice_scan_id is not null and not exists (
    select 1 from public.invoice_scans s where s.id = p_invoice_scan_id and s.restaurant_id = p_restaurant_id
  )) then raise exception 'C04_INVENTORY_REFERENCE_INVALID' using errcode = 'P0001'; end if;

  insert into public.inventory_items(
    restaurant_id,wine_id,quantity,unit_cost,currency,bin_id,bin_location,
    section,format,invoice_scan_id,added_via
  ) values (
    p_restaurant_id,p_wine_id,p_quantity,p_unit_cost,p_currency,p_bin_id,p_bin_location,
    p_section,p_format,p_invoice_scan_id,coalesce(p_added_via,'manual'::public.added_via)
  ) returning id into v_id;
  return jsonb_build_object('inventoryItemId', v_id, 'quantity', p_quantity, 'updated', true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when others then raise exception 'C04_INVENTORY_CREATE_REFUSED' using errcode='P0001';
end;
$function$;

create function public.patch_inventory_item_private(
  p_inventory_item_id uuid,
  p_expected_updated_at timestamptz,
  p_set_quantity boolean,
  p_quantity integer,
  p_set_unit_cost boolean,
  p_unit_cost numeric,
  p_set_currency boolean,
  p_currency text,
  p_set_bin_id boolean,
  p_bin_id uuid,
  p_set_bin_location boolean,
  p_bin_location text,
  p_set_section boolean,
  p_section text,
  p_set_format boolean,
  p_format text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_item public.inventory_items%rowtype;
  v_quantity integer;
  v_unit_cost numeric;
  v_currency text;
  v_bin_id uuid;
  v_bin_location text;
  v_section text;
  v_format text;
begin
  if p_expected_updated_at is null
     or p_set_quantity is null or p_set_unit_cost is null or p_set_currency is null
     or p_set_bin_id is null or p_set_bin_location is null or p_set_section is null
     or p_set_format is null then
    raise exception 'C04_PATCH_FLAGS_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_item from public.inventory_items ii
   where ii.id = p_inventory_item_id for update;
  if not found or not public.current_site_role_at_least(v_item.restaurant_id, 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_item.updated_at is distinct from p_expected_updated_at then
    raise exception 'inventory_item_stale' using errcode = 'P04S1';
  end if;
  if p_set_unit_cost and p_unit_cost is null then
    raise exception 'C04_UNIT_COST_REQUIRED' using errcode = 'P0001';
  end if;
  v_quantity := case when p_set_quantity then p_quantity else v_item.quantity end;
  v_unit_cost := case when p_set_unit_cost then p_unit_cost else v_item.unit_cost end;
  v_currency := case when p_set_currency then p_currency else v_item.currency end;
  v_bin_id := case when p_set_bin_id then p_bin_id else v_item.bin_id end;
  v_bin_location := case when p_set_bin_location then p_bin_location else v_item.bin_location end;
  v_section := case when p_set_section then p_section else v_item.section end;
  v_format := case when p_set_format then p_format else v_item.format end;
  if not (v_quantity between 0 and 100000) or not (v_unit_cost between 0 and 1000000)
     or (v_currency is not null and v_currency not in ('USD','EUR','GBP','CAD','AUD','CHF','JPY'))
     or (v_bin_location is not null and octet_length(v_bin_location) > 500)
     or (v_section is not null and octet_length(v_section) > 500)
     or (v_format is not null and octet_length(v_format) > 100)
     or (v_bin_id is not null and not exists (
       select 1 from public.bins b where b.id = v_bin_id and b.restaurant_id = v_item.restaurant_id
     )) then raise exception 'C04_INVENTORY_VALUE_INVALID' using errcode = 'P0001'; end if;
  if v_quantity < v_item.quantity and exists (
    select 1 from public.open_bottles ob
     where ob.source_inventory_item_id = v_item.id and ob.identity_contract = 2
  ) then raise exception 'physical_bottle_dependency' using errcode = 'P04D1'; end if;
  update public.inventory_items ii
     set quantity=v_quantity,unit_cost=v_unit_cost,currency=v_currency,bin_id=v_bin_id,
         bin_location=v_bin_location,section=v_section,format=v_format
   where ii.id=v_item.id;
  return jsonb_build_object('inventoryItemId', v_item.id, 'quantity', v_quantity, 'updated', true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P04S1' then raise exception 'inventory_item_stale' using errcode='P0001';
  when sqlstate 'P04D1' then raise exception 'physical_bottle_dependency' using errcode='P0001';
  when others then raise exception 'C04_INVENTORY_PATCH_REFUSED' using errcode='P0001';
end;
$function$;

create function public.delete_wine_private(
  p_restaurant_id uuid,
  p_wine_id uuid,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_wine public.wines%rowtype;
begin
  if not public.current_site_role_at_least(p_restaurant_id, 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Shared identity mutations take locks in scan -> wine -> inventory order.
  -- Locking every mutable site scan closes the gap where reconciliation could
  -- add a wine reference after a narrower dependency probe.
  perform 1 from public.invoice_scans s
   where s.restaurant_id=p_restaurant_id and s.committed_at is null
   order by s.id for update;
  select * into v_wine from public.wines w
   where w.id=p_wine_id and w.restaurant_id=p_restaurant_id for update;
  if not found then raise exception 'wine_not_found' using errcode='P0002'; end if;
  if p_expected_updated_at is null or v_wine.updated_at is distinct from p_expected_updated_at then
    raise exception 'wine_stale' using errcode='P04S2';
  end if;
  if exists(select 1 from public.inventory_items x where x.wine_id=p_wine_id)
     or exists(select 1 from public.wine_list_items x where x.wine_id=p_wine_id)
     or exists(select 1 from public.open_bottles x where x.wine_id=p_wine_id)
     or exists(select 1 from public.pour_events x where x.wine_id=p_wine_id)
     or exists(select 1 from public.bottle_closeouts x where x.wine_id=p_wine_id)
     or exists(select 1 from public.availability_events x where x.wine_id=p_wine_id)
     or exists(select 1 from public.stock_adjustments x where x.wine_id=p_wine_id)
     or exists(select 1 from public.pricing_recommendations x where x.wine_id=p_wine_id)
     or exists(select 1 from public.cellar_health x where x.wine_id=p_wine_id)
     or exists(select 1 from public.import_batch_rows x where x.applied_wine_id=p_wine_id)
     or exists(select 1 from public.inventory_command_receipts x where x.wine_id=p_wine_id)
     or exists(select 1 from public.inventory_command_bottle_effects x where x.wine_id=p_wine_id)
     or exists(select 1 from public.wine_notes x where x.wine_id=p_wine_id)
     or exists(select 1 from public.producer_backfill_audit x where x.wine_id=p_wine_id)
     or exists(select 1 from public.invoice_scans x
               where x.restaurant_id=p_restaurant_id and (
                 x.parsed_line_items @> jsonb_build_array(jsonb_build_object('wine_id',p_wine_id))
                 or x.final_line_items @> jsonb_build_array(jsonb_build_object('wine_id',p_wine_id))
               ))
     or exists(select 1 from public.invoice_scan_deletions x
               where x.restaurant_id=p_restaurant_id
                 and x.final_line_items @> jsonb_build_array(jsonb_build_object('wine_id',p_wine_id)))
     or exists(select 1 from public.reconcile_actions x
               where x.restaurant_id=p_restaurant_id and (
                 (x.subject_table='wines' and x.subject_id=p_wine_id)
                 or x.prior_state @> jsonb_build_object(
                   'final_line_items',jsonb_build_array(jsonb_build_object('wine_id',p_wine_id)))
                 or x.new_state @> jsonb_build_object(
                   'final_line_items',jsonb_build_array(jsonb_build_object('wine_id',p_wine_id)))
               ))
     or exists(select 1 from public.identity_merge_log x
               where x.restaurant_id=p_restaurant_id and (x.source_id=p_wine_id or x.target_id=p_wine_id)) then
    raise exception 'wine_has_dependencies' using errcode='P04D2';
  end if;
  delete from public.wines w where w.id=p_wine_id and w.restaurant_id=p_restaurant_id;
  return jsonb_build_object('wineId',p_wine_id,'deleted',true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'wine_not_found' using errcode='P0002';
  when sqlstate 'P04S2' then raise exception 'wine_stale' using errcode='P0001';
  when sqlstate 'P04D2' then raise exception 'wine_has_dependencies' using errcode='P0001';
  when others then raise exception 'C04_WINE_DELETE_REFUSED' using errcode='P0001';
end;
$function$;

alter function public.add_manual_overrides(uuid,text[])
  rename to add_manual_overrides_pre_0157;
revoke all on function public.add_manual_overrides_pre_0157(uuid,text[])
  from public, anon, authenticated, service_role;

create function public.add_manual_overrides(p_wine_id uuid,p_fields text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_restaurant_id uuid; v_result text[];
begin
  select w.restaurant_id into v_restaurant_id from public.wines w where w.id=p_wine_id for update;
  if v_restaurant_id is null or not public.current_site_role_at_least(v_restaurant_id,'manager') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select array(select distinct f from unnest(coalesce((select w.manual_overrides from public.wines w where w.id=p_wine_id),array[]::text[]) || coalesce(p_fields,array[]::text[])) f order by f)
    into v_result;
  if not public.wine_manual_overrides_valid(v_result) then
    raise exception 'C04_MANUAL_OVERRIDE_INVALID' using errcode='P0001';
  end if;
  update public.wines w set manual_overrides=v_result where w.id=p_wine_id;
  return jsonb_build_object('wineId',p_wine_id,'updated',true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when others then raise exception 'C04_MANUAL_OVERRIDE_REFUSED' using errcode='P0001';
end;
$function$;

alter function public.enrich_wines_batch(uuid,jsonb)
  rename to enrich_wines_batch_pre_0157;
revoke all on function public.enrich_wines_batch_pre_0157(uuid,jsonb)
  from public, anon, authenticated, service_role;

create function public.enrich_wines_batch(p_restaurant_id uuid,p_enrichments jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare v_item jsonb; v_count integer;
begin
  if not public.current_site_role_at_least(p_restaurant_id,'manager') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_enrichments is null then return 0; end if;
  if jsonb_typeof(p_enrichments)<>'array' then
    raise exception 'C04_ENRICHMENT_ITEM_INVALID' using errcode='P0001';
  end if;
  if jsonb_array_length(p_enrichments)=0 then return 0; end if;
  if jsonb_array_length(p_enrichments) > 2000 then
    raise exception 'C04_ENRICHMENT_BATCH_TOO_LARGE' using errcode='P0001';
  end if;
  for v_item in select value from jsonb_array_elements(p_enrichments) loop
    if jsonb_typeof(v_item)<>'object' then
      raise exception 'C04_ENRICHMENT_ITEM_INVALID' using errcode='P0001';
    end if;
    if exists(select 1 from jsonb_object_keys(v_item) k where k not in (
         'id','drink_window_start','drink_window_end','peak_year','rating',
         'rating_source','review_excerpt','serving_temp_min','serving_temp_max',
         'serving_temp_label','decant_minutes','region','country','varietal','colour',
         'enrichment_metadata'
       ))
       or not (v_item ? 'id')
       or (v_item ? 'enrichment_metadata' and not public.wine_enrichment_metadata_valid(v_item->'enrichment_metadata'))
       or (v_item ? 'rating' and ((v_item->>'rating')::numeric < 0 or (v_item->>'rating')::numeric > 100))
       or (v_item ? 'peak_year' and ((v_item->>'peak_year')::integer < 1900 or (v_item->>'peak_year')::integer > 2100))
       or (v_item ? 'decant_minutes' and ((v_item->>'decant_minutes')::integer < 0 or (v_item->>'decant_minutes')::integer > 1440))
       or exists(select 1 from jsonb_each_text(v_item) f where f.key in ('rating_source','review_excerpt','serving_temp_label','region','country','varietal','colour') and octet_length(f.value)>1000) then
      raise exception 'C04_ENRICHMENT_ITEM_INVALID' using errcode='P0001';
    end if;
  end loop;
  select public.enrich_wines_batch_pre_0157(p_restaurant_id,p_enrichments) into v_count;
  return v_count;
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when others then raise exception 'C04_ENRICHMENT_REFUSED' using errcode='P0001';
end;
$function$;

create function public.claim_scan_idempotency(
  p_restaurant_id uuid,
  p_key uuid,
  p_kind text
) returns table(disposition text, receipt jsonb)
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_row public.scan_idempotency%rowtype;
  v_claimed integer := 0;
  v_expected_claim jsonb;
begin
  if v_actor is null or p_key is null
     or p_kind is null
     or p_kind not in ('invoice_scan_upload','invoice_inventory_save','bottle_inventory_save') then
    raise exception 'C04_IDEMPOTENCY_INVALID' using errcode='P0001';
  end if;
  if not public.current_site_role_at_least(p_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_expected_claim := jsonb_build_object('version',1,'kind',p_kind,'status','claimed');
  insert into public.scan_idempotency(
    key,restaurant_id,response_status,response_body,created_at,claimed_by_user_id
  ) values (p_key,p_restaurant_id,null,v_expected_claim,statement_timestamp(),v_actor)
  on conflict (key,restaurant_id) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 1 then
    return query select 'claimed'::text,null::jsonb;
    return;
  end if;

  select * into v_row from public.scan_idempotency c
   where c.key=p_key and c.restaurant_id=p_restaurant_id for update;
  if not found then raise exception 'C04_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
  if v_row.claimed_by_user_id is distinct from v_actor then
    raise exception 'C04_IDEMPOTENCY_CONFLICT' using errcode='P0001';
  end if;
  if v_row.response_body is null
     or jsonb_typeof(v_row.response_body) is distinct from 'object'
     or jsonb_typeof(v_row.response_body->'kind') is distinct from 'string'
     or v_row.response_body->>'kind' is distinct from p_kind then
    raise exception 'C04_IDEMPOTENCY_CONFLICT' using errcode='P0001';
  end if;
  if v_row.created_at <= statement_timestamp()-interval '24 hours' then
    return query select 'expired'::text,null::jsonb; return;
  end if;
  if v_row.response_status is null then
    if v_row.response_body is distinct from v_expected_claim then
      return query select 'expired'::text,null::jsonb; return;
    end if;
    return query select 'in_progress'::text,null::jsonb; return;
  end if;

  if (p_kind='invoice_scan_upload' and v_row.response_status=202
      and (select count(*) from jsonb_object_keys(v_row.response_body))=5
      and jsonb_typeof(v_row.response_body->'version')='number'
      and v_row.response_body->>'version'='1'
      and jsonb_typeof(v_row.response_body->'kind')='string'
      and v_row.response_body->>'kind'=p_kind
      and jsonb_typeof(v_row.response_body->'status')='string'
      and v_row.response_body->>'status'='queued'
      and jsonb_typeof(v_row.response_body->'scanId')='string'
      and jsonb_typeof(v_row.response_body->'itemCount')='number'
      and v_row.response_body->>'itemCount'='0'
      and exists(select 1 from public.invoice_scans s
                  where s.id::text=v_row.response_body->>'scanId'
                    and s.restaurant_id=p_restaurant_id))
     or (p_kind='invoice_inventory_save' and v_row.response_status=200
      and (select count(*) from jsonb_object_keys(v_row.response_body))=6
      and jsonb_typeof(v_row.response_body->'version')='number'
      and v_row.response_body->>'version'='1'
      and jsonb_typeof(v_row.response_body->'kind')='string'
      and v_row.response_body->>'kind'=p_kind
      and jsonb_typeof(v_row.response_body->'status')='string'
      and v_row.response_body->>'status'='committed'
      and jsonb_typeof(v_row.response_body->'scanId')='string'
      and jsonb_typeof(v_row.response_body->'itemCount')='number'
      and jsonb_typeof(v_row.response_body->'wineCount')='number'
      and (v_row.response_body->>'itemCount') ~ '^[0-9]+$'
      and (v_row.response_body->>'wineCount') ~ '^[0-9]+$'
      and (v_row.response_body->>'itemCount')::numeric between 0 and 500
      and (v_row.response_body->>'wineCount')::numeric between 0 and (v_row.response_body->>'itemCount')::numeric
      and exists(select 1 from public.invoice_scans s
                  where s.id::text=v_row.response_body->>'scanId'
                    and s.restaurant_id=p_restaurant_id))
     or (p_kind='bottle_inventory_save' and v_row.response_status=200
      and (select count(*) from jsonb_object_keys(v_row.response_body))=5
      and jsonb_typeof(v_row.response_body->'version')='number'
      and v_row.response_body->>'version'='1'
      and jsonb_typeof(v_row.response_body->'kind')='string'
      and v_row.response_body->>'kind'=p_kind
      and jsonb_typeof(v_row.response_body->'status')='string'
      and v_row.response_body->>'status'='committed'
      and jsonb_typeof(v_row.response_body->'wineId')='string'
      and jsonb_typeof(v_row.response_body->'itemCount')='number'
      and v_row.response_body->>'itemCount'='1'
      and exists(select 1 from public.wines w
                  where w.id::text=v_row.response_body->>'wineId'
                    and w.restaurant_id=p_restaurant_id)) then
    return query select 'replay'::text,v_row.response_body; return;
  end if;
  return query select 'expired'::text,null::jsonb;
end;
$function$;

create function public.complete_scan_idempotency(
  p_restaurant_id uuid,
  p_key uuid,
  p_kind text,
  p_scan_id uuid,
  p_item_count integer,
  p_wine_count integer,
  p_wine_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_row public.scan_idempotency%rowtype;
  v_claim jsonb;
  v_receipt jsonb;
  v_status integer;
begin
  if p_key is null or p_kind is null
     or p_kind not in ('invoice_scan_upload','invoice_inventory_save','bottle_inventory_save') then
    raise exception 'C04_IDEMPOTENCY_INVALID' using errcode='P0001';
  end if;
  if v_actor is null or not public.current_site_role_at_least(p_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_claim:=jsonb_build_object('version',1,'kind',p_kind,'status','claimed');

  select * into v_row from public.scan_idempotency c
   where c.key=p_key and c.restaurant_id=p_restaurant_id for update;
  if not found or v_row.claimed_by_user_id is distinct from v_actor then
    raise exception 'C04_IDEMPOTENCY_CONFLICT' using errcode='P0001';
  end if;
  if jsonb_typeof(v_row.response_body)<>'object' then
    raise exception 'C04_IDEMPOTENCY_LEGACY_OR_MALFORMED' using errcode='P0001';
  end if;
  if v_row.response_body->>'kind' is distinct from p_kind then
    raise exception 'C04_IDEMPOTENCY_CONFLICT' using errcode='P0001';
  end if;
  if v_row.created_at < statement_timestamp()-interval '24 hours' then
    raise exception 'C04_IDEMPOTENCY_EXPIRED' using errcode='P0001';
  end if;
  if p_kind='invoice_scan_upload' then
    if p_scan_id is null or p_item_count is distinct from 0
       or p_wine_count is not null or p_wine_id is not null
       or not exists(select 1 from public.invoice_scans s where s.id=p_scan_id and s.restaurant_id=p_restaurant_id) then
      raise exception 'C04_IDEMPOTENCY_COMPLETION_INVALID' using errcode='P0001';
    end if;
    v_status:=202;
    v_receipt:=jsonb_build_object('version',1,'kind',p_kind,'scanId',p_scan_id,'status','queued','itemCount',0);
  elsif p_kind='invoice_inventory_save' then
    if p_scan_id is null or p_item_count is null or p_wine_count is null
       or p_wine_id is not null or p_item_count not between 0 and 500
       or p_wine_count not between 0 and p_item_count
       or not exists(select 1 from public.invoice_scans s where s.id=p_scan_id and s.restaurant_id=p_restaurant_id) then
      raise exception 'C04_IDEMPOTENCY_COMPLETION_INVALID' using errcode='P0001';
    end if;
    v_status:=200;
    v_receipt:=jsonb_build_object('version',1,'kind',p_kind,'scanId',p_scan_id,'status','committed','itemCount',p_item_count,'wineCount',p_wine_count);
  else
    if p_scan_id is not null or p_item_count is distinct from 1
       or p_wine_count is not null or p_wine_id is null
       or not exists(select 1 from public.wines w where w.id=p_wine_id and w.restaurant_id=p_restaurant_id) then
      raise exception 'C04_IDEMPOTENCY_COMPLETION_INVALID' using errcode='P0001';
    end if;
    v_status:=200;
    v_receipt:=jsonb_build_object('version',1,'kind',p_kind,'wineId',p_wine_id,'status','committed','itemCount',1);
  end if;
  if v_row.response_status is not null then
    if v_row.response_status=v_status and v_row.response_body=v_receipt then return v_receipt; end if;
    raise exception 'C04_IDEMPOTENCY_RECOMPLETION_MISMATCH' using errcode='P0001';
  end if;
  if v_row.response_body is distinct from v_claim then
    raise exception 'C04_IDEMPOTENCY_LEGACY_OR_MALFORMED' using errcode='P0001';
  end if;
  update public.scan_idempotency c
     set response_status=v_status,response_body=v_receipt
   where c.key=p_key and c.restaurant_id=p_restaurant_id
     and c.claimed_by_user_id=v_actor and c.response_status is null
     and c.response_body=v_claim;
  if not found then raise exception 'C04_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
  return v_receipt;
end;
$function$;

create function public.abandon_scan_idempotency(
  p_restaurant_id uuid,
  p_key uuid,
  p_kind text
) returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare v_actor uuid:=(select auth.uid()); v_claim jsonb;
begin
  if p_key is null or p_kind is null
     or p_kind not in ('invoice_scan_upload','invoice_inventory_save','bottle_inventory_save') then
    raise exception 'C04_IDEMPOTENCY_INVALID' using errcode='P0001';
  end if;
  if v_actor is null or not public.current_site_role_at_least(p_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_claim:=jsonb_build_object('version',1,'kind',p_kind,'status','claimed');
  delete from public.scan_idempotency c
   where c.key=p_key and c.restaurant_id=p_restaurant_id
     and c.claimed_by_user_id=v_actor and c.response_status is null and c.response_body=v_claim;
  if not found then raise exception 'C04_IDEMPOTENCY_ABANDON_REFUSED' using errcode='P0001'; end if;
  return true;
end;
$function$;

alter function public.cleanup_scan_idempotency()
  rename to cleanup_scan_idempotency_pre_0157;
revoke all on function public.cleanup_scan_idempotency_pre_0157()
  from public, anon, authenticated, service_role;
create function public.cleanup_scan_idempotency() returns void
language sql security definer set search_path = ''
as $function$
  delete from public.scan_idempotency c
   where c.created_at < statement_timestamp()-interval '24 hours'
$function$;
revoke all on function public.cleanup_scan_idempotency()
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_scan_idempotency() to service_role;

-- Invoice operations -------------------------------------------------------

create function public.invoice_line_items_valid(p_items jsonb)
returns boolean
language plpgsql immutable security definer set search_path = ''
as $function$
declare v_item jsonb; v_field jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 500 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then return false; end if;
    if not (v_item ?& array['id','name','producer','vintage','varietal','region','qty','unitCost','confidence'])
       or exists(select 1 from jsonb_object_keys(v_item) k where k not in (
         'id','name','producer','vintage','varietal','region','qty','unitCost',
         'lineTotal','currency','format','confidence','lowFields','wine_id'
       ))
       or jsonb_typeof(v_item->'id') <> 'string'
       or octet_length(v_item->>'id') not between 1 and 500
       or jsonb_typeof(v_item->'name') <> 'string'
       or octet_length(v_item->>'name') not between 1 and 500
       or jsonb_typeof(v_item->'producer') <> 'string'
       or octet_length(v_item->>'producer') not between 1 and 500
       or jsonb_typeof(v_item->'varietal') <> 'string'
       or octet_length(v_item->>'varietal') > 500
       or jsonb_typeof(v_item->'region') <> 'string'
       or octet_length(v_item->>'region') > 500
       or not (jsonb_typeof(v_item->'vintage') = 'null'
               or (jsonb_typeof(v_item->'vintage') = 'number'
                   and (v_item->>'vintage')::numeric = trunc((v_item->>'vintage')::numeric)
                   and (v_item->>'vintage')::numeric between 0 and 2100))
       or jsonb_typeof(v_item->'qty') <> 'number'
       or (v_item->>'qty')::numeric <> trunc((v_item->>'qty')::numeric)
       or (v_item->>'qty')::numeric not between 1 and 100000
       or jsonb_typeof(v_item->'unitCost') <> 'number'
       or (v_item->>'unitCost')::numeric not between 0 and 1000000
       or jsonb_typeof(v_item->'confidence') <> 'number'
       or (v_item->>'confidence')::numeric not between 0 and 1
       or (v_item ? 'lineTotal' and not (
         jsonb_typeof(v_item->'lineTotal') = 'null'
         or (jsonb_typeof(v_item->'lineTotal') = 'number'
             and (v_item->>'lineTotal')::numeric between 0 and 100000000000)
       ))
       or (v_item ? 'currency' and not (
         jsonb_typeof(v_item->'currency') = 'null'
         or (jsonb_typeof(v_item->'currency') = 'string'
             and octet_length(v_item->>'currency') <= 16)
       ))
       or (v_item ? 'format' and not (
         jsonb_typeof(v_item->'format') = 'null'
         or (jsonb_typeof(v_item->'format') = 'string'
             and octet_length(v_item->>'format') <= 100)
       ))
       or (v_item ? 'wine_id' and not (
         jsonb_typeof(v_item->'wine_id') = 'string'
         and (v_item->>'wine_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       ))
       or (v_item ? 'lowFields' and jsonb_typeof(v_item->'lowFields') <> 'array') then
      return false;
    end if;
    if v_item ? 'lowFields' then
      if jsonb_array_length(v_item->'lowFields') > 9 then return false; end if;
      for v_field in select value from jsonb_array_elements(v_item->'lowFields') loop
        if jsonb_typeof(v_field) <> 'string' or v_field #>> '{}' not in (
          'name','producer','vintage','varietal','region','qty','unitCost','currency','format'
        ) then return false; end if;
      end loop;
      if jsonb_array_length(v_item->'lowFields') <> (
        select count(distinct value)::integer from jsonb_array_elements(v_item->'lowFields')
      ) then return false; end if;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$function$;

create function public.invoice_edits_valid(p_edits jsonb)
returns boolean
language plpgsql immutable security definer set search_path = ''
as $function$
begin
  if p_edits is null or jsonb_typeof(p_edits)<>'object' then return false; end if;
  return (select count(*) from jsonb_object_keys(p_edits)) <= 500
     and not exists (
       select 1 from jsonb_each(p_edits) e
        where octet_length(e.key) not between 1 and 500 or e.value <> 'true'::jsonb
     );
exception when others then
  return false;
end;
$function$;

revoke all on function public.invoice_line_items_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.invoice_edits_valid(jsonb)
  from public, anon, authenticated, service_role;

create function public.create_invoice_scan_upload(
  p_restaurant_id uuid,
  p_scan_id uuid,
  p_object_name text,
  p_distributor_name text,
  p_invoice_number text,
  p_invoice_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_prefix text := p_restaurant_id::text || '/' || p_scan_id::text;
  v_primary text;
  v_extra jsonb;
  v_count integer;
  v_pdf_count integer;
  v_page_count integer;
begin
  if v_actor is null or not public.current_site_role_at_least(p_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_scan_id is null or p_object_name is null
     or p_object_name !~ ('^' || v_prefix || '(_page[1-8])?[.](jpg|jpeg|png|heic|heif|pdf)$')
     or p_distributor_name is null or octet_length(p_distributor_name) not between 1 and 500
     or (p_invoice_number is not null and octet_length(p_invoice_number) > 500) then
    raise exception 'C04_SCAN_UPLOAD_INVALID' using errcode='P0001';
  end if;

  select count(*)::integer,
         count(*) filter (where lower(right(o.name,4)) = '.pdf')::integer,
         count(*) filter (where o.name ~ ('^' || v_prefix || '_page[1-8][.](jpg|jpeg|png|heic|heif)$'))::integer,
         min(o.name) filter (where o.name = p_object_name),
         coalesce(jsonb_agg(o.name order by o.name) filter (where o.name <> p_object_name),'[]'::jsonb)
    into v_count,v_pdf_count,v_page_count,v_primary,v_extra
    from storage.objects o
   where o.bucket_id='invoice-images'
     and (o.name = v_prefix || '.jpg' or o.name = v_prefix || '.jpeg'
       or o.name = v_prefix || '.png' or o.name = v_prefix || '.heic'
       or o.name = v_prefix || '.heif' or o.name = v_prefix || '.pdf'
       or o.name ~ ('^' || v_prefix || '_page[1-8][.](jpg|jpeg|png|heic|heif)$'))
     and coalesce((o.metadata->>'size')::numeric,-1) between 1 and 10485760
     and o.metadata->>'mimetype' in (
       'image/jpeg','image/png','image/heic','image/heif','application/pdf'
     );
  if v_primary is null or v_count not between 1 and 8
     or (v_pdf_count > 0 and (v_pdf_count <> 1 or v_count <> 1))
     or (v_count > 1 and v_page_count <> v_count)
     or (v_count > 1 and exists (
       select 1 from generate_series(1,v_count) n
        where not exists (
          select 1 from storage.objects o
           where o.bucket_id='invoice-images'
             and o.name ~ ('^' || v_prefix || '_page' || n::text || '[.](jpg|jpeg|png|heic|heif)$')
        )
     )) then
    raise exception 'C04_SCAN_UPLOAD_OBJECT_INVALID' using errcode='P0001';
  end if;

  insert into public.invoice_scans(
    id,restaurant_id,created_by,distributor_name,invoice_number,invoice_date,
    raw_image_path,extra_image_paths,parsed_line_items,final_line_items,edits,item_count,status
  ) values (
    p_scan_id,p_restaurant_id,v_actor,p_distributor_name,p_invoice_number,p_invoice_date,
    p_object_name,v_extra,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,0,'processing'
  );
  perform public.enqueue_invoice_extract_job(p_restaurant_id,p_scan_id);
  return jsonb_build_object('scanId',p_scan_id,'status','queued');
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when unique_violation then raise exception 'scan_upload_conflict' using errcode='23505';
  when others then raise exception 'C04_SCAN_UPLOAD_REFUSED' using errcode='P0001';
end;
$function$;

create function public.review_invoice_scan(
  p_scan_id uuid,
  p_expected_updated_at timestamptz,
  p_distributor_name text,
  p_invoice_number text,
  p_invoice_date date,
  p_final_line_items jsonb,
  p_edits jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_scan public.invoice_scans%rowtype; v_count integer; v_expected_wines integer; v_found_wines integer;
begin
  select * into v_scan from public.invoice_scans s where s.id=p_scan_id for update;
  if not found
     or not public.current_site_role_at_least(v_scan.restaurant_id,'manager')
     or not public.effective_site_capability(v_scan.restaurant_id,'cost.read') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if v_scan.committed_at is not null then
    raise exception 'scan_already_committed' using errcode='P04S4';
  end if;
  if p_expected_updated_at is null or v_scan.updated_at is distinct from p_expected_updated_at then
    raise exception 'scan_superseded' using errcode='P04S3';
  end if;
  if p_distributor_name is null or octet_length(p_distributor_name) not between 1 and 500
     or (p_invoice_number is not null and octet_length(p_invoice_number)>500)
     or not public.invoice_line_items_valid(p_final_line_items)
     or not public.invoice_edits_valid(p_edits)
     or octet_length(p_final_line_items::text)+octet_length(p_edits::text)>2097152 then
    raise exception 'C04_SCAN_REVIEW_INVALID' using errcode='P0001';
  end if;
  select count(distinct (x.item->>'wine_id')::uuid)::integer into v_expected_wines
    from jsonb_array_elements(p_final_line_items) x(item) where x.item?'wine_id';
  perform 1 from public.wines w join (
    select distinct (x.item->>'wine_id')::uuid id
      from jsonb_array_elements(p_final_line_items) x(item) where x.item?'wine_id'
  ) requested on requested.id=w.id
   where w.restaurant_id=v_scan.restaurant_id order by w.id for update of w;
  select count(*)::integer into v_found_wines from public.wines w
   where w.restaurant_id=v_scan.restaurant_id and w.id in (
     select distinct (x.item->>'wine_id')::uuid
       from jsonb_array_elements(p_final_line_items) x(item) where x.item?'wine_id'
   );
  if v_found_wines is distinct from v_expected_wines then
    raise exception 'C04_SCAN_REVIEW_INVALID' using errcode='P0001';
  end if;
  v_count:=jsonb_array_length(p_final_line_items);
  update public.invoice_scans s set
    distributor_name=p_distributor_name,invoice_number=p_invoice_number,
    invoice_date=p_invoice_date,final_line_items=p_final_line_items,edits=p_edits,
    item_count=v_count,status='complete'
  where s.id=p_scan_id and s.restaurant_id=v_scan.restaurant_id;
  return jsonb_build_object('scanId',p_scan_id,'status','complete','itemCount',v_count,'updated',true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P04S3' then raise exception 'scan_superseded' using errcode='P0001';
  when sqlstate 'P04S4' then raise exception 'scan_already_committed' using errcode='P0001';
  when others then raise exception 'C04_SCAN_REVIEW_REFUSED' using errcode='P0001';
end;
$function$;

-- Committed receipts can only be replayed exactly when every committed line
-- already records the identity used by its inventory write. Refuse admission
-- rather than silently derive a different distinct-wine count from mutable
-- inventory references.
do $historical_committed_scan_identity_preflight$
begin
  if exists(
    select 1 from public.invoice_scans s
     where s.committed_at is not null and case
       when not public.invoice_line_items_valid(s.final_line_items) then true
       else exists(
         select 1 from jsonb_array_elements(s.final_line_items) x(item)
          where not (x.item?'wine_id')
       ) end
  ) then
    raise exception 'C04_0157_COMMITTED_SCAN_IDENTITY_MISSING' using errcode='P0001';
  end if;
end;
$historical_committed_scan_identity_preflight$;

create function public.commit_invoice_scan(p_scan_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_scan public.invoice_scans%rowtype;
  v_wines jsonb;
  v_created_ids uuid[];
  v_lines jsonb;
  v_count integer;
  v_wine_count integer;
  v_expected_wines integer;
  v_found_wines integer;
begin
  select * into v_scan from public.invoice_scans s where s.id=p_scan_id for update;
  if not found
     or not public.current_site_role_at_least(v_scan.restaurant_id,'manager')
     or not public.effective_site_capability(v_scan.restaurant_id,'cost.read') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if v_scan.committed_at is not null then
    if not public.invoice_line_items_valid(v_scan.final_line_items) then
      raise exception 'C04_SCAN_COMMIT_REPLAY_INVALID' using errcode='P0001';
    end if;
    if exists(select 1 from jsonb_array_elements(v_scan.final_line_items) x(item)
               where not (x.item?'wine_id')) then
      raise exception 'C04_SCAN_COMMIT_REPLAY_INVALID' using errcode='P0001';
    end if;
    v_count:=jsonb_array_length(v_scan.final_line_items);
    select count(distinct (x.item->>'wine_id')::uuid)::integer into v_wine_count
      from jsonb_array_elements(v_scan.final_line_items) x(item);
    return jsonb_build_object('scanId',p_scan_id,'itemCount',v_count,'wineCount',v_wine_count);
  end if;
  if not public.invoice_line_items_valid(v_scan.final_line_items) then
    raise exception 'C04_SCAN_COMMIT_INVALID' using errcode='P0001';
  end if;
  v_count:=jsonb_array_length(v_scan.final_line_items);
  select jsonb_agg(jsonb_build_object(
    'name',x.item->>'name','producer',x.item->>'producer',
    'vintage',case when jsonb_typeof(x.item->'vintage')='null' then null else (x.item->>'vintage')::integer end,
    'varietal',nullif(x.item->>'varietal',''),'region',nullif(x.item->>'region',''),
    'country',null,'size_ml',750
  ) order by x.ordinality) into v_wines
    from jsonb_array_elements(v_scan.final_line_items) with ordinality x(item,ordinality)
   where not (x.item?'wine_id');
  if v_wines is not null then
    select public.find_or_create_wines_batch(v_scan.restaurant_id,v_wines) into v_created_ids;
  else
    v_created_ids:=array[]::uuid[];
  end if;
  if cardinality(v_created_ids) is distinct from coalesce(jsonb_array_length(v_wines),0) then
    raise exception 'C04_SCAN_WINE_RESULT_INVALID' using errcode='P0001';
  end if;

  select jsonb_agg(
           case when q.item?'wine_id' then q.item
                else q.item||jsonb_build_object('wine_id',v_created_ids[q.unmatched_ordinal]) end
           order by q.ordinality
         ) into v_lines
    from (
      select x.item,x.ordinality,
             count(*) filter(where not (x.item?'wine_id'))
               over(order by x.ordinality)::integer as unmatched_ordinal
        from jsonb_array_elements(v_scan.final_line_items) with ordinality x(item,ordinality)
    ) q;
  if not public.invoice_line_items_valid(v_lines) then
    raise exception 'C04_SCAN_WINE_RESULT_INVALID' using errcode='P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(v_lines) x(item) where not (x.item?'wine_id')) then
    raise exception 'C04_SCAN_WINE_RESULT_INVALID' using errcode='P0001';
  end if;

  select count(distinct (x.item->>'wine_id')::uuid)::integer into v_expected_wines
    from jsonb_array_elements(v_lines) x(item);
  perform 1 from public.wines w join (
    select distinct (x.item->>'wine_id')::uuid id from jsonb_array_elements(v_lines) x(item)
  ) resolved on resolved.id=w.id
   where w.restaurant_id=v_scan.restaurant_id order by w.id for update of w;
  select count(*)::integer into v_found_wines from public.wines w
   where w.restaurant_id=v_scan.restaurant_id and w.id in (
     select distinct (x.item->>'wine_id')::uuid from jsonb_array_elements(v_lines) x(item)
   );
  if v_found_wines is distinct from v_expected_wines then
    raise exception 'C04_SCAN_WINE_RESULT_INVALID' using errcode='P0001';
  end if;

  insert into public.inventory_items(
    wine_id,restaurant_id,invoice_scan_id,quantity,unit_cost,format,currency,added_via
  )
  select (x.item->>'wine_id')::uuid,v_scan.restaurant_id,p_scan_id,
         (x.item->>'qty')::integer,(x.item->>'unitCost')::numeric,
         nullif(x.item->>'format',''),nullif(x.item->>'currency',''),'invoice_scan'::public.added_via
    from jsonb_array_elements(v_lines) with ordinality x(item,ordinality)
   order by x.ordinality;
  update public.invoice_scans s set final_line_items=v_lines,committed_at=statement_timestamp()
   where s.id=p_scan_id and s.restaurant_id=v_scan.restaurant_id and s.committed_at is null;
  if not found then raise exception 'scan_commit_conflict' using errcode='P0001'; end if;
  v_wine_count:=v_expected_wines;
  return jsonb_build_object('scanId',p_scan_id,'itemCount',v_count,'wineCount',v_wine_count);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when unique_violation then raise exception 'scan_commit_conflict' using errcode='23505';
  when others then raise exception 'C04_SCAN_COMMIT_REFUSED' using errcode='P0001';
end;
$function$;

alter function public.delete_invoice_scan(uuid) rename to delete_invoice_scan_pre_0157;
revoke all on function public.delete_invoice_scan_pre_0157(uuid)
  from public, anon, authenticated, service_role;

create function public.delete_invoice_scan(p_scan_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_restaurant_id uuid; v_receipt jsonb;
begin
  select s.restaurant_id into v_restaurant_id from public.invoice_scans s
   where s.id=p_scan_id and public.current_site_role_at_least(s.restaurant_id,'manager')
   for update;
  if not found then
    raise exception 'invoice_scan_not_found' using errcode='P0002';
  end if;
  perform 1 from public.inventory_items ii
   where ii.invoice_scan_id=p_scan_id and ii.restaurant_id=v_restaurant_id
   order by ii.id for update;
  if exists(
    select 1 from public.inventory_items ii join public.open_bottles ob
      on ob.source_inventory_item_id=ii.id
     where ii.invoice_scan_id=p_scan_id and ii.restaurant_id=v_restaurant_id
  ) then
    raise exception 'physical_bottle_dependency' using errcode='P04D4';
  end if;
  select public.delete_invoice_scan_pre_0157(p_scan_id) into v_receipt;
  return jsonb_build_object(
    'scanId',p_scan_id,
    'inventoryRowsDeleted',(v_receipt->>'inventoryRowsDeleted')::integer,
    'bottlesRemoved',(v_receipt->>'bottlesRemoved')::integer
  );
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'invoice_scan_not_found' using errcode='P0002';
  when sqlstate 'P04D4' then raise exception 'physical_bottle_dependency' using errcode='P0001';
  when others then raise exception 'C04_SCAN_DELETE_REFUSED' using errcode='P0001';
end;
$function$;

create function public.request_invoice_scan_reextract(p_scan_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_scan public.invoice_scans%rowtype; v_job_id uuid;
begin
  select * into v_scan from public.invoice_scans s where s.id=p_scan_id for update;
  if not found
     or not public.current_site_role_at_least(v_scan.restaurant_id,'manager')
     or not public.effective_site_capability(v_scan.restaurant_id,'cost.read') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if v_scan.ocr_text is null then raise exception 'missing_ocr_text' using errcode='P0001'; end if;
  select b.id into v_job_id from public.background_jobs b
   where b.job_type='invoice_extract' and b.idempotency_key=p_scan_id::text for update;
  if v_job_id is null then
    insert into public.background_jobs(
      restaurant_id,created_by,job_type,status,subject_table,subject_id,
      idempotency_key,max_attempts,run_after
    ) values (
      v_scan.restaurant_id,(select auth.uid()),'invoice_extract','queued',
      'invoice_scans',p_scan_id,p_scan_id::text,5,statement_timestamp()
    ) returning id into v_job_id;
  else
    if exists(select 1 from public.background_jobs b where b.id=v_job_id and b.status='processing') then
      raise exception 'scan_reextract_in_progress' using errcode='P0001';
    end if;
    update public.background_jobs b set
      status='queued',attempt_count=0,error_code=null,error_message=null,
      claimed_by=null,claimed_at=null,run_after=statement_timestamp(),
      finished_at=null,result='{}'::jsonb
    where b.id=v_job_id;
  end if;
  return jsonb_build_object('scanId',p_scan_id,'status','queued');
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when others then raise exception 'C04_SCAN_REEXTRACT_REFUSED' using errcode='P0001';
end;
$function$;

-- CSV import operations ----------------------------------------------------

alter function public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)
  rename to create_import_batch_pre_0157;
revoke all on function public.create_import_batch_pre_0157(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)
  from public, anon, authenticated, service_role;

create function public.create_import_batch(
  p_restaurant_id uuid,
  p_created_by uuid,
  p_filename text,
  p_total_rows integer,
  p_rows jsonb,
  p_session_id uuid default null,
  p_chunk_index integer default null,
  p_chunk_total integer default null,
  p_content_sha256 text default null,
  p_source_sha256 text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid:=(select auth.uid()); v_result jsonb;
  v_session_site uuid; v_session_source text;
begin
  if v_actor is null or p_created_by is distinct from v_actor
     or not public.current_site_role_at_least(p_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_filename is null or octet_length(p_filename) not between 1 and 500
     or p_total_rows not between 1 and 5000
     or p_rows is null or jsonb_typeof(p_rows)<>'array'
     or jsonb_array_length(p_rows) is distinct from p_total_rows
     or (p_content_sha256 is not null and p_content_sha256 !~ '^(?:[0-9a-f]{64}|overrides-v[0-9]+:[0-9a-f]{64}:[0-9a-f]{64})$')
     or (p_source_sha256 is not null and p_source_sha256 !~ '^[0-9a-f]{64}$')
     or ((p_chunk_index is null) <> (p_chunk_total is null))
     or (p_chunk_index is not null and (p_chunk_index<1 or p_chunk_total<1 or p_chunk_index>p_chunk_total)) then
    raise exception 'C04_IMPORT_BATCH_INVALID' using errcode='P0001';
  end if;
  if p_session_id is not null then
    select s.restaurant_id,s.source_sha256 into v_session_site,v_session_source
      from public.import_sessions s where s.id=p_session_id;
    if not found or v_session_site is distinct from p_restaurant_id then
      raise exception 'import_session_not_found' using errcode='P0002';
    end if;
    if v_session_source is not null and p_source_sha256 is not null
       and v_session_source is distinct from p_source_sha256 then
      raise exception 'import_source_mismatch' using errcode='P0006';
    end if;
  end if;
  select public.create_import_batch_pre_0157(
    p_restaurant_id,v_actor,p_filename,p_total_rows,p_rows,p_session_id,
    p_chunk_index,p_chunk_total,p_content_sha256,p_source_sha256
  ) into v_result;
  return jsonb_build_object('batchId',v_result->'batchId','status','created','rowCount',p_total_rows);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'import_session_not_found' using errcode='P0002';
  when sqlstate 'P0006' then raise exception 'import_source_mismatch' using errcode='P0006';
  when unique_violation then raise exception 'import_batch_conflict' using errcode='23505';
  when others then raise exception 'C04_IMPORT_CREATE_REFUSED' using errcode='P0001';
end;
$function$;

alter function public.count_import_batch_rows(uuid)
  rename to count_import_batch_rows_pre_0157;
revoke all on function public.count_import_batch_rows_pre_0157(uuid)
  from public, anon, authenticated, service_role;

create function public.count_import_batch_rows(p_batch_id uuid)
returns table(total integer,applied integer,excluded integer,pending integer,eligible_not_applied integer)
language plpgsql stable security definer set search_path = ''
as $function$
declare v_restaurant_id uuid;
begin
  select b.restaurant_id into v_restaurant_id from public.import_batches b where b.id=p_batch_id;
  if v_restaurant_id is null or not public.current_site_role_at_least(v_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query select
    count(*)::integer,
    count(*) filter(where r.apply_status='applied')::integer,
    count(*) filter(where r.resolution='exclude')::integer,
    count(*) filter(where r.resolution='pending')::integer,
    count(*) filter(where r.apply_status='not_applied' and r.resolution in ('auto','include'))::integer
  from public.import_batch_rows r
  where r.batch_id=p_batch_id and r.restaurant_id=v_restaurant_id;
end;
$function$;

alter function public.apply_import_batch_chunk(uuid,integer)
  rename to apply_import_batch_chunk_pre_0157;
revoke all on function public.apply_import_batch_chunk_pre_0157(uuid,integer)
  from public, anon, authenticated, service_role;

create function public.apply_import_batch_chunk(p_batch_id uuid,p_limit integer default 100)
returns table(
  row_id uuid,row_number integer,outcome text,inventory_item_id uuid,
  error_message text,error_code text
)
language plpgsql security definer set search_path = ''
as $function$
declare v_restaurant_id uuid; v_status text; v_row record;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'C04_IMPORT_CHUNK_INVALID' using errcode='P0001';
  end if;
  select b.restaurant_id,b.status into v_restaurant_id,v_status
    from public.import_batches b where b.id=p_batch_id;
  if v_restaurant_id is null or not public.current_site_role_at_least(v_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  for v_row in select * from public.apply_import_batch_chunk_pre_0157(p_batch_id,p_limit) loop
    row_id:=v_row.row_id;
    row_number:=v_row.row_number;
    outcome:=case when v_row.outcome in ('applied','blocked','error') then v_row.outcome else 'error' end;
    inventory_item_id:=case when v_row.outcome='applied' then v_row.inventory_item_id else null end;
    error_code:=case when v_row.outcome='blocked' then 'missing_unit_cost'
                     when v_row.outcome='error' then 'row_apply_failed' else null end;
    error_message:=error_code;
    return next;
  end loop;
  update public.import_batches b set status=case
    when b.status='reverted' then 'reverted'
    when not exists(select 1 from public.import_batch_rows r where r.batch_id=p_batch_id
      and not (r.apply_status='applied' or r.resolution='exclude')) then 'completed'
    when exists(select 1 from public.import_batch_rows r where r.batch_id=p_batch_id
      and r.apply_status='applied') then 'applying'
    else 'created' end
  where b.id=p_batch_id and b.restaurant_id=v_restaurant_id;
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0004' then raise exception 'import_batch_conflict' using errcode='P0004';
  when others then raise exception 'C04_IMPORT_APPLY_REFUSED' using errcode='P0001';
end;
$function$;

create function public.resolve_import_batch_row(
  p_row_id uuid,p_action text,p_manual_unit_cost numeric default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_row public.import_batch_rows%rowtype; v_actor uuid:=(select auth.uid());
begin
  select * into v_row from public.import_batch_rows r where r.id=p_row_id for update;
  if not found or v_actor is null
     or not public.current_site_role_at_least(v_row.restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if v_row.resolution<>'pending' then raise exception 'row_not_pending' using errcode='P0001'; end if;
  if p_action not in ('include','exclude')
     or (p_action='exclude' and p_manual_unit_cost is not null)
     or (p_action='include' and v_row.cost_status='missing'
       and (p_manual_unit_cost is null or p_manual_unit_cost not between 0 and 1000000))
     or (p_action='include' and v_row.cost_status<>'missing' and p_manual_unit_cost is not null) then
    raise exception 'C04_IMPORT_RESOLUTION_INVALID' using errcode='P0001';
  end if;
  update public.import_batch_rows r set
    resolution=p_action,
    manual_unit_cost=case when p_action='include' and v_row.cost_status='missing'
                          then round(p_manual_unit_cost,2) else v_row.manual_unit_cost end,
    resolved_at=statement_timestamp(),resolved_by=v_actor
  where r.id=p_row_id and r.restaurant_id=v_row.restaurant_id and r.resolution='pending';
  update public.import_batches b set status=case
    when not exists(select 1 from public.import_batch_rows r where r.batch_id=v_row.batch_id
      and not (r.apply_status='applied' or r.resolution='exclude')) then 'completed'
    when exists(select 1 from public.import_batch_rows r where r.batch_id=v_row.batch_id
      and r.apply_status='applied') then 'applying' else 'created' end
  where b.id=v_row.batch_id and b.restaurant_id=v_row.restaurant_id and b.status<>'reverted';
  return jsonb_build_object('rowId',p_row_id,'batchId',v_row.batch_id,'status','resolved','updated',true);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when others then raise exception 'C04_IMPORT_RESOLVE_REFUSED' using errcode='P0001';
end;
$function$;

create function public.bulk_resolve_import_batch_rows(p_batch_id uuid,p_action text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_restaurant_id uuid; v_actor uuid:=(select auth.uid()); v_count integer; v_remaining integer;
begin
  select b.restaurant_id into v_restaurant_id from public.import_batches b
   where b.id=p_batch_id and b.status<>'reverted' for update;
  if v_restaurant_id is null or v_actor is null
     or not public.current_site_role_at_least(v_restaurant_id,'staff') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_action not in ('include','exclude') then
    raise exception 'C04_IMPORT_RESOLUTION_INVALID' using errcode='P0001';
  end if;
  update public.import_batch_rows r set
    resolution=p_action,resolved_at=statement_timestamp(),resolved_by=v_actor
  where r.batch_id=p_batch_id and r.restaurant_id=v_restaurant_id
    and r.resolution='pending'
    and (p_action='exclude' or r.cost_status='present');
  get diagnostics v_count=row_count;
  select count(*)::integer into v_remaining from public.import_batch_rows r
   where r.batch_id=p_batch_id and r.restaurant_id=v_restaurant_id and r.resolution='pending';
  update public.import_batches b set status=case
    when not exists(select 1 from public.import_batch_rows r where r.batch_id=p_batch_id
      and not (r.apply_status='applied' or r.resolution='exclude')) then 'completed'
    when exists(select 1 from public.import_batch_rows r where r.batch_id=p_batch_id
      and r.apply_status='applied') then 'applying' else 'created' end
  where b.id=p_batch_id and b.restaurant_id=v_restaurant_id;
  return jsonb_build_object('batchId',p_batch_id,'status','resolved','resolvedCount',v_count,'remainingPending',v_remaining);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when others then raise exception 'C04_IMPORT_BULK_RESOLVE_REFUSED' using errcode='P0001';
end;
$function$;

alter function public.revert_import_batch(uuid) rename to revert_import_batch_pre_0157;
revoke all on function public.revert_import_batch_pre_0157(uuid)
  from public, anon, authenticated, service_role;

create function public.revert_import_batch(p_batch_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare v_restaurant_id uuid; v_status text; v_count integer;
begin
  select b.restaurant_id,b.status into v_restaurant_id,v_status
    from public.import_batches b
   where b.id=p_batch_id and public.current_site_role_at_least(b.restaurant_id,'staff')
   for update;
  if not found then
    raise exception 'import_batch_not_found' using errcode='P0002';
  end if;
  if v_status='reverted' then
    raise exception 'import_batch_already_reverted' using errcode='P04I1';
  end if;
  perform 1 from public.inventory_items ii join public.import_batch_rows r
    on r.applied_inventory_item_id=ii.id
   where r.batch_id=p_batch_id and r.restaurant_id=v_restaurant_id
     and r.apply_status='applied'
   order by ii.id for update of ii;
  if exists(
    select 1 from public.import_batch_rows r join public.open_bottles ob
      on ob.source_inventory_item_id=r.applied_inventory_item_id
     where r.batch_id=p_batch_id and r.restaurant_id=v_restaurant_id
       and r.apply_status='applied'
  ) then
    raise exception 'physical_bottle_dependency' using errcode='P04D3';
  end if;
  select public.revert_import_batch_pre_0157(p_batch_id) into v_count;
  return v_count;
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'import_batch_not_found' using errcode='P0002';
  when sqlstate 'P04I1' then raise exception 'import_batch_already_reverted' using errcode='P0001';
  when sqlstate 'P04D3' then raise exception 'physical_bottle_dependency' using errcode='P0001';
  when others then raise exception 'C04_IMPORT_REVERT_REFUSED' using errcode='P0001';
end;
$function$;

alter function public.revert_import_session(uuid) rename to revert_import_session_pre_0157;
revoke all on function public.revert_import_session_pre_0157(uuid)
  from public, anon, authenticated, service_role;

create function public.revert_import_session(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_restaurant_id uuid; v_batch record; v_count integer;
  v_reverted_batches integer:=0; v_blocked_batches integer:=0; v_reverted_items integer:=0;
  v_results jsonb:='[]'::jsonb;
begin
  select s.restaurant_id into v_restaurant_id from public.import_sessions s
   where s.id=p_session_id and public.current_site_role_at_least(s.restaurant_id,'staff')
   for update;
  if not found then
    raise exception 'import_session_not_found' using errcode='P0002';
  end if;
  for v_batch in select b.id,b.status,b.chunk_index from public.import_batches b
    where b.session_id=p_session_id and b.restaurant_id=v_restaurant_id
    order by coalesce(b.chunk_index,0) desc,b.created_at desc,b.id desc
    for update
  loop
    if v_batch.status='reverted' then
      v_results:=v_results||jsonb_build_object(
        'batchId',v_batch.id,'chunkIndex',v_batch.chunk_index,
        'skipped',true,'reason','already_reverted'
      );
      continue;
    end if;
    perform 1 from public.inventory_items ii join public.import_batch_rows r
      on r.applied_inventory_item_id=ii.id
     where r.batch_id=v_batch.id and r.restaurant_id=v_restaurant_id
       and r.apply_status='applied'
     order by ii.id for update of ii;
    if exists(
      select 1 from public.import_batch_rows r join public.open_bottles ob
        on ob.source_inventory_item_id=r.applied_inventory_item_id
       where r.batch_id=v_batch.id and r.restaurant_id=v_restaurant_id
         and r.apply_status='applied'
    ) then
      v_blocked_batches:=v_blocked_batches+1;
      v_results:=v_results||jsonb_build_object(
        'batchId',v_batch.id,'chunkIndex',v_batch.chunk_index,
        'skipped',true,'reason','physical_bottle_dependency'
      );
      continue;
    end if;
    begin
      select public.revert_import_batch_pre_0157(v_batch.id) into v_count;
      v_reverted_batches:=v_reverted_batches+1;
      v_reverted_items:=v_reverted_items+v_count;
      v_results:=v_results||jsonb_build_object(
        'batchId',v_batch.id,'chunkIndex',v_batch.chunk_index,
        'skipped',false,'revertedCount',v_count
      );
    exception when others then
      v_blocked_batches:=v_blocked_batches+1;
      v_results:=v_results||jsonb_build_object(
        'batchId',v_batch.id,'chunkIndex',v_batch.chunk_index,
        'skipped',true,'reason','revert_refused'
      );
    end;
  end loop;
  update public.import_sessions s set
    status=case when v_blocked_batches=0 then 'reverted' else 'in_progress' end,
    updated_at=statement_timestamp()
  where s.id=p_session_id and s.restaurant_id=v_restaurant_id;
  return jsonb_build_object(
    'sessionId',p_session_id,
    'status',case when v_blocked_batches=0 then 'reverted' else 'in_progress' end,
    'batches',v_results,
    'revertedBatchCount',v_reverted_batches,
    'blockedBatchCount',v_blocked_batches,
    'revertedItemCount',v_reverted_items
  );
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0002' then raise exception 'import_session_not_found' using errcode='P0002';
  when others then raise exception 'C04_IMPORT_SESSION_REVERT_REFUSED' using errcode='P0001';
end;
$function$;

-- The admitted source convention is produced by src/app/api/scan/route.ts:
-- one page is <site>/<scan>.<ext>; a photo batch is
-- <site>/<scan>_page1.<ext> followed by _page2.._page8.
create function public.invoice_image_paths_valid(
  p_restaurant_id uuid,p_scan_id uuid,p_raw_image_path text,p_extra_image_paths jsonb
) returns boolean
language plpgsql immutable security definer set search_path = ''
as $function$
declare v_prefix text:=p_restaurant_id::text||'/'||p_scan_id::text; v_path jsonb; v_n integer;
begin
  if p_extra_image_paths is null or jsonb_typeof(p_extra_image_paths)<>'array' then
    return false;
  end if;
  if jsonb_array_length(p_extra_image_paths)>7 then return false; end if;
  if p_raw_image_path is null then return jsonb_array_length(p_extra_image_paths)=0; end if;
  if octet_length(p_raw_image_path)>200
     or p_raw_image_path !~ ('^'||v_prefix||'(_page1)?[.](jpg|jpeg|png|heic|heif|pdf)$') then
    return false;
  end if;
  if jsonb_array_length(p_extra_image_paths)>0
     and p_raw_image_path !~ ('^'||v_prefix||'_page1[.](jpg|jpeg|png|heic|heif)$') then
    return false;
  end if;
  v_n:=0;
  for v_path in select value from jsonb_array_elements(p_extra_image_paths) loop
    v_n:=v_n+1;
    if jsonb_typeof(v_path)<>'string' or octet_length(v_path#>>'{}')>200
       or (v_path#>>'{}') !~ ('^'||v_prefix||'_page'||(v_n+1)::text||'[.](jpg|jpeg|png|heic|heif)$') then
      return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$function$;

revoke all on function public.invoice_image_paths_valid(uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.invoice_image_paths_valid(uuid,uuid,text,jsonb)
  to authenticated, service_role;

do $historical_invoice_image_preflight$
begin
  if exists(
    select 1 from public.invoice_scans s
     where not public.invoice_image_paths_valid(s.restaurant_id,s.id,s.raw_image_path,s.extra_image_paths)
  ) then
    raise exception 'C04_0157_HISTORICAL_INVOICE_IMAGE_PATH_INVALID' using errcode='P0001';
  end if;
end;
$historical_invoice_image_preflight$;

alter table public.invoice_scans
  add constraint invoice_scans_image_paths_valid_check check (
    public.invoice_image_paths_valid(restaurant_id,id,raw_image_path,extra_image_paths)
  ) not valid;
alter table public.invoice_scans validate constraint invoice_scans_image_paths_valid_check;

create function public.read_invoice_image_target(p_scan_id uuid,p_page_index integer default 0)
returns table(object_name text)
language plpgsql stable security definer set search_path = ''
as $function$
declare v_scan public.invoice_scans%rowtype; v_name text;
begin
  if p_page_index is null or p_page_index not between 0 and 7 then
    raise exception 'C04_IMAGE_PAGE_INVALID' using errcode='P0001';
  end if;
  select * into v_scan from public.invoice_scans s where s.id=p_scan_id;
  if not found or not public.current_site_role_at_least(v_scan.restaurant_id,'staff')
     or not public.effective_site_capability(v_scan.restaurant_id,'cost.read') then
    return;
  end if;
  if not public.invoice_image_paths_valid(
    v_scan.restaurant_id,v_scan.id,v_scan.raw_image_path,v_scan.extra_image_paths
  ) then return; end if;
  v_name:=case when p_page_index=0 then v_scan.raw_image_path
               else v_scan.extra_image_paths->>(p_page_index-1) end;
  if v_name is null then return; end if;
  if exists(select 1 from storage.objects o where o.bucket_id='invoice-images' and o.name=v_name) then
    return query select v_name;
  end if;
end;
$function$;

-- Reconciliation and identity merge ---------------------------------------

create function public.accept_reconcile_batch(
  p_restaurant_id uuid,p_actions jsonb,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid:=(select auth.uid()); v_action jsonb; v_patch jsonb; v_record public.reconcile_actions%rowtype;
  v_index integer; v_subject_id uuid; v_bin_id uuid; v_wine_id uuid; v_lineage_id uuid;
  v_line_index integer; v_prior jsonb; v_new jsonb; v_lines jsonb; v_expected jsonb; v_bin_code text;
  v_existing public.reconcile_batches%rowtype;
  v_existing_found boolean;
begin
  if v_actor is null or not public.current_site_role_at_least(p_restaurant_id,'manager') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_idempotency_key is null or p_actions is null or jsonb_typeof(p_actions)<>'array' then
    raise exception 'C04_RECONCILE_BATCH_INVALID' using errcode='P0001';
  end if;
  if jsonb_array_length(p_actions) not between 1 and 100 then
    raise exception 'C04_RECONCILE_BATCH_INVALID' using errcode='P0001';
  end if;

  v_index:=0;
  for v_action in select value from jsonb_array_elements(p_actions) loop
    if jsonb_typeof(v_action)<>'object' then
      raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
    end if;
    if (select count(*) from jsonb_object_keys(v_action))<>4
       or not (v_action ?& array['action_type','subject_table','subject_id','patch'])
       or exists(select 1 from jsonb_object_keys(v_action) k where k not in ('action_type','subject_table','subject_id','patch'))
       or jsonb_typeof(v_action->'action_type')<>'string'
       or jsonb_typeof(v_action->'subject_table')<>'string'
       or jsonb_typeof(v_action->'subject_id')<>'string'
       or (v_action->>'subject_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(v_action->'patch')<>'object' then
      raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
    end if;
    v_patch:=v_action->'patch';
    if v_action->>'action_type'='place_bin' then
      if v_action->>'subject_table'<>'inventory_items' or (select count(*) from jsonb_object_keys(v_patch))<>1
         or not (v_patch?'bin_id') or jsonb_typeof(v_patch->'bin_id')<>'string'
         or (v_patch->>'bin_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
      end if;
    elsif v_action->>'action_type'='match_scan' then
      if v_action->>'subject_table'<>'invoice_scans' or (select count(*) from jsonb_object_keys(v_patch))<>3
         or not (v_patch?&array['line_index','wine_id','expected_line'])
         or exists(select 1 from jsonb_object_keys(v_patch) k where k not in ('line_index','wine_id','expected_line'))
         or jsonb_typeof(v_patch->'line_index')<>'number'
         or (v_patch->>'line_index')::numeric<>trunc((v_patch->>'line_index')::numeric)
         or (v_patch->>'line_index')::numeric not between 0 and 499
         or jsonb_typeof(v_patch->'wine_id')<>'string'
         or (v_patch->>'wine_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or not public.invoice_line_items_valid(jsonb_build_array(v_patch->'expected_line')) then
        raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
      end if;
    elsif v_action->>'action_type'='link_lineage' then
      if v_action->>'subject_table'<>'wines' or (select count(*) from jsonb_object_keys(v_patch))<>1
         or not (v_patch?'lineage_id') or jsonb_typeof(v_patch->'lineage_id')<>'string'
         or (v_patch->>'lineage_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
      end if;
    elsif v_action->>'action_type'='dismiss' then
      if v_action->>'subject_table' not in ('inventory_items','invoice_scans','wines')
         or (select count(*) from jsonb_object_keys(v_patch))<>0 then
        raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
      end if;
    else raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001'; end if;
    v_index:=v_index+1;
  end loop;
  if exists(
    select 1 from (
      select (a->>'subject_table')||':'||(a->>'subject_id')||
             case when a->>'action_type'='match_scan' then ':'||(a->'patch'->>'line_index') else '' end as k,
             count(*) from jsonb_array_elements(p_actions) a group by 1 having count(*)>1
    ) duplicates
  ) then raise exception 'C04_RECONCILE_DUPLICATE_SUBJECT' using errcode='P0001'; end if;

  -- Existing idempotency rows lock before their subjects, matching undo.
  -- New batches have no row yet and serialize on the later unique insert.
  select * into v_existing from public.reconcile_batches b
   where b.id=p_idempotency_key and b.restaurant_id=p_restaurant_id for update;
  v_existing_found:=found;

  -- Shared identity mutations lock exact-site rows in scan -> wine ->
  -- inventory order. match_scan wine targets are wine locks too even though
  -- their subject_table is invoice_scans.
  perform 1 from public.invoice_scans s join (
    select distinct (a->>'subject_id')::uuid id from jsonb_array_elements(p_actions) a
     where a->>'subject_table'='invoice_scans'
  ) q on q.id=s.id
   where s.restaurant_id=p_restaurant_id order by s.id for update of s;
  perform 1 from public.wines w join (
    select (a->>'subject_id')::uuid id from jsonb_array_elements(p_actions) a
     where a->>'subject_table'='wines'
    union
    select (a->'patch'->>'wine_id')::uuid id from jsonb_array_elements(p_actions) a
     where a->>'action_type'='match_scan'
  ) q on q.id=w.id
   where w.restaurant_id=p_restaurant_id order by w.id for update of w;
  perform 1 from public.inventory_items ii join (
    select distinct (a->>'subject_id')::uuid id from jsonb_array_elements(p_actions) a
     where a->>'subject_table'='inventory_items'
  ) q on q.id=ii.id
   where ii.restaurant_id=p_restaurant_id order by ii.id for update of ii;

  if v_existing_found then
    if v_existing.restaurant_id is distinct from p_restaurant_id
       or v_existing.created_by is distinct from v_actor
       or v_existing.action_count is distinct from jsonb_array_length(p_actions)
       or v_existing.undone_at is not null then
      raise exception 'C04_RECONCILE_IDEMPOTENCY_CONFLICT' using errcode='P0001';
    end if;
    v_index:=0;
    for v_action in select value from jsonb_array_elements(p_actions) loop
      select * into v_record from public.reconcile_actions a
       where a.batch_id=p_idempotency_key and a.restaurant_id=p_restaurant_id
         and a.ordinal=v_index;
      if not found or v_record.action_type is distinct from v_action->>'action_type'
         or v_record.subject_table is distinct from v_action->>'subject_table'
         or v_record.subject_id is distinct from (v_action->>'subject_id')::uuid then
        raise exception 'C04_RECONCILE_IDEMPOTENCY_CONFLICT' using errcode='P0001';
      end if;
      v_patch:=v_action->'patch';
      if (v_record.action_type='place_bin' and v_record.new_state->>'bin_id' is distinct from v_patch->>'bin_id')
         or (v_record.action_type='link_lineage' and v_record.new_state->>'lineage_id' is distinct from v_patch->>'lineage_id')
         or (v_record.action_type='dismiss' and (v_record.prior_state<>'{}'::jsonb or v_record.new_state<>'{}'::jsonb))
         or (v_record.action_type='match_scan' and (
           v_record.prior_state->'final_line_items'->((v_patch->>'line_index')::integer) is distinct from v_patch->'expected_line'
           or v_record.new_state->'final_line_items'->((v_patch->>'line_index')::integer)->>'wine_id' is distinct from v_patch->>'wine_id'
         )) then raise exception 'C04_RECONCILE_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
      v_index:=v_index+1;
    end loop;
    return jsonb_build_object('batchId',p_idempotency_key,'actionCount',v_existing.action_count,'status','accepted');
  end if;

  insert into public.reconcile_batches(id,restaurant_id,created_by,action_count)
  values(p_idempotency_key,p_restaurant_id,v_actor,0);
  v_index:=0;
  for v_action in select value from jsonb_array_elements(p_actions) loop
    v_patch:=v_action->'patch'; v_subject_id:=(v_action->>'subject_id')::uuid;
    if v_action->>'action_type'='place_bin' then
      v_bin_id:=(v_patch->>'bin_id')::uuid;
      select jsonb_build_object('bin_id',ii.bin_id,'bin_location',ii.bin_location)
        into v_prior from public.inventory_items ii
       where ii.id=v_subject_id and ii.restaurant_id=p_restaurant_id;
      select b.code into v_bin_code from public.bins b
       where b.id=v_bin_id and b.restaurant_id=p_restaurant_id and b.retired_at is null;
      if v_prior is null or v_bin_code is null or v_prior->'bin_id'<>'null'::jsonb then
        raise exception 'reconcile_subject_conflict' using errcode='P0001';
      end if;
      v_new:=jsonb_build_object('bin_id',v_bin_id,'bin_location',v_bin_code);
      update public.inventory_items ii set bin_id=v_bin_id,bin_location=v_bin_code
       where ii.id=v_subject_id and ii.restaurant_id=p_restaurant_id and ii.bin_id is null;
      if not found then raise exception 'reconcile_subject_conflict' using errcode='P0001'; end if;
    elsif v_action->>'action_type'='match_scan' then
      v_line_index:=(v_patch->>'line_index')::integer; v_wine_id:=(v_patch->>'wine_id')::uuid;
      select s.final_line_items into v_lines from public.invoice_scans s
       where s.id=v_subject_id and s.restaurant_id=p_restaurant_id and s.committed_at is null;
      if v_lines is null or jsonb_typeof(v_lines)<>'array' or jsonb_array_length(v_lines)<=v_line_index
         or v_lines->v_line_index is distinct from v_patch->'expected_line'
         or not exists(select 1 from public.wines w where w.id=v_wine_id and w.restaurant_id=p_restaurant_id) then
        raise exception 'reconcile_subject_conflict' using errcode='P0001';
      end if;
      v_prior:=jsonb_build_object('final_line_items',v_lines);
      v_lines:=jsonb_set(v_lines,array[v_line_index::text],(v_patch->'expected_line')||jsonb_build_object('wine_id',v_wine_id),false);
      v_new:=jsonb_build_object('final_line_items',v_lines);
      update public.invoice_scans s set final_line_items=v_lines
       where s.id=v_subject_id and s.restaurant_id=p_restaurant_id;
    elsif v_action->>'action_type'='link_lineage' then
      v_lineage_id:=(v_patch->>'lineage_id')::uuid;
      select jsonb_build_object('lineage_id',w.lineage_id) into v_prior from public.wines w
       where w.id=v_subject_id and w.restaurant_id=p_restaurant_id;
      if v_prior is null or not exists(select 1 from public.wine_lineages l
        where l.id=v_lineage_id and l.restaurant_id=p_restaurant_id) then
        raise exception 'reconcile_subject_conflict' using errcode='P0001';
      end if;
      v_new:=jsonb_build_object('lineage_id',v_lineage_id);
      update public.wines w set lineage_id=v_lineage_id
       where w.id=v_subject_id and w.restaurant_id=p_restaurant_id;
    else
      if (v_action->>'subject_table'='inventory_items' and not exists(select 1 from public.inventory_items x where x.id=v_subject_id and x.restaurant_id=p_restaurant_id))
         or (v_action->>'subject_table'='invoice_scans' and not exists(select 1 from public.invoice_scans x where x.id=v_subject_id and x.restaurant_id=p_restaurant_id))
         or (v_action->>'subject_table'='wines' and not exists(select 1 from public.wines x where x.id=v_subject_id and x.restaurant_id=p_restaurant_id)) then
        raise exception 'reconcile_subject_not_found' using errcode='P0002';
      end if;
      v_prior:='{}'::jsonb; v_new:='{}'::jsonb;
    end if;
    insert into public.reconcile_actions(
      batch_id,restaurant_id,action_type,subject_table,subject_id,ordinal,prior_state,new_state
    ) values (
      p_idempotency_key,p_restaurant_id,v_action->>'action_type',v_action->>'subject_table',
      v_subject_id,v_index,v_prior,v_new
    );
    v_index:=v_index+1;
  end loop;
  update public.reconcile_batches b set action_count=v_index
   where b.id=p_idempotency_key and b.restaurant_id=p_restaurant_id;
  return jsonb_build_object('batchId',p_idempotency_key,'actionCount',v_index,'status','accepted');
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
when unique_violation then raise exception 'reconcile_batch_conflict' using errcode='23505';
when others then raise exception 'C04_RECONCILE_ACCEPT_REFUSED' using errcode='P0001';
end;
$function$;

create function public.undo_reconcile_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_actor uuid:=(select auth.uid()); v_batch public.reconcile_batches%rowtype; v_action public.reconcile_actions%rowtype; v_now timestamptz;
begin
  select * into v_batch from public.reconcile_batches b
   where b.id=p_batch_id
     and public.current_site_role_at_least(b.restaurant_id,'manager')
   for update;
  if not found or v_actor is null then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if v_batch.undone_at is not null then raise exception 'reconcile_batch_already_undone' using errcode='P0001'; end if;
  perform 1 from public.reconcile_actions a
   where a.batch_id=p_batch_id and a.restaurant_id=v_batch.restaurant_id
   order by a.ordinal for update;
  perform 1 from public.invoice_scans s join public.reconcile_actions a
    on a.batch_id=p_batch_id and a.subject_table='invoice_scans' and a.subject_id=s.id
   where s.restaurant_id=v_batch.restaurant_id order by s.id for update of s;
  perform 1 from public.wines w join public.reconcile_actions a
    on a.batch_id=p_batch_id and a.subject_table='wines' and a.subject_id=w.id
   where w.restaurant_id=v_batch.restaurant_id order by w.id for update of w;
  perform 1 from public.inventory_items ii join public.reconcile_actions a
    on a.batch_id=p_batch_id and a.subject_table='inventory_items' and a.subject_id=ii.id
   where ii.restaurant_id=v_batch.restaurant_id order by ii.id for update of ii;
  for v_action in select * from public.reconcile_actions a
    where a.batch_id=p_batch_id and a.restaurant_id=v_batch.restaurant_id
      and a.ordinal<v_batch.action_count
    order by a.ordinal desc
  loop
    if v_action.action_type='place_bin' then
      if not exists(select 1 from public.inventory_items ii where ii.id=v_action.subject_id
        and ii.restaurant_id=v_batch.restaurant_id
        and jsonb_build_object('bin_id',ii.bin_id,'bin_location',ii.bin_location)=v_action.new_state) then
        raise exception 'reconcile_subject_changed' using errcode='P0001';
      end if;
      update public.inventory_items ii set
        bin_id=(v_action.prior_state->>'bin_id')::uuid,
        bin_location=v_action.prior_state->>'bin_location'
      where ii.id=v_action.subject_id and ii.restaurant_id=v_batch.restaurant_id;
    elsif v_action.action_type='match_scan' then
      if not exists(select 1 from public.invoice_scans s where s.id=v_action.subject_id
        and s.restaurant_id=v_batch.restaurant_id
        and s.final_line_items=v_action.new_state->'final_line_items') then
        raise exception 'reconcile_subject_changed' using errcode='P0001';
      end if;
      update public.invoice_scans s set final_line_items=v_action.prior_state->'final_line_items'
       where s.id=v_action.subject_id and s.restaurant_id=v_batch.restaurant_id;
    elsif v_action.action_type='link_lineage' then
      if not exists(select 1 from public.wines w where w.id=v_action.subject_id
        and w.restaurant_id=v_batch.restaurant_id
        and jsonb_build_object('lineage_id',w.lineage_id)=v_action.new_state) then
        raise exception 'reconcile_subject_changed' using errcode='P0001';
      end if;
      update public.wines w set lineage_id=(v_action.prior_state->>'lineage_id')::uuid
       where w.id=v_action.subject_id and w.restaurant_id=v_batch.restaurant_id;
    elsif v_action.action_type<>'dismiss' then
      raise exception 'reconcile_action_invalid' using errcode='P0001';
    end if;
  end loop;
  v_now:=statement_timestamp();
  update public.reconcile_batches b set undone_at=v_now,undone_by=v_actor
   where b.id=p_batch_id and b.restaurant_id=v_batch.restaurant_id and b.undone_at is null;
  if not found then raise exception 'reconcile_batch_conflict' using errcode='P0001'; end if;
  return jsonb_build_object('batchId',p_batch_id,'actionCount',v_batch.action_count,'status','undone','undoneAt',v_now);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when others then raise exception 'C04_RECONCILE_UNDO_REFUSED' using errcode='P0001';
end;
$function$;

alter function public.merge_wines(uuid,uuid) rename to merge_wines_pre_0157;
revoke all on function public.merge_wines_pre_0157(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.merge_wines(p_source_wine_id uuid,p_target_wine_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_site uuid; v_source public.wines%rowtype; v_target public.wines%rowtype;
  v_result jsonb; v_parsed_scan_ids uuid[]:=array[]::uuid[];
  v_final_scan_ids uuid[]:=array[]::uuid[]; v_moved_scan_count integer:=0;
begin
  if p_source_wine_id is not distinct from p_target_wine_id then
    raise exception 'identical_merge' using errcode='P04M0';
  end if;

  select source.restaurant_id into v_site
    from public.wines source join public.wines target
      on target.id=p_target_wine_id and target.restaurant_id=source.restaurant_id
   where source.id=p_source_wine_id
     and public.current_site_role_at_least(source.restaurant_id,'manager');
  if not found then
    raise exception 'wine_not_found' using errcode='P04M1';
  end if;

  -- Lock every mutable scan before either wine. This prevents a concurrent
  -- reconciliation from adding a source reference between a narrow probe and
  -- the merge, while committed scan evidence remains immutable history.
  perform 1 from public.invoice_scans s
   where s.restaurant_id=v_site and s.committed_at is null
   order by s.id for update;
  perform 1 from public.wines w
   where w.restaurant_id=v_site and w.id in (p_source_wine_id,p_target_wine_id)
   order by w.id for update;
  select * into v_source from public.wines w
   where w.id=p_source_wine_id and w.restaurant_id=v_site;
  select * into v_target from public.wines w
   where w.id=p_target_wine_id and w.restaurant_id=v_site;
  if v_source.id is null or v_target.id is null then
    raise exception 'wine_not_found' using errcode='P04M1';
  end if;
  if v_source.lineage_id is null or v_target.lineage_id is null
     or v_source.lineage_id is distinct from v_target.lineage_id then
    raise exception 'lineage_mismatch_merge' using errcode='P04M2';
  end if;
  if coalesce(v_source.vintage,0) is distinct from coalesce(v_target.vintage,0) then
    raise exception 'cross_vintage_merge' using errcode='P04M3';
  end if;
  if v_source.size_ml is distinct from v_target.size_ml then
    raise exception 'format_mismatch_merge' using errcode='P04M4';
  end if;
  if v_source.wine_variant_id is not null and v_target.wine_variant_id is not null
     and v_source.wine_variant_id is distinct from v_target.wine_variant_id then
    raise exception 'variant_identity_conflict' using errcode='P04M5';
  end if;

  with updated as (
    update public.invoice_scans s set parsed_line_items=(
      select jsonb_agg(
        case when x.item->>'wine_id'=p_source_wine_id::text
             then x.item||jsonb_build_object('wine_id',p_target_wine_id)
             else x.item end order by x.ordinality
      ) from jsonb_array_elements(s.parsed_line_items) with ordinality x(item,ordinality)
    )
     where s.restaurant_id=v_site and s.committed_at is null
       and jsonb_typeof(s.parsed_line_items)='array'
       and s.parsed_line_items @> jsonb_build_array(jsonb_build_object('wine_id',p_source_wine_id))
    returning s.id
  ) select coalesce(array_agg(updated.id),array[]::uuid[]) into v_parsed_scan_ids from updated;
  with updated as (
    update public.invoice_scans s set final_line_items=(
      select jsonb_agg(
        case when x.item->>'wine_id'=p_source_wine_id::text
             then x.item||jsonb_build_object('wine_id',p_target_wine_id)
             else x.item end order by x.ordinality
      ) from jsonb_array_elements(s.final_line_items) with ordinality x(item,ordinality)
    )
     where s.restaurant_id=v_site and s.committed_at is null
       and jsonb_typeof(s.final_line_items)='array'
       and s.final_line_items @> jsonb_build_array(jsonb_build_object('wine_id',p_source_wine_id))
    returning s.id
  ) select coalesce(array_agg(updated.id),array[]::uuid[]) into v_final_scan_ids from updated;
  select count(distinct moved.id)::integer into v_moved_scan_count
    from unnest(v_parsed_scan_ids||v_final_scan_ids) moved(id);

  select public.merge_wines_pre_0157(p_source_wine_id,p_target_wine_id) into v_result;
  return v_result||jsonb_build_object('moved_uncommitted_invoice_scans',v_moved_scan_count);
exception
  when sqlstate '42501' then raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P04M0' then raise exception 'identical_merge' using errcode='P0001';
  when sqlstate 'P04M1' then raise exception 'wine_not_found' using errcode='P0002';
  when sqlstate 'P04M2' then raise exception 'lineage_mismatch_merge' using errcode='P0001';
  when sqlstate 'P04M3' then raise exception 'cross_vintage_merge' using errcode='P0001';
  when sqlstate 'P04M4' then raise exception 'format_mismatch_merge' using errcode='P0001';
  when sqlstate 'P04M5' then raise exception 'variant_identity_conflict' using errcode='P0001';
  when unique_violation then raise exception 'merge_conflict' using errcode='23505';
  when others then raise exception 'C04_WINE_MERGE_REFUSED' using errcode='P0001';
end;
$function$;

-- Exact routine ACLs. Legacy table/column grants remain untouched here; the
-- separately admitted contract migration owns their later removal.
revoke all on function public.read_inventory_costs(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_inventory_costs(uuid,uuid[]) to authenticated;
revoke all on function public.read_wine_pricing_strategy(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_wine_pricing_strategy(uuid,uuid[]) to authenticated;
revoke all on function public.read_wine_cost_flags(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_wine_cost_flags(uuid,uuid[]) to authenticated;
revoke all on function public.read_restaurant_pricing_defaults(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_restaurant_pricing_defaults(uuid) to authenticated;
revoke all on function public.read_pricing_recommendations(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_pricing_recommendations(uuid) to authenticated;
revoke all on function public.read_invoice_scan_private(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_scan_private(uuid) to authenticated;
revoke all on function public.read_invoice_image_target(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_image_target(uuid,integer) to authenticated;
revoke all on function public.read_invoice_scan_deletion_private(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_invoice_scan_deletion_private(uuid) to authenticated;
revoke all on function public.read_reconcile_action_private(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_reconcile_action_private(uuid) to authenticated;
revoke all on function public.read_identity_merge_private(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_identity_merge_private(uuid) to authenticated;
revoke all on function public.read_import_batch_cost_rows(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_import_batch_cost_rows(uuid,integer,integer) to authenticated;
revoke all on function public.read_cellar_health_private(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_cellar_health_private(uuid,uuid[]) to authenticated;

revoke all on function public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric) from public,anon,authenticated,service_role;
grant execute on function public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric) to authenticated;
revoke all on function public.set_restaurant_pricing_defaults(uuid,numeric,numeric) from public,anon,authenticated,service_role;
grant execute on function public.set_restaurant_pricing_defaults(uuid,numeric,numeric) to authenticated;
revoke all on function public.dismiss_pricing_alert_private(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.dismiss_pricing_alert_private(uuid,integer) to authenticated;
revoke all on function public.set_wine_overpaid_flag(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_wine_overpaid_flag(uuid,uuid,boolean) to authenticated;
revoke all on function public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via) from public,anon,authenticated,service_role;
grant execute on function public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via) to authenticated;
revoke all on function public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text) to authenticated;
revoke all on function public.delete_wine_private(uuid,uuid,timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public.delete_wine_private(uuid,uuid,timestamp with time zone) to authenticated;
revoke all on function public.add_manual_overrides(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.add_manual_overrides(uuid,text[]) to authenticated;
revoke all on function public.enrich_wines_batch(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.enrich_wines_batch(uuid,jsonb) to authenticated;

revoke all on function public.create_invoice_scan_upload(uuid,uuid,text,text,text,date) from public,anon,authenticated,service_role;
grant execute on function public.create_invoice_scan_upload(uuid,uuid,text,text,text,date) to authenticated;
revoke all on function public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb) to authenticated;
revoke all on function public.commit_invoice_scan(uuid) from public,anon,authenticated,service_role;
grant execute on function public.commit_invoice_scan(uuid) to authenticated;
revoke all on function public.delete_invoice_scan(uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_invoice_scan(uuid) to authenticated;
revoke all on function public.request_invoice_scan_reextract(uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_invoice_scan_reextract(uuid) to authenticated;

revoke all on function public.claim_scan_idempotency(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_scan_idempotency(uuid,uuid,text) to authenticated;
revoke all on function public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid) to authenticated;
revoke all on function public.abandon_scan_idempotency(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.abandon_scan_idempotency(uuid,uuid,text) to authenticated;

revoke all on function public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text) to authenticated;
revoke all on function public.count_import_batch_rows(uuid) from public,anon,authenticated,service_role;
grant execute on function public.count_import_batch_rows(uuid) to authenticated;
revoke all on function public.apply_import_batch_chunk(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.apply_import_batch_chunk(uuid,integer) to authenticated;
revoke all on function public.resolve_import_batch_row(uuid,text,numeric) from public,anon,authenticated,service_role;
grant execute on function public.resolve_import_batch_row(uuid,text,numeric) to authenticated;
revoke all on function public.bulk_resolve_import_batch_rows(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.bulk_resolve_import_batch_rows(uuid,text) to authenticated;
revoke all on function public.revert_import_batch(uuid) from public,anon,authenticated,service_role;
grant execute on function public.revert_import_batch(uuid) to authenticated;
revoke all on function public.revert_import_session(uuid) from public,anon,authenticated,service_role;
grant execute on function public.revert_import_session(uuid) to authenticated;

revoke all on function public.accept_reconcile_batch(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.accept_reconcile_batch(uuid,jsonb,uuid) to authenticated;
revoke all on function public.undo_reconcile_batch(uuid) from public,anon,authenticated,service_role;
grant execute on function public.undo_reconcile_batch(uuid) to authenticated;
revoke all on function public.merge_wines(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.merge_wines(uuid,uuid) to authenticated;

comment on column public.scan_idempotency.claimed_by_user_id is
  'Actor binding for the bounded 24-hour scan transport retry cache. This is not durable business-operation idempotency and is not atomic with earlier inventory writes.';
comment on function public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid) is
  'Completes only an actor/site/kind-bound unfinished claim with one internally constructed typed receipt. This 24-hour transport cache does not make a separate business write atomic.';

-- Cost-free staff display projection admitted after the concrete import UI
-- inventory. Raw JSON is never returned or stringified.
create function public.read_import_batch_display_rows(
  p_batch_id uuid,p_after_row_number integer default 0,p_limit integer default 100
) returns table(
  row_id uuid,batch_id uuid,restaurant_id uuid,row_number integer,
  producer text,name text
)
language plpgsql stable security definer set search_path = ''
as $function$
declare v_restaurant_id uuid;
begin
  if p_after_row_number is null or p_limit is null
     or not (p_after_row_number>=0) or not (p_limit between 1 and 500) then
    raise exception 'C04_IMPORT_PAGE_INVALID' using errcode='P0001';
  end if;
  select b.restaurant_id into v_restaurant_id from public.import_batches b where b.id=p_batch_id;
  if v_restaurant_id is null or not public.current_site_role_at_least(v_restaurant_id,'staff') then return; end if;
  return query
  select r.id,r.batch_id,r.restaurant_id,r.row_number,
         case when jsonb_typeof(r.raw->'producer')='string' then r.raw->>'producer' else null end,
         case when jsonb_typeof(r.raw->'name')='string' then r.raw->>'name' else null end
    from public.import_batch_rows r
   where r.batch_id=p_batch_id and r.restaurant_id=v_restaurant_id
     and r.row_number>p_after_row_number
   order by r.row_number asc,r.id asc limit p_limit;
end;
$function$;
revoke all on function public.read_import_batch_display_rows(uuid,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.read_import_batch_display_rows(uuid,integer,integer)
  to authenticated;

-- Definer identity is part of the boundary. Do not inherit the migration
-- runner as owner: normalize every new or replaced routine explicitly to the
-- existing postgres role, without creating or altering any cluster role.
alter function public.wine_manual_overrides_valid(text[]) owner to postgres;
alter function public.wine_enrichment_metadata_valid(jsonb) owner to postgres;
alter function public.current_site_role_at_least(uuid,public.membership_role) owner to postgres;
alter function public.read_inventory_costs(uuid,uuid[]) owner to postgres;
alter function public.read_wine_pricing_strategy(uuid,uuid[]) owner to postgres;
alter function public.read_wine_cost_flags(uuid,uuid[]) owner to postgres;
alter function public.read_restaurant_pricing_defaults(uuid) owner to postgres;
alter function public.read_pricing_recommendations(uuid) owner to postgres;
alter function public.read_invoice_scan_private(uuid) owner to postgres;
alter function public.read_invoice_scan_deletion_private(uuid) owner to postgres;
alter function public.read_reconcile_action_private(uuid) owner to postgres;
alter function public.read_identity_merge_private(uuid) owner to postgres;
alter function public.read_import_batch_cost_rows(uuid,integer,integer) owner to postgres;
alter function public.read_import_batch_display_rows(uuid,integer,integer) owner to postgres;
alter function public.read_cellar_health_private(uuid,uuid[]) owner to postgres;
alter function public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric) owner to postgres;
alter function public.set_restaurant_pricing_defaults(uuid,numeric,numeric) owner to postgres;
alter function public.dismiss_pricing_alert_private(uuid,integer) owner to postgres;
alter function public.set_wine_overpaid_flag(uuid,uuid,boolean) owner to postgres;
alter function public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via) owner to postgres;
alter function public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text) owner to postgres;
alter function public.delete_wine_private(uuid,uuid,timestamp with time zone) owner to postgres;
alter function public.add_manual_overrides(uuid,text[]) owner to postgres;
alter function public.enrich_wines_batch(uuid,jsonb) owner to postgres;
alter function public.claim_scan_idempotency(uuid,uuid,text) owner to postgres;
alter function public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid) owner to postgres;
alter function public.abandon_scan_idempotency(uuid,uuid,text) owner to postgres;
alter function public.cleanup_scan_idempotency() owner to postgres;
alter function public.invoice_line_items_valid(jsonb) owner to postgres;
alter function public.invoice_edits_valid(jsonb) owner to postgres;
alter function public.create_invoice_scan_upload(uuid,uuid,text,text,text,date) owner to postgres;
alter function public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb) owner to postgres;
alter function public.commit_invoice_scan(uuid) owner to postgres;
alter function public.delete_invoice_scan(uuid) owner to postgres;
alter function public.request_invoice_scan_reextract(uuid) owner to postgres;
alter function public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text) owner to postgres;
alter function public.count_import_batch_rows(uuid) owner to postgres;
alter function public.apply_import_batch_chunk(uuid,integer) owner to postgres;
alter function public.resolve_import_batch_row(uuid,text,numeric) owner to postgres;
alter function public.bulk_resolve_import_batch_rows(uuid,text) owner to postgres;
alter function public.revert_import_batch(uuid) owner to postgres;
alter function public.revert_import_session(uuid) owner to postgres;
alter function public.invoice_image_paths_valid(uuid,uuid,text,jsonb) owner to postgres;
alter function public.read_invoice_image_target(uuid,integer) owner to postgres;
alter function public.accept_reconcile_batch(uuid,jsonb,uuid) owner to postgres;
alter function public.undo_reconcile_batch(uuid) owner to postgres;
alter function public.merge_wines(uuid,uuid) owner to postgres;
