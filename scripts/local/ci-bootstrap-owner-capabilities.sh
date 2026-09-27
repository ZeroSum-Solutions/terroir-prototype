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

manifest=$(psql "$db_url" -X -Atq -v ON_ERROR_STOP=1 <<'SQL'
  -- The local seed is written after migration 0152. Its compatibility
  -- trigger links new site memberships to a workspace membership but, by
  -- design, never infers workspace governance from the legacy site role.
  -- Promote only the one named local fixture so the production bootstrap is
  -- exercised against the same explicit owner identity it requires.
  do $fixture$
  declare
    v_count integer;
  begin
    select count(*)
      into v_count
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where lower(u.email) = 'owner+local@terroir.test'
       and m.restaurant_id = 'de100000-0000-4000-8000-000000000001'::uuid
       and m.role = 'owner';
    if v_count <> 1 then
      raise exception 'CI_SEED_OWNER_IDENTITY_INVALID' using errcode = 'P0001';
    end if;

    update public.workspace_memberships wm
       set governance_role = 'workspace_owner'
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where wm.id = m.workspace_membership_id
       and lower(u.email) = 'owner+local@terroir.test'
       and m.restaurant_id = 'de100000-0000-4000-8000-000000000001'::uuid
       and m.role = 'owner'
       and wm.governance_role is distinct from 'workspace_owner';
  end;
  $fixture$;

  select jsonb_build_array(jsonb_build_object(
    'membership_id', m.id,
    'actor_user_id', m.user_id
  ))::text
    from public.memberships m
    join auth.users u on u.id = m.user_id
   where lower(u.email) = 'owner+local@terroir.test'
     and m.restaurant_id = 'de100000-0000-4000-8000-000000000001'::uuid
     and m.role = 'owner';
SQL
)
[ -n "$manifest" ] || {
  echo "ci-bootstrap-owner-capabilities: exact seed owner not found" >&2
  exit 2
}

psql "$db_url" -X -v ON_ERROR_STOP=1 --single-transaction \
  -v capability_manifest="$manifest" \
  -v expected_entry_count=1 \
  -f scripts/0154-production-capability-bootstrap.sql
