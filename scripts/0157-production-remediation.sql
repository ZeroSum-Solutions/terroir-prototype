-- One-time, fail-closed repair for a committed pre-0157 invoice scan whose
-- line JSON predates persisted wine identities. The caller must provide the
-- exact scan, line count, and JSON preimage digest observed during preflight.
--
-- Run in one caller-owned transaction, for example:
--   psql -X -v ON_ERROR_STOP=1 --single-transaction \
--     -v target_scan_id=... -v expected_lines=... \
--     -v expected_preimage_md5=... \
--     -f scripts/0157-production-remediation.sql

\set ON_ERROR_STOP on

select pg_catalog.set_config(
  'terroir.c04_0157_remediation_target_scan_id',
  :'target_scan_id',
  true
);
select pg_catalog.set_config(
  'terroir.c04_0157_remediation_expected_lines',
  :'expected_lines',
  true
);
select pg_catalog.set_config(
  'terroir.c04_0157_remediation_expected_preimage_md5',
  :'expected_preimage_md5',
  true
);

lock table public.invoice_scans in share row exclusive mode nowait;
lock table public.inventory_items in share row exclusive mode nowait;
lock table public.wines in share row exclusive mode nowait;

do $remediate$
declare
  v_scan public.invoice_scans%rowtype;
  v_target_scan_id uuid := pg_catalog.current_setting(
    'terroir.c04_0157_remediation_target_scan_id'
  )::uuid;
  v_expected_lines integer := pg_catalog.current_setting(
    'terroir.c04_0157_remediation_expected_lines'
  )::integer;
  v_expected_preimage_md5 text := pg_catalog.current_setting(
    'terroir.c04_0157_remediation_expected_preimage_md5'
  );
  v_item jsonb;
  v_ordinal bigint;
  v_wine_id uuid;
  v_candidate_count integer;
  v_inventory_rows integer;
  v_inventory_wines integer;
  v_updated_rows integer;
  v_used_wine_ids uuid[] := array[]::uuid[];
  v_repaired_lines jsonb := '[]'::jsonb;
begin
  if v_expected_lines < 1 or v_expected_lines > 1000
     or v_expected_preimage_md5 !~ '^[0-9a-f]{32}$' then
    raise exception 'C04_0157_REMEDIATION_ARGUMENT_INVALID'
      using errcode = 'P0001';
  end if;

  select * into strict v_scan
    from public.invoice_scans s
   where s.id = v_target_scan_id
   for update;

  if v_scan.committed_at is null
     or pg_catalog.md5(v_scan.final_line_items::text) <> v_expected_preimage_md5
     or pg_catalog.jsonb_typeof(v_scan.final_line_items) <> 'array'
     or pg_catalog.jsonb_array_length(v_scan.final_line_items) <> v_expected_lines
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements(v_scan.final_line_items) x(item)
        where pg_catalog.jsonb_typeof(x.item) <> 'object'
           or x.item ? 'wine_id'
     ) then
    raise exception 'C04_0157_REMEDIATION_PREIMAGE_MISMATCH'
      using errcode = 'P0001';
  end if;

  select count(*), count(distinct ii.wine_id)
    into v_inventory_rows, v_inventory_wines
    from public.inventory_items ii
   where ii.invoice_scan_id = v_scan.id
     and ii.restaurant_id = v_scan.restaurant_id;

  if v_inventory_rows <> v_expected_lines
     or v_inventory_wines <> v_expected_lines then
    raise exception 'C04_0157_REMEDIATION_INVENTORY_CARDINALITY_MISMATCH'
      using errcode = 'P0001';
  end if;

  for v_item, v_ordinal in
    select x.item, x.ordinality
      from pg_catalog.jsonb_array_elements(v_scan.final_line_items)
           with ordinality x(item, ordinality)
     order by x.ordinality
  loop
    select count(*), (array_agg(ii.wine_id order by ii.wine_id))[1]
      into v_candidate_count, v_wine_id
      from public.inventory_items ii
      join public.wines w on w.id = ii.wine_id
     where ii.invoice_scan_id = v_scan.id
       and ii.restaurant_id = v_scan.restaurant_id
       and ii.quantity = (v_item->>'qty')::integer
       and ii.unit_cost = (v_item->>'unitCost')::numeric
       and ii.currency = v_item->>'currency'
       and ii.format::text = v_item->>'format'
       and w.producer = v_item->>'producer'
       and w.name = v_item->>'name'
       and w.vintage::text is not distinct from v_item->>'vintage'
       and w.varietal is not distinct from v_item->>'varietal'
       and w.region is not distinct from v_item->>'region';

    if v_candidate_count <> 1
       or v_wine_id = any(v_used_wine_ids) then
      raise exception 'C04_0157_REMEDIATION_LINE_%_NOT_UNIQUE', v_ordinal
        using errcode = 'P0001';
    end if;

    v_used_wine_ids := pg_catalog.array_append(v_used_wine_ids, v_wine_id);
    v_repaired_lines := v_repaired_lines || pg_catalog.jsonb_build_array(
      v_item || pg_catalog.jsonb_build_object('wine_id', v_wine_id)
    );
  end loop;

  update public.invoice_scans s
     set final_line_items = v_repaired_lines
   where s.id = v_scan.id
     and s.restaurant_id = v_scan.restaurant_id
     and s.committed_at is not null
     and pg_catalog.md5(s.final_line_items::text) = v_expected_preimage_md5;
  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1
     or pg_catalog.jsonb_array_length(v_repaired_lines) <> v_expected_lines
     or exists (
       select 1
         from pg_catalog.jsonb_array_elements(v_repaired_lines) x(item)
        where not (x.item ? 'wine_id')
           or not exists (
             select 1
               from public.inventory_items ii
              where ii.invoice_scan_id = v_scan.id
                and ii.restaurant_id = v_scan.restaurant_id
                and ii.wine_id = (x.item->>'wine_id')::uuid
           )
     ) then
    raise exception 'C04_0157_REMEDIATION_POSTIMAGE_MISMATCH'
      using errcode = 'P0001';
  end if;

  raise notice 'C04_0157_REMEDIATION_PASS scan=% lines=%',
    v_scan.id, v_expected_lines;
exception
  when no_data_found then
    raise exception 'C04_0157_REMEDIATION_TARGET_NOT_FOUND'
      using errcode = 'P0001';
  when too_many_rows then
    raise exception 'C04_0157_REMEDIATION_TARGET_NOT_UNIQUE'
      using errcode = 'P0001';
end;
$remediate$;
