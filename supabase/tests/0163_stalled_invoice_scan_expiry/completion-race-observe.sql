-- Observe B waiting for the scan row held by A.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C08_0163_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and current_user='postgres' and session_user='postgres'
  and exists(
    select 1 from pg_catalog.pg_stat_activity a
     where a.datname=current_database()
       and a.application_name='c08_0163_completion_expiry'
       and a.state='active'
       and a.wait_event_type='Lock'
       and a.query like '%expire_stalled_invoice_scans%'
  ) then 1 else 0 end as c08_0163_completion_lock_observed;
\echo C08_0163_COMPLETION_RACE_OBSERVE_PASS
