\set ON_ERROR_STOP on
\pset pager off

do $acceptance$
begin
  if (select status from public.memberships
       where id = '15400000-0000-4000-8000-000000000014') <> 'revoked'
     or (select status from public.workspace_memberships
          where id = '15400000-0000-4000-8000-000000000013') <> 'revoked' then
    raise exception 'C04_0154_PARENT_RACE_DID_NOT_COMMIT_BOTH';
  end if;
  if (select count(*) from public.membership_capability_grants
       where membership_id = '15400000-0000-4000-8000-000000000014') <> 2
     or (select count(*) from public.membership_capability_grants
          where membership_id = '15400000-0000-4000-8000-000000000014'
            and revoked_at is not null) <> 2
     or (select count(distinct revoke_cause)
           from public.membership_capability_grants
          where membership_id = '15400000-0000-4000-8000-000000000014') <> 1
     or (select min(revoke_cause)
           from public.membership_capability_grants
          where membership_id = '15400000-0000-4000-8000-000000000014')
        not in ('site_lifecycle', 'workspace_lifecycle') then
    raise exception 'C04_0154_PARENT_RACE_RETIREMENT_NOT_FINAL_ONCE';
  end if;
  perform set_config(
    'request.jwt.claim.sub', '15400000-0000-4000-8000-000000000002', true
  );
  if public.effective_site_capability(
    '15400000-0000-4000-8000-000000000011', 'cost.read'
  ) then
    raise exception 'C04_0154_PARENT_RACE_LEFT_EFFECTIVE_GRANT';
  end if;
end;
$acceptance$;

\echo C04_0154_LIFECYCLE_RACE_ACCEPTANCE_PASS
