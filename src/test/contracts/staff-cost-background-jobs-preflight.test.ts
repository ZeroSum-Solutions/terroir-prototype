import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preflightPath = "scripts/staff-cost-background-jobs-preflight.sql";
const preflight = existsSync(preflightPath)
  ? readFileSync(preflightPath, "utf8")
  : "";
const completeSource = readFileSync("src/lib/jobs/complete.ts", "utf8");
const seedSource = readFileSync("scripts/seed-local-operational.ts", "utf8");
const healthSource = readFileSync("src/lib/cellar-health/recompute.ts", "utf8");
const pricingSource = readFileSync(
  "src/lib/pricing-recommendations/recompute.ts",
  "utf8",
);
const schema0052 = readFileSync(
  "supabase/migrations/0052_background_jobs.sql",
  "utf8",
);
const invoiceJobs0075 = readFileSync(
  "supabase/migrations/0075_invoice_extract_jobs.sql",
  "utf8",
);
const enqueue0083 = readFileSync(
  "supabase/migrations/0083_background_jobs_enqueue_rpc.sql",
  "utf8",
);
const additive0157 = readFileSync(
  "supabase/migrations/0157_staff_cost_seal_additive.sql",
  "utf8",
);

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex + start.length);
  return source.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}

function normalizedSql(source: string): string {
  return source
    .replace(/--[^\n]*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function unsafeNullablePayloadComparisons(source: string): string[] {
  return normalizedSql(source).match(
    /\bj\.(?:metadata|result)\s*(?:=|<>|!=)\s*/gu,
  ) ?? [];
}

const completionCodeBlock = sliceBetween(
  completeSource,
  "const recognizedStoredFailureCodes",
  "]);",
);
const completionCodes = [...completionCodeBlock.matchAll(/^\s+"([^"]+)",$/gmu)]
  .map((match) => match[1]);
const preflightCodeBlock = sliceBetween(
  preflight,
  "-- C04_INVOICE_FAILURE_CODES_BEGIN",
  "-- C04_INVOICE_FAILURE_CODES_END",
);
const preflightCodes = [...preflightCodeBlock.matchAll(/\('([^']+)'\)/gu)]
  .map((match) => match[1]);

describe("staff-cost background-job history preflight", () => {
  it("is a bounded repeatable-read snapshot without explicit locks", () => {
    expect(existsSync(preflightPath)).toBe(true);
    const normalized = normalizedSql(preflight);
    const executable = normalized.replace(/'(?:''|[^'])*'/gu, "''");

    expect(normalized).toContain("\\set on_error_stop on");
    expect(normalized).toContain(
      "begin transaction isolation level repeatable read, read only",
    );
    expect(normalized).toContain("set local statement_timeout");
    expect(normalized).toContain("set local lock_timeout");
    expect(normalized).toContain("set local idle_in_transaction_session_timeout");
    expect(normalized).not.toMatch(/\block\s+table\b/u);
    expect(normalized).not.toMatch(
      /\bfor\s+(?:no\s+key\s+update|update|key\s+share|share)\b/u,
    );
    expect(executable).not.toMatch(
      /\b(?:call|execute|perform|security\s+definer)\b/u,
    );
    expect(executable).not.toMatch(
      /\b(?:public|auth|storage)\.[a-z_][a-z0-9_]*\s*\(/u,
    );
    expect(executable).not.toMatch(/\bpg_(?:advisory|sleep)[a-z0-9_]*\s*\(/u);
    expect(normalized.indexOf("pg_catalog.to_regclass('public.background_jobs')")).toBeLessThan(
      normalized.indexOf("from public.background_jobs j"),
    );
    expect(normalized).toContain("rollback");
    expect(normalized).toContain("c04_background_jobs_history_preflight_pass");
    expect(executable).not.toMatch(
      /\b(?:insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|copy)\b/u,
    );
  });

  it("takes the exact current 24-code completion map as authority", () => {
    expect(completionCodes).toHaveLength(24);
    expect(preflightCodes).toEqual(completionCodes);
    expect(preflightCodes).toContain("unknown");
    expect(preflightCodes).not.toContain("scan_superseded");
    expect(preflight).toContain("Invoice extraction job failed.");
  });

  it("fails closed when nullable JSON payloads drift to null", () => {
    const resultComparisons = [
      ...preflight.matchAll(
        /j\.result is not distinct from '[^']*'::jsonb/gu,
      ),
    ];

    expect(preflight).toContain(
      "when j.metadata is distinct from '{}'::jsonb then 'metadata_not_empty_object'",
    );
    expect(resultComparisons).toHaveLength(10);
    expect(unsafeNullablePayloadComparisons(preflight)).toEqual([]);

    const metadataMutation = preflight.replace(
      "j.metadata is distinct from '{}'::jsonb",
      "j.metadata <> '{}'::jsonb",
    );
    expect(unsafeNullablePayloadComparisons(metadataMutation)).toHaveLength(1);

    for (const comparison of resultComparisons) {
      expect(comparison.index).toBeTypeOf("number");
      const replacement = comparison[0].replace(" is not distinct from ", " = ");
      const mutation = [
        preflight.slice(0, comparison.index),
        replacement,
        preflight.slice((comparison.index ?? 0) + comparison[0].length),
      ].join("");
      expect(unsafeNullablePayloadComparisons(mutation)).toHaveLength(1);
    }
  });

  it("admits only exact recompute states, receipts, and fixed failures", () => {
    const health = sliceBetween(
      preflight,
      "-- C04_CELLAR_HEALTH_CONTRACT_BEGIN",
      "-- C04_CELLAR_HEALTH_CONTRACT_END",
    );
    const pricing = sliceBetween(
      preflight,
      "-- C04_PRICING_RECOMMENDATIONS_CONTRACT_BEGIN",
      "-- C04_PRICING_RECOMMENDATIONS_CONTRACT_END",
    );

    expect(health).toContain("j.status = 'processing'");
    expect(health).toContain("j.status = 'failed'");
    expect(health).toContain("j.status = 'succeeded'");
    expect(health).toContain(
      `j.result is not distinct from '{"version":1,"kind":"cellar_health_recompute","status":"succeeded"}'::jsonb`,
    );
    expect(health).toContain("cellar_health_recompute_failed");
    expect(health).toContain("Cellar health recompute failed.");
    expect(health).toContain(
      "j.error_code is not distinct from 'cellar_health_recompute_failed'",
    );
    expect(health).toContain(
      "j.error_message is not distinct from 'Cellar health recompute failed.'",
    );

    expect(pricing).toContain("j.status = 'processing'");
    expect(pricing).toContain("j.status = 'failed'");
    expect(pricing).toContain("j.status = 'succeeded'");
    expect(pricing).toContain(
      `j.result is not distinct from '{"version":1,"kind":"pricing_recommendations_recompute","status":"succeeded"}'::jsonb`,
    );
    expect(pricing).toContain("pricing_recommendations_recompute_failed");
    expect(pricing).toContain("Pricing recommendations recompute failed.");
    expect(pricing).toContain(
      "j.error_code is not distinct from 'pricing_recommendations_recompute_failed'",
    );
    expect(pricing).toContain(
      "j.error_message is not distinct from 'Pricing recommendations recompute failed.'",
    );
  });

  it("preserves invoice retry and reclaim pairs through queued and processing", () => {
    const invoice = sliceBetween(
      preflight,
      "-- C04_INVOICE_EXTRACT_CONTRACT_BEGIN",
      "-- C04_INVOICE_EXTRACT_CONTRACT_END",
    );
    const claim = sliceBetween(
      enqueue0083,
      "update public.background_jobs b",
      "returning b.*",
    );

    expect(invoice).toContain("j.result is not distinct from '{}'::jsonb");
    expect(invoice).toContain("j.status = 'succeeded'");
    expect(invoice).toContain("j.status in ('queued', 'processing')");
    expect(invoice).toContain("j.status = 'dead'");
    expect(invoice).toContain("Invoice extraction job failed.");
    expect(invoice).toContain("stuck_reclaimed");
    expect(invoice).toContain(
      "Reclaimed: claimed longer than the stuck threshold without completing.",
    );
    expect(invoice).toContain("j.error_code is null");
    expect(invoice).toContain("j.error_message is null");
    expect(invoice).toContain(
      "j.error_message is not distinct from 'Invoice extraction job failed.'",
    );
    expect(invoice).toContain(
      "j.error_code is not distinct from 'stuck_reclaimed'",
    );
    expect(claim).not.toContain("error_code");
    expect(claim).not.toContain("error_message");
    expect(invoiceJobs0075).toContain("error_code = 'stuck_reclaimed'");
    expect(invoiceJobs0075).toContain(
      "Reclaimed: claimed longer than the stuck threshold ",
    );
  });

  it("admits only the exact source-backed safe legacy seed states", () => {
    const legacy = sliceBetween(
      preflight,
      "-- C04_LEGACY_JOB_CONTRACTS_BEGIN",
      "-- C04_LEGACY_JOB_CONTRACTS_END",
    );

    expect(legacy).toContain("j.job_type = 'invoice_ocr'");
    expect(legacy).toContain("j.status = 'queued'");
    expect(legacy).toContain("j.job_type = 'wine_enrichment'");
    expect(legacy).toContain("j.status in ('processing', 'succeeded')");
    expect(legacy).toContain("j.job_type = 'wine_list_pdf'");
    expect(legacy).toContain("j.status in ('queued', 'succeeded')");
    expect(
      legacy.match(/j\.result is not distinct from '\{\}'::jsonb/gu),
    ).toHaveLength(3);
    expect(legacy.match(/j\.error_code is null/gu)).toHaveLength(3);
    expect(legacy.match(/j\.error_message is null/gu)).toHaveLength(3);
  });

  it("requires empty metadata and agrees with every current payload writer", () => {
    expect(preflight).toContain(
      "when j.metadata is distinct from '{}'::jsonb then 'metadata_not_empty_object'",
    );
    expect(schema0052).toContain("result         jsonb not null default '{}'::jsonb");
    expect(schema0052).toContain("metadata       jsonb not null default '{}'::jsonb");
    expect(seedSource).toContain("error_code: null");
    expect(seedSource).toContain("error_message: null");
    expect(seedSource).toContain("result: {}");
    expect(seedSource).toContain("metadata: {}");
    expect(healthSource).toContain("metadata: {},");
    expect(healthSource).toContain("result: {},");
    expect(pricingSource).toContain("metadata: {},");
    expect(pricingSource).toContain("result: {},");

    const enqueueInsert = sliceBetween(
      enqueue0083,
      "insert into public.background_jobs",
      "returning id into v_job_id",
    );
    const reextract = sliceBetween(
      additive0157,
      "create function public.request_invoice_scan_reextract",
      "$function$;",
    );
    const reextractInsert = sliceBetween(
      reextract,
      "insert into public.background_jobs",
      "returning id into v_job_id",
    );
    expect(enqueueInsert).not.toMatch(
      /\b(?:metadata|result|error_code|error_message)\b/u,
    );
    expect(reextractInsert).not.toMatch(
      /\b(?:metadata|result|error_code|error_message)\b/u,
    );
    expect(reextract).toContain(
      "status='queued',attempt_count=0,error_code=null,error_message=null",
    );
    expect(reextract).toContain("finished_at=null,result='{}'::jsonb");
    expect(reextract).not.toContain("metadata=");
  });

  it("reports aggregate classes and counts without protected row material", () => {
    const report = sliceBetween(
      preflight,
      "-- C04_AGGREGATE_REPORT_BEGIN",
      "-- C04_AGGREGATE_REPORT_END",
    );

    expect(report).toContain(
      "raise notice 'C04_BACKGROUND_JOBS_VIOLATION job_type_class=% violation_class=% count=%'",
    );
    expect(report).toContain("v_violation.job_type_class");
    expect(report).toContain("v_violation.violation_class");
    expect(report).toContain("v_violation.violation_count");
    expect(report).not.toMatch(
      /v_violation\.(?:id|subject_id|result|metadata|error_code|error_message)\b/u,
    );
    expect(preflight).toContain("C04_BACKGROUND_JOBS_ADMISSION_FAILED count=%");
  });
});
