-- One-time production cutover bootstrap for explicitly reviewed owner grants.
-- Run only after 0154 and before 0157, inside one transaction. The caller must
-- supply an exact JSON manifest instead of deriving recipients from legacy roles.
\if :{?capability_manifest}
\else
  \echo '0154 capability bootstrap requires -v capability_manifest=<json>'
  \quit 2
\endif

\if :{?expected_entry_count}
\else
  \echo '0154 capability bootstrap requires -v expected_entry_count=<integer>'
  \quit 2
\endif

create temporary table capability_bootstrap_manifest (
  manifest jsonb not null,
  expected_entry_count integer not null check (expected_entry_count > 0)
) on commit drop;

insert into capability_bootstrap_manifest(manifest, expected_entry_count)
values (:'capability_manifest'::jsonb, :'expected_entry_count'::integer);

-- Stabilize the empty-history admission through postflight. This script's
-- ON COMMIT DROP temp table also makes an autocommit invocation fail before
-- this point; the approved caller uses --single-transaction.
lock table public.membership_capability_grants in share row exclusive mode;

do $bootstrap_admission$
declare
  v_manifest jsonb := (select manifest from capability_bootstrap_manifest);
  v_expected integer := (select expected_entry_count from capability_bootstrap_manifest);
begin
  if v_expected < 1
     or jsonb_typeof(v_manifest) <> 'array'
     or jsonb_array_length(v_manifest) <> v_expected
     or exists (
       select 1
         from jsonb_array_elements(v_manifest) entry
        where jsonb_typeof(entry) <> 'object'
           or not (entry ? 'membership_id' and entry ? 'actor_user_id')
           or (select count(*) from jsonb_object_keys(entry)) <> 2
     ) then
    raise exception 'C04_0154_BOOTSTRAP_MANIFEST_INVALID' using errcode = 'P0001';
  end if;
  if (select count(distinct (entry->>'membership_id')::uuid)
        from jsonb_array_elements(v_manifest) entry) <> v_expected then
    raise exception 'C04_0154_BOOTSTRAP_MEMBERSHIP_DUPLICATE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.membership_capability_grants) then
    raise exception 'C04_0154_BOOTSTRAP_REQUIRES_EMPTY_HISTORY' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_manifest) entry
      left join public.memberships m
        on m.id = (entry->>'membership_id')::uuid
       and m.user_id = (entry->>'actor_user_id')::uuid
       and m.role = 'owner'
       and m.status = 'active'
       and m.revoked_at is null
       and (m.expires_at is null or m.expires_at > statement_timestamp())
      left join public.restaurants r on r.id = m.restaurant_id
      left join public.workspace_memberships wm
        on wm.id = m.workspace_membership_id
       and wm.user_id = m.user_id
       and wm.workspace_id = r.workspace_id
       and wm.governance_role = 'workspace_owner'
       and wm.status = 'active'
       and wm.revoked_at is null
       and (wm.expires_at is null or wm.expires_at > statement_timestamp())
     where m.id is null or r.id is null or wm.id is null
  ) then
    raise exception 'C04_0154_BOOTSTRAP_IDENTITY_INVALID' using errcode = 'P0001';
  end if;
end;
$bootstrap_admission$;

do $bootstrap_apply$
declare
  v_entry jsonb;
  v_result text[];
begin
  for v_entry in
    select entry
      from jsonb_array_elements(
        (select manifest from capability_bootstrap_manifest)
      ) entry
     order by (entry->>'membership_id')::uuid
  loop
    perform set_config('request.jwt.claim.sub', v_entry->>'actor_user_id', true);
    select array_agg(capability_key order by capability_key)
      into v_result
      from public.replace_member_site_capabilities(
        (v_entry->>'membership_id')::uuid,
        array['cost.read','margin.read','pricing.manage'],
        null,
        'Production cutover: explicit owner capability bootstrap'
      ) capability_key;
    if v_result is distinct from array['cost.read','margin.read','pricing.manage'] then
      raise exception 'C04_0154_BOOTSTRAP_RESULT_INVALID' using errcode = 'P0001';
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
end;
$bootstrap_apply$;

do $bootstrap_postflight$
declare
  v_manifest jsonb := (select manifest from capability_bootstrap_manifest);
  v_expected integer := (select expected_entry_count from capability_bootstrap_manifest);
begin
  if (select count(*)
        from public.membership_capability_grants g
        join jsonb_array_elements(v_manifest) entry
          on g.membership_id = (entry->>'membership_id')::uuid
         and g.subject_user_id = (entry->>'actor_user_id')::uuid
       where g.revoked_at is null
         and g.expires_at is null
         and g.capability_key in ('cost.read','margin.read','pricing.manage')) <> v_expected * 3
     or exists (
       select 1
         from jsonb_array_elements(v_manifest) entry
        where (select array_agg(g.capability_key order by g.capability_key)
                 from public.membership_capability_grants g
                where g.membership_id = (entry->>'membership_id')::uuid
                  and g.subject_user_id = (entry->>'actor_user_id')::uuid
                  and g.revoked_at is null)
              is distinct from array['cost.read','margin.read','pricing.manage']
     ) then
    raise exception 'C04_0154_BOOTSTRAP_POSTFLIGHT_FAILED' using errcode = 'P0001';
  end if;
end;
$bootstrap_postflight$;

select 'C04_0154_CAPABILITY_BOOTSTRAP_PASS' as evidence,
       count(distinct membership_id) as memberships,
       count(*) as active_grants
  from public.membership_capability_grants
 where revoked_at is null;
