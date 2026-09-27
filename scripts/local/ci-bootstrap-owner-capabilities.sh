#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
[ "$PWD" = "$repo_root" ] || {
  echo "ci-bootstrap-owner-capabilities: run from $repo_root" >&2
  exit 2
}

db_url=$(supabase status -o env 2>/dev/null \
  | sed -n 's/^DB_URL="\(.*\)"$/\1/p')
case "$db_url" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo "ci-bootstrap-owner-capabilities: refusing non-loopback database" >&2; exit 2 ;;
esac

manifest_and_count=$(psql "$db_url" -X -Atq -v ON_ERROR_STOP=1 <<'SQL'
  -- The local seed is written after migration 0152. Its compatibility
  -- trigger links new site memberships to a workspace membership but, by
  -- design, never infers workspace governance from the legacy site role.
  -- Promote only the named owner in the two allowlisted local fixtures. The
  -- production-shaped site is optional because required CI seeds only the
  -- demo site, while full E2E seeds both before calling this script.
  do $fixture$
  declare
    v_demo_count integer;
    v_prodshape_count integer;
    v_prodshape_site_count integer;
  begin
    select count(*)
      into v_demo_count
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where lower(u.email) = 'owner+local@terroir.test'
       and m.restaurant_id = 'de100000-0000-4000-8000-000000000001'::uuid
       and m.role = 'owner';
    if v_demo_count <> 1 then
      raise exception 'CI_SEED_OWNER_IDENTITY_INVALID' using errcode = 'P0001';
    end if;

    select count(*)
      into v_prodshape_count
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where lower(u.email) = 'owner+local@terroir.test'
       and m.restaurant_id = 'de200000-0000-4000-8000-000000000001'::uuid
       and m.role = 'owner';
    select count(*)
      into v_prodshape_site_count
      from public.restaurants r
     where r.id = 'de200000-0000-4000-8000-000000000001'::uuid;
    if v_prodshape_count <> v_prodshape_site_count then
      raise exception 'CI_PRODSHAPE_OWNER_IDENTITY_INVALID' using errcode = 'P0001';
    end if;

    update public.workspace_memberships wm
       set governance_role = 'workspace_owner'
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where wm.id = m.workspace_membership_id
       and lower(u.email) = 'owner+local@terroir.test'
       and m.restaurant_id in (
         'de100000-0000-4000-8000-000000000001'::uuid,
         'de200000-0000-4000-8000-000000000001'::uuid
       )
       and m.role = 'owner'
       and wm.governance_role is distinct from 'workspace_owner';
  end;
  $fixture$;

  select coalesce(jsonb_agg(jsonb_build_object(
    'membership_id', m.id,
    'actor_user_id', m.user_id
  ) order by m.restaurant_id), '[]'::jsonb)::text
    from public.memberships m
    join auth.users u on u.id = m.user_id
   where lower(u.email) = 'owner+local@terroir.test'
     and m.restaurant_id in (
       'de100000-0000-4000-8000-000000000001'::uuid,
       'de200000-0000-4000-8000-000000000001'::uuid
     )
     and m.role = 'owner';

  select count(*)
    from public.memberships m
    join auth.users u on u.id = m.user_id
   where lower(u.email) = 'owner+local@terroir.test'
     and m.restaurant_id in (
       'de100000-0000-4000-8000-000000000001'::uuid,
       'de200000-0000-4000-8000-000000000001'::uuid
     )
     and m.role = 'owner';
SQL
)
manifest=$(printf '%s\n' "$manifest_and_count" | sed -n '1p')
expected_entry_count=$(printf '%s\n' "$manifest_and_count" | sed -n '2p')
[ -n "$manifest" ] || {
  echo "ci-bootstrap-owner-capabilities: exact seed owner not found" >&2
  exit 2
}
case "$expected_entry_count" in
  1|2) ;;
  *) echo "ci-bootstrap-owner-capabilities: unexpected owner count '$expected_entry_count'" >&2; exit 2 ;;
esac

psql "$db_url" -X -v ON_ERROR_STOP=1 --single-transaction \
  -v capability_manifest="$manifest" \
  -v expected_entry_count="$expected_entry_count" \
  -f scripts/0154-production-capability-bootstrap.sql
