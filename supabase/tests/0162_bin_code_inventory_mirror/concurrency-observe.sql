-- Run after A has updated and while B waits on A's bin row lock.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \echo C07_0162_EXPECTED_DATABASE_REQUIRED
  \quit 3
\endif
\if :{?target_admitted}
\else
  \echo C07_0162_TARGET_ADMISSION_REQUIRED
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and :'target_admitted'='on'
then 1 else 0 end as c07_0162_observer_admitted;
select 1 / case when (
  select pg_catalog.count(*)
    from pg_catalog.pg_stat_activity a
   where a.datname=current_database()
     and a.application_name='c07_0162_rename_b'
     and a.state='active'
     and a.wait_event_type='Lock'
     and a.wait_event is not null
)=1 then 1 else 0 end as c07_0162_wait_observed;
select a.pid,a.application_name,a.wait_event_type,a.wait_event,a.state
  from pg_catalog.pg_stat_activity a
 where a.datname=current_database()
   and a.application_name='c07_0162_rename_b';
