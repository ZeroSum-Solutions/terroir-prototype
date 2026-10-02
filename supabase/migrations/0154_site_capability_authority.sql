-- 0154_site_capability_authority.sql
--
-- C04 additive authority A only. This migration introduces explicit exact-site
-- capability grants and an authorized pricing reader without removing the
-- legacy pricing SELECT policy or activating an application cutover.
--
-- Apply in one explicit transaction. The parent-table ACCESS EXCLUSIVE locks
-- are acquired before either table is rewritten with a volatile UUID default.

do $static_admission$
begin
  if to_regclass('public.workspaces') is null
     or to_regclass('public.restaurants') is null
     or to_regclass('public.workspace_memberships') is null
     or to_regclass('public.memberships') is null
     or to_regclass('public.pricing_recommendations') is null
     or to_regclass('public.wines') is null then
    raise exception 'C04_0154_REQUIRED_RELATION_MISSING' using errcode = 'P0001';
  end if;

  if to_regclass('public.membership_capability_grants') is not null
     or to_regprocedure('public.retire_membership_capability_grants(uuid[],uuid,text,text)') is not null
     or to_regprocedure('public.guard_membership_capability_grant_history()') is not null
     or to_regprocedure('public.enforce_site_membership_capability_lifecycle()') is not null
     or to_regprocedure('public.enforce_workspace_membership_capability_lifecycle()') is not null
     or to_regprocedure('public.effective_site_capability(uuid,text)') is not null
     or to_regprocedure('public.effective_site_ids(text)') is not null
     or to_regprocedure('public.replace_member_site_capabilities(uuid,text[],timestamp with time zone,text)') is not null
     or to_regprocedure('public.read_pricing_recommendations(uuid)') is not null
     or exists (
       select 1 from pg_catalog.pg_attribute a
        where a.attrelid in (
          'public.memberships'::regclass,
          'public.workspace_memberships'::regclass
        )
          and a.attname = 'lifecycle_generation'
          and a.attnum > 0 and not a.attisdropped
     ) then
    raise exception 'C04_0154_TARGET_IDENTITY_OCCUPIED' using errcode = 'P0001';
  end if;
end;
$static_admission$;

lock table public.memberships in access exclusive mode nowait;
lock table public.workspace_memberships in access exclusive mode nowait;
lock table public.workspaces in share mode nowait;
lock table public.restaurants in share mode nowait;
lock table public.pricing_recommendations in share mode nowait;
lock table public.wines in share mode nowait;

do $locked_preflight$
declare
  v_role_oid oid;
  v_object record;
  v_count integer := 0;
begin
  select oid into strict v_role_oid
    from pg_catalog.pg_roles where rolname = current_user;

  for v_object in
    select c.oid::regclass::text as identity, c.relowner
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname in (
         'workspaces', 'restaurants', 'workspace_memberships', 'memberships',
         'pricing_recommendations', 'wines'
       )
  loop
    v_count := v_count + 1;
    if v_object.relowner <> v_role_oid then
      raise exception 'C04_0154_OPERATOR_NOT_DIRECT_OWNER: %', v_object.identity
        using errcode = 'P0001';
    end if;
  end loop;
  if v_count <> 6 then
    raise exception 'C04_0154_REQUIRED_RELATION_COUNT: %', v_count using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.memberships'::regclass
       and t.tgname = 'memberships_link_workspace'
       and not t.tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.workspace_memberships'::regclass
       and t.tgname = 'workspace_memberships_guard_identity'
       and not t.tgisinternal
  ) then
    raise exception 'C04_0154_0152_GUARD_MISSING' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policy p
     where p.polrelid = 'public.pricing_recommendations'::regclass
       and p.polname = 'members can read pricing_recommendations'
       and p.polcmd = 'r'
       and p.polpermissive
       and p.polroles = array[0::oid]
       and pg_catalog.pg_get_expr(p.polqual, p.polrelid) =
         '(restaurant_id IN ( SELECT member_restaurant_ids() AS member_restaurant_ids))'
       and p.polwithcheck is null
  ) or not has_table_privilege(
    'authenticated', 'public.pricing_recommendations', 'SELECT'
  ) then
    raise exception 'C04_0154_LEGACY_PRICING_SELECT_MISSING' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid in (
       'public.memberships'::regclass,
       'public.workspace_memberships'::regclass
     )
       and a.attname = 'lifecycle_generation'
       and a.attnum > 0 and not a.attisdropped
  ) or to_regclass('public.membership_capability_grants') is not null then
    raise exception 'C04_0154_TARGET_CHANGED_AFTER_ADMISSION' using errcode = 'P0001';
  end if;
end;
$locked_preflight$;

alter table public.memberships
  add column lifecycle_generation uuid not null default gen_random_uuid();

alter table public.workspace_memberships
  add column lifecycle_generation uuid not null default gen_random_uuid();

create table public.membership_capability_grants (
  id                             uuid        primary key default gen_random_uuid(),
  workspace_id                   uuid        not null,
  restaurant_id                  uuid        not null,
  workspace_membership_id        uuid        not null,
  membership_id                  uuid        not null,
  subject_user_id                uuid        not null,
  site_lifecycle_generation      uuid        not null,
  workspace_lifecycle_generation uuid        not null,
  capability_key                 text        not null,
  granted_at                     timestamptz not null default statement_timestamp(),
  granted_by_user_id             uuid        not null,
  grant_reason                   text        not null,
  source                         text        not null default 'workspace_governance',
  expires_at                     timestamptz,
  revoked_at                     timestamptz,
  revoked_by_user_id             uuid,
  revoke_reason                  text,
  revoke_cause                   text,
  constraint membership_capability_grants_capability_key_check check (
    capability_key in ('cost.read', 'margin.read', 'pricing.manage')
  ),
  constraint membership_capability_grants_source_check check (
    source = 'workspace_governance'
  ),
  constraint membership_capability_grants_grant_reason_check check (
    btrim(grant_reason) <> ''
  ),
  constraint membership_capability_grants_revoke_cause_check check (
    revoke_cause is null or revoke_cause in (
      'governance_replacement', 'site_lifecycle', 'workspace_lifecycle',
      'site_delete', 'workspace_delete'
    )
  ),
  constraint membership_capability_grants_revocation_shape_check check (
    (revoked_at is null and revoked_by_user_id is null
      and revoke_reason is null and revoke_cause is null)
    or
    (revoked_at is not null and revoke_reason is not null
      and btrim(revoke_reason) <> '' and revoke_cause is not null)
  )
);

create unique index membership_capability_grants_current_key
  on public.membership_capability_grants (membership_id, capability_key)
  where revoked_at is null;

create index membership_capability_grants_current_workspace_member_idx
  on public.membership_capability_grants (
    workspace_membership_id, membership_id, capability_key, id
  ) where revoked_at is null;

create index membership_capability_grants_subject_capability_site_idx
  on public.membership_capability_grants (
    subject_user_id, capability_key, restaurant_id
  ) where revoked_at is null;

alter table public.membership_capability_grants enable row level security;
revoke all on table public.membership_capability_grants
  from public, anon, authenticated, service_role;

create function public.guard_membership_capability_grant_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'C04_CAPABILITY_GRANT_HISTORY_DELETE_FORBIDDEN'
      using errcode = 'P0001';
  end if;

  if old.revoked_at is not null
     or new.revoked_at is null
     or new.revoke_reason is null
     or btrim(new.revoke_reason) = ''
     or new.revoke_cause is null
     or (to_jsonb(new) - 'revoked_at' - 'revoked_by_user_id' - 'revoke_reason' - 'revoke_cause')
        is distinct from
        (to_jsonb(old) - 'revoked_at' - 'revoked_by_user_id' - 'revoke_reason' - 'revoke_cause') then
    raise exception 'C04_CAPABILITY_GRANT_HISTORY_IMMUTABLE'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_membership_capability_grant_history()
  from public, anon, authenticated, service_role;

create trigger membership_capability_grants_guard_history
  before update or delete on public.membership_capability_grants
  for each row execute function public.guard_membership_capability_grant_history();

create function public.retire_membership_capability_grants(
  p_membership_ids uuid[],
  p_revoked_by_user_id uuid,
  p_revoke_reason text,
  p_revoke_cause text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_ids uuid[];
  v_count integer;
begin
  if p_revoke_reason is null or btrim(p_revoke_reason) = '' then
    raise exception 'C04_RETIRE_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_revoke_cause is null or p_revoke_cause not in (
    'governance_replacement', 'site_lifecycle', 'workspace_lifecycle',
    'site_delete', 'workspace_delete'
  ) then
    raise exception 'C04_RETIRE_CAUSE_UNKNOWN' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(locked.id order by
    locked.membership_id, locked.capability_key, locked.id), array[]::uuid[])
    into v_locked_ids
    from (
      select g.id, g.membership_id, g.capability_key
        from public.membership_capability_grants g
       where g.membership_id = any(coalesce(p_membership_ids, array[]::uuid[]))
         and g.revoked_at is null
       order by g.membership_id, g.capability_key, g.id
       for update
    ) locked;

  update public.membership_capability_grants g
     set revoked_at = statement_timestamp(),
         revoked_by_user_id = p_revoked_by_user_id,
         revoke_reason = p_revoke_reason,
         revoke_cause = p_revoke_cause
   where g.id = any(v_locked_ids)
     and g.revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.retire_membership_capability_grants(uuid[],uuid,text,text)
  from public, anon, authenticated, service_role;

create function public.enforce_site_membership_capability_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.lifecycle_generation := gen_random_uuid();
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.retire_membership_capability_grants(
      array[old.id], auth.uid(), 'site membership deleted', 'site_delete'
    );
    return old;
  end if;

  if new.lifecycle_generation is distinct from old.lifecycle_generation then
    raise exception 'C04_SITE_LIFECYCLE_GENERATION_FORGERY' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status
     or new.revoked_at is distinct from old.revoked_at
     or new.expires_at is distinct from old.expires_at
     or new.user_id is distinct from old.user_id
     or new.restaurant_id is distinct from old.restaurant_id
     or new.workspace_membership_id is distinct from old.workspace_membership_id then
    perform public.retire_membership_capability_grants(
      array[old.id], auth.uid(), 'site membership lifecycle changed', 'site_lifecycle'
    );
    new.lifecycle_generation := gen_random_uuid();
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_site_membership_capability_lifecycle()
  from public, anon, authenticated, service_role;

-- PostgreSQL sorts same-event triggers by name. This name sorts after the
-- existing 0152 memberships_link_workspace trigger and observes finalized NEW.
create trigger memberships_z_capability_lifecycle
  before insert or update or delete on public.memberships
  for each row execute function public.enforce_site_membership_capability_lifecycle();

create function public.enforce_workspace_membership_capability_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership_ids uuid[];
begin
  if tg_op = 'INSERT' then
    new.lifecycle_generation := gen_random_uuid();
    return new;
  end if;

  if tg_op = 'DELETE' then
    select coalesce(array_agg(distinct g.membership_id), array[]::uuid[])
      into v_membership_ids
      from public.membership_capability_grants g
     where g.workspace_membership_id = old.id
       and g.revoked_at is null;
    perform public.retire_membership_capability_grants(
      v_membership_ids, auth.uid(), 'workspace membership deleted', 'workspace_delete'
    );
    return old;
  end if;

  if new.lifecycle_generation is distinct from old.lifecycle_generation then
    raise exception 'C04_WORKSPACE_LIFECYCLE_GENERATION_FORGERY' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status
     or new.revoked_at is distinct from old.revoked_at
     or new.expires_at is distinct from old.expires_at
     or new.user_id is distinct from old.user_id
     or new.workspace_id is distinct from old.workspace_id then
    select coalesce(array_agg(distinct g.membership_id), array[]::uuid[])
      into v_membership_ids
      from public.membership_capability_grants g
     where g.workspace_membership_id = old.id
       and g.revoked_at is null;
    perform public.retire_membership_capability_grants(
      v_membership_ids, auth.uid(), 'workspace membership lifecycle changed',
      'workspace_lifecycle'
    );
    new.lifecycle_generation := gen_random_uuid();
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_workspace_membership_capability_lifecycle()
  from public, anon, authenticated, service_role;

create trigger workspace_memberships_z_capability_lifecycle
  before insert or update or delete on public.workspace_memberships
  for each row execute function public.enforce_workspace_membership_capability_lifecycle();

create function public.effective_site_capability(
  p_restaurant_id uuid,
  p_capability_key text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_capability_key in ('cost.read', 'margin.read', 'pricing.manage')
    and exists (
      select 1
        from public.membership_capability_grants g
        join public.memberships m
          on m.id = g.membership_id
         and m.user_id = g.subject_user_id
         and m.restaurant_id = g.restaurant_id
         and m.workspace_membership_id = g.workspace_membership_id
         and m.lifecycle_generation = g.site_lifecycle_generation
        join public.restaurants r
          on r.id = m.restaurant_id
         and r.id = g.restaurant_id
         and r.workspace_id = g.workspace_id
        join public.workspaces w
          on w.id = r.workspace_id
         and w.kind = 'restaurant'
        join public.workspace_memberships wm
          on wm.id = m.workspace_membership_id
         and wm.id = g.workspace_membership_id
         and wm.user_id = m.user_id
         and wm.user_id = g.subject_user_id
         and wm.workspace_id = r.workspace_id
         and wm.workspace_id = g.workspace_id
         and wm.lifecycle_generation = g.workspace_lifecycle_generation
       where g.subject_user_id = (select auth.uid())
         and g.restaurant_id = p_restaurant_id
         and g.capability_key = p_capability_key
         and g.revoked_at is null
         and (g.expires_at is null or g.expires_at > statement_timestamp())
         and m.status = 'active'
         and m.revoked_at is null
         and (m.expires_at is null or m.expires_at > statement_timestamp())
         and wm.status = 'active'
         and wm.revoked_at is null
         and (wm.expires_at is null or wm.expires_at > statement_timestamp())
    );
$$;

create function public.effective_site_ids(p_capability_key text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct g.restaurant_id
    from public.membership_capability_grants g
   where g.subject_user_id = (select auth.uid())
     and g.capability_key = p_capability_key
     and p_capability_key in ('cost.read', 'margin.read', 'pricing.manage')
     and public.effective_site_capability(g.restaurant_id, p_capability_key)
   order by g.restaurant_id;
$$;

create function public.replace_member_site_capabilities(
  p_membership_id uuid,
  p_capability_keys text[],
  p_expires_at timestamptz,
  p_grant_reason text
) returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace_id uuid;
  v_live_workspace_id uuid;
  v_target_workspace_membership_id uuid;
  v_caller_workspace_membership_id uuid;
  v_target public.memberships%rowtype;
  v_target_workspace_member public.workspace_memberships%rowtype;
  v_caller_workspace_member public.workspace_memberships%rowtype;
  v_keys text[];
  v_key text;
begin
  if v_actor is null then
    raise exception 'C04_CAPABILITY_REPLACEMENT_AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_capability_keys is null then
    raise exception 'C04_CAPABILITY_SET_REQUIRED' using errcode = 'P0001';
  end if;
  if p_grant_reason is null or btrim(p_grant_reason) = '' then
    raise exception 'C04_GRANT_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_expires_at is not null and p_expires_at <= statement_timestamp() then
    raise exception 'C04_GRANT_EXPIRY_NOT_FUTURE' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_capability_keys) as supplied(capability_key)
     where supplied.capability_key is null
  )
     or exists (
       select 1 from unnest(p_capability_keys) as supplied(capability_key)
        where supplied.capability_key not in (
          'cost.read', 'margin.read', 'pricing.manage'
        )
     ) then
    raise exception 'C04_CAPABILITY_KEY_UNKNOWN' using errcode = 'P0001';
  end if;
  if cardinality(p_capability_keys) <>
     (select count(distinct supplied.capability_key)
        from unnest(p_capability_keys) as supplied(capability_key)) then
    raise exception 'C04_CAPABILITY_SET_DUPLICATE' using errcode = 'P0001';
  end if;
  select coalesce(
    array_agg(supplied.capability_key order by supplied.capability_key),
    array[]::text[]
  ) into v_keys
    from unnest(p_capability_keys) as supplied(capability_key);

  select r.workspace_id, m.workspace_membership_id
    into v_workspace_id, v_target_workspace_membership_id
    from public.memberships m
    join public.restaurants r on r.id = m.restaurant_id
   where m.id = p_membership_id;
  if not found then
    raise exception 'C04_TARGET_MEMBERSHIP_NOT_FOUND' using errcode = 'P0001';
  end if;

  select wm.id into v_caller_workspace_membership_id
    from public.workspace_memberships wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_actor;
  if not found then
    raise exception 'C04_CALLER_NOT_GOVERNOR' using errcode = 'P0001';
  end if;

  perform 1 from public.workspaces w
   where w.id = v_workspace_id and w.kind = 'restaurant'
   for update;
  if not found then
    raise exception 'C04_TARGET_WORKSPACE_NOT_CURRENT' using errcode = 'P0001';
  end if;

  perform 1 from public.workspace_memberships wm
   where wm.id in (
     v_caller_workspace_membership_id, v_target_workspace_membership_id
   )
   order by wm.id
   for update;

  perform 1 from public.memberships m
   where m.id = p_membership_id
   for update;

  select m.* into v_target
    from public.memberships m where m.id = p_membership_id;
  select wm.* into v_target_workspace_member
    from public.workspace_memberships wm
   where wm.id = v_target_workspace_membership_id;
  select wm.* into v_caller_workspace_member
    from public.workspace_memberships wm
   where wm.id = v_caller_workspace_membership_id;

  if v_caller_workspace_member.id is null
     or v_caller_workspace_member.workspace_id is distinct from v_workspace_id
     or v_caller_workspace_member.user_id is distinct from v_actor
     or v_caller_workspace_member.governance_role is null
     or v_caller_workspace_member.governance_role not in (
       'workspace_owner', 'group_admin'
     )
     or v_caller_workspace_member.status <> 'active'
     or v_caller_workspace_member.revoked_at is not null
     or (v_caller_workspace_member.expires_at is not null
         and v_caller_workspace_member.expires_at <= statement_timestamp()) then
    raise exception 'C04_CALLER_NOT_GOVERNOR' using errcode = 'P0001';
  end if;

  select r.workspace_id into v_live_workspace_id
    from public.restaurants r where r.id = v_target.restaurant_id;
  if v_target.id is null
     or v_target.status <> 'active'
     or v_target.revoked_at is not null
     or (v_target.expires_at is not null
         and v_target.expires_at <= statement_timestamp())
     or v_target.workspace_membership_id is distinct from
        v_target_workspace_membership_id
     or v_live_workspace_id is distinct from v_workspace_id
     or v_target_workspace_member.id is null
     or v_target_workspace_member.id is distinct from
        v_target.workspace_membership_id
     or v_target_workspace_member.user_id is distinct from v_target.user_id
     or v_target_workspace_member.workspace_id is distinct from v_workspace_id
     or v_target_workspace_member.status <> 'active'
     or v_target_workspace_member.revoked_at is not null
     or (v_target_workspace_member.expires_at is not null
         and v_target_workspace_member.expires_at <= statement_timestamp())
     or v_caller_workspace_member.workspace_id is distinct from v_workspace_id then
    raise exception 'C04_TARGET_IDENTITY_NOT_CURRENT' using errcode = 'P0001';
  end if;

  perform public.retire_membership_capability_grants(
    array[p_membership_id], v_actor, p_grant_reason, 'governance_replacement'
  );

  foreach v_key in array v_keys loop
    insert into public.membership_capability_grants (
      workspace_id, restaurant_id, workspace_membership_id, membership_id,
      subject_user_id, site_lifecycle_generation,
      workspace_lifecycle_generation, capability_key, granted_by_user_id,
      grant_reason, expires_at
    ) values (
      v_workspace_id, v_target.restaurant_id, v_target.workspace_membership_id,
      v_target.id, v_target.user_id, v_target.lifecycle_generation,
      v_target_workspace_member.lifecycle_generation, v_key, v_actor,
      btrim(p_grant_reason), p_expires_at
    );
  end loop;

  return query
  select supplied.capability_key
    from unnest(v_keys) as supplied(capability_key)
   order by supplied.capability_key;
end;
$$;

create function public.read_pricing_recommendations(p_restaurant_id uuid)
returns table (
  wine_id uuid,
  class text,
  rationale text,
  evidence jsonb,
  timing text,
  computed_at timestamptz,
  wines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.effective_site_capability(p_restaurant_id, 'cost.read')
     or not public.effective_site_capability(p_restaurant_id, 'margin.read') then
    return;
  end if;

  return query
  select
    pr.wine_id,
    pr.class,
    pr.rationale,
    pr.evidence,
    pr.timing,
    pr.computed_at,
    jsonb_build_object(
      'name', w.name,
      'producer', w.producer,
      'vintage', w.vintage
    ) as wines
  from public.pricing_recommendations pr
  join public.wines w
    on w.id = pr.wine_id
   and w.restaurant_id = pr.restaurant_id
  where pr.restaurant_id = p_restaurant_id
  order by pr.class asc, pr.computed_at desc, pr.wine_id asc;
end;
$$;

revoke all on function public.effective_site_capability(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.effective_site_ids(text)
  from public, anon, authenticated, service_role;
revoke all on function public.replace_member_site_capabilities(uuid,text[],timestamptz,text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_pricing_recommendations(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.effective_site_capability(uuid,text)
  to authenticated;
grant execute on function public.effective_site_ids(text)
  to authenticated;
grant execute on function public.replace_member_site_capabilities(uuid,text[],timestamptz,text)
  to authenticated;
grant execute on function public.read_pricing_recommendations(uuid)
  to authenticated;

comment on table public.membership_capability_grants is
  'C04 additive authority A append-history; no direct Data API table access.';
comment on function public.effective_site_capability(uuid,text) is
  'C04 exact-site authority using live identity and both lifecycle generations.';
comment on function public.effective_site_ids(text) is
  'C04 explicitly granted current sites only; governance never implies site access.';
comment on function public.replace_member_site_capabilities(uuid,text[],timestamptz,text) is
  'C04 workspace-governed exact-set replacement with ordered immutable retirement.';
comment on function public.read_pricing_recommendations(uuid) is
  'C04 cost-and-margin gated reader; legacy direct SELECT remains during expand.';
