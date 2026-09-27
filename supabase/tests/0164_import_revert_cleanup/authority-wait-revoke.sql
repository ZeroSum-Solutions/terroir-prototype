-- Connection C: while B is blocked, revoke the exact lifecycle membership.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
\if :{?target_admitted}
\else
  \quit 3
\endif
\if :{?membership_id}
\else
  \quit 3
\endif
\if :{?actor_id}
\else
  \quit 3
\endif
\if :{?site_id}
\else
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and :'target_admitted'='on'
  and (select pg_catalog.count(*)
  from pg_catalog.pg_stat_activity a
 where a.datname=current_database()
   and a.application_name='c09_0164_auth_wait_b'
   and a.state='active'
   and a.wait_event_type='Lock')=1 then 1 else 0 end
  as c09_0164_authority_wait_observed;
with revoked as (
  update public.memberships
     set status='revoked',revoked_at=pg_catalog.statement_timestamp()
   where id=:'membership_id'::uuid
     and user_id=:'actor_id'::uuid
     and restaurant_id=:'site_id'::uuid
     and status='active' and revoked_at is null
  returning id
)
select 1 / case when pg_catalog.count(*)=1 then 1 else 0 end
  as c09_0164_one_membership_revoked
  from revoked;
\echo C09_0164_AUTHORITY_WAIT_REVOKE_PASS
