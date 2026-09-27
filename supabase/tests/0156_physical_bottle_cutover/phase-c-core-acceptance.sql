\set ON_ERROR_STOP on
\pset pager off

begin;
create temporary table _t0156_bottles (
  label text primary key,
  bottle_id uuid not null
) on commit drop;
create temporary table _t0156_rpc_results (
  label text primary key,
  result jsonb not null
) on commit drop;

do $phase_c_core$
declare
  v_restaurant uuid := '15600000-0000-4000-8000-000000000001';
  v_user uuid := '15600000-0000-4000-8000-000000000002';
  v_wine_a uuid := '15600000-0000-4000-8000-000000000010';
  v_wine_b uuid := '15600000-0000-4000-8000-000000000011';
  v_lot_a uuid := '15600000-0000-4000-8000-000000000020';
  v_lot_b uuid := '15600000-0000-4000-8000-000000000021';
  v_bottle_a uuid;
  v_bottle_b uuid;
  v_bottle_c uuid;
  v_zero_bottle uuid := '15600000-0000-4000-8000-000000000099';
  v_discard_event uuid;
  v_result jsonb;
  v_replay jsonb;
  v_before jsonb;
  v_prior_at timestamptz;
  v_inserted_at timestamptz;
  v_message text;
begin
  if public.current_inventory_contract_version() <> 2 then
    raise exception 'C06_0156_EXPECTED_VERSION_2';
  end if;

  insert into auth.users(id, email)
    values (v_user, 'phase-c-0156@terroir.test');
  insert into public.restaurants(id, name)
    values (v_restaurant, 'Phase C 0156 fixture');
  insert into public.memberships(user_id, restaurant_id, role)
    values (v_user, v_restaurant, 'owner');
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  insert into public.wines(id, restaurant_id, name, producer, vintage, size_ml)
  values
    (v_wine_a, v_restaurant, 'Physical A', 'C06', 2020, 750),
    (v_wine_b, v_restaurant, 'Physical B', 'C06', 2021, 750);
  insert into public.inventory_items(
    id, wine_id, restaurant_id, quantity, unit_cost, bin_location
  ) values
    (v_lot_a, v_wine_a, v_restaurant, 2, 25, 'A-1'),
    (v_lot_b, v_wine_b, v_restaurant, 1, 30, 'B-1');

  v_result := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000101', v_restaurant, 'open', v_wine_a
  );
  insert into _t0156_rpc_results(label, result) values ('open', v_result);
  v_bottle_a := (v_result #>> '{open_bottle,id}')::uuid;
  v_result := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000102', v_restaurant, 'open', v_wine_a
  );
  v_bottle_b := (v_result #>> '{open_bottle,id}')::uuid;
  insert into _t0156_bottles(label, bottle_id)
    values ('A', v_bottle_a), ('B', v_bottle_b);

  if v_bottle_a = v_bottle_b
     or (select count(*) from public.open_bottles
          where restaurant_id = v_restaurant and wine_id = v_wine_a
            and closed_at is null) <> 2
     or (select quantity from public.inventory_items where id = v_lot_a) <> 0 then
    raise exception 'C06_0156_TWO_OPEN_CONSERVATION_FAILED';
  end if;

  -- Demo arithmetic: four 150 mL pours target A only. B remains byte-stable
  -- and no additional sealed unit is consumed after the two explicit opens.
  perform public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000111', v_restaurant, 'pour', v_wine_a,
    v_bottle_a, null, 150
  );
  perform public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000112', v_restaurant, 'pour', v_wine_a,
    v_bottle_a, null, 150
  );
  perform public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000113', v_restaurant, 'pour', v_wine_a,
    v_bottle_a, null, 150
  );
  v_result := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000114', v_restaurant, 'pour', v_wine_a,
    v_bottle_a, null, 150
  );
  insert into _t0156_rpc_results(label, result) values ('pour', v_result);

  if (select (remaining_ml, state_version) from public.open_bottles where id = v_bottle_a)
       is distinct from row(150, 4::bigint)
     or (select (remaining_ml, state_version) from public.open_bottles where id = v_bottle_b)
       is distinct from row(750, 0::bigint)
     or (select count(*) from public.pour_events
          where restaurant_id = v_restaurant and open_bottle_id = v_bottle_a
            and kind = 'pour' and ml_delta = 150) <> 4
     or (select quantity from public.inventory_items where id = v_lot_a) <> 0 then
    raise exception 'C06_0156_FOUR_EXACT_POURS_FAILED';
  end if;

  -- The serialization trigger is BEFORE INSERT. Force a post-trigger shape
  -- failure and prove PostgreSQL rolls its bottle update back with the row.
  v_before := (select to_jsonb(ob) from public.open_bottles ob where ob.id = v_bottle_a);
  begin
    insert into public.pour_events(
      wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
      actor_user_id, occurred_at, note, event_contract
    ) values (
      v_wine_a, v_restaurant, v_bottle_a, 1, 'pour',
      v_user, clock_timestamp(), 'C06 failed-before-insert', 2
    );
    raise exception 'C06_EXPECTED_EVENT_SHAPE_REFUSAL';
  exception when check_violation then null;
  end;
  if (select to_jsonb(ob) from public.open_bottles ob where ob.id = v_bottle_a)
       is distinct from v_before
     or exists (
       select 1 from public.pour_events
        where open_bottle_id = v_bottle_a and note = 'C06 failed-before-insert'
     ) then
    raise exception 'C06_0156_BEFORE_TRIGGER_ROLLBACK_FAILED';
  end if;

  -- A caller-supplied timestamp cannot move a bottle's event chronology
  -- backward. Prove the trigger clamps it while the same row lock is held,
  -- then roll the valid event and its bottle mutation back together.
  select max(occurred_at) into strict v_prior_at
    from public.pour_events
   where open_bottle_id = v_bottle_a;
  begin
    insert into public.inventory_command_receipts(
      restaurant_id, operation_id, actor_user_id, wine_id, command_type,
      request_payload, command_version, scope_kind
    ) values (
      v_restaurant, '15600000-0000-4000-8000-000000000117', v_user,
      v_wine_a, 'pour', '{}'::jsonb, 2, 'single_wine'
    );
    insert into public.pour_events(
      wine_id, restaurant_id, open_bottle_id, ml_delta, kind,
      actor_user_id, occurred_at, note, event_contract, operation_id,
      operation_entry_ordinal
    ) values (
      v_wine_a, v_restaurant, v_bottle_a, 1, 'pour', v_user,
      v_prior_at - interval '1 day', 'C06 backward-clock clamp', 2,
      '15600000-0000-4000-8000-000000000117', 0
    ) returning occurred_at into v_inserted_at;
    if v_inserted_at is distinct from v_prior_at + interval '1 microsecond' then
      raise exception 'C06_0156_BACKWARD_CLOCK_NOT_CLAMPED' using errcode = 'P0002';
    end if;
    raise exception 'C06_ROLLBACK_BACKWARD_CLOCK_FIXTURE' using errcode = 'P0004';
  exception when sqlstate 'P0004' then null;
  end;
  if (select to_jsonb(ob) from public.open_bottles ob where ob.id = v_bottle_a)
       is distinct from v_before
     or exists (
       select 1 from public.pour_events
        where operation_id = '15600000-0000-4000-8000-000000000117'
     )
     or exists (
       select 1 from public.inventory_command_receipts
        where operation_id = '15600000-0000-4000-8000-000000000117'
     ) then
    raise exception 'C06_0156_BACKWARD_CLOCK_ROLLBACK_FAILED';
  end if;

  v_before := (select to_jsonb(ob) from public.open_bottles ob where ob.id = v_bottle_a);
  v_replay := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000114', v_restaurant, 'pour', v_wine_a,
    v_bottle_a, null, 150
  );
  if (v_replay->>'replayed')::boolean is not true
     or (select to_jsonb(ob) from public.open_bottles ob where ob.id = v_bottle_a)
          is distinct from v_before
     or (select count(*) from public.pour_events
          where restaurant_id = v_restaurant and open_bottle_id = v_bottle_a
            and kind = 'pour' and ml_delta = 150) <> 4 then
    raise exception 'C06_0156_LAST_POUR_REPLAY_MUTATED';
  end if;

  select id into strict v_discard_event
    from public.pour_events
   where operation_id = '15600000-0000-4000-8000-000000000114';
  begin
    update public.inventory_command_receipts
       set result_payload = jsonb_set(
         result_payload, '{open_bottle,state_version}', '"malformed"'::jsonb
       )
     where operation_id = '15600000-0000-4000-8000-000000000114';
    begin
      perform public.execute_physical_bottle_command(
        '15600000-0000-4000-8000-000000000115', v_restaurant, 'undo', v_wine_a,
        null, null, null, null, null, null, 0, null, v_discard_event
      );
      raise exception 'C06_EXPECTED_MALFORMED_RECEIPT_REFUSAL' using errcode = 'P0002';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'undo_requires_review' then raise; end if;
    end;
    raise exception 'C06_ROLLBACK_MALFORMED_RECEIPT_FIXTURE' using errcode = 'P0004';
  exception when sqlstate 'P0004' then null;
  end;
  begin
    delete from public.inventory_command_bottle_effects
     where operation_id = '15600000-0000-4000-8000-000000000114';
    begin
      perform public.execute_physical_bottle_command(
        '15600000-0000-4000-8000-000000000116', v_restaurant, 'undo', v_wine_a,
        null, null, null, null, null, null, 0, null, v_discard_event
      );
      raise exception 'C06_EXPECTED_MISSING_EFFECT_REFUSAL' using errcode = 'P0002';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'undo_requires_review' then raise; end if;
    end;
    raise exception 'C06_ROLLBACK_MISSING_EFFECT_FIXTURE' using errcode = 'P0004';
  exception when sqlstate 'P0004' then null;
  end;
  if exists (
    select 1 from public.inventory_command_receipts
     where operation_id in (
       '15600000-0000-4000-8000-000000000115',
       '15600000-0000-4000-8000-000000000116'
     )
  ) or (select (remaining_ml, state_version) from public.open_bottles where id = v_bottle_a)
       is distinct from row(150, 4::bigint) then
    raise exception 'C06_0156_UNDO_EVIDENCE_FAILURE_MUTATED';
  end if;

  v_result := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000103', v_restaurant, 'open', v_wine_b
  );
  v_bottle_c := (v_result #>> '{open_bottle,id}')::uuid;
  insert into _t0156_bottles(label, bottle_id) values ('C', v_bottle_c);

  v_result := public.execute_physical_reconciliation_batch(
    '15600000-0000-4000-8000-000000000120',
    v_restaurant,
    jsonb_build_array(
      jsonb_build_object(
        'open_bottle_id', v_bottle_c,
        'expected_state_version', 0,
        'target_remaining_ml', 700,
        'note', null
      ),
      jsonb_build_object(
        'open_bottle_id', v_bottle_b,
        'expected_state_version', 0,
        'target_remaining_ml', 700,
        'note', 'counted'
      )
    )
  );
  insert into _t0156_rpc_results(label, result) values ('reconcile', v_result);
  v_replay := public.execute_physical_reconciliation_batch(
    '15600000-0000-4000-8000-000000000120',
    v_restaurant,
    jsonb_build_array(
      jsonb_build_object(
        'open_bottle_id', v_bottle_b,
        'expected_state_version', 0,
        'target_remaining_ml', 700,
        'note', 'counted'
      ),
      jsonb_build_object(
        'open_bottle_id', v_bottle_c,
        'expected_state_version', 0,
        'target_remaining_ml', 700,
        'note', null
      )
    )
  );
  if (v_result - 'replayed') is distinct from (v_replay - 'replayed')
     or (v_replay->>'replayed')::boolean is not true
     or (select count(*) from public.inventory_command_receipts
          where operation_id = '15600000-0000-4000-8000-000000000120') <> 1
     or (select count(*) from public.inventory_command_bottle_effects
          where operation_id = '15600000-0000-4000-8000-000000000120') <> 2
     or (select count(distinct occurred_at) from public.pour_events
          where operation_id = '15600000-0000-4000-8000-000000000120') <> 1
     or (select (remaining_ml, state_version) from public.open_bottles where id = v_bottle_b)
          is distinct from row(700, 1::bigint)
     or (select (remaining_ml, state_version) from public.open_bottles where id = v_bottle_c)
          is distinct from row(700, 1::bigint) then
    raise exception 'C06_0156_BATCH_OR_REPLAY_FAILED';
  end if;

  v_result := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000130', v_restaurant, 'discard', v_wine_a,
    v_bottle_b
  );
  v_discard_event := (v_result->'pour_event_ids'->>0)::uuid;
  if (select (remaining_ml, state_version, closed_at is not null)
        from public.open_bottles where id = v_bottle_b)
       is distinct from row(0, 2::bigint, true)
     or exists (select 1 from public.bottle_closeouts where open_bottle_id = v_bottle_b) then
    raise exception 'C06_0156_DISCARD_FAILED';
  end if;

  v_result := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000131', v_restaurant, 'undo', v_wine_a,
    null, null, null, null, null, null, 0, null, v_discard_event,
    'mistaken_report', true
  );
  insert into _t0156_rpc_results(label, result) values ('undo', v_result);
  if (select (remaining_ml, state_version, closed_at is null)
        from public.open_bottles where id = v_bottle_b)
       is distinct from row(700, 3::bigint, true)
     or (select remaining_ml from public.open_bottles where id = v_bottle_a) <> 150 then
    raise exception 'C06_0156_DISCARD_UNDO_FAILED';
  end if;

  v_result := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000132', v_restaurant, 'close', v_wine_a,
    v_bottle_b, null, null, 'measured close', null, 690
  );
  insert into _t0156_rpc_results(label, result) values ('close', v_result);
  v_before := (select to_jsonb(ob) from public.open_bottles ob where ob.id = v_bottle_b);
  v_replay := public.execute_physical_bottle_command(
    '15600000-0000-4000-8000-000000000132', v_restaurant, 'close', v_wine_a,
    v_bottle_b, null, null, 'measured close', null, 690
  );
  if (v_replay->>'replayed')::boolean is not true
     or (select to_jsonb(ob) from public.open_bottles ob where ob.id = v_bottle_b)
          is distinct from v_before
     or (select count(*) from public.bottle_closeouts where open_bottle_id = v_bottle_b) <> 1
     or (select (remaining_ml, state_version, closed_at is not null)
           from public.open_bottles where id = v_bottle_b)
          is distinct from row(0, 4::bigint, true) then
    raise exception 'C06_0156_CLOSE_REPLAY_FAILED';
  end if;

  begin
    perform public.execute_inventory_command(
      '15600000-0000-4000-8000-000000000140', v_restaurant, 'open', v_wine_a
    );
    raise exception 'C06_0156_EXPECTED_LEGACY_RETIREMENT';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'legacy_inventory_command_retired' then raise; end if;
  end;

  insert into public.open_bottles(
    id, wine_id, restaurant_id, remaining_ml, opened_by, identity_contract,
    identity_origin, nominal_capacity_ml, source_provenance, state_version
  ) values (
    v_zero_bottle, v_wine_a, v_restaurant, 0, v_user, 2,
    'migrated_active', 750, 'legacy_unknown', 0
  );
  begin
    perform public.execute_physical_bottle_command(
      '15600000-0000-4000-8000-000000000141', v_restaurant, 'discard', v_wine_a,
      v_zero_bottle
    );
    raise exception 'C06_0156_EXPECTED_ZERO_DISCARD_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'open_bottle_changed' then raise; end if;
  end;
  if exists (
    select 1 from public.inventory_command_receipts
     where operation_id = '15600000-0000-4000-8000-000000000141'
  ) or exists (
    select 1 from public.pour_events where open_bottle_id = v_zero_bottle
  ) then
    raise exception 'C06_0156_ZERO_DISCARD_MUTATED';
  end if;

  begin
    delete from public.inventory_items where id = v_lot_a;
    raise exception 'C06_0156_EXPECTED_PROVENANCE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'physical_bottle_dependency' then raise; end if;
  end;
  if not exists (select 1 from public.inventory_items where id = v_lot_a) then
    raise exception 'C06_0156_PROVENANCE_DELETE_MUTATED';
  end if;

  raise notice 'C06_0156_CORE_ACCEPTANCE_PASS bottles=3 pours_into_a=4 a_remaining=150 b_open_demo_remaining=750 batch_entries=2 close_replay=1 discard_undo=1';
end;
$phase_c_core$;

select
  'C06_0156_PERSISTED_READBACK' as evidence,
  proof.label,
  ob.remaining_ml,
  ob.state_version,
  ob.closed_at is not null as closed,
  (select count(*) from public.pour_events pe
    where pe.open_bottle_id = ob.id and pe.kind = 'pour' and pe.ml_delta = 150)
    as pours_150ml
from _t0156_bottles proof
join public.open_bottles ob on ob.id = proof.bottle_id
order by proof.label;

select
  'C06_0156_RPC_RESPONSE' as evidence,
  label,
  result
from _t0156_rpc_results
order by label;
rollback;

\echo C06_0156_CORE_ACCEPTANCE_PASS
