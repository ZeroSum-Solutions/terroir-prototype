-- Read-only admission probe for the additive staff-cost boundary.
\set ON_ERROR_STOP on
\pset pager off

select 'C04_0157_EXECUTOR' as evidence,current_database(),current_user,session_user,
       r.rolsuper,r.rolbypassrls
from pg_catalog.pg_roles r where r.rolname=current_user;

begin;
lock table public.invoice_scans in share row exclusive mode nowait;
lock table public.wines in share row exclusive mode nowait;
lock table public.scan_idempotency in share row exclusive mode nowait;

do $preflight$
declare
  v_wine record;
  v_scan record;
  v_path jsonb;
  v_prefix text;
  v_n integer;
  v_enriched_at timestamptz;
begin
  if public.current_inventory_contract_version()<>2
     or to_regprocedure('public.effective_site_capability(uuid,text)') is null
     or to_regprocedure('public.effective_site_ids(text)') is null
     or to_regrole('postgres') is null
     or to_regprocedure('public.delete_invoice_scan(uuid)') is null
     or to_regprocedure('public.merge_wines(uuid,uuid)') is null then
    raise exception 'C04_0157_REQUIRED_BASELINE_MISSING';
  end if;
  if to_regprocedure('public.current_site_role_at_least(uuid,public.membership_role)') is not null
     or exists(select 1 from pg_catalog.pg_attribute a
       where a.attrelid='public.scan_idempotency'::regclass
         and a.attname='claimed_by_user_id' and a.attnum>0 and not a.attisdropped) then
    raise exception 'C04_0157_ALREADY_OR_PARTIALLY_APPLIED';
  end if;
  if exists(select 1 from public.wines w where w.manual_overrides is not null and (
       cardinality(w.manual_overrides)>4
       or cardinality(w.manual_overrides)<>(select count(distinct f)::integer from unnest(w.manual_overrides) f)
       or exists(select 1 from unnest(w.manual_overrides) f where f is null or f not in ('drink_window','region','country','varietal'))
     )) then raise exception 'C04_0157_HISTORICAL_MANUAL_OVERRIDES_INVALID'; end if;
  for v_wine in select w.id,w.enrichment_metadata value from public.wines w
    where w.enrichment_metadata is not null
  loop
    if jsonb_typeof(v_wine.value)<>'object' then
      raise exception 'C04_0157_HISTORICAL_ENRICHMENT_METADATA_INVALID';
    end if;
    if (select count(*) from jsonb_object_keys(v_wine.value))<>3
       or not (v_wine.value?&array['source','fields_enriched','enriched_at'])
       or exists(select 1 from jsonb_object_keys(v_wine.value) k where k not in ('source','fields_enriched','enriched_at'))
       or jsonb_typeof(v_wine.value->'source')<>'string'
       or v_wine.value->>'source' not in ('rule_engine','lwin_fallback')
       or jsonb_typeof(v_wine.value->'fields_enriched')<>'array'
       or jsonb_typeof(v_wine.value->'enriched_at')<>'string' then
      raise exception 'C04_0157_HISTORICAL_ENRICHMENT_METADATA_INVALID';
    end if;
    if jsonb_array_length(v_wine.value->'fields_enriched')>10
       or exists(select 1 from jsonb_array_elements(v_wine.value->'fields_enriched') f
          where jsonb_typeof(f)<>'string' or f#>>'{}' not in ('drink_window','serving_temp','decant','peak_year','rating_source','review_excerpt','region','country','varietal','colour'))
       or jsonb_array_length(v_wine.value->'fields_enriched')<>(select count(distinct f)::integer from jsonb_array_elements(v_wine.value->'fields_enriched') f)
       or octet_length(v_wine.value->>'enriched_at')>32
       or v_wine.value->>'enriched_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' then
      raise exception 'C04_0157_HISTORICAL_ENRICHMENT_METADATA_INVALID';
    end if;
    begin
      v_enriched_at:=(v_wine.value->>'enriched_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'C04_0157_HISTORICAL_ENRICHMENT_METADATA_INVALID';
    end;
    if v_enriched_at<'2000-01-01T00:00:00Z'::timestamptz
       or v_enriched_at>='2100-01-01T00:00:00Z'::timestamptz then
      raise exception 'C04_0157_HISTORICAL_ENRICHMENT_METADATA_INVALID';
    end if;
  end loop;

  -- src/app/api/scan/route.ts writes one page as <site>/<scan>.<ext>, or
  -- a photo batch as <site>/<scan>_page1..<site>/<scan>_page8.
  for v_scan in
    select s.id,s.restaurant_id,s.raw_image_path,s.extra_image_paths
      from public.invoice_scans s
  loop
    v_prefix:=v_scan.restaurant_id::text||'/'||v_scan.id::text;
    if v_scan.extra_image_paths is null
       or jsonb_typeof(v_scan.extra_image_paths)<>'array' then
      raise exception 'C04_0157_HISTORICAL_INVOICE_IMAGE_PATH_INVALID';
    end if;
    if jsonb_array_length(v_scan.extra_image_paths)>7
       or (v_scan.raw_image_path is null and jsonb_array_length(v_scan.extra_image_paths)<>0)
       or (v_scan.raw_image_path is not null and (
         octet_length(v_scan.raw_image_path)>200
         or v_scan.raw_image_path !~ ('^'||v_prefix||'(_page1)?[.](jpg|jpeg|png|heic|heif|pdf)$')
       ))
       or (jsonb_array_length(v_scan.extra_image_paths)>0 and
         v_scan.raw_image_path !~ ('^'||v_prefix||'_page1[.](jpg|jpeg|png|heic|heif)$')) then
      raise exception 'C04_0157_HISTORICAL_INVOICE_IMAGE_PATH_INVALID';
    end if;
    v_n:=0;
    for v_path in select value from jsonb_array_elements(v_scan.extra_image_paths) loop
      v_n:=v_n+1;
      if jsonb_typeof(v_path)<>'string' or octet_length(v_path#>>'{}')>200
         or (v_path#>>'{}') !~ ('^'||v_prefix||'_page'||(v_n+1)::text||'[.](jpg|jpeg|png|heic|heif)$') then
        raise exception 'C04_0157_HISTORICAL_INVOICE_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end loop;
  if exists(
    select 1 from public.invoice_scans s
     where s.committed_at is not null and case
       when s.final_line_items is null
         or jsonb_typeof(s.final_line_items)<>'array' then true
       when jsonb_array_length(s.final_line_items)<1 then true
       else exists(
         select 1 from jsonb_array_elements(s.final_line_items) x(item)
          where jsonb_typeof(x.item)<>'object'
             or not (x.item?'wine_id')
             or jsonb_typeof(x.item->'wine_id')<>'string'
             or (x.item->>'wine_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       ) end
  ) then
    raise exception 'C04_0157_COMMITTED_SCAN_IDENTITY_MISSING';
  end if;
end;
$preflight$;
rollback;

\echo C04_0157_PRODUCTION_PREFLIGHT_PASS
