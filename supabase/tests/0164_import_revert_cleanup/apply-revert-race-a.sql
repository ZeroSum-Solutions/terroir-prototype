-- Connection A: first operation in the two-wine apply/revert advisory race.
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
\if :{?race_mode}
\else
  \echo C09_0164_RACE_MODE_REQUIRED
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
\if :{?apply_batch_id}
\else
  \quit 3
\endif
\if :{?revert_batch_id}
\else
  \quit 3
\endif

select 1 / case when current_database()=:'expected_database'
  and :'target_admitted'='on'
  and :'race_mode' in ('apply_first','revert_first')
  and (select pg_catalog.count(distinct w.id)
         from public.import_batch_rows r
         join public.wines w
           on w.restaurant_id=r.restaurant_id
          and pg_catalog.lower(w.producer)=pg_catalog.lower(r.raw->>'producer')
          and pg_catalog.lower(w.name)=pg_catalog.lower(r.raw->>'name')
          and coalesce(w.vintage,0)=
              coalesce(nullif(r.raw->>'vintage','')::integer,0)
          and w.size_ml=coalesce(
                nullif(r.raw->>'size_ml','')::integer,750
              )
        where r.batch_id=:'apply_batch_id'::uuid
          and r.restaurant_id=:'site_id'::uuid)=2
  and (select pg_catalog.array_agg(w.id order by r.row_number)
         from public.import_batch_rows r
         join public.wines w
           on w.restaurant_id=r.restaurant_id
          and pg_catalog.lower(w.producer)=pg_catalog.lower(r.raw->>'producer')
          and pg_catalog.lower(w.name)=pg_catalog.lower(r.raw->>'name')
          and coalesce(w.vintage,0)=
              coalesce(nullif(r.raw->>'vintage','')::integer,0)
          and w.size_ml=coalesce(
                nullif(r.raw->>'size_ml','')::integer,750
              )
        where r.batch_id=:'apply_batch_id'::uuid
          and r.restaurant_id=:'site_id'::uuid)
      = (select pg_catalog.array_agg(ids.id order by ids.id desc)
           from (select distinct r.applied_wine_id as id
                   from public.import_batch_rows r
                  where r.batch_id=:'revert_batch_id'::uuid
                    and r.restaurant_id=:'site_id'::uuid
                    and r.apply_status='applied') ids)
then 1 else 0 end as c09_0164_two_wine_inverse_precondition;

begin;
set local role authenticated;
set local statement_timeout='25s';
set local lock_timeout='20s';
select pg_catalog.set_config('application_name','c09_0164_race_a',true);
select pg_catalog.set_config('request.jwt.claim.sub',:'actor_id',true);
select :'race_mode'='apply_first' as apply_first \gset
\if :apply_first
  select * from public.apply_import_batch_chunk(:'apply_batch_id'::uuid,100);
\else
  select public.revert_import_batch_private(:'revert_batch_id'::uuid);
\endif
select pg_catalog.pg_sleep(8);
commit;
\echo C09_0164_APPLY_REVERT_RACE_A_PASS
