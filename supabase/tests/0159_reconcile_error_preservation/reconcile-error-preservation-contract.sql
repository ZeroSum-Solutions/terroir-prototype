-- 0159 reconciliation stable-error rollback-only contract.
-- LOCAL/DISPOSABLE DATABASE ONLY: never run against production, a hosted project,
-- or an active local stack. The DO block admits only the exact empty fixture target.
-- Every fixture write is enclosed by this file's BEGIN/ROLLBACK boundary.
-- This entrypoint contains no connection string, password, token, or test credential.
\set ON_ERROR_STOP on
\pset pager off

\if :{?source_0157_sha256}
\else
  \echo C04_RECONCILE_CONTRACT_SOURCE_0157_PIN_REQUIRED
  do $c04_psql_control_guard$ begin raise exception 'C04_RECONCILE_CONTRACT_SOURCE_0157_PIN_REQUIRED' using errcode='P0001'; end; $c04_psql_control_guard$;
\endif
\if :{?source_0158_sha256}
\else
  \echo C04_RECONCILE_CONTRACT_SOURCE_0158_PIN_REQUIRED
  do $c04_psql_control_guard$ begin raise exception 'C04_RECONCILE_CONTRACT_SOURCE_0158_PIN_REQUIRED' using errcode='P0001'; end; $c04_psql_control_guard$;
\endif
\if :{?source_0159_sha256}
\else
  \echo C04_RECONCILE_CONTRACT_SOURCE_0159_PIN_REQUIRED
  do $c04_psql_control_guard$ begin raise exception 'C04_RECONCILE_CONTRACT_SOURCE_0159_PIN_REQUIRED' using errcode='P0001'; end; $c04_psql_control_guard$;
\endif
\if :{?schema_sha256}
\else
  \echo C04_RECONCILE_CONTRACT_SCHEMA_PIN_REQUIRED
  do $c04_psql_control_guard$ begin raise exception 'C04_RECONCILE_CONTRACT_SCHEMA_PIN_REQUIRED' using errcode='P0001'; end; $c04_psql_control_guard$;
\endif
\if :{?data_sha256}
\else
  \echo C04_RECONCILE_CONTRACT_DATA_PIN_REQUIRED
  do $c04_psql_control_guard$ begin raise exception 'C04_RECONCILE_CONTRACT_DATA_PIN_REQUIRED' using errcode='P0001'; end; $c04_psql_control_guard$;
\endif
\if :{?fresh_interval_admitted}
\else
  \echo C04_RECONCILE_CONTRACT_FRESH_INTERVAL_REQUIRED
  do $c04_psql_control_guard$ begin raise exception 'C04_RECONCILE_CONTRACT_FRESH_INTERVAL_REQUIRED' using errcode='P0001'; end; $c04_psql_control_guard$;
\endif
\if :{?receiving_rehearsal_settled}
\else
  \echo C04_RECONCILE_CONTRACT_RECEIVING_SETTLEMENT_REQUIRED
  do $c04_psql_control_guard$ begin raise exception 'C04_RECONCILE_CONTRACT_RECEIVING_SETTLEMENT_REQUIRED' using errcode='P0001'; end; $c04_psql_control_guard$;
\endif

select 1 / case when
  :'source_0157_sha256' = 'e4107961a846d96a8a58225ee6b030eea734f8778627a2615604bc3b450de8e6'
  and :'source_0158_sha256' = '05dc29c4e5b7f93fb4e9e4bcc94ab6cee1ec6c55d311a807a264db5e15e76b12'
  and :'source_0159_sha256' = '17063cea072da9034d71af5a5ba3744a45bef872cc814dd95f62d0da668e1fba'
  and :'schema_sha256' = '2848957cd7e08dea5cc64f1b5c08aca3e5068a24b324e2a27bfdb131dbc1352b'
  and :'data_sha256' = 'bec6d526b83e9c1d5061ebc73f4269bb722f73659d41a1b3259c465b3238bcf4'
  and :'fresh_interval_admitted' = 'on'
  and :'receiving_rehearsal_settled' = 'on'
then 1 else 0 end as c04_reconcile_contract_source_state_admitted;

begin;
\set ON_ERROR_STOP off

do $reconcile_error_preservation_contract$
declare
  v_actor constant uuid := '15920000-0000-4000-8000-000000000001';
  v_workspace constant uuid := '15920000-0000-4000-8000-000000000002';
  v_workspace_member constant uuid := '15920000-0000-4000-8000-000000000003';
  v_membership constant uuid := '15920000-0000-4000-8000-000000000004';
  v_site constant uuid := '15920000-0000-4000-8000-000000000005';
  v_wine_a constant uuid := '15920000-0000-4000-8000-000000000010';
  v_wine_b constant uuid := '15920000-0000-4000-8000-000000000011';
  v_bin_a constant uuid := '15920000-0000-4000-8000-000000000012';
  v_bin_b constant uuid := '15920000-0000-4000-8000-000000000013';
  v_inventory constant uuid := '15920000-0000-4000-8000-000000000014';
  v_changed_key constant uuid := '15920000-0000-4000-8000-000000000020';
  v_repeat_key constant uuid := '15920000-0000-4000-8000-000000000021';
  v_stale_key constant uuid := '15920000-0000-4000-8000-000000000022';
  v_changed_first jsonb;
  v_changed_second jsonb;
  v_repeat_action jsonb;
  v_stale_action jsonb;
  v_changed_batch_before jsonb;
  v_changed_history_before jsonb;
  v_repeat_batch_after_undo jsonb;
  v_repeat_history_after_undo jsonb;
  v_stale_batch_before_undo jsonb;
  v_stale_history_before_undo jsonb;
  v_changed_observed text;
  v_repeat_observed text;
  v_stale_observed text;
  v_message text;
begin
  if current_database() <> 'terroir_cost_seal_20260926b'
     or current_user <> 'postgres'
     or session_user <> 'postgres'
     or public.current_inventory_contract_version() <> 2
     or to_regprocedure('public.accept_reconcile_batch(uuid,jsonb,uuid)') is null
     or to_regprocedure('public.undo_reconcile_batch(uuid)') is null
     or pg_catalog.pg_get_userbyid((
       select p.proowner from pg_catalog.pg_proc p
        where p.oid = 'public.accept_reconcile_batch(uuid,jsonb,uuid)'::regprocedure
     )) <> 'postgres'
     or pg_catalog.pg_get_userbyid((
       select p.proowner from pg_catalog.pg_proc p
        where p.oid = 'public.undo_reconcile_batch(uuid)'::regprocedure
     )) <> 'postgres'
     or not (select p.prosecdef from pg_catalog.pg_proc p
              where p.oid = 'public.accept_reconcile_batch(uuid,jsonb,uuid)'::regprocedure)
     or not (select p.prosecdef from pg_catalog.pg_proc p
              where p.oid = 'public.undo_reconcile_batch(uuid)'::regprocedure)
     or (select p.proconfig from pg_catalog.pg_proc p
          where p.oid = 'public.accept_reconcile_batch(uuid,jsonb,uuid)'::regprocedure)
        is distinct from array['search_path=""']::text[]
     or (select p.proconfig from pg_catalog.pg_proc p
          where p.oid = 'public.undo_reconcile_batch(uuid)'::regprocedure)
        is distinct from array['search_path=""']::text[]
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.accept_reconcile_batch(uuid,jsonb,uuid)', 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.undo_reconcile_batch(uuid)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'public.accept_reconcile_batch(uuid,jsonb,uuid)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'public.undo_reconcile_batch(uuid)', 'EXECUTE'
     )
     or exists(select 1 from auth.users)
     or exists(select 1 from public.workspaces)
     or exists(select 1 from public.restaurants)
     or exists(select 1 from public.workspace_memberships)
     or exists(select 1 from public.memberships)
     or exists(select 1 from public.wines)
     or exists(select 1 from public.bins)
     or exists(select 1 from public.inventory_items)
     or exists(select 1 from public.reconcile_batches)
     or exists(select 1 from public.reconcile_actions)
     or exists(
       select 1 from pg_catalog.pg_stat_activity a
        where a.datname = current_database() and a.pid <> pg_backend_pid()
     ) then
    raise exception 'C04_RECONCILE_CONTRACT_TARGET_NOT_ADMITTED' using errcode = 'P0001';
  end if;

  insert into auth.users(id,email) values
    (v_actor,'c04-reconcile-contract@terroir.test');
  insert into public.workspaces(id,kind,name) values
    (v_workspace,'restaurant','C04 reconcile contract');
  insert into public.restaurants(id,name,workspace_id) values
    (v_site,'C04 reconcile contract site',v_workspace);
  insert into public.workspace_memberships(
    id,workspace_id,user_id,governance_role
  ) values(v_workspace_member,v_workspace,v_actor,'workspace_owner');
  insert into public.memberships(
    id,user_id,restaurant_id,role,workspace_membership_id
  ) values(v_membership,v_actor,v_site,'manager',v_workspace_member);
  insert into public.wines(
    id,restaurant_id,name,producer,vintage,size_ml
  ) values
    (v_wine_a,v_site,'Reconcile Contract A','Fixture Producer',2021,750),
    (v_wine_b,v_site,'Reconcile Contract B','Fixture Producer',2022,750);
  insert into public.bins(id,restaurant_id,code) values
    (v_bin_a,v_site,'CONTRACT-A'),
    (v_bin_b,v_site,'CONTRACT-B');
  insert into public.inventory_items(
    id,wine_id,restaurant_id,quantity,unit_cost,added_via
  ) values(v_inventory,v_wine_a,v_site,2,11,'manual');
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  v_changed_first := jsonb_build_array(jsonb_build_object(
    'action_type','dismiss','subject_table','wines','subject_id',v_wine_a,
    'patch','{}'::jsonb
  ));
  v_changed_second := jsonb_build_array(jsonb_build_object(
    'action_type','dismiss','subject_table','wines','subject_id',v_wine_b,
    'patch','{}'::jsonb
  ));
  perform public.accept_reconcile_batch(v_site,v_changed_first,v_changed_key);
  select to_jsonb(b) into strict v_changed_batch_before
    from public.reconcile_batches b where b.id = v_changed_key;
  select to_jsonb(a) into strict v_changed_history_before
    from public.reconcile_actions a where a.batch_id = v_changed_key;
  begin
    perform public.accept_reconcile_batch(v_site,v_changed_second,v_changed_key);
    raise exception 'C04_RECONCILE_CONTRACT_CHANGED_INPUT_ACCEPTED';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message not in (
      'C04_RECONCILE_ACCEPT_REFUSED','C04_RECONCILE_IDEMPOTENCY_CONFLICT'
    ) then
      raise exception 'C04_RECONCILE_CONTRACT_UNADMITTED_ERROR' using errcode='P0001';
    end if;
    v_changed_observed := v_message;
  when others then
    raise exception 'C04_RECONCILE_CONTRACT_UNADMITTED_ERROR' using errcode='P0001';
  end;
  if (select to_jsonb(b) from public.reconcile_batches b where b.id = v_changed_key)
       is distinct from v_changed_batch_before
     or (select to_jsonb(a) from public.reconcile_actions a where a.batch_id = v_changed_key)
       is distinct from v_changed_history_before
     or (select count(*) from public.reconcile_actions a where a.batch_id = v_changed_key) <> 1
     or exists(
       select 1 from public.reconcile_actions a
        where a.batch_id = v_changed_key and a.subject_id = v_wine_b
     ) then
    raise exception 'C04_RECONCILE_CONTRACT_CHANGED_INPUT_SIDE_EFFECT';
  end if;

  v_repeat_action := jsonb_build_array(jsonb_build_object(
    'action_type','dismiss','subject_table','wines','subject_id',v_wine_a,
    'patch','{}'::jsonb
  ));
  perform public.accept_reconcile_batch(v_site,v_repeat_action,v_repeat_key);
  perform public.undo_reconcile_batch(v_repeat_key);
  select to_jsonb(b) into strict v_repeat_batch_after_undo
    from public.reconcile_batches b where b.id = v_repeat_key;
  select to_jsonb(a) into strict v_repeat_history_after_undo
    from public.reconcile_actions a where a.batch_id = v_repeat_key;
  begin
    perform public.undo_reconcile_batch(v_repeat_key);
    raise exception 'C04_RECONCILE_CONTRACT_REPEAT_UNDO_ACCEPTED';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message not in (
      'C04_RECONCILE_UNDO_REFUSED','reconcile_batch_already_undone'
    ) then
      raise exception 'C04_RECONCILE_CONTRACT_UNADMITTED_ERROR' using errcode='P0001';
    end if;
    v_repeat_observed := v_message;
  when others then
    raise exception 'C04_RECONCILE_CONTRACT_UNADMITTED_ERROR' using errcode='P0001';
  end;
  if (select to_jsonb(b) from public.reconcile_batches b where b.id = v_repeat_key)
       is distinct from v_repeat_batch_after_undo
     or (select to_jsonb(a) from public.reconcile_actions a where a.batch_id = v_repeat_key)
       is distinct from v_repeat_history_after_undo
     or (select count(*) from public.reconcile_actions a where a.batch_id = v_repeat_key) <> 1
     or not exists(
       select 1 from public.reconcile_batches b
        where b.id = v_repeat_key and b.undone_at is not null and b.undone_by = v_actor
     ) then
    raise exception 'C04_RECONCILE_CONTRACT_REPEAT_UNDO_SIDE_EFFECT';
  end if;

  v_stale_action := jsonb_build_array(jsonb_build_object(
    'action_type','place_bin','subject_table','inventory_items','subject_id',v_inventory,
    'patch',jsonb_build_object('bin_id',v_bin_a)
  ));
  perform public.accept_reconcile_batch(v_site,v_stale_action,v_stale_key);
  if not exists(
    select 1 from public.inventory_items ii
     where ii.id = v_inventory and ii.bin_id = v_bin_a and ii.bin_location = 'CONTRACT-A'
  ) then
    raise exception 'C04_RECONCILE_CONTRACT_STALE_SETUP_FAILED';
  end if;
  select to_jsonb(b) into strict v_stale_batch_before_undo
    from public.reconcile_batches b where b.id = v_stale_key;
  select to_jsonb(a) into strict v_stale_history_before_undo
    from public.reconcile_actions a where a.batch_id = v_stale_key;
  update public.inventory_items ii
     set bin_id = v_bin_b, bin_location = 'CONTRACT-B'
   where ii.id = v_inventory and ii.restaurant_id = v_site;
  if not found then
    raise exception 'C04_RECONCILE_CONTRACT_STALE_MUTATION_FAILED';
  end if;
  begin
    perform public.undo_reconcile_batch(v_stale_key);
    raise exception 'C04_RECONCILE_CONTRACT_STALE_UNDO_ACCEPTED';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message not in (
      'C04_RECONCILE_UNDO_REFUSED','reconcile_subject_changed'
    ) then
      raise exception 'C04_RECONCILE_CONTRACT_UNADMITTED_ERROR' using errcode='P0001';
    end if;
    v_stale_observed := v_message;
  when others then
    raise exception 'C04_RECONCILE_CONTRACT_UNADMITTED_ERROR' using errcode='P0001';
  end;
  if not exists(
       select 1 from public.inventory_items ii
        where ii.id = v_inventory
          and ii.bin_id = v_bin_b and ii.bin_location = 'CONTRACT-B'
     )
     or (select to_jsonb(b) from public.reconcile_batches b where b.id = v_stale_key)
       is distinct from v_stale_batch_before_undo
     or (select to_jsonb(a) from public.reconcile_actions a where a.batch_id = v_stale_key)
       is distinct from v_stale_history_before_undo
     or (select count(*) from public.reconcile_actions a where a.batch_id = v_stale_key) <> 1
     or exists(
       select 1 from public.reconcile_batches b
        where b.id = v_stale_key and (b.undone_at is not null or b.undone_by is not null)
     ) then
    raise exception 'C04_RECONCILE_CONTRACT_STALE_UNDO_SIDE_EFFECT';
  end if;

  if (select count(*) from public.reconcile_batches b where b.restaurant_id = v_site) <> 3
     or (select count(*) from public.reconcile_actions a where a.restaurant_id = v_site) <> 3
     or (select count(*) from public.inventory_items ii where ii.restaurant_id = v_site) <> 1
     or (select coalesce(sum(ii.quantity),0) from public.inventory_items ii
          where ii.restaurant_id = v_site) <> 2 then
    raise exception 'C04_RECONCILE_CONTRACT_FINAL_CONSERVATION_MISMATCH';
  end if;

  if v_changed_observed = 'C04_RECONCILE_ACCEPT_REFUSED' then
    raise notice 'C04_RECONCILE_OBSERVED_CHANGED_INPUT_BROAD_REFUSAL';
  else
    raise notice 'C04_RECONCILE_OBSERVED_CHANGED_INPUT_IDEMPOTENCY_CONFLICT';
  end if;
  if v_repeat_observed = 'C04_RECONCILE_UNDO_REFUSED' then
    raise notice 'C04_RECONCILE_OBSERVED_REPEAT_UNDO_BROAD_REFUSAL';
  else
    raise notice 'C04_RECONCILE_OBSERVED_REPEAT_UNDO_ALREADY_UNDONE';
  end if;
  if v_stale_observed = 'C04_RECONCILE_UNDO_REFUSED' then
    raise notice 'C04_RECONCILE_OBSERVED_STALE_UNDO_BROAD_REFUSAL';
  else
    raise notice 'C04_RECONCILE_OBSERVED_STALE_UNDO_SUBJECT_CHANGED';
  end if;

  if v_changed_observed = 'C04_RECONCILE_ACCEPT_REFUSED'
     or v_repeat_observed = 'C04_RECONCILE_UNDO_REFUSED'
     or v_stale_observed = 'C04_RECONCILE_UNDO_REFUSED' then
    raise exception 'C04_RECONCILE_ERROR_PRESERVATION_RED' using errcode='P0001';
  end if;
  if v_changed_observed <> 'C04_RECONCILE_IDEMPOTENCY_CONFLICT'
     or v_repeat_observed <> 'reconcile_batch_already_undone'
     or v_stale_observed <> 'reconcile_subject_changed' then
    raise exception 'C04_RECONCILE_CONTRACT_REQUIRED_OUTCOME_MISMATCH';
  end if;
exception when others then
  get stacked diagnostics v_message = message_text;
  if v_message = 'C04_RECONCILE_ERROR_PRESERVATION_RED' then
    raise exception 'C04_RECONCILE_ERROR_PRESERVATION_RED' using errcode='P0001';
  end if;
  raise exception 'C04_RECONCILE_CONTRACT_FIXTURE_REFUSED' using errcode='P0001';
end;
$reconcile_error_preservation_contract$;

\if :ERROR
  rollback;
  \set ON_ERROR_STOP on
  do $c04_psql_control_red$ begin raise exception 'C04_RECONCILE_EXPECTED_RED_EXIT_3' using errcode='P0001'; end; $c04_psql_control_red$;
\endif

\set ON_ERROR_STOP on
rollback;
\echo C04_RECONCILE_ERROR_PRESERVATION_PASS
