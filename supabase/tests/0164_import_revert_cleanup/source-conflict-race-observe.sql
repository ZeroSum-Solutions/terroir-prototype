-- Observe B waiting on A's common site advisory boundary.
\set ON_ERROR_STOP on
\pset pager off
\if :{?expected_database}
\else
  \quit 3
\endif
select 1/case when current_database()=:'expected_database'
  and (select pg_catalog.count(*)
         from pg_catalog.pg_stat_activity b
        where b.datname=current_database()
          and b.application_name='c09_0164_source_conflict_b'
          and b.state='active'
          and b.wait_event_type='Lock'
          and b.wait_event='advisory'
          and pg_catalog.cardinality(pg_catalog.pg_blocking_pids(b.pid))=1
          and exists(
            select 1 from pg_catalog.pg_stat_activity a
             where a.pid=any(pg_catalog.pg_blocking_pids(b.pid))
               and a.datname=current_database()
               and a.application_name='c09_0164_source_conflict_a'
          ))=1
then 1 else 0 end as c09_0164_source_conflict_wait_observed;
select a.pid,a.application_name,a.wait_event_type,a.wait_event,a.state,
       pg_catalog.pg_blocking_pids(a.pid) as blocking_pids
  from pg_catalog.pg_stat_activity a
 where a.datname=current_database()
   and a.application_name in (
     'c09_0164_source_conflict_a','c09_0164_source_conflict_b'
   )
 order by a.application_name;
