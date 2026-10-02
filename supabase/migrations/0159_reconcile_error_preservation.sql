-- 0159_reconcile_error_preservation.sql
--
-- Preserve the exact admitted reconciliation error contract without changing
-- either function signature, owner, configuration, or existing ACL.

do $c04_0159_forward_admission$
begin
  if exists (
    select 1
      from (values
        (
          'public.accept_reconcile_batch(uuid,jsonb,uuid)'::text,
          '87e476575d603ed4e06acbf5c57cc222dc1975b166356b230b9675645c55ed35'::text,
          '["p_restaurant_id", "p_actions", "p_idempotency_key"]'::pg_catalog.jsonb
        ),
        (
          'public.undo_reconcile_batch(uuid)'::text,
          '5b3053519370a0e8a2b0f931668ddcad56b20c055396ee130d472315d0413045'::text,
          '["p_batch_id"]'::pg_catalog.jsonb
        )
      ) expected(identity, body_sha256, argument_names)
      left join pg_catalog.pg_proc p
        on p.oid = pg_catalog.to_regprocedure(expected.identity)
     where p.oid is null
        or pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')),
             'hex'
           ) is distinct from expected.body_sha256
        or pg_catalog.pg_get_userbyid(p.proowner) is distinct from 'postgres'
        or p.prolang is distinct from (
             select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
           )
        or p.prorettype is distinct from pg_catalog.to_regtype('pg_catalog.jsonb')
        or p.prokind is distinct from 'f'
        or p.provolatile is distinct from 'v'
        or p.prosecdef is distinct from true
        or p.proisstrict is distinct from false
        or p.proretset is distinct from false
        or p.proparallel is distinct from 'u'
        or p.proleakproof is distinct from false
        or p.procost is distinct from 100::real
        or p.prorows is distinct from 0::real
        or p.pronargdefaults is distinct from 0
        or p.provariadic is distinct from 0::pg_catalog.oid
        or p.prosupport is distinct from 0::pg_catalog.oid
        or p.proconfig is distinct from array['search_path=""']::text[]
        or pg_catalog.to_jsonb(p.proacl) is distinct from
             '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
        or pg_catalog.to_jsonb(p.proargnames) is distinct from expected.argument_names
        or p.proargmodes is not null
        or p.proallargtypes is not null
        or p.protrftypes is not null
        or p.proargdefaults is not null
        or p.prosqlbody is not null
        or p.probin is not null
  ) then
    raise exception 'C04_0159_FORWARD_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c04_0159_forward_admission$;

create or replace function public.accept_reconcile_batch(
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
  v_error text;
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
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
  when sqlstate '42501' then
    raise exception 'forbidden' using errcode='42501';
  when unique_violation then
    raise exception 'reconcile_batch_conflict' using errcode='23505';
  when sqlstate 'P0002' then
    get stacked diagnostics v_error = message_text;
    if v_error = 'reconcile_subject_not_found' then
      raise exception 'reconcile_subject_not_found' using errcode='P0002';
    end if;
    raise exception 'C04_RECONCILE_ACCEPT_REFUSED' using errcode='P0001';
  when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    case v_error
      when 'C04_RECONCILE_BATCH_INVALID' then
        raise exception 'C04_RECONCILE_BATCH_INVALID' using errcode='P0001';
      when 'C04_RECONCILE_ACTION_INVALID' then
        raise exception 'C04_RECONCILE_ACTION_INVALID' using errcode='P0001';
      when 'C04_RECONCILE_DUPLICATE_SUBJECT' then
        raise exception 'C04_RECONCILE_DUPLICATE_SUBJECT' using errcode='P0001';
      when 'C04_RECONCILE_IDEMPOTENCY_CONFLICT' then
        raise exception 'C04_RECONCILE_IDEMPOTENCY_CONFLICT' using errcode='P0001';
      when 'reconcile_subject_conflict' then
        raise exception 'reconcile_subject_conflict' using errcode='P0001';
      else
        raise exception 'C04_RECONCILE_ACCEPT_REFUSED' using errcode='P0001';
    end case;
  when others then
    raise exception 'C04_RECONCILE_ACCEPT_REFUSED' using errcode='P0001';
end;
$function$;

create or replace function public.undo_reconcile_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid:=(select auth.uid());
  v_batch public.reconcile_batches%rowtype;
  v_action public.reconcile_actions%rowtype;
  v_now timestamptz;
  v_error text;
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
  when sqlstate '42501' then
    raise exception 'forbidden' using errcode='42501';
  when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    case v_error
      when 'reconcile_batch_already_undone' then
        raise exception 'reconcile_batch_already_undone' using errcode='P0001';
      when 'reconcile_subject_changed' then
        raise exception 'reconcile_subject_changed' using errcode='P0001';
      when 'reconcile_action_invalid' then
        raise exception 'reconcile_action_invalid' using errcode='P0001';
      when 'reconcile_batch_conflict' then
        raise exception 'reconcile_batch_conflict' using errcode='P0001';
      else
        raise exception 'C04_RECONCILE_UNDO_REFUSED' using errcode='P0001';
    end case;
  when others then
    raise exception 'C04_RECONCILE_UNDO_REFUSED' using errcode='P0001';
end;
$function$;

do $c04_0159_forward_postcondition$
begin
  if exists (
    select 1
      from (values
        (
          'public.accept_reconcile_batch(uuid,jsonb,uuid)'::text,
          'a0a2c184d486303e02e0cfbaf8b53cc516c89dc54811e0d85679dddb2a7cff36'::text,
          '["p_restaurant_id", "p_actions", "p_idempotency_key"]'::pg_catalog.jsonb
        ),
        (
          'public.undo_reconcile_batch(uuid)'::text,
          '99619be5de0e9c6cc79dbb17167e3483c7352e1f7a950260438d7a61340a95de'::text,
          '["p_batch_id"]'::pg_catalog.jsonb
        )
      ) expected(identity, body_sha256, argument_names)
      left join pg_catalog.pg_proc p
        on p.oid = pg_catalog.to_regprocedure(expected.identity)
     where p.oid is null
        or pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')),
             'hex'
           ) is distinct from expected.body_sha256
        or pg_catalog.pg_get_userbyid(p.proowner) is distinct from 'postgres'
        or p.prolang is distinct from (
             select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
           )
        or p.prorettype is distinct from pg_catalog.to_regtype('pg_catalog.jsonb')
        or p.prokind is distinct from 'f'
        or p.provolatile is distinct from 'v'
        or p.prosecdef is distinct from true
        or p.proisstrict is distinct from false
        or p.proretset is distinct from false
        or p.proparallel is distinct from 'u'
        or p.proleakproof is distinct from false
        or p.procost is distinct from 100::real
        or p.prorows is distinct from 0::real
        or p.pronargdefaults is distinct from 0
        or p.provariadic is distinct from 0::pg_catalog.oid
        or p.prosupport is distinct from 0::pg_catalog.oid
        or p.proconfig is distinct from array['search_path=""']::text[]
        or pg_catalog.to_jsonb(p.proacl) is distinct from
             '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb
        or pg_catalog.to_jsonb(p.proargnames) is distinct from expected.argument_names
        or p.proargmodes is not null
        or p.proallargtypes is not null
        or p.protrftypes is not null
        or p.proargdefaults is not null
        or p.prosqlbody is not null
        or p.probin is not null
  ) then
    raise exception 'C04_0159_FORWARD_POSTCONDITION_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c04_0159_forward_postcondition$;
