\set ON_ERROR_STOP on
\pset pager off

begin;

do $semantics$
declare
  v_actor uuid := gen_random_uuid();
  v_subject uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_mismatch_user uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_site_a uuid := gen_random_uuid();
  v_site_b uuid := gen_random_uuid();
  v_actor_wm uuid;
  v_subject_wm uuid;
  v_subject_membership uuid;
  v_other_wm uuid;
  v_generation uuid;
  v_workspace_generation uuid;
  v_expired_grant_id uuid;
  v_site_ids uuid[];
  v_grant_count integer;
  v_error text;
begin
  insert into auth.users(id, email) values
    (v_actor, 'c04-a-actor-' || v_actor || '@terroir.test'),
    (v_subject, 'c04-a-subject-' || v_subject || '@terroir.test'),
    (v_other, 'c04-a-other-' || v_other || '@terroir.test'),
    (v_mismatch_user, 'c04-a-mismatch-' || v_mismatch_user || '@terroir.test');
  insert into public.workspaces(id, kind, name)
    values (v_workspace, 'restaurant', 'C04 authority semantics');
  insert into public.restaurants(id, name, workspace_id) values
    (v_site_a, 'C04 site A', v_workspace),
    (v_site_b, 'C04 site B', v_workspace);
  insert into public.workspace_memberships(
    workspace_id, user_id, governance_role
  ) values (v_workspace, v_actor, 'workspace_owner') returning id into v_actor_wm;
  insert into public.workspace_memberships(workspace_id, user_id)
    values (v_workspace, v_subject) returning id into v_subject_wm;
  insert into public.workspace_memberships(workspace_id, user_id)
    values (v_workspace, v_other) returning id into v_other_wm;
  insert into public.memberships(
    user_id, restaurant_id, role, workspace_membership_id
  ) values (v_subject, v_site_a, 'staff', v_subject_wm)
  returning id into v_subject_membership;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.replace_member_site_capabilities(
    v_subject_membership,
    array['cost.read', 'margin.read'],
    null,
    'C04 semantics baseline'
  );

  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if not public.effective_site_capability(v_site_a, 'cost.read')
     or public.effective_site_capability(v_site_b, 'cost.read')
     or public.effective_site_capability(v_site_a, 'invented.capability') then
    raise exception 'C04_0154_EXACT_SITE_OR_VOCABULARY_FAILURE';
  end if;
  select coalesce(array_agg(site_id order by site_id), array[]::uuid[])
    into v_site_ids
    from public.effective_site_ids('cost.read') as sites(site_id);
  if v_site_ids is distinct from array[v_site_a]
     or exists (select 1 from public.effective_site_ids('invented.capability')) then
    raise exception 'C04_0154_EFFECTIVE_SITE_IDS_SUBJECT_FAILURE';
  end if;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  if public.effective_site_capability(v_site_a, 'cost.read')
     or exists (select 1 from public.effective_site_ids('cost.read'))
     or exists (select 1 from public.effective_site_ids('invented.capability')) then
    raise exception 'C04_0154_GOVERNANCE_IMPLIED_SITE_AUTHORITY';
  end if;

  select lifecycle_generation into v_generation
    from public.memberships where id = v_subject_membership;
  select count(*) into v_grant_count
    from public.membership_capability_grants
   where membership_id = v_subject_membership;
  begin
    update public.memberships set lifecycle_generation = gen_random_uuid()
     where id = v_subject_membership;
    raise exception 'C04_EXPECTED_SITE_GENERATION_FORGERY_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'C04_SITE_LIFECYCLE_GENERATION_FORGERY' then raise; end if;
  end;
  if (select lifecycle_generation from public.memberships
       where id = v_subject_membership) <> v_generation
     or (select count(*) from public.membership_capability_grants
          where membership_id = v_subject_membership) <> v_grant_count then
    raise exception 'C04_0154_GENERATION_FORGERY_MUTATED_STATE';
  end if;

  select lifecycle_generation into v_workspace_generation
    from public.workspace_memberships where id = v_subject_wm;
  begin
    update public.workspace_memberships
       set lifecycle_generation = gen_random_uuid()
     where id = v_subject_wm;
    raise exception 'C04_EXPECTED_WORKSPACE_GENERATION_FORGERY_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'C04_WORKSPACE_LIFECYCLE_GENERATION_FORGERY' then raise; end if;
  end;
  if (select lifecycle_generation from public.workspace_memberships
       where id = v_subject_wm) <> v_workspace_generation
     or (select count(*) from public.membership_capability_grants
          where membership_id = v_subject_membership) <> v_grant_count then
    raise exception 'C04_0154_WORKSPACE_GENERATION_FORGERY_MUTATED_STATE';
  end if;

  begin
    update public.membership_capability_grants set grant_reason = 'forged'
     where membership_id = v_subject_membership and capability_key = 'cost.read';
    raise exception 'C04_EXPECTED_LEDGER_UPDATE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'C04_CAPABILITY_GRANT_HISTORY_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from public.membership_capability_grants
     where membership_id = v_subject_membership and capability_key = 'cost.read';
    raise exception 'C04_EXPECTED_LEDGER_DELETE_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'C04_CAPABILITY_GRANT_HISTORY_DELETE_FORBIDDEN' then raise; end if;
  end;

  begin
    insert into public.membership_capability_grants(
      workspace_id, restaurant_id, workspace_membership_id, membership_id,
      subject_user_id, site_lifecycle_generation,
      workspace_lifecycle_generation, capability_key, granted_by_user_id,
      grant_reason
    ) select
      v_workspace, v_site_a, v_subject_wm, m.id, v_subject,
      m.lifecycle_generation, wm.lifecycle_generation, 'cost.read', v_actor,
      'duplicate current grant'
    from public.memberships m join public.workspace_memberships wm
      on wm.id = m.workspace_membership_id where m.id = v_subject_membership;
    raise exception 'C04_EXPECTED_PARTIAL_UNIQUENESS_REFUSAL';
  exception when unique_violation then null;
  end;

  foreach v_error in array array[
    'user_id', 'restaurant_id', 'workspace_membership_id'
  ] loop
    begin
      if v_error = 'user_id' then
        update public.memberships set user_id = v_other
         where id = v_subject_membership;
      elsif v_error = 'restaurant_id' then
        update public.memberships set restaurant_id = v_site_b
         where id = v_subject_membership;
      else
        update public.memberships set workspace_membership_id = v_other_wm
         where id = v_subject_membership;
      end if;
      raise exception 'C04_EXPECTED_0152_SITE_REPOINT_REFUSAL';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_error = message_text;
      if v_error <> 'membership_identity_immutable' then raise; end if;
    end;
  end loop;
  if (select lifecycle_generation from public.memberships
       where id = v_subject_membership) <> v_generation
     or (select count(*) from public.membership_capability_grants
          where membership_id = v_subject_membership) <> v_grant_count then
    raise exception 'C04_0154_REPOINT_REFUSAL_MUTATED_STATE';
  end if;

  foreach v_error in array array['user_id', 'workspace_id'] loop
    begin
      if v_error = 'user_id' then
        update public.workspace_memberships set user_id = v_other
         where id = v_subject_wm;
      else
        update public.workspace_memberships set workspace_id = gen_random_uuid()
         where id = v_subject_wm;
      end if;
      raise exception 'C04_EXPECTED_0152_WORKSPACE_REPOINT_REFUSAL';
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_error = message_text;
      if v_error <> 'workspace_membership_identity_immutable' then raise; end if;
    end;
  end loop;
  if (select lifecycle_generation from public.workspace_memberships
       where id = v_subject_wm) <> v_workspace_generation
     or (select count(*) from public.membership_capability_grants
          where membership_id = v_subject_membership) <> v_grant_count then
    raise exception 'C04_0154_WORKSPACE_REPOINT_REFUSAL_MUTATED_STATE';
  end if;
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if not public.effective_site_capability(v_site_a, 'cost.read') then
    raise exception 'C04_0154_ORIGINAL_IDENTITY_LOST_GRANT';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  update public.memberships
     set status = 'revoked', revoked_at = statement_timestamp()
   where id = v_subject_membership;
  if exists (
    select 1 from public.membership_capability_grants
     where membership_id = v_subject_membership and revoked_at is null
  ) then
    raise exception 'C04_0154_SITE_RETIREMENT_INCOMPLETE';
  end if;
  update public.memberships set status = 'active', revoked_at = null
   where id = v_subject_membership;
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if public.effective_site_capability(v_site_a, 'cost.read') then
    raise exception 'C04_0154_REACTIVATION_RESURRECTED_GRANT';
  end if;

  -- A trusted fixture inserts one expired current row to prove expiry denies
  -- independently from parent lifecycle and without mutating immutable expiry.
  insert into public.membership_capability_grants(
    workspace_id, restaurant_id, workspace_membership_id, membership_id,
    subject_user_id, site_lifecycle_generation, workspace_lifecycle_generation,
    capability_key, granted_by_user_id, grant_reason, expires_at
  ) select
    v_workspace, v_site_a, v_subject_wm, m.id, v_subject,
    m.lifecycle_generation, wm.lifecycle_generation, 'pricing.manage',
    v_actor, 'C04 expired fixture', statement_timestamp() - interval '1 second'
  from public.memberships m
  join public.workspace_memberships wm on wm.id = m.workspace_membership_id
  where m.id = v_subject_membership
  returning id into v_expired_grant_id;
  if public.effective_site_capability(v_site_a, 'pricing.manage') then
    raise exception 'C04_0154_EXPIRED_GRANT_EFFECTIVE';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.replace_member_site_capabilities(
    v_subject_membership, array['pricing.manage'], null,
    'C04 expired public replacement'
  );
  if not exists (
    select 1 from public.membership_capability_grants
     where id = v_expired_grant_id
       and revoked_at is not null
       and revoked_by_user_id = v_actor
       and revoke_reason = 'C04 expired public replacement'
       and revoke_cause = 'governance_replacement'
  ) or (select count(*) from public.membership_capability_grants
         where membership_id = v_subject_membership
           and capability_key = 'pricing.manage'
           and revoked_at is null) <> 1 then
    raise exception 'C04_0154_EXPIRED_PUBLIC_REPLACEMENT_HISTORY_FAILURE';
  end if;
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if not public.effective_site_capability(v_site_a, 'pricing.manage') then
    raise exception 'C04_0154_EXPIRED_PUBLIC_REPLACEMENT_NOT_EFFECTIVE';
  end if;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.retire_membership_capability_grants(
    array[v_subject_membership], v_actor, 'identity mismatch fixture',
    'governance_replacement'
  );

  -- Each row below keeps generations/current lifecycle valid while one stored
  -- identity edge is forged. Every case must fail closed.
  insert into public.membership_capability_grants(
    workspace_id, restaurant_id, workspace_membership_id, membership_id,
    subject_user_id, site_lifecycle_generation, workspace_lifecycle_generation,
    capability_key, granted_by_user_id, grant_reason
  ) select
    v_workspace, v_site_a, v_subject_wm, m.id, v_other,
    m.lifecycle_generation, wm.lifecycle_generation, 'cost.read', v_actor,
    'subject mismatch'
  from public.memberships m join public.workspace_memberships wm
    on wm.id = m.workspace_membership_id where m.id = v_subject_membership;
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if public.effective_site_capability(v_site_a, 'cost.read') then
    raise exception 'C04_0154_SUBJECT_MISMATCH_ALLOWED';
  end if;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.retire_membership_capability_grants(
    array[v_subject_membership], v_actor, 'next mismatch', 'governance_replacement'
  );

  insert into public.membership_capability_grants(
    workspace_id, restaurant_id, workspace_membership_id, membership_id,
    subject_user_id, site_lifecycle_generation, workspace_lifecycle_generation,
    capability_key, granted_by_user_id, grant_reason
  ) select
    v_workspace, v_site_b, v_subject_wm, m.id, v_subject,
    m.lifecycle_generation, wm.lifecycle_generation, 'cost.read', v_actor,
    'restaurant mismatch'
  from public.memberships m join public.workspace_memberships wm
    on wm.id = m.workspace_membership_id where m.id = v_subject_membership;
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if public.effective_site_capability(v_site_a, 'cost.read')
     or public.effective_site_capability(v_site_b, 'cost.read') then
    raise exception 'C04_0154_RESTAURANT_MISMATCH_ALLOWED';
  end if;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.retire_membership_capability_grants(
    array[v_subject_membership], v_actor, 'next mismatch', 'governance_replacement'
  );

  insert into public.membership_capability_grants(
    workspace_id, restaurant_id, workspace_membership_id, membership_id,
    subject_user_id, site_lifecycle_generation, workspace_lifecycle_generation,
    capability_key, granted_by_user_id, grant_reason
  ) select
    v_workspace, v_site_a, v_other_wm, m.id, v_subject,
    m.lifecycle_generation, wm.lifecycle_generation, 'cost.read', v_actor,
    'workspace membership link mismatch'
  from public.memberships m join public.workspace_memberships wm
    on wm.id = m.workspace_membership_id where m.id = v_subject_membership;
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if public.effective_site_capability(v_site_a, 'cost.read') then
    raise exception 'C04_0154_WORKSPACE_LINK_MISMATCH_ALLOWED';
  end if;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.retire_membership_capability_grants(
    array[v_subject_membership], v_actor, 'next mismatch', 'governance_replacement'
  );

  insert into public.membership_capability_grants(
    workspace_id, restaurant_id, workspace_membership_id, membership_id,
    subject_user_id, site_lifecycle_generation, workspace_lifecycle_generation,
    capability_key, granted_by_user_id, grant_reason
  ) select
    gen_random_uuid(), v_site_a, v_subject_wm, m.id, v_subject,
    m.lifecycle_generation, wm.lifecycle_generation, 'cost.read', v_actor,
    'workspace mismatch'
  from public.memberships m join public.workspace_memberships wm
    on wm.id = m.workspace_membership_id where m.id = v_subject_membership;
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if public.effective_site_capability(v_site_a, 'cost.read') then
    raise exception 'C04_0154_WORKSPACE_MISMATCH_ALLOWED';
  end if;

  -- The workspace-member-user mismatch requires a trusted maintenance path;
  -- both owner-controlled guards are disabled only inside this rolled-back fixture.
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.retire_membership_capability_grants(
    array[v_subject_membership], v_actor, 'next mismatch', 'governance_replacement'
  );
  alter table public.workspace_memberships
    disable trigger workspace_memberships_guard_identity;
  alter table public.workspace_memberships
    disable trigger workspace_memberships_z_capability_lifecycle;
  update public.workspace_memberships set user_id = v_mismatch_user
   where id = v_subject_wm;
  alter table public.workspace_memberships
    enable trigger workspace_memberships_z_capability_lifecycle;
  alter table public.workspace_memberships
    enable trigger workspace_memberships_guard_identity;
  insert into public.membership_capability_grants(
    workspace_id, restaurant_id, workspace_membership_id, membership_id,
    subject_user_id, site_lifecycle_generation, workspace_lifecycle_generation,
    capability_key, granted_by_user_id, grant_reason
  ) select
    v_workspace, v_site_a, v_subject_wm, m.id, v_subject,
    m.lifecycle_generation, wm.lifecycle_generation, 'cost.read', v_actor,
    'workspace member user mismatch'
  from public.memberships m join public.workspace_memberships wm
    on wm.id = m.workspace_membership_id where m.id = v_subject_membership;
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  if public.effective_site_capability(v_site_a, 'cost.read') then
    raise exception 'C04_0154_WORKSPACE_MEMBER_USER_MISMATCH_ALLOWED';
  end if;
end;
$semantics$;

do $delete_history$
declare
  v_actor uuid := gen_random_uuid();
  v_site_subject uuid := gen_random_uuid();
  v_workspace_subject uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_actor_wm uuid;
  v_site_subject_wm uuid;
  v_workspace_subject_wm uuid;
  v_site_membership uuid;
  v_workspace_membership uuid;
  v_site_grant uuid;
  v_workspace_grant uuid;
  v_site_generation uuid;
  v_site_workspace_generation uuid;
  v_workspace_site_generation uuid;
  v_workspace_generation uuid;
begin
  insert into auth.users(id, email) values
    (v_actor, 'c04-delete-actor-' || v_actor || '@terroir.test'),
    (v_site_subject, 'c04-site-delete-' || v_site_subject || '@terroir.test'),
    (v_workspace_subject,
     'c04-workspace-delete-' || v_workspace_subject || '@terroir.test');
  insert into public.workspaces(id, kind, name)
    values (v_workspace, 'restaurant', 'C04 delete history');
  insert into public.restaurants(id, name, workspace_id)
    values (v_site, 'C04 delete history site', v_workspace);
  insert into public.workspace_memberships(
    workspace_id, user_id, governance_role
  ) values (v_workspace, v_actor, 'workspace_owner') returning id into v_actor_wm;
  insert into public.workspace_memberships(workspace_id, user_id)
    values (v_workspace, v_site_subject) returning id into v_site_subject_wm;
  insert into public.workspace_memberships(workspace_id, user_id)
    values (v_workspace, v_workspace_subject)
    returning id into v_workspace_subject_wm;
  insert into public.memberships(
    user_id, restaurant_id, role, workspace_membership_id
  ) values (v_site_subject, v_site, 'staff', v_site_subject_wm)
  returning id, lifecycle_generation into v_site_membership, v_site_generation;
  insert into public.memberships(
    user_id, restaurant_id, role, workspace_membership_id
  ) values (v_workspace_subject, v_site, 'staff', v_workspace_subject_wm)
  returning id, lifecycle_generation
    into v_workspace_membership, v_workspace_site_generation;
  select lifecycle_generation into v_site_workspace_generation
    from public.workspace_memberships where id = v_site_subject_wm;
  select lifecycle_generation into v_workspace_generation
    from public.workspace_memberships where id = v_workspace_subject_wm;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.replace_member_site_capabilities(
    v_site_membership, array['cost.read'], null, 'C04 site delete history'
  );
  perform public.replace_member_site_capabilities(
    v_workspace_membership, array['margin.read'], null,
    'C04 workspace delete history'
  );
  select id into strict v_site_grant
    from public.membership_capability_grants
   where membership_id = v_site_membership and revoked_at is null;
  select id into strict v_workspace_grant
    from public.membership_capability_grants
   where membership_id = v_workspace_membership and revoked_at is null;

  delete from public.memberships where id = v_site_membership;
  if exists (select 1 from public.memberships where id = v_site_membership)
     or not exists (
       select 1 from public.membership_capability_grants g
        where g.id = v_site_grant
          and g.workspace_id = v_workspace
          and g.restaurant_id = v_site
          and g.workspace_membership_id = v_site_subject_wm
          and g.membership_id = v_site_membership
          and g.subject_user_id = v_site_subject
          and g.site_lifecycle_generation = v_site_generation
          and g.workspace_lifecycle_generation = v_site_workspace_generation
          and g.capability_key = 'cost.read'
          and g.granted_by_user_id = v_actor
          and g.grant_reason = 'C04 site delete history'
          and g.source = 'workspace_governance'
          and g.revoked_at is not null
          and g.revoked_by_user_id = v_actor
          and g.revoke_reason = 'site membership deleted'
          and g.revoke_cause = 'site_delete'
     ) then
    raise exception 'C04_0154_SITE_DELETE_HISTORY_FAILURE';
  end if;

  -- A workspace membership cannot be removed while its site membership still
  -- owns the 0152 NO ACTION link. Trusted setup removes only that parent while
  -- the 0154 site trigger is disabled, leaving a current FK-free history row
  -- for the workspace DELETE branch to retire.
  alter table public.memberships
    disable trigger memberships_z_capability_lifecycle;
  delete from public.memberships where id = v_workspace_membership;
  alter table public.memberships
    enable trigger memberships_z_capability_lifecycle;
  if not exists (
    select 1 from public.membership_capability_grants
     where id = v_workspace_grant and revoked_at is null
  ) then
    raise exception 'C04_0154_WORKSPACE_DELETE_SETUP_RETIRED_GRANT';
  end if;
  delete from public.workspace_memberships where id = v_workspace_subject_wm;
  if exists (
    select 1 from public.workspace_memberships where id = v_workspace_subject_wm
  ) or not exists (
    select 1 from public.membership_capability_grants g
     where g.id = v_workspace_grant
       and g.workspace_id = v_workspace
       and g.restaurant_id = v_site
       and g.workspace_membership_id = v_workspace_subject_wm
       and g.membership_id = v_workspace_membership
       and g.subject_user_id = v_workspace_subject
       and g.site_lifecycle_generation = v_workspace_site_generation
       and g.workspace_lifecycle_generation = v_workspace_generation
       and g.capability_key = 'margin.read'
       and g.granted_by_user_id = v_actor
       and g.grant_reason = 'C04 workspace delete history'
       and g.source = 'workspace_governance'
       and g.revoked_at is not null
       and g.revoked_by_user_id = v_actor
       and g.revoke_reason = 'workspace membership deleted'
       and g.revoke_cause = 'workspace_delete'
  ) then
    raise exception 'C04_0154_WORKSPACE_DELETE_HISTORY_FAILURE';
  end if;

  perform set_config('request.jwt.claim.sub', v_site_subject::text, true);
  if public.effective_site_capability(v_site, 'cost.read') then
    raise exception 'C04_0154_SITE_DELETE_LEFT_EFFECTIVE_GRANT';
  end if;
  perform set_config('request.jwt.claim.sub', v_workspace_subject::text, true);
  if public.effective_site_capability(v_site, 'margin.read') then
    raise exception 'C04_0154_WORKSPACE_DELETE_LEFT_EFFECTIVE_GRANT';
  end if;
end;
$delete_history$;

rollback;

\echo C04_0154_SEMANTICS_ACCEPTANCE_PASS
