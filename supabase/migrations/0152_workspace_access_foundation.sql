-- DRAFT ONLY -- DO NOT APPLY FROM THIS LOCATION.
--
-- C04 Slice 1: additive workspace/site-access foundation and shadow capability
-- helpers. Existing memberships, is_member*, member_restaurant_ids*, RLS,
-- route guards, and role behavior remain authoritative.

-- This file requires one outer transaction. Production uses psql
-- --single-transaction and the isolated rehearsal uses psql -1. Fail before
-- any DDL unless auth writers and all readers/writers of the two tables altered
-- below have drained. This is an explicit maintenance-window boundary, not a
-- zero-downtime migration claim.
lock table auth.users
  in share row exclusive mode nowait;
lock table public.restaurants, public.memberships
  in access exclusive mode nowait;

create table public.workspaces (
  id          uuid        primary key default gen_random_uuid(),
  kind        text        not null check (kind in ('restaurant', 'personal')),
  name        text        not null,
  expanded_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint workspaces_id_kind_key unique (id, kind)
);

alter table public.workspaces enable row level security;
revoke all on table public.workspaces from public, anon, authenticated;
grant select, insert, update, delete on table public.workspaces to service_role;

create table public.workspace_memberships (
  id               uuid        primary key default gen_random_uuid(),
  workspace_id     uuid        not null,
  user_id          uuid        not null,
  governance_role  text        check (governance_role in ('workspace_owner', 'group_admin')),
  status            text        not null default 'active'
                                check (status in ('active', 'revoked')),
  expires_at        timestamptz,
  revoked_at        timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  constraint workspace_memberships_workspace_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint workspace_memberships_user_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint workspace_memberships_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint workspace_memberships_workspace_user_key unique (workspace_id, user_id),
  constraint workspace_memberships_revocation_pair_check check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

create index workspace_memberships_user_id_idx
  on public.workspace_memberships (user_id);
create index workspace_memberships_created_by_idx
  on public.workspace_memberships (created_by)
  where created_by is not null;

alter table public.workspace_memberships enable row level security;
revoke all on table public.workspace_memberships from public, anon, authenticated;
grant select, insert, update, delete on table public.workspace_memberships to service_role;

alter table public.restaurants
  add column workspace_id uuid,
  add column workspace_kind text generated always as ('restaurant'::text) stored;

alter table public.memberships
  add column workspace_membership_id uuid,
  add column status text not null default 'active',
  add column expires_at timestamptz,
  add column revoked_at timestamptz,
  add column granted_by uuid;

-- Old restaurant inserts omit workspace_id. Default UUIDs have already been
-- evaluated before this BEFORE trigger runs, so NEW.id is the deterministic
-- singleton workspace identity.
create or replace function public.ensure_restaurant_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.workspace_id is null then
    insert into public.workspaces (id, kind, name, created_at)
    values (new.id, 'restaurant', new.name, new.created_at)
    on conflict (id) do nothing;

    new.workspace_id := new.id;
  elsif new.id <> new.workspace_id then
    -- Remember that this workspace has ever contained a non-identity site.
    -- Current sibling counts alone cannot distinguish a never-grouped
    -- singleton after a former group's other sites have been deleted.
    update public.workspaces w
       set expanded_at = coalesce(w.expanded_at, statement_timestamp())
     where w.id = new.workspace_id
       and w.kind = 'restaurant';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_restaurant_workspace() from public;

create trigger restaurants_ensure_workspace
  before insert on public.restaurants
  for each row execute function public.ensure_restaurant_workspace();

create or replace function public.guard_restaurant_workspace_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- OLD may be null only during this migration's one-time backfill.
  if old.workspace_id is not null
     and old.workspace_id is distinct from new.workspace_id then
    raise exception 'workspace_reassignment_requires_review' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_restaurant_workspace_assignment() from public;

create trigger restaurants_guard_workspace_assignment
  before update of workspace_id on public.restaurants
  for each row execute function public.guard_restaurant_workspace_assignment();

insert into public.workspaces (id, kind, name, created_at)
select r.id, 'restaurant', r.name, r.created_at
  from public.restaurants r
on conflict (id) do nothing;

-- Adding containment metadata must not make every existing restaurant appear
-- freshly edited. The preceding ALTER TABLE lock is held to transaction end,
-- so no writer can enter while only this named timestamp trigger is disabled.
alter table public.restaurants disable trigger restaurants_set_updated_at;
update public.restaurants
   set workspace_id = id
 where workspace_id is null;
alter table public.restaurants enable trigger restaurants_set_updated_at;

-- A workspace membership identity cannot be retargeted after a site grant has
-- been linked to it.
create or replace function public.guard_workspace_membership_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.workspace_id is distinct from new.workspace_id
     or old.user_id is distinct from new.user_id then
    raise exception 'workspace_membership_identity_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_workspace_membership_identity() from public;

create trigger workspace_memberships_guard_identity
  before update of workspace_id, user_id on public.workspace_memberships
  for each row execute function public.guard_workspace_membership_identity();

-- Compatibility and containment for old membership inserts. The outer table
-- policy remains the authenticated authorization check; this trigger derives
-- identity/provenance and never grants governance or reactivates a row.
create or replace function public.link_membership_to_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id           uuid;
  v_workspace_membership   public.workspace_memberships%rowtype;
  v_actor                  uuid := auth.uid();
  v_backfill_link_update   boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.granted_by is distinct from old.granted_by then
      -- The FK's provenance-only ON DELETE SET NULL action sees its deleted
      -- auth parent as absent. Return before any site/workspace lock. A caller
      -- cannot clear or replace a still-existing granter.
      if old.granted_by is not null
         and new.granted_by is null
         and (to_jsonb(new) - 'granted_by') = (to_jsonb(old) - 'granted_by')
         and not exists (
           select 1 from auth.users u where u.id = old.granted_by
         ) then
        return new;
      end if;
      raise exception 'membership_grant_provenance_immutable' using errcode = 'P0001';
    end if;

    -- The only identity update admitted is this migration's one-time nullable
    -- link backfill. After NOT NULL is validated, moving a site grant is
    -- delete+insert; rejecting retargeting also avoids row->restaurant lock
    -- inversion with restaurant cleanup.
    v_backfill_link_update := old.workspace_membership_id is null
      and new.workspace_membership_id is not null
      and new.user_id is not distinct from old.user_id
      and new.restaurant_id is not distinct from old.restaurant_id;

    if not v_backfill_link_update then
      if new.user_id is distinct from old.user_id
         or new.restaurant_id is distinct from old.restaurant_id
         or new.workspace_membership_id is distinct from old.workspace_membership_id then
        raise exception 'membership_identity_immutable' using errcode = 'P0001';
      end if;
      return new;
    end if;
  end if;

  -- A legacy INSERT's outer restaurant FK has not fired yet. Take its parent
  -- KEY SHARE lock before inserting/reusing a workspace member (whose FK takes
  -- workspace KEY SHARE), matching restaurant cleanup's restaurant->workspace
  -- order and preventing the inverse wait cycle.
  select r.workspace_id
    into v_workspace_id
    from public.restaurants r
   where r.id = new.restaurant_id
   for key share;
  if v_workspace_id is null then
    raise exception 'membership_workspace_link_mismatch' using errcode = 'P0001';
  end if;

  if new.workspace_membership_id is null then
    insert into public.workspace_memberships (
      workspace_id, user_id, governance_role, created_by
    ) values (
      v_workspace_id, new.user_id, null, v_actor
    )
    on conflict (workspace_id, user_id) do nothing;

    select *
      into v_workspace_membership
      from public.workspace_memberships wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = new.user_id;
  else
    select *
      into v_workspace_membership
      from public.workspace_memberships wm
     where wm.id = new.workspace_membership_id;
  end if;

  if not found
     or v_workspace_membership.workspace_id <> v_workspace_id
     or v_workspace_membership.user_id <> new.user_id then
    raise exception 'membership_workspace_link_mismatch' using errcode = 'P0001';
  end if;

  new.workspace_membership_id := v_workspace_membership.id;
  if tg_op = 'INSERT' then
    -- Ignore caller-supplied provenance. Authenticated legacy inserts record
    -- their own JWT subject; service/trigger contexts remain null.
    new.granted_by := v_actor;
  else
    new.granted_by := old.granted_by;
  end if;

  return new;
end;
$$;

revoke all on function public.link_membership_to_workspace() from public;

create trigger memberships_link_workspace
  before insert or update of user_id, restaurant_id, workspace_membership_id, granted_by
  on public.memberships
  for each row execute function public.link_membership_to_workspace();

insert into public.workspace_memberships (
  workspace_id, user_id, governance_role, created_at
)
select
  r.workspace_id,
  m.user_id,
  case when bool_or(m.role = 'owner') then 'workspace_owner' end,
  min(m.created_at)
from public.memberships m
join public.restaurants r on r.id = m.restaurant_id
group by r.workspace_id, m.user_id
on conflict (workspace_id, user_id) do nothing;

-- A concurrent old-style owner insert may have created the row with null
-- governance. The migration may promote only the governance exactly derivable
-- from an existing singleton-site owner grant.
update public.workspace_memberships wm
   set governance_role = 'workspace_owner'
 where wm.governance_role is null
   and exists (
     select 1
       from public.restaurants r
       join public.memberships m on m.restaurant_id = r.id
      where r.workspace_id = wm.workspace_id
        and m.user_id = wm.user_id
        and m.role = 'owner'
   );

update public.memberships m
   set workspace_membership_id = wm.id
  from public.restaurants r,
       public.workspace_memberships wm
 where r.id = m.restaurant_id
   and wm.workspace_id = r.workspace_id
   and wm.user_id = m.user_id
   and m.workspace_membership_id is null;

do $foundation_assertions$
begin
  if exists (
    select 1
      from public.restaurants r
      left join public.workspaces w
        on w.id = r.workspace_id and w.kind = 'restaurant'
     where r.workspace_id is null or w.id is null
  ) then
    raise exception 'workspace_backfill_restaurant_mismatch' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.memberships m
      join public.restaurants r on r.id = m.restaurant_id
      left join public.workspace_memberships wm
        on wm.id = m.workspace_membership_id
       and wm.workspace_id = r.workspace_id
       and wm.user_id = m.user_id
     where wm.id is null
  ) then
    raise exception 'workspace_backfill_membership_mismatch' using errcode = 'P0001';
  end if;
end;
$foundation_assertions$;

alter table public.restaurants
  add constraint restaurants_workspace_kind_fkey
    foreign key (workspace_id, workspace_kind)
    references public.workspaces(id, kind)
    on delete restrict
    not valid;
alter table public.restaurants validate constraint restaurants_workspace_kind_fkey;
alter table public.restaurants alter column workspace_id set not null;
create index restaurants_workspace_id_idx on public.restaurants (workspace_id);

alter table public.memberships
  add constraint memberships_status_check
    check (status in ('active', 'revoked')) not valid,
  add constraint memberships_revocation_pair_check
    check ((status = 'revoked') = (revoked_at is not null)) not valid,
  add constraint memberships_workspace_membership_fkey
    foreign key (workspace_membership_id)
    references public.workspace_memberships(id)
    on delete no action
    not valid,
  add constraint memberships_granted_by_fkey
    foreign key (granted_by)
    references auth.users(id)
    on delete set null
    not valid;

alter table public.memberships validate constraint memberships_status_check;
alter table public.memberships validate constraint memberships_revocation_pair_check;
alter table public.memberships validate constraint memberships_workspace_membership_fkey;
alter table public.memberships validate constraint memberships_granted_by_fkey;
alter table public.memberships alter column workspace_membership_id set not null;

create index memberships_workspace_membership_id_idx
  on public.memberships (workspace_membership_id);
create index memberships_granted_by_idx
  on public.memberships (granted_by)
  where granted_by is not null;

-- Legacy restaurant deletion compatibility. This is not a general account-
-- erasure API. It removes a workspace only when every row is provably derived
-- from the deterministic singleton site being deleted.
create or replace function public.prepare_derived_workspace_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.workspace_id <> old.id then
    return old;
  end if;

  perform 1
    from public.workspaces w
   where w.id = old.workspace_id
     and w.kind = 'restaurant'
     and w.expanded_at is null
   for update;
  if not found then
    return old;
  end if;

  if exists (
    select 1 from public.restaurants r
     where r.workspace_id = old.workspace_id and r.id <> old.id
  ) then
    return old;
  end if;

  perform 1
    from public.memberships m
   where m.restaurant_id = old.id
   order by m.id
   for update;
  perform 1
    from public.workspace_memberships wm
   where wm.workspace_id = old.workspace_id
   order by wm.id
   for update;

  if exists (
    select 1
      from public.workspace_memberships wm
     where wm.workspace_id = old.workspace_id
       and (
         wm.status <> 'active'
         or wm.expires_at is not null
         or wm.revoked_at is not null
         or wm.governance_role = 'group_admin'
         or not exists (
           select 1 from public.memberships m
            where m.restaurant_id = old.id
              and m.user_id = wm.user_id
         )
         or (
           wm.governance_role = 'workspace_owner'
           and not exists (
             select 1 from public.memberships m
              where m.restaurant_id = old.id
                and m.user_id = wm.user_id
                and m.role = 'owner'
           )
         )
       )
  ) or exists (
    select 1
      from public.memberships m
     where m.restaurant_id = old.id
       and (
         m.status <> 'active'
         or m.expires_at is not null
         or m.revoked_at is not null
       )
  ) then
    return old;
  end if;

  delete from public.memberships where restaurant_id = old.id;
  delete from public.workspace_memberships where workspace_id = old.workspace_id;
  return old;
end;
$$;

revoke all on function public.prepare_derived_workspace_cleanup() from public;

create trigger restaurants_prepare_derived_workspace_cleanup
  before delete on public.restaurants
  for each row execute function public.prepare_derived_workspace_cleanup();

create or replace function public.finish_derived_workspace_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.workspace_id = old.id then
    delete from public.workspaces w
     where w.id = old.workspace_id
       and w.kind = 'restaurant'
       and w.expanded_at is null
       and not exists (
         select 1 from public.restaurants r where r.workspace_id = w.id
       )
       and not exists (
         select 1 from public.workspace_memberships wm where wm.workspace_id = w.id
       );
  end if;
  return old;
end;
$$;

revoke all on function public.finish_derived_workspace_cleanup() from public;

create trigger restaurants_finish_derived_workspace_cleanup
  after delete on public.restaurants
  for each row execute function public.finish_derived_workspace_cleanup();

-- Preserve the exact 0053 naming and reason-code behavior. Auth metadata
-- cannot select workspace identity/kind/governance, site role, or lifecycle.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_restaurant_id          uuid;
  new_workspace_id           uuid;
  new_workspace_member_id    uuid;
  restaurant_name            text;
begin
  restaurant_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'restaurant_name'), ''),
    'My Restaurant'
  );

  insert into public.restaurants (name)
  values (restaurant_name)
  returning id, workspace_id into new_restaurant_id, new_workspace_id;

  insert into public.workspace_memberships (
    workspace_id, user_id, governance_role, created_by
  ) values (
    new_workspace_id, new.id, 'workspace_owner', new.id
  )
  returning id into new_workspace_member_id;

  insert into public.memberships (
    user_id, restaurant_id, role, workspace_membership_id
  ) values (
    new.id, new_restaurant_id, 'owner', new_workspace_member_id
  );

  perform public.seed_reason_codes(new_restaurant_id);
  return new;
end;
$$;

create or replace function public.shadow_effective_site_access(p_restaurant_id uuid)
returns table (
  restaurant_id  uuid,
  workspace_id   uuid,
  legacy_role    public.membership_role,
  preset_key     text,
  capabilities   text[],
  access_source  text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.workspace_id,
    m.role,
    case m.role
      when 'owner' then 'site_owner'
      when 'manager' then 'beverage_manager'
      when 'staff' then 'service_staff'
    end,
    case m.role
      when 'owner' then
        array[
          'site.read', 'inventory.service', 'inventory.manage',
          'receiving.capture', 'receiving.cost_capture', 'count.capture',
          'discrepancy.approve', 'cost.read', 'margin.read',
          'pricing.manage', 'team.site.manage'
        ]::text[] || case
          when wm.governance_role in ('workspace_owner', 'group_admin')
            then array['group.manage']::text[]
          else array[]::text[]
        end
      when 'manager' then array[
        'site.read', 'inventory.service', 'inventory.manage',
        'receiving.capture', 'receiving.cost_capture', 'count.capture',
        'discrepancy.approve', 'cost.read', 'margin.read', 'pricing.manage'
      ]::text[]
      when 'staff' then array['site.read', 'inventory.service']::text[]
    end,
    'explicit_site_membership'::text
  from public.memberships m
  join public.restaurants r on r.id = m.restaurant_id
  join public.workspaces w
    on w.id = r.workspace_id and w.kind = 'restaurant'
  join public.workspace_memberships wm
    on wm.id = m.workspace_membership_id
   and wm.workspace_id = r.workspace_id
   and wm.user_id = m.user_id
  where m.user_id = (select auth.uid())
    and m.restaurant_id = p_restaurant_id
    and m.status = 'active'
    and m.revoked_at is null
    and (m.expires_at is null or m.expires_at > now())
    and wm.status = 'active'
    and wm.revoked_at is null
    and (wm.expires_at is null or wm.expires_at > now());
$$;

create or replace function public.shadow_has_site_capability(
  p_restaurant_id uuid,
  p_capability_key text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_capability_key is null or p_capability_key not in (
      'site.read', 'inventory.service', 'inventory.manage',
      'receiving.capture', 'receiving.cost_capture', 'count.capture',
      'discrepancy.approve', 'cost.read', 'margin.read',
      'pricing.manage', 'team.site.manage', 'group.manage'
    ) then false
    else coalesce((
      select p_capability_key = any(a.capabilities)
        from public.shadow_effective_site_access(p_restaurant_id) a
    ), false)
  end;
$$;

create or replace function public.shadow_effective_site_ids(p_capability_key text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct a.restaurant_id
    from public.memberships m
    cross join lateral public.shadow_effective_site_access(m.restaurant_id) a
   where m.user_id = (select auth.uid())
     and p_capability_key in (
       'site.read', 'inventory.service', 'inventory.manage',
       'receiving.capture', 'receiving.cost_capture', 'count.capture',
       'discrepancy.approve', 'cost.read', 'margin.read',
       'pricing.manage', 'team.site.manage', 'group.manage'
     )
     and p_capability_key = any(a.capabilities)
   order by a.restaurant_id;
$$;

comment on function public.shadow_effective_site_access(uuid) is
  'C04 Slice 1 observational result only. Legacy membership helpers and RLS remain authoritative.';
comment on function public.shadow_has_site_capability(uuid, text) is
  'C04 Slice 1 observational result only. Unknown capability keys return false.';
comment on function public.shadow_effective_site_ids(text) is
  'C04 Slice 1 observational explicit-site list only; workspace membership never grants a site.';

revoke all on function public.shadow_effective_site_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.shadow_has_site_capability(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.shadow_effective_site_ids(text)
  from public, anon, authenticated, service_role;

grant execute on function public.shadow_effective_site_access(uuid)
  to authenticated, service_role;
grant execute on function public.shadow_has_site_capability(uuid, text)
  to authenticated, service_role;
grant execute on function public.shadow_effective_site_ids(text)
  to authenticated, service_role;
