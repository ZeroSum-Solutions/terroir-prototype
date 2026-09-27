-- 0163_stalled_invoice_scan_expiry.sql
--
-- Expire only abandoned invoice extraction work through one closed, current-
-- authority boundary. Ordered scan locks and the separate final UPDATE are
-- intentionally two SQL statements so READ COMMITTED refreshes the job view
-- after a lock wait.

do $c08_0163_preflight$
declare
  v_column_count integer;
  v_job_type_definition text;
  v_job_status_definition text;
  v_updated_at_function pg_catalog.pg_proc%rowtype;
begin
  if pg_catalog.to_regclass('public.invoice_scans') is null
     or pg_catalog.to_regclass('public.background_jobs') is null
     or pg_catalog.to_regprocedure(
       'public.current_site_role_at_least(uuid,public.membership_role)'
     ) is null
     or pg_catalog.to_regprocedure('public.set_updated_at()') is null
     or pg_catalog.to_regrole('postgres') is null
     or pg_catalog.to_regrole('anon') is null
     or pg_catalog.to_regrole('authenticated') is null
     or pg_catalog.to_regrole('service_role') is null then
    raise exception 'C08_0163_REQUIRED_BASELINE_MISSING' using errcode = 'P0001';
  end if;

  select p.* into strict v_updated_at_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.set_updated_at()');

  select pg_catalog.count(*) into v_column_count
    from pg_catalog.pg_attribute a
   where (a.attrelid, a.attname, a.atttypid, a.attnotnull) in (
     (pg_catalog.to_regclass('public.invoice_scans'), 'id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.invoice_scans'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.invoice_scans'), 'status',
       pg_catalog.to_regtype('pg_catalog.text'), true),
     (pg_catalog.to_regclass('public.invoice_scans'), 'committed_at',
       pg_catalog.to_regtype('pg_catalog.timestamptz'), false),
     (pg_catalog.to_regclass('public.invoice_scans'), 'status_reason',
       pg_catalog.to_regtype('pg_catalog.text'), false),
     (pg_catalog.to_regclass('public.invoice_scans'), 'updated_at',
       pg_catalog.to_regtype('pg_catalog.timestamptz'), true),
     (pg_catalog.to_regclass('public.background_jobs'), 'restaurant_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), true),
     (pg_catalog.to_regclass('public.background_jobs'), 'job_type',
       pg_catalog.to_regtype('pg_catalog.text'), true),
     (pg_catalog.to_regclass('public.background_jobs'), 'subject_table',
       pg_catalog.to_regtype('pg_catalog.text'), false),
     (pg_catalog.to_regclass('public.background_jobs'), 'subject_id',
       pg_catalog.to_regtype('pg_catalog.uuid'), false),
     (pg_catalog.to_regclass('public.background_jobs'), 'status',
       pg_catalog.to_regtype('pg_catalog.text'), true),
     (pg_catalog.to_regclass('public.background_jobs'), 'claimed_at',
       pg_catalog.to_regtype('pg_catalog.timestamptz'), false)
   )
     and a.attnum > 0
     and not a.attisdropped;

  select pg_catalog.pg_get_constraintdef(c.oid, false)
    into v_job_type_definition
    from pg_catalog.pg_constraint c
   where c.conrelid = pg_catalog.to_regclass('public.background_jobs')
     and c.conname = 'background_jobs_job_type_check'
     and c.contype = 'c'
     and c.convalidated;
  select pg_catalog.pg_get_constraintdef(c.oid, false)
    into v_job_status_definition
    from pg_catalog.pg_constraint c
   where c.conrelid = pg_catalog.to_regclass('public.background_jobs')
     and c.conname = 'background_jobs_status_check'
     and c.contype = 'c'
     and c.convalidated;

  if v_column_count <> 12
     or v_job_type_definition is null
     or pg_catalog.strpos(v_job_type_definition, 'invoice_extract') = 0
     or v_job_status_definition is null
     or pg_catalog.strpos(v_job_status_definition, 'queued') = 0
     or pg_catalog.strpos(v_job_status_definition, 'processing') = 0
     or pg_catalog.strpos(v_job_status_definition, 'retrying') = 0
     or pg_catalog.strpos(v_job_status_definition, 'succeeded') = 0
     or pg_catalog.strpos(v_job_status_definition, 'failed') = 0
     or pg_catalog.strpos(v_job_status_definition, 'cancelled') = 0
     or pg_catalog.strpos(v_job_status_definition, 'dead') = 0
     or pg_catalog.encode(
       pg_catalog.sha256(
         pg_catalog.convert_to(v_updated_at_function.prosrc, 'UTF8')
       ),
       'hex'
     ) <> '3c6d6c41d6262a20e7c102dbd49bb3383bd86a4138c8a3ab6b9b04a1ec2420a5'
     or pg_catalog.pg_get_userbyid(v_updated_at_function.proowner) <> 'postgres'
     or v_updated_at_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
     or v_updated_at_function.prorettype <>
       pg_catalog.to_regtype('pg_catalog.trigger')
     or v_updated_at_function.prokind <> 'f'
     or v_updated_at_function.provolatile <> 'v'
     or not v_updated_at_function.prosecdef
     or v_updated_at_function.proisstrict
     or v_updated_at_function.proretset
     or v_updated_at_function.proparallel <> 'u'
     or v_updated_at_function.proleakproof
     or v_updated_at_function.procost <> 100::real
     or v_updated_at_function.prorows <> 0::real
     or v_updated_at_function.pronargs <> 0
     or v_updated_at_function.pronargdefaults <> 0
     or v_updated_at_function.provariadic <> 0::pg_catalog.oid
     or v_updated_at_function.prosupport <> 0::pg_catalog.oid
     or v_updated_at_function.proargtypes::text <> ''
     or v_updated_at_function.proallargtypes is not null
     or v_updated_at_function.proargmodes is not null
     or v_updated_at_function.proargnames is not null
     or v_updated_at_function.proargdefaults is not null
     or v_updated_at_function.proconfig is distinct from
       array['search_path=public']::text[]
     or v_updated_at_function.proacl is not null
     or v_updated_at_function.prosqlbody is not null
     or v_updated_at_function.probin is not null
     or (select pg_catalog.count(*)
           from pg_catalog.pg_index i
           join pg_catalog.pg_class c on c.oid = i.indexrelid
          where (
            (i.indrelid = pg_catalog.to_regclass('public.invoice_scans')
             and c.relname in (
               'invoice_scans_restaurant_id_idx', 'invoice_scans_status_idx'
             ))
            or (i.indrelid = pg_catalog.to_regclass('public.background_jobs')
                and c.relname = 'background_jobs_subject_idx')
          )
            and i.indisvalid
            and i.indisready) <> 3
     or not exists (
       select 1
         from pg_catalog.pg_trigger t
        where t.tgrelid = pg_catalog.to_regclass('public.invoice_scans')
          and t.tgname = 'invoice_scans_set_updated_at'
          and not t.tgisinternal
          and t.tgtype = 19
          and t.tgenabled = 'O'
          and t.tgfoid = pg_catalog.to_regprocedure('public.set_updated_at()')
          and t.tgattr::text = ''
          and t.tgqual is null
          and t.tgnargs = 0
          and pg_catalog.encode(t.tgargs, 'hex') = ''
     ) then
    raise exception 'C08_0163_REQUIRED_BASELINE_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (
       select 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'expire_stalled_invoice_scans'
     ) then
    raise exception 'C08_0163_TARGET_IDENTITY_OCCUPIED' using errcode = 'P0001';
  end if;
end;
$c08_0163_preflight$;

create function public.expire_stalled_invoice_scans(p_restaurant_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz;
  v_locked_scan_ids uuid[];
  v_expired_count integer;
begin
  if v_actor is null
     or p_restaurant_id is null
     or not public.current_site_role_at_least(p_restaurant_id, 'staff') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'read_committed_required' using errcode = '25000';
  end if;

  v_now := pg_catalog.statement_timestamp();

  select coalesce(
           pg_catalog.array_agg(locked.id order by locked.id),
           array[]::uuid[]
         )
    into v_locked_scan_ids
    from (
      select s.id
        from public.invoice_scans s
       where s.restaurant_id = p_restaurant_id
         and s.status = 'processing'
         and s.committed_at is null
         and s.updated_at < v_now - interval '15 minutes'
       order by s.id
       for update
    ) as locked;

  with expired as (
    update public.invoice_scans as s
       set status = 'failed',
           status_reason = 'stalled'
     where s.id = any(v_locked_scan_ids)
       and s.restaurant_id = p_restaurant_id
       and s.status = 'processing'
       and s.committed_at is null
       and s.updated_at < v_now - interval '15 minutes'
       and not exists (
         select 1
           from public.background_jobs as job
          where job.restaurant_id = s.restaurant_id
            and job.job_type = 'invoice_extract'
            and job.subject_table = 'invoice_scans'
            and job.subject_id = s.id
            and (
              job.status in ('queued', 'retrying')
              or (
                job.status = 'processing'
                and job.claimed_at >= v_now - interval '5 minutes'
              )
            )
       )
     returning s.id
  )
  select pg_catalog.count(*)::integer
    into v_expired_count
    from expired;

  return pg_catalog.jsonb_build_object(
    'version', 1,
    'expiredCount', v_expired_count
  );
end;
$function$;

comment on function public.expire_stalled_invoice_scans(uuid) is
  'Expires exact-site stale processing scans only when no matching extraction job is active; requires current staff authority and READ COMMITTED.';

revoke all on function public.expire_stalled_invoice_scans(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stalled_invoice_scans(uuid)
  to authenticated;
alter function public.expire_stalled_invoice_scans(uuid) owner to postgres;

do $c08_0163_postflight$
declare
  v_function pg_catalog.pg_proc%rowtype;
begin
  select p.* into strict v_function
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'public.expire_stalled_invoice_scans(uuid)'
   );

  if (select pg_catalog.count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'expire_stalled_invoice_scans') <> 1
     or pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_function.prosrc, 'UTF8')),
       'hex'
     ) <> 'bd01b007ef6b2bc0b37b3e7126f938f8ae10d5600b7499ccd941abd5efa0b8a1'
     or pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
     or v_function.prolang <> (
       select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql'
     )
     or v_function.prorettype <> pg_catalog.to_regtype('pg_catalog.jsonb')
     or v_function.prokind <> 'f'
     or v_function.provolatile <> 'v'
     or not v_function.prosecdef
     or v_function.proisstrict
     or v_function.proretset
     or v_function.proparallel <> 'u'
     or v_function.proleakproof
     or v_function.procost <> 100::real
     or v_function.prorows <> 0::real
     or v_function.pronargs <> 1
     or v_function.pronargdefaults <> 0
     or v_function.provariadic <> 0::pg_catalog.oid
     or v_function.prosupport <> 0::pg_catalog.oid
     or v_function.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.to_jsonb(v_function.proargnames) is distinct from
       '["p_restaurant_id"]'::pg_catalog.jsonb
     or v_function.proargmodes is not null
     or v_function.proallargtypes is not null
     or v_function.protrftypes is not null
     or v_function.proargdefaults is not null
     or v_function.prosqlbody is not null
     or v_function.probin is not null
     or pg_catalog.to_jsonb(v_function.proacl) is distinct from
       '["postgres=X/postgres", "authenticated=X/postgres"]'::pg_catalog.jsonb then
    raise exception 'C08_0163_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$c08_0163_postflight$;
