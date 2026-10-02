import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const seedSource = readFileSync("scripts/seed-local-operational.ts", "utf8");
const buildJobsStart = seedSource.indexOf("function buildJobs");
const buildJobsEnd = seedSource.indexOf("// ── write helpers", buildJobsStart);
const buildJobsSource = seedSource.slice(buildJobsStart, buildJobsEnd);

const expectedPlans = [
  [1, "invoice_extract", "succeeded", "invoice_scans", "scan(0)", 3, 1],
  [2, "invoice_extract", "succeeded", "invoice_scans", "scan(1)", 2, 1],
  [3, "invoice_extract", "processing", "invoice_scans", "scan(2)", 0, 1],
  [4, "invoice_ocr", "queued", "invoice_scans", "scan(3)", 0, 0],
  [8, "wine_enrichment", "succeeded", "wines", "wine(5)", 9, 1],
  [9, "wine_enrichment", "processing", "wines", "wine(40)", 0, 1],
  [11, "wine_list_pdf", "succeeded", "wine_lists", "list(0)", 5, 1],
  [12, "wine_list_pdf", "queued", "wine_lists", "list(1)", 0, 0],
] as const;

function seededPlans() {
  return [...buildJobsSource.matchAll(
    /\{ ordinal: (\d+), job_type: "([^"]+)", status: "([^"]+)", subject_table: "([^"]+)", subject_id: ([^,]+), daysAgo: (\d+), attempt_count: (\d+) \},/gu,
  )].map((match) => [
    Number(match[1]),
    match[2],
    match[3],
    match[4],
    match[5],
    Number(match[6]),
    Number(match[7]),
  ]);
}

describe("background-job operational seed compatibility", () => {
  it("retains only the eight admitted job tuples at their original ordinals", () => {
    expect(buildJobsStart).toBeGreaterThan(-1);
    expect(buildJobsEnd).toBeGreaterThan(buildJobsStart);
    expect(seededPlans()).toEqual(expectedPlans);
  });

  it("keeps deterministic identity and timing derived from the original ordinal", () => {
    expect(buildJobsSource).toContain("id: uuid(UUID_PREFIX.job, plan.ordinal)");
    expect(buildJobsSource).toContain("idempotency_key: `local-seed-${plan.ordinal}`");
    expect(buildJobsSource).toContain("max_attempts: 3");
    expect(buildJobsSource).toContain("run_after: hoursAgo(plan.daysAgo, 8)");
    expect(buildJobsSource).toContain(
      'started_at: plan.status === "queued" ? null : hoursAgo(plan.daysAgo, 8)',
    );
    expect(buildJobsSource).toContain(
      'finished_at: ["succeeded", "failed", "dead", "cancelled"].includes(plan.status)',
    );
    expect(buildJobsSource).toContain(
      'claimed_at: plan.status === "processing" ? hoursAgo(plan.daysAgo, 8) : null',
    );
    expect(buildJobsSource).toContain("created_at: hoursAgo(plan.daysAgo, 7)");
    expect(buildJobsSource).toContain("updated_at: hoursAgo(plan.daysAgo, 9)");
  });

  it("hard-projects the closed empty receipt and metadata shape", () => {
    expect(buildJobsSource).toContain("error_code: null");
    expect(buildJobsSource).toContain("error_message: null");
    expect(buildJobsSource).toContain("result: {}");
    expect(buildJobsSource).toContain("metadata: {}");
    expect(buildJobsSource).not.toMatch(
      /plan\.(?:error_code|error_message|result|metadata)/u,
    );

    for (const legacyLiteral of [
      "line_items",
      "accuracy",
      "Skurnik",
      "Polaner",
      "Vine Street",
      "ocr_timeout",
      "ocr_unreadable",
      "cancelled_by_user",
      "drink-window-refresh",
      "Osteria Ivory",
      "enriched:",
      "skipped:",
      "bytes:",
    ]) {
      expect(buildJobsSource, legacyLiteral).not.toContain(legacyLiteral);
    }
  });

  it("keeps truthful seed logging and the existing background-job upsert path", () => {
    expect(seedSource).toContain(
      '{ table: "background_jobs (authored)", rows: jobs.length }',
    );
    expect(seedSource).toContain(
      'await upsertRows(supabase, "background_jobs", jobs)',
    );
  });
});
