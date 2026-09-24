\set ON_ERROR_STOP on
\pset pager off

begin;

create temporary table c04_pricing_fixture (
  actor_id uuid,
  subject_id uuid,
  workspace_id uuid,
  restaurant_id uuid,
  other_restaurant_id uuid,
  malformed_wine_id uuid,
  subject_membership_id uuid
) on commit drop;

do $setup$
declare
  v_actor uuid := gen_random_uuid();
  v_subject uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_other_restaurant uuid := gen_random_uuid();
  v_actor_wm uuid;
  v_subject_wm uuid;
  v_membership uuid;
  v_malformed_wine uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values
    (v_actor, 'c04-pricing-actor-' || v_actor || '@terroir.test'),
    (v_subject, 'c04-pricing-subject-' || v_subject || '@terroir.test');
  insert into public.workspaces(id, kind, name)
    values (v_workspace, 'restaurant', 'C04 pricing parity');
  insert into public.restaurants(id, name, workspace_id) values
    (v_restaurant, 'C04 pricing parity A', v_workspace),
    (v_other_restaurant, 'C04 pricing parity B', v_workspace);
  insert into public.workspace_memberships(
    workspace_id, user_id, governance_role
  ) values (v_workspace, v_actor, 'workspace_owner') returning id into v_actor_wm;
  insert into public.workspace_memberships(workspace_id, user_id)
    values (v_workspace, v_subject) returning id into v_subject_wm;
  insert into public.memberships(
    user_id, restaurant_id, role, workspace_membership_id
  ) values (v_subject, v_restaurant, 'staff', v_subject_wm)
  returning id into v_membership;

  insert into public.wines(id, restaurant_id, name, producer, vintage, size_ml)
  select
    md5('c04-pricing-wine-' || series)::uuid,
    v_restaurant,
    'C04 parity wine ' || series,
    'C04 parity producer ' || series,
    2020,
    750
  from generate_series(1, 1005) series;
  insert into public.wines(
    id, restaurant_id, name, producer, vintage, size_ml
  ) values (
    v_malformed_wine, v_other_restaurant, 'C04 cross tenant',
    'C04 cross tenant', 2020, 750
  );

  insert into public.pricing_recommendations(
    id, restaurant_id, wine_id, class, rationale, evidence, timing, computed_at
  )
  select
    md5('c04-pricing-row-' || series)::uuid,
    v_restaurant,
    md5('c04-pricing-wine-' || series)::uuid,
    (array['discount_to_move', 'feature_btg', 'hold', 'raise_appreciating'])[
      1 + (series % 4)
    ],
    'C04 parity rationale ' || series,
    jsonb_build_object(
      'healthSegment', null,
      'appreciation', null,
      'appreciationThreshold', 0.08,
      'velocity30d', 0,
      'marginPct', null,
      'marginThresholdPct', 70,
      'dayOfWeekProfile', '{}'::jsonb,
      'selectedDay', null
    ),
    null,
    '2026-09-24 12:00:00+00'::timestamptz
      - ((series % 3) * interval '1 second')
  from generate_series(1, 1005) series;

  -- Deliberately malformed service-written pair: site A row, site B wine.
  insert into public.pricing_recommendations(
    restaurant_id, wine_id, class, rationale, evidence, computed_at
  ) values (
    v_restaurant, v_malformed_wine, 'hold', 'must be excluded',
    jsonb_build_object(
      'healthSegment', null,
      'appreciation', null,
      'appreciationThreshold', 0.08,
      'velocity30d', 0,
      'marginPct', null,
      'marginThresholdPct', 70,
      'dayOfWeekProfile', '{}'::jsonb,
      'selectedDay', null
    ),
    '2026-09-24 12:00:00+00'::timestamptz
  );

  insert into c04_pricing_fixture values (
    v_actor, v_subject, v_workspace, v_restaurant, v_other_restaurant,
    v_malformed_wine, v_membership
  );
end;
$setup$;

create temporary table c04_pricing_legacy (
  page_number integer,
  page_ordinal bigint,
  wine_id uuid,
  class text,
  rationale text,
  evidence jsonb,
  timing text,
  computed_at timestamptz,
  wines jsonb
) on commit drop;
create temporary table c04_pricing_rpc
  (like c04_pricing_legacy including all) on commit drop;

grant select on c04_pricing_fixture to authenticated;
grant select, insert on c04_pricing_legacy, c04_pricing_rpc to authenticated;

set local role authenticated;

do $capability_gate$
declare
  v_actor uuid;
  v_subject uuid;
  v_restaurant uuid;
  v_membership uuid;
  v_count bigint;
begin
  select actor_id, subject_id, restaurant_id, subject_membership_id
    into v_actor, v_subject, v_restaurant, v_membership
    from c04_pricing_fixture;

  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  select count(*) into v_count
    from public.read_pricing_recommendations(v_restaurant);
  if v_count <> 0 then
    raise exception 'C04_0154_PRICING_WITHOUT_CAPABILITIES_ALLOWED';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.replace_member_site_capabilities(
    v_membership, array['cost.read'], null, 'C04 pricing cost-only gate'
  );
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  select count(*) into v_count
    from public.read_pricing_recommendations(v_restaurant);
  if v_count <> 0 then
    raise exception 'C04_0154_PRICING_COST_ONLY_ALLOWED';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.replace_member_site_capabilities(
    v_membership, array['margin.read'], null, 'C04 pricing margin-only gate'
  );
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
  select count(*) into v_count
    from public.read_pricing_recommendations(v_restaurant);
  if v_count <> 0 then
    raise exception 'C04_0154_PRICING_MARGIN_ONLY_ALLOWED';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform public.replace_member_site_capabilities(
    v_membership, array['cost.read', 'margin.read'], null,
    'C04 pricing both-capabilities parity'
  );
  perform set_config('request.jwt.claim.sub', v_subject::text, true);
end;
$capability_gate$;

insert into c04_pricing_legacy
select
  1,
  row_number() over (
    order by pr.class asc, pr.computed_at desc, pr.wine_id asc
  ),
  pr.wine_id,
  pr.class,
  pr.rationale,
  pr.evidence,
  pr.timing,
  pr.computed_at,
  jsonb_build_object('name', w.name, 'producer', w.producer, 'vintage', w.vintage)
from public.pricing_recommendations pr
join public.wines w on w.id = pr.wine_id
where pr.restaurant_id = (
  select restaurant_id from c04_pricing_fixture
)
order by pr.class asc, pr.computed_at desc, pr.wine_id asc
limit 1000 offset 0;

insert into c04_pricing_legacy
select
  2,
  row_number() over (
    order by pr.class asc, pr.computed_at desc, pr.wine_id asc
  ) - 1000,
  pr.wine_id,
  pr.class,
  pr.rationale,
  pr.evidence,
  pr.timing,
  pr.computed_at,
  jsonb_build_object('name', w.name, 'producer', w.producer, 'vintage', w.vintage)
from public.pricing_recommendations pr
join public.wines w on w.id = pr.wine_id
where pr.restaurant_id = (
  select restaurant_id from c04_pricing_fixture
)
order by pr.class asc, pr.computed_at desc, pr.wine_id asc
limit 1000 offset 1000;

insert into c04_pricing_rpc
select
  1,
  rpc.emission_ordinal,
  rpc.wine_id,
  rpc.class,
  rpc.rationale,
  rpc.evidence,
  rpc.timing,
  rpc.computed_at,
  rpc.wines
from public.read_pricing_recommendations(
  (select restaurant_id from c04_pricing_fixture)
) with ordinality as rpc(
  wine_id, class, rationale, evidence, timing, computed_at, wines,
  emission_ordinal
)
limit 1000 offset 0;

insert into c04_pricing_rpc
select
  2,
  rpc.emission_ordinal - 1000,
  rpc.wine_id,
  rpc.class,
  rpc.rationale,
  rpc.evidence,
  rpc.timing,
  rpc.computed_at,
  rpc.wines
from public.read_pricing_recommendations(
  (select restaurant_id from c04_pricing_fixture)
) with ordinality as rpc(
  wine_id, class, rationale, evidence, timing, computed_at, wines,
  emission_ordinal
)
limit 1000 offset 1000;

reset role;

do $verify$
begin
  if (select count(*) from c04_pricing_legacy) <> 1005
     or (select count(*) from c04_pricing_rpc) <> 1005 then
    raise exception 'C04_0154_PRICING_PARITY_COUNT_MISMATCH';
  end if;
  if exists (
    (select * from c04_pricing_legacy except all select * from c04_pricing_rpc)
    union all
    (select * from c04_pricing_rpc except all select * from c04_pricing_legacy)
  ) then
    raise exception 'C04_0154_PRICING_PARITY_BYTES_OR_ORDER_MISMATCH';
  end if;
  if (select count(*) from c04_pricing_rpc where page_number = 1) <> 1000
     or (select count(*) from c04_pricing_rpc where page_number = 2) <> 5
     or (select max(page_ordinal) from c04_pricing_rpc
          where page_number = 1) <> 1000
     or (select max(page_ordinal) from c04_pricing_rpc
          where page_number = 2) <> 5 then
    raise exception 'C04_0154_PRICING_RANGE_PAGE_BOUNDARY_MISMATCH';
  end if;
  if exists (
    select 1
      from (values (1, 1000::bigint), (2, 1::bigint))
        boundary(page_number, page_ordinal)
      left join c04_pricing_legacy legacy using (page_number, page_ordinal)
      left join c04_pricing_rpc rpc using (page_number, page_ordinal)
     where legacy.wine_id is null
        or rpc.wine_id is null
        or to_jsonb(legacy) is distinct from to_jsonb(rpc)
  ) then
    raise exception 'C04_0154_PRICING_PAGE_BOUNDARY_IDENTITY_MISMATCH';
  end if;
  if exists (
    select 1 from c04_pricing_rpc
     where wine_id = (select malformed_wine_id from c04_pricing_fixture)
  ) then
    raise exception 'C04_0154_CROSS_TENANT_PRICING_PAIR_VISIBLE';
  end if;
end;
$verify$;

rollback;

\echo C04_0154_PRICING_PARITY_PASS
