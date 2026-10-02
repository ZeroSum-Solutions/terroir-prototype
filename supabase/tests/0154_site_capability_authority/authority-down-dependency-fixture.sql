\set ON_ERROR_STOP on
\pset pager off

-- On a fresh post-0154 database with no grant history, create one external
-- dependent. The guarded down must fail with SQLSTATE 2BP01 under RESTRICT;
-- its explicit transaction must roll back every preceding drop.
create view public.c04_0154_down_dependency_fixture as
select public.effective_site_capability(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'cost.read'
) as allowed;

\echo C04_0154_DOWN_DEPENDENCY_FIXTURE_READY
