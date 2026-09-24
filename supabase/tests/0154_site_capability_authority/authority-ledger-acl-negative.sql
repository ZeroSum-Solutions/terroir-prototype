\set ON_ERROR_STOP on
\pset pager off

begin;
set local role authenticated;

do $acl$
declare
  v_denials integer := 0;
begin
  begin
    insert into public.membership_capability_grants(
      workspace_id, restaurant_id, workspace_membership_id, membership_id,
      subject_user_id, site_lifecycle_generation,
      workspace_lifecycle_generation, capability_key, granted_by_user_id,
      grant_reason
    ) values (
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'cost.read',
      gen_random_uuid(), 'must be denied'
    );
  exception when insufficient_privilege then v_denials := v_denials + 1;
  end;
  begin
    update public.membership_capability_grants set grant_reason = 'must be denied';
  exception when insufficient_privilege then v_denials := v_denials + 1;
  end;
  begin
    delete from public.membership_capability_grants;
  exception when insufficient_privilege then v_denials := v_denials + 1;
  end;
  begin
    update public.workspace_memberships set governance_role = null;
  exception when insufficient_privilege then v_denials := v_denials + 1;
  end;
  if v_denials <> 4 then
    raise exception 'C04_0154_DIRECT_DML_DENIAL_COUNT: %', v_denials;
  end if;
end;
$acl$;

reset role;
rollback;

\echo C04_0154_LEDGER_ACL_NEGATIVE_PASS
