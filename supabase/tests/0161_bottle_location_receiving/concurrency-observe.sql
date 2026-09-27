-- Run while A is sleeping and B is blocked. The supervisor must require one
-- exact waiter row for the selected mode; scheduler order without this row is
-- not concurrency evidence.
\set ON_ERROR_STOP on
\pset pager off
\if :{?waiter_application_name}
\else
  \echo C06_0161_WAITER_APPLICATION_REQUIRED
  \quit 3
\endif
select 1 / case when (
  select pg_catalog.count(*)
    from pg_catalog.pg_stat_activity a
   where a.datname=current_database()
     and a.application_name=:'waiter_application_name'
     and a.state='active'
     and a.wait_event_type='Lock'
     and a.wait_event is not null
)=1 then 1 else 0 end as c06_0161_wait_observed;
select a.pid,a.application_name,a.wait_event_type,a.wait_event,a.state
  from pg_catalog.pg_stat_activity a
 where a.datname=current_database()
   and a.application_name=:'waiter_application_name';
