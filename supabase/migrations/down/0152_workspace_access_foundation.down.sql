-- DRAFT ONLY -- DO NOT APPLY FROM THIS LOCATION.
-- Reverse C04 Slice 1 only when every surviving row is exactly representable
-- by the legacy singleton restaurant/membership model.

begin;

lock table auth.users
  in access exclusive mode nowait;
lock table
  public.workspaces,
  public.restaurants,
  public.workspace_memberships,
  public.memberships
in access exclusive mode nowait;

do $down_guard$
begin
  -- Personal, grouped, reassigned, or intentionally preserved empty
  -- workspaces have no lossless representation in the legacy schema.
  if exists (
    select 1
      from public.workspaces w
      left join lateral (
        select count(*)::int as site_count
          from public.restaurants r
         where r.workspace_id = w.id
      ) sites on true
     where w.kind <> 'restaurant'
        or w.expanded_at is not null
        or sites.site_count <> 1
        or not exists (
          select 1 from public.restaurants r
           where r.workspace_id = w.id and r.id = w.id
        )
  ) then
    raise exception 'cannot_down_0152_workspace_access_not_legacy_representable'
      using errcode = 'P0001';
  end if;

  -- Every workspace member must correspond one-to-one with the singleton
  -- site's legacy membership, with lifecycle defaults and exactly derivable
  -- governance. A group-only member or governance difference is meaningful.
  if exists (
    select 1
      from public.workspace_memberships wm
      join public.restaurants r on r.workspace_id = wm.workspace_id
      left join public.memberships m
        on m.restaurant_id = r.id
       and m.user_id = wm.user_id
     where m.id is null
        or wm.status <> 'active'
        or wm.expires_at is not null
        or wm.revoked_at is not null
        or wm.created_by is not null
        or wm.governance_role is distinct from case
          when m.role = 'owner' then 'workspace_owner'::text
          else null::text
        end
  ) then
    raise exception 'cannot_down_0152_workspace_access_not_legacy_representable'
      using errcode = 'P0001';
  end if;

  -- Site lifecycle/provenance and any containment mismatch would be silently
  -- lost by dropping the new columns.
  if exists (
    select 1
      from public.memberships m
      join public.restaurants r on r.id = m.restaurant_id
      left join public.workspace_memberships wm
        on wm.id = m.workspace_membership_id
       and wm.workspace_id = r.workspace_id
       and wm.user_id = m.user_id
     where wm.id is null
        or m.status <> 'active'
        or m.expires_at is not null
        or m.revoked_at is not null
        or m.granted_by is not null
  ) then
    raise exception 'cannot_down_0152_workspace_access_not_legacy_representable'
      using errcode = 'P0001';
  end if;
end;
$down_guard$;

drop function public.shadow_effective_site_ids(text);
drop function public.shadow_has_site_capability(uuid, text);
drop function public.shadow_effective_site_access(uuid);

-- Restore the exact 0053 signup function before removing the compatibility
-- columns and triggers it currently uses.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_restaurant_id uuid;
  restaurant_name   text;
begin
  restaurant_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'restaurant_name'), ''),
    'My Restaurant'
  );

  insert into public.restaurants (name)
  values (restaurant_name)
  returning id into new_restaurant_id;

  insert into public.memberships (user_id, restaurant_id, role)
  values (new.id, new_restaurant_id, 'owner');

  perform public.seed_reason_codes(new_restaurant_id);
  return new;
end;
$$;

drop trigger restaurants_finish_derived_workspace_cleanup on public.restaurants;
drop trigger restaurants_prepare_derived_workspace_cleanup on public.restaurants;
drop function public.finish_derived_workspace_cleanup();
drop function public.prepare_derived_workspace_cleanup();

drop trigger memberships_link_workspace on public.memberships;
drop function public.link_membership_to_workspace();

drop trigger workspace_memberships_guard_identity on public.workspace_memberships;
drop function public.guard_workspace_membership_identity();

drop trigger restaurants_guard_workspace_assignment on public.restaurants;
drop function public.guard_restaurant_workspace_assignment();
drop trigger restaurants_ensure_workspace on public.restaurants;
drop function public.ensure_restaurant_workspace();

drop index public.memberships_granted_by_idx;
drop index public.memberships_workspace_membership_id_idx;

alter table public.memberships
  drop constraint memberships_granted_by_fkey,
  drop constraint memberships_workspace_membership_fkey,
  drop constraint memberships_revocation_pair_check,
  drop constraint memberships_status_check,
  drop column granted_by,
  drop column revoked_at,
  drop column expires_at,
  drop column status,
  drop column workspace_membership_id;

drop index public.restaurants_workspace_id_idx;
alter table public.restaurants
  drop constraint restaurants_workspace_kind_fkey,
  drop column workspace_kind,
  drop column workspace_id;

drop table public.workspace_memberships;
drop table public.workspaces;

commit;
