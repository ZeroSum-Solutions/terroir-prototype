-- 0164_import_revert_cleanup.down.sql
-- Restore the exact 0157 batch/session definitions and remove only the exact
-- 0164 typed/core entries. No inventory, catalog, or history row is changed.

do $c09_0164_down_preflight$
declare
  v_apply pg_catalog.pg_proc%rowtype;
  v_core pg_catalog.pg_proc%rowtype;
  v_typed pg_catalog.pg_proc%rowtype;
  v_legacy pg_catalog.pg_proc%rowtype;
  v_session pg_catalog.pg_proc%rowtype;
begin
  if pg_catalog.to_regprocedure(
       'public.apply_import_batch_chunk(uuid,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.revert_import_batch_core_private(uuid,uuid[])'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.revert_import_batch_private(uuid)'
     ) is null
     or pg_catalog.to_regprocedure('public.revert_import_batch(uuid)') is null
     or pg_catalog.to_regprocedure('public.revert_import_session(uuid)') is null then
    raise exception 'C09_0164_DOWN_BASELINE_MISSING' using errcode = 'P0001';
  end if;

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
     or pg_catalog.pg_get_userbyid(v_apply.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_core.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_typed.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_legacy.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_session.proowner) <> 'postgres'
     or not v_apply.prosecdef
     or not v_core.prosecdef or not v_typed.prosecdef
     or not v_legacy.prosecdef or not v_session.prosecdef
     or v_apply.provolatile <> 'v'
     or v_apply.prorettype <> pg_catalog.to_regtype('pg_catalog.record')
     or not v_apply.proretset
     or v_apply.pronargdefaults <> 1
     or pg_catalog.pg_get_expr(v_apply.proargdefaults, 0, false) <> '100'
     or v_core.provolatile <> 'v' or v_typed.provolatile <> 'v'
     or v_legacy.provolatile <> 'v' or v_session.provolatile <> 'v'
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
     or exists (
       select 1
         from pg_catalog.pg_depend d
        where d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          and d.refobjid in (v_core.oid, v_typed.oid)
          and d.deptype = 'n'
     ) then
    raise exception 'C09_0164_DOWN_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c09_0164_down_preflight$;

create or replace function public.apply_import_batch_chunk(p_batch_id uuid,p_limit integer default 100)
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

create or replace function public.revert_import_batch(p_batch_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
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

create or replace function public.revert_import_session(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
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

comment on function public.apply_import_batch_chunk(uuid, integer) is null;
comment on function public.revert_import_batch(uuid) is null;
comment on function public.revert_import_session(uuid) is null;

revoke all on function public.apply_import_batch_chunk(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_import_batch_chunk(uuid, integer) to authenticated;
revoke all on function public.revert_import_batch(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revert_import_batch(uuid) to authenticated;
revoke all on function public.revert_import_session(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revert_import_session(uuid) to authenticated;
alter function public.apply_import_batch_chunk(uuid, integer) owner to postgres;
alter function public.revert_import_batch(uuid) owner to postgres;
alter function public.revert_import_session(uuid) owner to postgres;

drop function public.revert_import_batch_private(uuid) restrict;
drop function public.revert_import_batch_core_private(uuid, uuid[]) restrict;

do $c09_0164_down_postflight$
declare
  v_apply pg_catalog.pg_proc%rowtype;
  v_batch pg_catalog.pg_proc%rowtype;
  v_session pg_catalog.pg_proc%rowtype;
begin
  select p.* into strict v_apply from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.apply_import_batch_chunk(uuid,integer)'
   );
  select p.* into strict v_batch from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.revert_import_batch(uuid)');
  select p.* into strict v_session from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.revert_import_session(uuid)');

  if exists (
       select 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'revert_import_batch_core_private',
            'revert_import_batch_private'
          )
     )
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_apply.prosrc, 'UTF8')
     ), 'hex') <> '3b84ef448e44560db50067e35091cb0f4a96f170f0a696be3eaac3661e25116b'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_batch.prosrc, 'UTF8')
     ), 'hex') <> '23b230a852f5cfa86fca557d3a190a8eec02e719ab7cd93ed49969ec93659c07'
     or pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(v_session.prosrc, 'UTF8')
     ), 'hex') <> '119a2ca01ebdb5af1553f738fb7b68c03076680336085d831ff95cfe8fbab884'
     or pg_catalog.pg_get_userbyid(v_apply.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_batch.proowner) <> 'postgres'
     or pg_catalog.pg_get_userbyid(v_session.proowner) <> 'postgres'
     or not v_apply.prosecdef
     or not v_batch.prosecdef or not v_session.prosecdef
     or v_apply.provolatile <> 'v'
     or v_apply.prorettype <> pg_catalog.to_regtype('pg_catalog.record')
     or not v_apply.proretset
     or v_apply.pronargdefaults <> 1
     or pg_catalog.pg_get_expr(v_apply.proargdefaults, 0, false) <> '100'
     or v_batch.provolatile <> 'v' or v_session.provolatile <> 'v'
     or v_apply.proconfig is distinct from array['search_path=""']::text[]
     or v_batch.proconfig is distinct from array['search_path=""']::text[]
     or v_session.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_apply.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_batch.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.to_jsonb(v_session.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
     or pg_catalog.obj_description(v_apply.oid, 'pg_proc') is not null
     or pg_catalog.obj_description(v_batch.oid, 'pg_proc') is not null
     or pg_catalog.obj_description(v_session.oid, 'pg_proc') is not null then
    raise exception 'C09_0164_DOWN_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c09_0164_down_postflight$;
