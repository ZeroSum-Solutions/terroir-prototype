\set ON_ERROR_STOP on
\pset pager off

-- Run only on a fresh disposable post-0154 database. The fixed identities let
-- independent psql sessions address the same rows without a generic harness.

insert into auth.users(id, email) values
  ('15400000-0000-4000-8000-000000000001', 'c04-race-actor@terroir.test'),
  ('15400000-0000-4000-8000-000000000002', 'c04-race-subject@terroir.test'),
  ('15400000-0000-4000-8000-000000000003', 'c04-governance-actor@terroir.test'),
  ('15400000-0000-4000-8000-000000000004', 'c04-governance-subject@terroir.test');

insert into public.workspaces(id, kind, name) values
  ('15400000-0000-4000-8000-000000000010', 'restaurant', 'C04 lifecycle race'),
  ('15400000-0000-4000-8000-000000000020', 'restaurant', 'C04 governance race');
insert into public.restaurants(id, name, workspace_id) values
  ('15400000-0000-4000-8000-000000000011', 'C04 lifecycle site',
   '15400000-0000-4000-8000-000000000010'),
  ('15400000-0000-4000-8000-000000000021', 'C04 governance site',
   '15400000-0000-4000-8000-000000000020');

insert into public.workspace_memberships(
  id, workspace_id, user_id, governance_role
) values
  ('15400000-0000-4000-8000-000000000012',
   '15400000-0000-4000-8000-000000000010',
   '15400000-0000-4000-8000-000000000001', 'workspace_owner'),
  ('15400000-0000-4000-8000-000000000013',
   '15400000-0000-4000-8000-000000000010',
   '15400000-0000-4000-8000-000000000002', null),
  ('15400000-0000-4000-8000-000000000022',
   '15400000-0000-4000-8000-000000000020',
   '15400000-0000-4000-8000-000000000003', 'workspace_owner'),
  ('15400000-0000-4000-8000-000000000023',
   '15400000-0000-4000-8000-000000000020',
   '15400000-0000-4000-8000-000000000004', null);

insert into public.memberships(
  id, user_id, restaurant_id, role, workspace_membership_id
) values
  ('15400000-0000-4000-8000-000000000014',
   '15400000-0000-4000-8000-000000000002',
   '15400000-0000-4000-8000-000000000011', 'staff',
   '15400000-0000-4000-8000-000000000013'),
  ('15400000-0000-4000-8000-000000000024',
   '15400000-0000-4000-8000-000000000004',
   '15400000-0000-4000-8000-000000000021', 'staff',
   '15400000-0000-4000-8000-000000000023');

select set_config(
  'request.jwt.claim.sub', '15400000-0000-4000-8000-000000000001', false
);
select public.replace_member_site_capabilities(
  '15400000-0000-4000-8000-000000000014',
  array['cost.read', 'margin.read'], null, 'C04 lifecycle race setup'
);
select set_config('request.jwt.claim.sub', '', false);

\echo C04_0154_RACE_SETUP_PASS
