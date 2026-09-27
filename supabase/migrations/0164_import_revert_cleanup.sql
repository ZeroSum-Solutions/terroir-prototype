-- 0164_import_revert_cleanup.sql
--
-- Retain catalog and history while making inventory reversal, eligible exact
-- LWIN-pair cleanup, and batch/session status one atomic operation.

do $c09_0164_preflight$
declare
  v_apply_function pg_catalog.pg_proc%rowtype;
  v_apply_private_function pg_catalog.pg_proc%rowtype;
  v_batch_function pg_catalog.pg_proc%rowtype;
  v_session_function pg_catalog.pg_proc%rowtype;
  v_role_function pg_catalog.pg_proc%rowtype;
  v_updated_at_function pg_catalog.pg_proc%rowtype;
  v_delete_function pg_catalog.pg_proc%rowtype;
  v_column_count integer;
begin
  if pg_catalog.to_regclass('public.import_batches') is null
     or pg_catalog.to_regclass('public.import_batch_rows') is null
     or pg_catalog.to_regclass('public.import_sessions') is null
     or pg_catalog.to_regclass('public.wines') is null
     or pg_catalog.to_regclass('public.inventory_items') is null
     or pg_catalog.to_regclass('public.open_bottles') is null
     or pg_catalog.to_regprocedure(
       'public.current_site_role_at_least(uuid,public.membership_role)'
     ) is null
     or pg_catalog.to_regprocedure('public.set_updated_at()') is null
     or pg_catalog.to_regprocedure(
       'public.import_batch_rows_reflect_inventory_delete()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.apply_import_batch_chunk(uuid,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.apply_import_batch_chunk_pre_0157(uuid,integer)'
     ) is null
     or pg_catalog.to_regprocedure('public.revert_import_batch(uuid)') is null
     or pg_catalog.to_regprocedure('public.revert_import_session(uuid)') is null
     or pg_catalog.to_regrole('postgres') is null
     or pg_catalog.to_regrole('anon') is null
     or pg_catalog.to_regrole('authenticated') is null
     or pg_catalog.to_regrole('service_role') is null then
    raise exception 'C09_0164_REQUIRED_BASELINE_MISSING' using errcode = 'P0001';
  end if;

  if exists (
       select 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'revert_import_batch_core_private',
            'revert_import_batch_private'
          )
     ) then
    raise exception 'C09_0164_TARGET_IDENTITY_OCCUPIED' using errcode = 'P0001';
  end if;

  select p.* into strict v_batch_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.revert_import_batch(uuid)');
  select p.* into strict v_session_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.revert_import_session(uuid)');
  select p.* into strict v_apply_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.apply_import_batch_chunk(uuid,integer)'
   );
  select p.* into strict v_apply_private_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.apply_import_batch_chunk_pre_0157(uuid,integer)'
   );
  select p.* into strict v_role_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.current_site_role_at_least(uuid,public.membership_role)'
   );
  select p.* into strict v_updated_at_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.set_updated_at()');
  select p.* into strict v_delete_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.import_batch_rows_reflect_inventory_delete()'
   );

  select pg_catalog.count(*) into v_column_count
    from pg_catalog.pg_attribute a
   where (a.attrelid, a.attname, a.atttypid, a.attnotnull) in (
     (pg_catalog.to_regclass('public.import_batches'), 'id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.import_batches'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.import_batches'), 'status',
       pg_catalog.to_regtype('pg_catalog.text'), true),
     (pg_catalog.to_regclass('public.import_batches'), 'reverted_at',
       pg_catalog.to_regtype('pg_catalog.timestamptz'), false),
     (pg_catalog.to_regclass('public.import_batches'), 'reverted_by',
       pg_catalog.to_regtype('pg_catalog.uuid'), false),
     (pg_catalog.to_regclass('public.import_batches'), 'session_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), false),
     (pg_catalog.to_regclass('public.import_batches'), 'chunk_index',
       pg_catalog.to_regtype('pg_catalog.int4'), false),
     (pg_catalog.to_regclass('public.import_batches'), 'created_at',
       pg_catalog.to_regtype('pg_catalog.timestamptz'), true),
     (pg_catalog.to_regclass('public.import_batch_rows'), 'id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.import_batch_rows'), 'batch_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.import_batch_rows'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.import_batch_rows'), 'apply_status',
       pg_catalog.to_regtype('pg_catalog.text'), true),
     (pg_catalog.to_regclass('public.import_batch_rows'),
       'applied_inventory_item_id', pg_catalog.to_regtype('pg_catalog.uuid'), false),
     (pg_catalog.to_regclass('public.import_batch_rows'), 'applied_wine_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), false),
     (pg_catalog.to_regclass('public.import_batch_rows'), 'updated_at',
       pg_catalog.to_regtype('pg_catalog.timestamptz'), true),
     (pg_catalog.to_regclass('public.import_batch_rows'), 'lwin_id',
       pg_catalog.to_regtype('pg_catalog.text'), false),
     (pg_catalog.to_regclass('public.import_batch_rows'), 'lwin_score',
       pg_catalog.to_regtype('pg_catalog.float4'), false),
     (pg_catalog.to_regclass('public.import_sessions'), 'id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.import_sessions'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.import_sessions'), 'status',
       pg_catalog.to_regtype('pg_catalog.text'), true),
     (pg_catalog.to_regclass('public.wines'), 'id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.wines'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.wines'), 'lwin_id',
       pg_catalog.to_regtype('pg_catalog.text'), false),
     (pg_catalog.to_regclass('public.wines'), 'lwin_match_score',
       pg_catalog.to_regtype('pg_catalog.float4'), false),
     (pg_catalog.to_regclass('public.wines'), 'updated_at',
       pg_catalog.to_regtype('pg_catalog.timestamptz'), true),
     (pg_catalog.to_regclass('public.inventory_items'), 'id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.inventory_items'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.inventory_items'), 'wine_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.open_bottles'), 'source_inventory_item_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), false)
   )
     and a.attnum > 0
     and not a.attisdropped;

  if v_column_count <> 29
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_apply_function.prosrc, 'UTF8')
     ), 'hex') <> '3b84ef448e44560db50067e35091cb0f4a96f170f0a696be3eaac3661e25116b'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_apply_private_function.prosrc, 'UTF8')
     ), 'hex') <> 'dbdaef5364b676c09dd4670da5a5c4d27c99aaefeea76db2817fc48f85ea7710'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_batch_function.prosrc, 'UTF8')
     ), 'hex') <> '23b230a852f5cfa86fca557d3a190a8eec02e719ab7cd93ed49969ec93659c07'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_session_function.prosrc, 'UTF8')
     ), 'hex') <> '119a2ca01ebdb5af1553f738fb7b68c03076680336085d831ff95cfe8fbab884'
     or pg_catalog.pg_get_userbyid(v_batch_function.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_session_function.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_apply_function.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_apply_private_function.proowner) <> 'postgres'
     or not v_batch_function.prosecdef
     or not v_session_function.prosecdef
     or not v_apply_function.prosecdef
     or v_apply_private_function.prosecdef
     or v_batch_function.provolatile <> 'v'
     or v_session_function.provolatile <> 'v'
     or v_apply_function.provolatile <> 'v'
     or v_apply_private_function.provolatile <> 'v'
     or v_apply_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
     or v_apply_private_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
     or v_apply_function.prorettype <> pg_catalog.to_regtype('pg_catalog.record')
     or v_apply_private_function.prorettype <>
       pg_catalog.to_regtype('pg_catalog.record')
     or not v_apply_function.proretset
     or not v_apply_private_function.proretset
     or v_apply_function.pronargdefaults <> 1
     or v_apply_private_function.pronargdefaults <> 1
     or pg_catalog.pg_get_expr(v_apply_function.proargdefaults, 0, false) <> '100'
     or pg_catalog.pg_get_expr(
       v_apply_private_function.proargdefaults, 0, false
     ) <> '50'
     or pg_catalog.to_jsonb(v_apply_function.proargnames) is distinct from
       '["p_batch_id", "p_limit", "row_id", "row_number", "outcome", "inventory_item_id", "error_message", "error_code"]'::pg_catalog.jsonb
     or v_batch_function.prorettype <> pg_catalog.to_regtype('pg_catalog.int4')
     or v_session_function.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or v_batch_function.proconfig is distinct from array['search_path=""']::text[]
     or v_session_function.proconfig is distinct from array['search_path=""']::text[]
     or v_apply_function.proconfig is distinct from array['search_path=""']::text[]
     or v_apply_private_function.proconfig is distinct from
       array['search_path=public']::text[]
     or pg_catalog.to_jsonb(v_batch_function.proargnames) is distinct from
       '["p_batch_id"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_session_function.proargnames) is distinct from
       '["p_session_id"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_batch_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_session_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_apply_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_apply_private_function.proacl) is distinct from
       '["postgres=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_role_function.prosrc, 'UTF8')
     ), 'hex') <> '6a01649ad58aebb820b6119b79381e69ae579269996ab7af5456fbf75ef322f2'
     or pg_catalog.pg_get_userbyid(v_role_function.proowner) <> 'postgres'
     or v_role_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'sql'
     )
     or v_role_function.provolatile <> 's'
     or not v_role_function.prosecdef
     or v_role_function.prorettype <> pg_catalog.to_regtype('pg_catalog.bool')
     or v_role_function.pronargs <> 2
     or v_role_function.pronargdefaults <> 0
     or v_role_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_role_function.proacl) is distinct from
       '["postgres=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_updated_at_function.prosrc, 'UTF8')
     ), 'hex') <> '3c6d6c41d6262a20e7c102dbd49bb3383bd86a4138c8a3ab6b9b04a1ec2420a5'
     or pg_catalog.pg_get_userbyid(v_updated_at_function.proowner) <> 'postgres'
     or v_updated_at_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
     or v_updated_at_function.prorettype <>
       pg_catalog.to_regtype('pg_catalog.trigger')
     or v_updated_at_function.provolatile <> 'v'
     or not v_updated_at_function.prosecdef
     or v_updated_at_function.proconfig is distinct from
       array['search_path=public']::text[]
     or v_updated_at_function.proacl is not null
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_delete_function.prosrc, 'UTF8')
     ), 'hex') <> '5ce2c8fade26354ddbdfa097e1dab15cd3e0837bf8ac986ac321b40f863242fd'
     or pg_catalog.pg_get_userbyid(v_delete_function.proowner) <> 'postgres'
     or v_delete_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
     or v_delete_function.prorettype <> pg_catalog.to_regtype('pg_catalog.trigger')
     or v_delete_function.provolatile <> 'v'
     or v_delete_function.prosecdef
     or v_delete_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_delete_function.proacl) is distinct from
       '["postgres=X/postgres"]'::pg_catalog.jsonb
     or not exists (
       select 1
         from pg_catalog.pg_constraint c
        where c.conrelid = pg_catalog.to_regclass('public.import_batch_rows')
          and c.conname = 'import_batch_rows_applied_has_inventory_id'
          and c.contype = 'c'
          and c.convalidated
          and pg_catalog.pg_get_expr(c.conbin, c.conrelid, false) =
            '((apply_status <> ''applied''::text) OR (applied_inventory_item_id IS NOT NULL))'
     )
     or not exists (
       select 1
         from pg_catalog.pg_constraint c
        where c.conrelid = pg_catalog.to_regclass('public.import_batch_rows')
          and c.conname = 'import_batch_rows_batch_restaurant_fkey'
          and c.contype = 'f'
          and c.convalidated
          and c.confrelid = pg_catalog.to_regclass('public.import_batches')
          and c.confdeltype = 'c'
          and c.conkey = array[
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.conrelid and a.attname = 'batch_id'),
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.conrelid and a.attname = 'restaurant_id')
          ]::smallint[]
          and c.confkey = array[
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.confrelid and a.attname = 'id'),
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.confrelid and a.attname = 'restaurant_id')
          ]::smallint[]
     )
     or not exists (
       select 1
         from pg_catalog.pg_constraint c
        where c.conrelid = pg_catalog.to_regclass('public.open_bottles')
          and c.conname = 'open_bottles_source_inventory_item_tenant_wine_fkey'
          and c.contype = 'f'
          and c.convalidated
          and c.confdeltype = 'r'
          and c.condeferrable
          and c.condeferred
          and c.confrelid = pg_catalog.to_regclass('public.inventory_items')
          and c.conkey = array[
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.conrelid and a.attname = 'source_inventory_item_id'),
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.conrelid and a.attname = 'restaurant_id'),
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.conrelid and a.attname = 'wine_id')
          ]::smallint[]
          and c.confkey = array[
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.confrelid and a.attname = 'id'),
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.confrelid and a.attname = 'restaurant_id'),
            (select a.attnum from pg_catalog.pg_attribute a
              where a.attrelid = c.confrelid and a.attname = 'wine_id')
          ]::smallint[]
     )
     or not exists (
       select 1
         from pg_catalog.pg_index i
         join pg_catalog.pg_class x on x.oid = i.indexrelid
        where i.indrelid = pg_catalog.to_regclass('public.open_bottles')
          and x.relname = 'open_bottles_source_inventory_item_id_idx'
          and i.indisvalid
          and i.indisready
          and i.indisunique = false
          and i.indkey::text = (
            select a.attnum::text from pg_catalog.pg_attribute a
             where a.attrelid = i.indrelid
               and a.attname = 'source_inventory_item_id'
          )
          and pg_catalog.pg_get_expr(i.indpred, i.indrelid, false) =
            '(source_inventory_item_id IS NOT NULL)'
     )
     or (select pg_catalog.count(*)
           from pg_catalog.pg_trigger t
          where (
            (t.tgrelid = pg_catalog.to_regclass('public.wines')
             and t.tgname = 'wines_set_updated_at'
             and t.tgfoid = v_updated_at_function.oid
             and t.tgtype = 19)
            or
            (t.tgrelid = pg_catalog.to_regclass('public.import_batch_rows')
             and t.tgname = 'import_batch_rows_set_updated_at'
             and t.tgfoid = v_updated_at_function.oid
             and t.tgtype = 19)
            or
            (t.tgrelid = pg_catalog.to_regclass('public.inventory_items')
             and t.tgname = 'inventory_items_reflect_import_delete'
             and t.tgfoid = v_delete_function.oid
             and t.tgtype = 11)
          )
            and not t.tgisinternal
            and t.tgenabled = 'O'
            and t.tgattr::text = ''
            and t.tgqual is null
            and t.tgnargs = 0
            and pg_catalog.encode(t.tgargs, 'hex') = ''
     ) <> 3 then
    raise exception 'C09_0164_REQUIRED_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c09_0164_preflight$;

create or replace function public.apply_import_batch_chunk(
  p_batch_id uuid,
  p_limit integer default 100
) returns table(
  row_id uuid,
  row_number integer,
  outcome text,
  inventory_item_id uuid,
  error_message text,
  error_code text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_status text;
  v_row record;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'C04_IMPORT_CHUNK_INVALID' using errcode = 'P0001';
  end if;

  select b.restaurant_id
    into v_restaurant_id
    from public.import_batches b
   where b.id = p_batch_id;
  if v_restaurant_id is null
     or not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'read_committed_required' using errcode = '25000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'import-mutation:' || v_restaurant_id::text,
      0
    )
  );

  if not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select b.status
    into v_status
    from public.import_batches b
   where b.id = p_batch_id
     and b.restaurant_id = v_restaurant_id
   for update;
  if not found
     or not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_row in
    select *
      from public.apply_import_batch_chunk_pre_0157(p_batch_id, p_limit)
  loop
    row_id := v_row.row_id;
    row_number := v_row.row_number;
    outcome := case
      when v_row.outcome in ('applied', 'blocked', 'error') then v_row.outcome
      else 'error'
    end;
    inventory_item_id := case
      when v_row.outcome = 'applied' then v_row.inventory_item_id
      else null
    end;
    error_code := case
      when v_row.outcome = 'blocked' then 'missing_unit_cost'
      when v_row.outcome = 'error' then 'row_apply_failed'
      else null
    end;
    error_message := error_code;
    return next;
  end loop;

  update public.import_batches b
     set status = case
       when b.status = 'reverted' then 'reverted'
       when not exists (
         select 1 from public.import_batch_rows r
          where r.batch_id = p_batch_id
            and not (r.apply_status = 'applied' or r.resolution = 'exclude')
       ) then 'completed'
       when exists (
         select 1 from public.import_batch_rows r
          where r.batch_id = p_batch_id
            and r.apply_status = 'applied'
       ) then 'applying'
       else 'created'
     end
   where b.id = p_batch_id
     and b.restaurant_id = v_restaurant_id;
exception
  when sqlstate '42501' then
    raise exception 'forbidden' using errcode = '42501';
  when sqlstate '25000' then
    raise exception 'read_committed_required' using errcode = '25000';
  when sqlstate 'P0004' then
    raise exception 'import_batch_conflict' using errcode = 'P0004';
  when others then
    raise exception 'C04_IMPORT_APPLY_REFUSED' using errcode = 'P0001';
end;
$function$;

create function public.revert_import_batch_core_private(
  p_batch_id uuid,
  p_reverting_batch_ids uuid[]
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_restaurant_id uuid;
  v_session_id uuid;
  v_status text;
  v_canonical_scope uuid[];
  v_inventory_ids uuid[] := array[]::uuid[];
  v_reverted_count integer := 0;
  v_inventory_count integer := 0;
  v_updated_count integer := 0;
  v_deleted_count integer := 0;
  v_lwin_cleared integer := 0;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select b.restaurant_id, b.session_id
    into v_restaurant_id, v_session_id
    from public.import_batches b
   where b.id = p_batch_id;
  if not found
     or not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  end if;

  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'read_committed_required' using errcode = '25000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'import-mutation:' || v_restaurant_id::text,
      0
    )
  );

  if not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  end if;

  select b.restaurant_id, b.session_id, b.status
    into v_restaurant_id, v_session_id, v_status
    from public.import_batches b
   where b.id = p_batch_id
     and b.restaurant_id = v_restaurant_id
   for update;
  if not found then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  end if;
  if not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  end if;
  if v_status = 'reverted' then
    raise exception 'import_batch_already_reverted' using errcode = 'P04I1';
  end if;

  if p_reverting_batch_ids is null
     or pg_catalog.array_ndims(p_reverting_batch_ids) <> 1
     or pg_catalog.array_lower(p_reverting_batch_ids, 1) <> 1
     or pg_catalog.cardinality(p_reverting_batch_ids) < 1
     or pg_catalog.array_position(p_reverting_batch_ids, null) is not null
     or not (p_batch_id = any(p_reverting_batch_ids)) then
    raise exception 'C09_IMPORT_REVERT_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  select pg_catalog.array_agg(scope.batch_id order by scope.batch_id)
    into v_canonical_scope
    from (
      select distinct u.batch_id
        from pg_catalog.unnest(p_reverting_batch_ids) as u(batch_id)
    ) as scope;
  if p_reverting_batch_ids is distinct from v_canonical_scope
     or exists (
       select 1
         from pg_catalog.unnest(p_reverting_batch_ids) as u(batch_id)
         left join public.import_batches b on b.id = u.batch_id
        where b.id is null
           or b.restaurant_id <> v_restaurant_id
           or (
             pg_catalog.cardinality(p_reverting_batch_ids) > 1
             and (v_session_id is null or b.session_id is distinct from v_session_id)
           )
     ) then
    raise exception 'C09_IMPORT_REVERT_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  perform r.id
    from public.import_batch_rows r
   where r.batch_id = p_batch_id
     and r.restaurant_id = v_restaurant_id
     and r.apply_status = 'applied'
   order by r.id
   for update;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(distinct r.applied_inventory_item_id)::integer,
         coalesce(
           pg_catalog.array_agg(r.applied_inventory_item_id order by r.id),
           array[]::uuid[]
         )
    into v_reverted_count, v_inventory_count, v_inventory_ids
    from public.import_batch_rows r
   where r.batch_id = p_batch_id
     and r.restaurant_id = v_restaurant_id
     and r.apply_status = 'applied';

  perform w.id
    from public.wines w
   where w.restaurant_id = v_restaurant_id
     and w.id in (
       select r.applied_wine_id
         from public.import_batch_rows r
        where r.batch_id = p_batch_id
          and r.restaurant_id = v_restaurant_id
          and r.apply_status = 'applied'
          and r.applied_wine_id is not null
     )
   order by w.id
   for update;

  perform i.id
    from public.inventory_items i
   where i.restaurant_id = v_restaurant_id
     and i.id = any(v_inventory_ids)
   order by i.id
   for update;

  if not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  end if;

  if exists (
       select 1
         from public.import_batch_rows claimed
        where claimed.apply_status = 'applied'
          and claimed.applied_inventory_item_id = any(v_inventory_ids)
        group by claimed.applied_inventory_item_id
       having pg_catalog.count(*) > 1
     ) then
    raise exception 'import_source_conflict' using errcode = 'P04I2';
  end if;

  if exists (
       select 1
         from public.import_batch_rows r
        where r.batch_id = p_batch_id
          and r.restaurant_id = v_restaurant_id
          and r.apply_status = 'applied'
          and (
            r.applied_wine_id is null
            or not exists (
              select 1
                from public.wines w
               where w.id = r.applied_wine_id
                 and w.restaurant_id = v_restaurant_id
            )
            or not exists (
              select 1
                from public.inventory_items i
               where i.id = r.applied_inventory_item_id
                 and i.restaurant_id = v_restaurant_id
                 and i.wine_id = r.applied_wine_id
            )
          )
     ) then
    raise exception 'C09_IMPORT_REVERT_BASELINE_INVALID' using errcode = 'P0001';
  end if;

  if exists (
       select 1
         from public.open_bottles ob
        where ob.source_inventory_item_id = any(v_inventory_ids)
     ) then
    raise exception 'physical_bottle_dependency' using errcode = 'P04D3';
  end if;

  with cleared as (
    update public.wines w
       set lwin_id = null,
           lwin_match_score = null
     where w.restaurant_id = v_restaurant_id
       and exists (
         select 1
           from public.import_batch_rows r
          where r.batch_id = p_batch_id
            and r.restaurant_id = v_restaurant_id
            and r.apply_status = 'applied'
            and r.applied_wine_id = w.id
            and r.lwin_id is not null
            and r.lwin_score is not null
            and r.lwin_score >= 0.6
            and r.updated_at = w.updated_at
            and r.lwin_id = w.lwin_id
            and r.lwin_score = w.lwin_match_score
       )
       and not exists (
         select 1
           from public.import_batch_rows competing
          where competing.restaurant_id = v_restaurant_id
            and competing.applied_wine_id = w.id
            and competing.apply_status = 'applied'
            and competing.lwin_id = w.lwin_id
            and competing.lwin_score = w.lwin_match_score
            and not (competing.batch_id = any(p_reverting_batch_ids))
       )
     returning w.id
  )
  select pg_catalog.count(*)::integer
    into v_lwin_cleared
    from cleared;

  update public.import_batch_rows r
     set apply_status = 'reverted',
         applied_inventory_item_id = null,
         updated_at = pg_catalog.statement_timestamp()
   where r.batch_id = p_batch_id
     and r.restaurant_id = v_restaurant_id
     and r.apply_status = 'applied';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_reverted_count then
    raise exception 'C09_IMPORT_REVERT_ROW_COUNT_MISMATCH' using errcode = 'P0001';
  end if;

  delete from public.inventory_items i
   where i.restaurant_id = v_restaurant_id
     and i.id = any(v_inventory_ids);
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> v_inventory_count then
    raise exception 'C09_IMPORT_REVERT_INVENTORY_COUNT_MISMATCH' using errcode = 'P0001';
  end if;

  update public.import_batches b
     set status = 'reverted',
         reverted_at = pg_catalog.statement_timestamp(),
         reverted_by = v_actor
   where b.id = p_batch_id
     and b.restaurant_id = v_restaurant_id
     and b.status <> 'reverted';
  if not found then
    raise exception 'C09_IMPORT_REVERT_BATCH_FENCE_MISMATCH' using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'version', 1,
    'batchId', p_batch_id,
    'status', 'reverted',
    'revertedItemCount', v_reverted_count,
    'orphanWinesDeleted', 0,
    'lwinStampsCleared', v_lwin_cleared
  );
exception
  when sqlstate '42501' then
    raise exception 'forbidden' using errcode = '42501';
  when sqlstate '25000' then
    raise exception 'read_committed_required' using errcode = '25000';
  when sqlstate 'P0002' then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  when sqlstate 'P04I1' then
    raise exception 'import_batch_already_reverted' using errcode = 'P04I1';
  when sqlstate 'P04I2' then
    raise exception 'import_source_conflict' using errcode = 'P04I2';
  when sqlstate 'P04D3' then
    raise exception 'physical_bottle_dependency' using errcode = 'P04D3';
  when others then
    raise exception 'C04_IMPORT_REVERT_REFUSED' using errcode = 'P0001';
end;
$function$;

create function public.revert_import_batch_private(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  return public.revert_import_batch_core_private(
    p_batch_id,
    array[p_batch_id]::uuid[]
  );
exception
  when sqlstate '42501' then
    raise exception 'forbidden' using errcode = '42501';
  when sqlstate '25000' then
    raise exception 'read_committed_required' using errcode = '25000';
  when sqlstate 'P0002' then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  when sqlstate 'P04I1' then
    raise exception 'import_batch_already_reverted' using errcode = 'P04I1';
  when sqlstate 'P04I2' then
    raise exception 'import_source_conflict' using errcode = 'P04I2';
  when sqlstate 'P04D3' then
    raise exception 'physical_bottle_dependency' using errcode = 'P04D3';
  when others then
    raise exception 'C04_IMPORT_REVERT_REFUSED' using errcode = 'P0001';
end;
$function$;

create or replace function public.revert_import_batch(p_batch_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  v_result := public.revert_import_batch_core_private(
    p_batch_id,
    array[p_batch_id]::uuid[]
  );
  return (v_result ->> 'revertedItemCount')::integer;
exception
  when sqlstate '42501' then
    raise exception 'forbidden' using errcode = '42501';
  when sqlstate '25000' then
    raise exception 'read_committed_required' using errcode = '25000';
  when sqlstate 'P0002' then
    raise exception 'import_batch_not_found' using errcode = 'P0002';
  when sqlstate 'P04I1' then
    raise exception 'import_batch_already_reverted' using errcode = 'P0001';
  when sqlstate 'P04I2' then
    raise exception 'import_source_conflict' using errcode = 'P0001';
  when sqlstate 'P04D3' then
    raise exception 'physical_bottle_dependency' using errcode = 'P0001';
  when others then
    raise exception 'C04_IMPORT_REVERT_REFUSED' using errcode = 'P0001';
end;
$function$;

create or replace function public.revert_import_session(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_restaurant_id uuid;
  v_batch record;
  v_scope uuid[] := array[]::uuid[];
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_reverted_batches integer := 0;
  v_reverted_items integer := 0;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.restaurant_id
    into v_restaurant_id
    from public.import_sessions s
   where s.id = p_session_id;
  if not found
     or not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_session_not_found' using errcode = 'P0002';
  end if;

  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'read_committed_required' using errcode = '25000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'import-mutation:' || v_restaurant_id::text,
      0
    )
  );

  if not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_session_not_found' using errcode = 'P0002';
  end if;

  perform 1
    from public.import_sessions s
   where s.id = p_session_id
     and s.restaurant_id = v_restaurant_id
   for update;
  if not found then
    raise exception 'import_session_not_found' using errcode = 'P0002';
  end if;
  if not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_session_not_found' using errcode = 'P0002';
  end if;

  perform b.id
    from public.import_batches b
   where b.session_id = p_session_id
     and b.restaurant_id = v_restaurant_id
   order by coalesce(b.chunk_index, 0) desc, b.created_at desc, b.id desc
   for update;

  if not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_session_not_found' using errcode = 'P0002';
  end if;

  select coalesce(
           pg_catalog.array_agg(b.id order by b.id),
           array[]::uuid[]
         )
    into v_scope
    from public.import_batches b
   where b.session_id = p_session_id
     and b.restaurant_id = v_restaurant_id
     and b.status <> 'reverted';

  perform r.id
    from public.import_batch_rows r
   where r.restaurant_id = v_restaurant_id
     and r.batch_id = any(v_scope)
     and r.apply_status = 'applied'
   order by r.id
   for update;

  perform w.id
    from public.wines w
   where w.restaurant_id = v_restaurant_id
     and w.id in (
       select r.applied_wine_id
         from public.import_batch_rows r
        where r.restaurant_id = v_restaurant_id
          and r.batch_id = any(v_scope)
          and r.apply_status = 'applied'
          and r.applied_wine_id is not null
     )
   order by w.id
   for update;

  perform i.id
    from public.inventory_items i
   where i.restaurant_id = v_restaurant_id
     and i.id in (
       select r.applied_inventory_item_id
         from public.import_batch_rows r
        where r.restaurant_id = v_restaurant_id
          and r.batch_id = any(v_scope)
          and r.apply_status = 'applied'
     )
   order by i.id
   for update;

  if not public.current_site_role_at_least(v_restaurant_id, 'staff') then
    raise exception 'import_session_not_found' using errcode = 'P0002';
  end if;

  if exists (
       select 1
         from public.import_batch_rows candidate
         join public.import_batch_rows claimed
           on claimed.applied_inventory_item_id = candidate.applied_inventory_item_id
          and claimed.apply_status = 'applied'
        where candidate.restaurant_id = v_restaurant_id
          and candidate.batch_id = any(v_scope)
          and candidate.apply_status = 'applied'
        group by candidate.applied_inventory_item_id
       having pg_catalog.count(distinct claimed.id) > 1
     ) then
    raise exception 'import_source_conflict' using errcode = 'P04I2';
  end if;

  if exists (
       select 1
         from public.import_batch_rows r
         join public.open_bottles ob
           on ob.source_inventory_item_id = r.applied_inventory_item_id
        where r.restaurant_id = v_restaurant_id
          and r.batch_id = any(v_scope)
          and r.apply_status = 'applied'
     ) then
    raise exception 'physical_bottle_dependency' using errcode = 'P04D3';
  end if;

  for v_batch in
    select b.id, b.status, b.chunk_index
      from public.import_batches b
     where b.session_id = p_session_id
       and b.restaurant_id = v_restaurant_id
     order by coalesce(b.chunk_index, 0) desc, b.created_at desc, b.id desc
  loop
    if v_batch.status = 'reverted' then
      v_results := v_results || pg_catalog.jsonb_build_object(
        'batchId', v_batch.id,
        'chunkIndex', v_batch.chunk_index,
        'skipped', true,
        'reason', 'already_reverted'
      );
      continue;
    end if;

    v_result := public.revert_import_batch_core_private(v_batch.id, v_scope);
    v_results := v_results || pg_catalog.jsonb_build_object(
      'batchId', v_batch.id,
      'chunkIndex', v_batch.chunk_index,
      'skipped', false,
      'status', 'reverted',
      'revertedItemCount', (v_result ->> 'revertedItemCount')::integer,
      'orphanWinesDeleted', 0,
      'lwinStampsCleared', (v_result ->> 'lwinStampsCleared')::integer
    );
    v_reverted_batches := v_reverted_batches + 1;
    v_reverted_items := v_reverted_items
      + (v_result ->> 'revertedItemCount')::integer;
  end loop;

  update public.import_sessions s
     set status = 'reverted',
         updated_at = pg_catalog.statement_timestamp()
   where s.id = p_session_id
     and s.restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'C09_IMPORT_SESSION_FENCE_MISMATCH' using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'version', 1,
    'sessionId', p_session_id,
    'status', 'reverted',
    'batches', v_results,
    'revertedBatchCount', v_reverted_batches,
    'blockedBatchCount', 0,
    'revertedItemCount', v_reverted_items
  );
exception
  when sqlstate '42501' then
    raise exception 'forbidden' using errcode = '42501';
  when sqlstate '25000' then
    raise exception 'read_committed_required' using errcode = '25000';
  when sqlstate 'P0002' then
    raise exception 'import_session_not_found' using errcode = 'P0002';
  when sqlstate 'P04I2' then
    raise exception 'import_source_conflict' using errcode = 'P04I2';
  when sqlstate 'P04D3' then
    raise exception 'physical_bottle_dependency' using errcode = 'P04D3';
  when others then
    raise exception 'C04_IMPORT_SESSION_REVERT_REFUSED' using errcode = 'P0001';
end;
$function$;

comment on function public.apply_import_batch_chunk(uuid, integer) is
  'Existing import apply contract serialized with revert by an exact-site transaction lock.';
comment on function public.revert_import_batch_core_private(uuid, uuid[]) is
  'Atomic retained-catalog import revert core; the private scope names the exact batches reverting in the caller transaction.';
comment on function public.revert_import_batch_private(uuid) is
  'Typed retained-catalog batch revert with strict version-1 cost-free receipt.';
comment on function public.revert_import_batch(uuid) is
  'Legacy integer compatibility wrapper over the atomic retained-catalog batch revert core.';
comment on function public.revert_import_session(uuid) is
  'All-or-nothing retained-catalog session revert with globally ordered wine and inventory lock unions.';

revoke all on function public.apply_import_batch_chunk(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_import_batch_chunk(uuid, integer)
  to authenticated;
revoke all on function public.revert_import_batch_core_private(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.revert_import_batch_private(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revert_import_batch_private(uuid)
  to authenticated;
revoke all on function public.revert_import_batch(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revert_import_batch(uuid)
  to authenticated;
revoke all on function public.revert_import_session(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revert_import_session(uuid)
  to authenticated;

alter function public.apply_import_batch_chunk(uuid, integer) owner to postgres;
alter function public.revert_import_batch_core_private(uuid, uuid[]) owner to postgres;
alter function public.revert_import_batch_private(uuid) owner to postgres;
alter function public.revert_import_batch(uuid) owner to postgres;
alter function public.revert_import_session(uuid) owner to postgres;

do $c09_0164_postflight$
declare
  v_apply pg_catalog.pg_proc%rowtype;
  v_core pg_catalog.pg_proc%rowtype;
  v_typed pg_catalog.pg_proc%rowtype;
  v_legacy pg_catalog.pg_proc%rowtype;
  v_session pg_catalog.pg_proc%rowtype;
begin
  select p.* into strict v_apply from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.apply_import_batch_chunk(uuid,integer)'
   );
  select p.* into strict v_core from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.revert_import_batch_core_private(uuid,uuid[])'
   );
  select p.* into strict v_typed from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.revert_import_batch_private(uuid)');
  select p.* into strict v_legacy from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.revert_import_batch(uuid)');
  select p.* into strict v_session from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.revert_import_session(uuid)');

  if (select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'apply_import_batch_chunk',
           'revert_import_batch_core_private',
           'revert_import_batch_private',
           'revert_import_batch',
           'revert_import_session'
         )) <> 5
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_apply.prosrc, 'UTF8')
     ), 'hex') <> '4954adc09249cb6af38c6c0c93bf6c142d2751a298263c3cc20e4a1fb7ab2472'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_core.prosrc, 'UTF8')
     ), 'hex') <> 'c445c55fba355718e92d5ed7d76fb8d2e77b4c44c57e340f2d40804ff4518fe0'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_typed.prosrc, 'UTF8')
     ), 'hex') <> '7a5084f1a21865fd41d9bba9825edc430e8899dfbd75f7a9ad0e5d0bb6b48806'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_legacy.prosrc, 'UTF8')
     ), 'hex') <> '87ef93a7d110bf29d67eac1813ed94cce6382914db36feb9429c04dde7415b87'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_session.prosrc, 'UTF8')
     ), 'hex') <> '628a355a722c36590869bf1e06d95766abcf0a386e0b578effb93c7048b479ae'
     or pg_catalog.pg_get_userbyid(v_core.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_apply.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_typed.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_legacy.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_session.proowner) <> 'postgres'
     or not v_apply.prosecdef
     or not v_core.prosecdef or not v_typed.prosecdef
     or not v_legacy.prosecdef or not v_session.prosecdef
     or v_apply.provolatile <> 'v'
     or v_core.provolatile <> 'v' or v_typed.provolatile <> 'v'
     or v_legacy.provolatile <> 'v' or v_session.provolatile <> 'v'
     or v_apply.prorettype <> pg_catalog.to_regtype('pg_catalog.record')
     or not v_apply.proretset
     or v_apply.pronargdefaults <> 1
     or pg_catalog.pg_get_expr(v_apply.proargdefaults, 0, false) <> '100'
     or pg_catalog.to_jsonb(v_apply.proargnames) is distinct from
       '["p_batch_id", "p_limit", "row_id", "row_number", "outcome", "inventory_item_id", "error_message", "error_code"]'::pg_catalog.jsonb
     or v_core.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or v_typed.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or v_legacy.prorettype <> pg_catalog.to_regtype('pg_catalog.int4')
     or v_session.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or v_apply.proconfig is distinct from array['search_path=""']::text[]
     or v_core.proconfig is distinct from array['search_path=""']::text[]
     or v_typed.proconfig is distinct from array['search_path=""']::text[]
     or v_legacy.proconfig is distinct from array['search_path=""']::text[]
     or v_session.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_apply.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_core.proacl) is distinct from
       '["postgres=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_typed.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_legacy.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_session.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.has_function_privilege(
       'anon', 'public.revert_import_batch_core_private(uuid,uuid[])', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', 'public.revert_import_batch_core_private(uuid,uuid[])', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', 'public.revert_import_batch_core_private(uuid,uuid[])', 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.apply_import_batch_chunk(uuid,integer)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'public.apply_import_batch_chunk(uuid,integer)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', 'public.apply_import_batch_chunk(uuid,integer)', 'EXECUTE'
     ) then
    raise exception 'C09_0164_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c09_0164_postflight$;
