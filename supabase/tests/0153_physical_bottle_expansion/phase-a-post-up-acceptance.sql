\set ON_ERROR_STOP on
\pset pager off

do $catalog$
declare
  v_columns text[];
begin
  if public.current_inventory_contract_version() <> 1 then
    raise exception 'C06_VERSION_NOT_ONE';
  end if;
  if (select count(*)
        from pg_catalog.pg_constraint c
       where c.conrelid in (
         'public.inventory_items'::regclass,
         'public.open_bottles'::regclass,
         'public.inventory_command_receipts'::regclass,
         'public.pour_events'::regclass,
         'public.bottle_closeouts'::regclass,
         'public.inventory_command_bottle_effects'::regclass
       )
         and pg_catalog.obj_description(c.oid, 'pg_constraint') like
           'C06_DEFINITION_MD5:%') <> 29
     or exists (
       select 1
         from pg_catalog.pg_constraint c
        where c.conrelid in (
          'public.inventory_items'::regclass,
          'public.open_bottles'::regclass,
          'public.inventory_command_receipts'::regclass,
          'public.pour_events'::regclass,
          'public.bottle_closeouts'::regclass,
          'public.inventory_command_bottle_effects'::regclass
        )
          and pg_catalog.obj_description(c.oid, 'pg_constraint') like
                'C06_DEFINITION_MD5:%'
          and pg_catalog.obj_description(c.oid, 'pg_constraint') is distinct from
            'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_constraintdef(c.oid, false))
     )
     or (select count(*)
           from pg_catalog.pg_class c
          where c.oid in (
            to_regclass('public.pour_events_operation_entry_key'),
            to_regclass('public.pour_events_reversal_key'),
            to_regclass('public.pour_events_open_bottle_tenant_wine_idx'),
            to_regclass('public.bottle_closeouts_open_bottle_tenant_wine_idx'),
            to_regclass('public.inventory_command_bottle_effects_open_operation_key'),
            to_regclass('public.inventory_command_bottle_effects_bottle_idx'),
            to_regclass('public.inventory_command_bottle_effects_wine_idx')
          )) <> 7
     or exists (
       select 1
         from pg_catalog.pg_class c
        where c.oid in (
          'public.pour_events_operation_entry_key'::regclass,
          'public.pour_events_reversal_key'::regclass,
          'public.pour_events_open_bottle_tenant_wine_idx'::regclass,
          'public.bottle_closeouts_open_bottle_tenant_wine_idx'::regclass,
          'public.inventory_command_bottle_effects_open_operation_key'::regclass,
          'public.inventory_command_bottle_effects_bottle_idx'::regclass,
          'public.inventory_command_bottle_effects_wine_idx'::regclass
        )
          and pg_catalog.obj_description(c.oid, 'pg_class') is distinct from
            'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_indexdef(c.oid))
     ) then
    raise exception 'C06_CATALOG_SEAL_MISMATCH';
  end if;
  if exists (
    select 1
      from (values
        ('public.current_inventory_contract_version()'::regprocedure, '8fa2f7e41390b52527e0afb63fc8283d'),
        ('public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure, '3ddc0587d989370a51e2092b8a869345'),
        ('public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure, '9800270b4fdf9c635c5a1c845d79916e'),
        ('public.list_active_physical_bottles(uuid)'::regprocedure, '211841061248dcfbd43385825bd7f9f7'),
        ('public.list_open_bottle_aggregates(uuid)'::regprocedure, '3f4d350659664a38e28c040642a65691')
      ) expected(identity, body_md5)
      join pg_catalog.pg_proc p on p.oid = expected.identity
     where md5(p.prosrc) <> expected.body_md5
  ) then
    raise exception 'C06_FUNCTION_BODY_DRIFT';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
     where c.oid = 'public.inventory_command_bottle_effects'::regclass
       and c.relrowsecurity
  ) then
    raise exception 'C06_EFFECT_RLS_MISSING';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policy
     where polrelid = 'public.inventory_command_bottle_effects'::regclass
  ) then
    raise exception 'C06_EFFECT_POLICY_UNEXPECTED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'bottle_closeouts_open_bottle_tenant_wine_idx'
       and indexdef like '%(open_bottle_id, restaurant_id, wine_id)%'
  ) then
    raise exception 'C06_CLOSEOUT_CHILD_INDEX_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'pour_events_open_bottle_tenant_wine_idx'
       and indexdef like '%(open_bottle_id, restaurant_id, wine_id)%'
  ) then
    raise exception 'C06_POUR_EVENT_CHILD_INDEX_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
     where c.oid = 'public.effective_service_pour_events'::regclass
       and c.reloptions = array['security_invoker=true']
       and pg_catalog.obj_description(c.oid, 'pg_class') =
         'C06_DEFINITION_MD5:' || md5(pg_catalog.pg_get_viewdef(c.oid, false))
  ) then
    raise exception 'C06_EFFECTIVE_VIEW_NOT_INVOKER';
  end if;
  if position('physical_inventory_contract_inactive' in pg_get_functiondef(
    'public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)'::regprocedure
  )) = 0
     or position('physical_inventory_contract_inactive' in pg_get_functiondef(
       'public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)'::regprocedure
     )) = 0 then
    raise exception 'C06_DORMANT_GUARD_MISSING';
  end if;
  select array_agg(a.attname::text order by a.attnum) into v_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.effective_service_pour_events'::regclass
     and a.attnum > 0 and not a.attisdropped;
  if v_columns is distinct from array[
    'id', 'wine_id', 'restaurant_id', 'open_bottle_id', 'ml_delta', 'kind',
    'actor_user_id', 'occurred_at', 'note', 'event_contract', 'operation_id',
    'operation_entry_ordinal'
  ] then
    raise exception 'C06_EFFECTIVE_VIEW_PRIVACY_PROJECTION_DRIFT';
  end if;
end;
$catalog$;

begin;
do $effective_semantics$
declare
  v_restaurant uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_wine uuid := gen_random_uuid();
  v_bottle uuid := gen_random_uuid();
  v_other_wine uuid := gen_random_uuid();
  v_other_bottle uuid := gen_random_uuid();
  v_original uuid := gen_random_uuid();
  v_reversal uuid := gen_random_uuid();
  v_operation uuid := gen_random_uuid();
  v_reversal_operation uuid := gen_random_uuid();
  v_unrelated_pour uuid := gen_random_uuid();
  v_unrelated_spill uuid := gen_random_uuid();
  v_unrelated_pour_operation uuid := gen_random_uuid();
  v_unrelated_spill_operation uuid := gen_random_uuid();
  v_legacy_target uuid := gen_random_uuid();
  v_legacy_reversal uuid := gen_random_uuid();
  v_legacy_reversal_operation uuid := gen_random_uuid();
  v_wrong_kind_target uuid := gen_random_uuid();
  v_wrong_kind_reversal uuid := gen_random_uuid();
  v_wrong_kind_operation uuid := gen_random_uuid();
  v_wrong_kind_reversal_operation uuid := gen_random_uuid();
  v_wrong_containment_target uuid := gen_random_uuid();
  v_wrong_containment_reversal uuid := gen_random_uuid();
  v_wrong_containment_operation uuid := gen_random_uuid();
  v_wrong_containment_reversal_operation uuid := gen_random_uuid();
  v_wrong_inverse_target uuid := gen_random_uuid();
  v_wrong_inverse_reversal uuid := gen_random_uuid();
  v_wrong_inverse_operation uuid := gen_random_uuid();
  v_wrong_inverse_reversal_operation uuid := gen_random_uuid();
begin
  insert into public.restaurants(id, name) values (v_restaurant, 'C06 effective fixture');
  insert into auth.users(id, email) values (v_user, 'c06-effective-' || v_user || '@terroir.test');
  insert into public.memberships(user_id, restaurant_id, role)
    values (v_user, v_restaurant, 'owner')
    on conflict (user_id, restaurant_id) do update set role = excluded.role;
  insert into public.wines(id, restaurant_id, name, producer, size_ml)
    values
      (v_wine, v_restaurant, 'Effective fixture', 'C06', 750),
      (v_other_wine, v_restaurant, 'Effective fixture other', 'C06', 750);
  insert into public.open_bottles(
    id, wine_id, restaurant_id, remaining_ml, identity_contract,
    identity_origin, nominal_capacity_ml, source_provenance, state_version
  ) values
    (v_bottle, v_wine, v_restaurant, 650, 2,
     'migrated_active', 750, 'legacy_unknown', 0),
    (v_other_bottle, v_other_wine, v_restaurant, 650, 2,
     'migrated_active', 750, 'legacy_unknown', 0);
  insert into public.inventory_command_receipts(
    restaurant_id, operation_id, actor_user_id, wine_id, command_type,
    request_payload, result_payload, completed_at, command_version, scope_kind
  ) values
    (v_restaurant, v_operation, v_user, v_wine, 'pour',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_reversal_operation, v_user, v_wine, 'undo',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_unrelated_pour_operation, v_user, v_wine, 'pour',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_unrelated_spill_operation, v_user, v_wine, 'spill',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_legacy_reversal_operation, v_user, v_wine, 'undo',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_wrong_kind_operation, v_user, v_wine, 'pour',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_wrong_kind_reversal_operation, v_user, v_wine, 'undo',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_wrong_containment_operation, v_user, v_wine, 'pour',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_wrong_containment_reversal_operation, v_user, v_other_wine, 'undo',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_wrong_inverse_operation, v_user, v_wine, 'spill',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine'),
    (v_restaurant, v_wrong_inverse_reversal_operation, v_user, v_wine, 'undo',
     '{}'::jsonb, '{}'::jsonb, now(), 2, 'single_wine');
  insert into public.pour_events(
    id, wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
    actor_user_id, event_contract, operation_id, operation_entry_ordinal
  ) values
    (gen_random_uuid(), v_wine, v_restaurant, null, 10, 'spill', v_user, 1, null, null),
    (v_legacy_target, v_wine, v_restaurant, null, 5, 'spill', v_user, 1, null, null),
    (v_original, v_wine, v_restaurant, v_bottle, 50, 'pour', v_user, 2, v_operation, 0),
    (v_unrelated_pour, v_wine, v_restaurant, v_bottle, 20, 'pour', v_user, 2,
     v_unrelated_pour_operation, 0),
    (v_unrelated_spill, v_wine, v_restaurant, v_bottle, 15, 'spill', v_user, 2,
     v_unrelated_spill_operation, 0),
    (v_wrong_kind_target, v_wine, v_restaurant, v_bottle, 8, 'reconcile', v_user, 2,
     v_wrong_kind_operation, 0),
    (v_wrong_containment_target, v_wine, v_restaurant, v_bottle, 9, 'pour', v_user, 2,
     v_wrong_containment_operation, 0),
    (v_wrong_inverse_target, v_wine, v_restaurant, v_bottle, 10, 'spill', v_user, 2,
     v_wrong_inverse_operation, 0);
  insert into public.pour_events(
    id, wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
    actor_user_id, event_contract, operation_id, operation_entry_ordinal,
    reversal_of_event_id
  ) values
    (v_reversal, v_wine, v_restaurant, v_bottle, -50, 'undo', v_user,
     2, v_reversal_operation, 0, v_original),
    (v_wrong_kind_reversal, v_wine, v_restaurant, v_bottle, -8, 'undo', v_user,
     2, v_wrong_kind_reversal_operation, 0, v_wrong_kind_target),
    (v_wrong_containment_reversal, v_other_wine, v_restaurant, v_other_bottle,
     -9, 'undo', v_user, 2, v_wrong_containment_reversal_operation, 0,
     v_wrong_containment_target),
    (v_wrong_inverse_reversal, v_wine, v_restaurant, v_bottle, -11, 'undo', v_user,
     2, v_wrong_inverse_reversal_operation, 0, v_wrong_inverse_target);

  begin
    insert into public.pour_events(
      wine_id, restaurant_id, ml_delta, kind, actor_user_id,
      event_contract, operation_id
    ) values (
      v_wine, v_restaurant, 1, 'spill', v_user, 1, v_operation
    );
    raise exception 'C06_EXPECTED_LEGACY_SHAPE_REFUSAL';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.pour_events(
      wine_id, restaurant_id, open_bottle_id, ml_delta, kind, actor_user_id,
      event_contract, operation_id, operation_entry_ordinal,
      reversal_of_event_id
    ) values (
      v_wine, v_restaurant, v_bottle, 1, 'spill', v_user,
      2, gen_random_uuid(), 0, v_original
    );
    raise exception 'C06_EXPECTED_NON_UNDO_REVERSAL_REFUSAL';
  exception
    when check_violation then null;
  end;

  insert into public.pour_events(
    id, wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
    actor_user_id, event_contract, operation_id, operation_entry_ordinal,
    reversal_of_event_id
  ) values (
    v_legacy_reversal, v_wine, v_restaurant, v_bottle, -5, 'undo', v_user,
    2, v_legacy_reversal_operation, 0, v_legacy_target
  );
  if (select count(*) from public.effective_service_pour_events
       where restaurant_id = v_restaurant and event_contract = 1) <> 2
     or exists (
       select 1 from public.effective_service_pour_events
        where id in (v_original, v_reversal)
     )
     or not exists (
       select 1 from public.effective_service_pour_events
        where id = v_legacy_target and event_contract = 1
     )
     or exists (
       select 1 from public.effective_service_pour_events
        where id = v_legacy_reversal
     )
     or (select count(*) from public.effective_service_pour_events
          where id in (v_unrelated_pour, v_unrelated_spill)) <> 2
     or not exists (
       select 1 from public.effective_service_pour_events
        where id = v_unrelated_pour and kind = 'pour' and ml_delta = 20
     )
     or not exists (
       select 1 from public.effective_service_pour_events
        where id = v_unrelated_spill and kind = 'spill' and ml_delta = 15
     )
     or (select count(*) from public.effective_service_pour_events
          where id in (
            v_wrong_kind_target, v_wrong_containment_target, v_wrong_inverse_target
          )) <> 3
     or exists (
       select 1 from public.effective_service_pour_events
        where id in (
          v_wrong_kind_reversal, v_wrong_containment_reversal, v_wrong_inverse_reversal
        )
     ) then
    raise exception 'C06_EFFECTIVE_EVENT_SEMANTICS_MISMATCH';
  end if;
end;
$effective_semantics$;
rollback;

\echo C06_PHASE_A_POST_UP_ACCEPTANCE_PASS
