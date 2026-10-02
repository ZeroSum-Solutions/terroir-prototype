-- Source-only historical admission probe for the staff-cost background-job
-- boundary. Run only on the named, externally quiesced disposable target.
-- This is a snapshot diagnostic only: the future contract transaction must
-- repeat these predicates inside its own write/admission transaction.
-- This script reports aggregate violation classes only and never repairs rows.
\set ON_ERROR_STOP on
\pset pager off

begin transaction isolation level repeatable read, read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';

do $baseline$
begin
  if pg_catalog.to_regclass('public.background_jobs') is null then
    raise exception 'C04_BACKGROUND_JOBS_BASELINE_MISSING' using errcode = 'P0001';
  end if;
end;
$baseline$;

do $history_preflight$
declare
  v_violation record;
  v_violation_total bigint := 0;
begin
  for v_violation in
    with invoice_failure_codes(code) as (
      -- C04_INVOICE_FAILURE_CODES_BEGIN
      values
        ('missing_subject'),
        ('subject_fetch_failed'),
        ('tenant_mismatch_or_missing_subject'),
        ('reextract_reset_failed'),
        ('reextract_superseded'),
        ('failed_reset_failed'),
        ('missing_or_mistenanted_image_path'),
        ('invalid_invoice_image_paths'),
        ('invalid_invoice_page_count'),
        ('unsupported_extension'),
        ('image_download_failed'),
        ('invalid_invoice_page_size'),
        ('invalid_invoice_page_mime'),
        ('claim_lost_before_extraction'),
        ('extraction_threw'),
        ('not_configured'),
        ('upstream_error'),
        ('empty_text'),
        ('parse_failed'),
        ('validation_failed'),
        ('rate_limited'),
        ('bad_input'),
        ('unknown'),
        ('no_wines_extracted')
      -- C04_INVOICE_FAILURE_CODES_END
    ),
    classified as (
      select
        case
          when j.job_type in (
            'invoice_ocr',
            'wine_enrichment',
            'wine_list_pdf',
            'cellar_health',
            'pricing_recommendations',
            'invoice_extract'
          ) then j.job_type
          else 'unsupported'
        end as job_type_class,
        case
          when j.job_type is null or j.job_type not in (
            'invoice_ocr',
            'wine_enrichment',
            'wine_list_pdf',
            'cellar_health',
            'pricing_recommendations',
            'invoice_extract'
          ) then 'unsupported_job_type'
          when j.metadata is distinct from '{}'::jsonb then 'metadata_not_empty_object'

          -- C04_CELLAR_HEALTH_CONTRACT_BEGIN
          when j.job_type = 'cellar_health' and not (
            (
              j.status = 'processing'
              and j.result is not distinct from '{}'::jsonb
              and j.error_code is null
              and j.error_message is null
            )
            or (
              j.status = 'failed'
              and j.result is not distinct from '{}'::jsonb
              and j.error_code is not distinct from 'cellar_health_recompute_failed'
              and j.error_message is not distinct from 'Cellar health recompute failed.'
            )
            or (
              j.status = 'succeeded'
              and j.result is not distinct from '{"version":1,"kind":"cellar_health_recompute","status":"succeeded"}'::jsonb
              and j.error_code is null
              and j.error_message is null
            )
          ) then 'cellar_health_contract'
          -- C04_CELLAR_HEALTH_CONTRACT_END

          -- C04_PRICING_RECOMMENDATIONS_CONTRACT_BEGIN
          when j.job_type = 'pricing_recommendations' and not (
            (
              j.status = 'processing'
              and j.result is not distinct from '{}'::jsonb
              and j.error_code is null
              and j.error_message is null
            )
            or (
              j.status = 'failed'
              and j.result is not distinct from '{}'::jsonb
              and j.error_code is not distinct from 'pricing_recommendations_recompute_failed'
              and j.error_message is not distinct from 'Pricing recommendations recompute failed.'
            )
            or (
              j.status = 'succeeded'
              and j.result is not distinct from '{"version":1,"kind":"pricing_recommendations_recompute","status":"succeeded"}'::jsonb
              and j.error_code is null
              and j.error_message is null
            )
          ) then 'pricing_recommendations_contract'
          -- C04_PRICING_RECOMMENDATIONS_CONTRACT_END

          -- C04_INVOICE_EXTRACT_CONTRACT_BEGIN
          when j.job_type = 'invoice_extract' and not (
            j.result is not distinct from '{}'::jsonb
            and (
              (
                j.status = 'succeeded'
                and j.error_code is null
                and j.error_message is null
              )
              or (
                j.status in ('queued', 'processing')
                and (
                  (j.error_code is null and j.error_message is null)
                  or (
                    exists (
                      select 1 from invoice_failure_codes c
                      where c.code = j.error_code
                    )
                    and j.error_message is not distinct from 'Invoice extraction job failed.'
                  )
                  or (
                    j.error_code is not distinct from 'stuck_reclaimed'
                    and j.error_message is not distinct from 'Reclaimed: claimed longer than the stuck threshold without completing.'
                  )
                )
              )
              or (
                j.status = 'dead'
                and (
                  (
                    exists (
                      select 1 from invoice_failure_codes c
                      where c.code = j.error_code
                    )
                    and j.error_message is not distinct from 'Invoice extraction job failed.'
                  )
                  or (
                    j.error_code is not distinct from 'stuck_reclaimed'
                    and j.error_message is not distinct from 'Reclaimed: claimed longer than the stuck threshold without completing.'
                  )
                )
              )
            )
          ) then 'invoice_extract_contract'
          -- C04_INVOICE_EXTRACT_CONTRACT_END

          -- C04_LEGACY_JOB_CONTRACTS_BEGIN
          when j.job_type = 'invoice_ocr' and not (
            j.status = 'queued'
            and j.result is not distinct from '{}'::jsonb
            and j.error_code is null
            and j.error_message is null
          ) then 'invoice_ocr_contract'
          when j.job_type = 'wine_enrichment' and not (
            j.status in ('processing', 'succeeded')
            and j.result is not distinct from '{}'::jsonb
            and j.error_code is null
            and j.error_message is null
          ) then 'wine_enrichment_contract'
          when j.job_type = 'wine_list_pdf' and not (
            j.status in ('queued', 'succeeded')
            and j.result is not distinct from '{}'::jsonb
            and j.error_code is null
            and j.error_message is null
          ) then 'wine_list_pdf_contract'
          -- C04_LEGACY_JOB_CONTRACTS_END
          else null
        end as violation_class
      from public.background_jobs j
    )
    select
      c.job_type_class,
      c.violation_class,
      pg_catalog.count(*)::bigint as violation_count
    from classified c
    where c.violation_class is not null
    group by c.job_type_class, c.violation_class
    order by c.job_type_class, c.violation_class
  loop
    -- C04_AGGREGATE_REPORT_BEGIN
    raise notice 'C04_BACKGROUND_JOBS_VIOLATION job_type_class=% violation_class=% count=%',
      v_violation.job_type_class,
      v_violation.violation_class,
      v_violation.violation_count;
    -- C04_AGGREGATE_REPORT_END
    v_violation_total := v_violation_total + v_violation.violation_count;
  end loop;

  if v_violation_total <> 0 then
    raise exception 'C04_BACKGROUND_JOBS_ADMISSION_FAILED count=%',
      v_violation_total
      using errcode = 'P0001';
  end if;
end;
$history_preflight$;

rollback;
\echo C04_BACKGROUND_JOBS_HISTORY_PREFLIGHT_PASS
