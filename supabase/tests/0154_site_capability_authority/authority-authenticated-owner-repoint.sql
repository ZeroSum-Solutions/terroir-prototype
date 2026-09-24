\set ON_ERROR_STOP on
\pset pager off

begin;

create temporary table c04_owner_repoint_fixture (
  actor_id uuid,
  subject_id uuid,
  other_user_id uuid,
  site_a uuid,
  site_b uuid,
  other_workspace_membership_id uuid,
  subject_membership_id uuid,
  baseline_generation uuid,
  baseline_parent jsonb,
  baseline_history jsonb
) on commit drop;

do $setup$
declare
  v_actor uuid := gen_random_uuid();
  v_subject uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_site_a uuid := gen_random_uuid();
  v_site_b uuid := gen_random_uuid();
  v_actor_wm uuid;
  v_subject_wm uuid;
  v_other_wm uuid;
  v_subject_membership uuid;
  v_generation uuid;
  v_parent jsonb;
  v_history jsonb;
begin
  insert into auth.users(id, email) values
    (v_actor, 'c04-repoint-owner-' || v_actor || '@terroir.test'),
    (v_subject, 'c04-repoint-subject-' || v_subject || '@terroir.test'),
    (v_other, 'c04-repoint-other-' || v_other || '@terroir.test');
  insert into public.workspaces(id, kind, name)
    values (v_workspace, 'restaurant', 'C04 authenticated owner repoint');
  insert into public.restaurants(id, name, workspace_id) values
    (v_site_a, 'C04 repoint site A', v_workspace),
    (v_site_b, 'C04 repoint site B', v_workspace);
  insert into public.workspace_memberships(
    workspace_id, user_id, governance_role
  ) values (v_workspace, v_actor, 'workspace_owner') returning id into v_actor_wm;
  insert into public.workspace_memberships(workspace_id, user_id)
    values (v_workspace, v_subject) returning id into v_subject_wm;
  insert into public.workspace_memberships(workspace_id, user_id)
    values (v_workspace, v_other) returning id into v_other_wm;

  -- The actor is a legacy exact-site owner on both the old and proposed sites,
  -- so RLS admits every UPDATE shape and the 0152 trigger is the refusal.
  insert into public.memberships(
    user_id, restaurant_id, role, workspace_membership_id
  ) values
    (v_actor, v_site_a, 'owner', v_actor_wm),
    (v_actor, v_site_b, 'owner', v_actor_wm);
  insert into public.memberships(
    user_id, restaurant_id, role, workspace_membership_id
  ) values (v_subject, v_site_a, 'staff', v_subject_wm)
  returning id, lifecycle_generation into v_subject_membership, v_generation;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.replace_member_site_capabilities(
    v_subject_membership, array['cost.read', 'margin.read'], null,
    'C04 authenticated owner repoint baseline'
  );
  select to_jsonb(m) into strict v_parent
    from public.memberships m where m.id = v_subject_membership;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb)
    into v_history
    from public.membership_capability_grants g
   where g.membership_id = v_subject_membership;
  insert into c04_owner_repoint_fixture values (
    v_actor, v_subject, v_other, v_site_a, v_site_b, v_other_wm,
    v_subject_membership, v_generation, v_parent, v_history
  );
end;
$setup$;

grant select on c04_owner_repoint_fixture to authenticated;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select actor_id::text from c04_owner_repoint_fixture),
  true
);

do $authenticated_repoints$
declare
  v_fixture c04_owner_repoint_fixture%rowtype;
  v_error text;
  v_denials integer := 0;
begin
  select * into strict v_fixture from c04_owner_repoint_fixture;

  begin
    update public.memberships set user_id = v_fixture.other_user_id
     where id = v_fixture.subject_membership_id;
    raise exception 'C04_EXPECTED_AUTHENTICATED_USER_REPOINT_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'membership_identity_immutable' then raise; end if;
    v_denials := v_denials + 1;
  end;
  begin
    update public.memberships set restaurant_id = v_fixture.site_b
     where id = v_fixture.subject_membership_id;
    raise exception 'C04_EXPECTED_AUTHENTICATED_SITE_REPOINT_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'membership_identity_immutable' then raise; end if;
    v_denials := v_denials + 1;
  end;
  begin
    update public.memberships
       set workspace_membership_id = v_fixture.other_workspace_membership_id
     where id = v_fixture.subject_membership_id;
    raise exception 'C04_EXPECTED_AUTHENTICATED_WORKSPACE_LINK_REPOINT_REFUSAL';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'membership_identity_immutable' then raise; end if;
    v_denials := v_denials + 1;
  end;
  if v_denials <> 3 then
    raise exception 'C04_0154_AUTHENTICATED_REPOINT_DENIAL_COUNT: %', v_denials;
  end if;
end;
$authenticated_repoints$;

reset role;

do $verify$
declare
  v_fixture c04_owner_repoint_fixture%rowtype;
  v_parent jsonb;
  v_history jsonb;
begin
  select * into strict v_fixture from c04_owner_repoint_fixture;
  select to_jsonb(m) into strict v_parent
    from public.memberships m where m.id = v_fixture.subject_membership_id;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb)
    into v_history
    from public.membership_capability_grants g
   where g.membership_id = v_fixture.subject_membership_id;
  if v_parent is distinct from v_fixture.baseline_parent
     or (select lifecycle_generation from public.memberships
          where id = v_fixture.subject_membership_id)
        is distinct from v_fixture.baseline_generation
     or v_history is distinct from v_fixture.baseline_history then
    raise exception 'C04_0154_AUTHENTICATED_REPOINT_MUTATED_STATE';
  end if;

  perform set_config('request.jwt.claim.sub', v_fixture.actor_id::text, true);
  if not public.is_member_with_role(v_fixture.site_a, 'owner')
     or not public.is_member_with_role(v_fixture.site_b, 'owner') then
    raise exception 'C04_0154_AUTHENTICATED_OWNER_AUTHORITY_LOST';
  end if;
  perform set_config('request.jwt.claim.sub', v_fixture.subject_id::text, true);
  if not public.effective_site_capability(v_fixture.site_a, 'cost.read') then
    raise exception 'C04_0154_AUTHENTICATED_REPOINT_LOST_ORIGINAL_GRANT';
  end if;
end;
$verify$;

rollback;

\echo C04_0154_AUTHENTICATED_OWNER_REPOINT_PASS
