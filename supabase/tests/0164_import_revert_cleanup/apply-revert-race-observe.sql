-- Run after A completes its RPC and while B waits on the site advisory lock.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
select 1 / case when current_database()=:'expected_database'
  and (select pg_catalog.count(*)
         from pg_catalog.pg_stat_activity a
        where a.datname=current_database()
          and a.application_name='c09_0164_race_b'
          and a.state='active'
          and a.wait_event_type='Lock'
          and a.wait_event='advisory')=1
then 1 else 0 end as c09_0164_advisory_wait_observed;
select a.pid,a.application_name,a.wait_event_type,a.wait_event,a.state
  from pg_catalog.pg_stat_activity a
 where a.datname=current_database()
   and a.application_name='c09_0164_race_b';
