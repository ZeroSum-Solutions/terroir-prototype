import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/0157_staff_cost_seal_additive.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const normalized = migration.replace(/\s+/gu, " ").toLowerCase();
const downPath = resolve(
  process.cwd(),
  "supabase/migrations/down/0157_staff_cost_seal_additive.down.sql",
);
const down = existsSync(downPath) ? readFileSync(downPath, "utf8") : "";
const normalizedDown = down.replace(/\s+/gu, " ").toLowerCase();
const preflightPath = resolve(
  process.cwd(),
  "scripts/0157-production-preflight.sql",
);
const preflight = existsSync(preflightPath)
  ? readFileSync(preflightPath, "utf8").replace(/\s+/gu, " ").toLowerCase()
  : "";
const postflightPath = resolve(
  process.cwd(),
  "scripts/0157-production-postflight.sql",
);
const postflight = existsSync(postflightPath)
  ? readFileSync(postflightPath, "utf8").replace(/\s+/gu, " ").toLowerCase()
  : "";

const protectedReaders = [
  "read_inventory_costs",
  "read_wine_pricing_strategy",
  "read_wine_cost_flags",
  "read_restaurant_pricing_defaults",
  "read_pricing_recommendations",
  "read_invoice_scan_private",
  "read_invoice_scan_deletion_private",
  "read_reconcile_action_private",
  "read_identity_merge_private",
  "read_import_batch_cost_rows",
  "read_import_batch_display_rows",
  "read_cellar_health_private",
  "read_invoice_image_target",
] as const;

const protectedMutations = [
  "set_wine_pricing_strategy",
  "set_restaurant_pricing_defaults",
  "dismiss_pricing_alert_private",
  "set_wine_overpaid_flag",
  "create_inventory_item_private",
  "patch_inventory_item_private",
  "delete_wine_private",
  "add_manual_overrides",
  "enrich_wines_batch",
] as const;

const operationalMutations = [
  "create_invoice_scan_upload",
  "review_invoice_scan",
  "commit_invoice_scan",
  "delete_invoice_scan",
  "request_invoice_scan_reextract",
  "claim_scan_idempotency",
  "complete_scan_idempotency",
  "abandon_scan_idempotency",
  "create_import_batch",
  "count_import_batch_rows",
  "apply_import_batch_chunk",
  "resolve_import_batch_row",
  "bulk_resolve_import_batch_rows",
  "revert_import_batch",
  "revert_import_session",
  "accept_reconcile_batch",
  "undo_reconcile_batch",
  "merge_wines",
] as const;

function functionBody(name: string): string {
  const starts = [
    normalized.indexOf(`create function public.${name}(`),
    normalized.indexOf(`create or replace function public.${name}(`),
  ].filter((value) => value >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  if (start < 0) return "";
  const nextCreate = normalized.indexOf("create function public.", start + 1);
  const nextReplace = normalized.indexOf(
    "create or replace function public.",
    start + 1,
  );
  const nextCandidates = [nextCreate, nextReplace].filter((value) => value >= 0);
  const next = nextCandidates.length > 0 ? Math.min(...nextCandidates) : -1;
  return normalized.slice(start, next < 0 ? undefined : next);
}

describe("0157 additive staff-cost seal", () => {
  it("owns the collision-free additive migration before asserting its contracts", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).toContain("0157_staff_cost_seal_additive.sql");
  });

  it("declares the exact non-cache caller interface", () => {
    const exactSignatures = [
      "current_site_role_at_least(uuid,public.membership_role)",
      "wine_manual_overrides_valid(text[])",
      "wine_enrichment_metadata_valid(jsonb)",
      "read_inventory_costs(uuid,uuid[])",
      "read_wine_pricing_strategy(uuid,uuid[])",
      "read_wine_cost_flags(uuid,uuid[])",
      "read_restaurant_pricing_defaults(uuid)",
      "read_pricing_recommendations(uuid)",
      "read_invoice_scan_private(uuid)",
      "read_invoice_scan_deletion_private(uuid)",
      "read_reconcile_action_private(uuid)",
      "read_identity_merge_private(uuid)",
      "read_import_batch_cost_rows(uuid,integer,integer)",
      "read_import_batch_display_rows(uuid,integer,integer)",
      "read_cellar_health_private(uuid,uuid[])",
      "read_invoice_image_target(uuid,integer)",
      "set_wine_pricing_strategy(uuid,uuid,numeric,numeric)",
      "set_restaurant_pricing_defaults(uuid,numeric,numeric)",
      "dismiss_pricing_alert_private(uuid,integer)",
      "set_wine_overpaid_flag(uuid,uuid,boolean)",
      "create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)",
      "patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)",
      "delete_wine_private(uuid,uuid,timestamp with time zone)",
      "add_manual_overrides(uuid,text[])",
      "enrich_wines_batch(uuid,jsonb)",
      "create_invoice_scan_upload(uuid,uuid,text,text,text,date)",
      "review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb)",
      "commit_invoice_scan(uuid)",
      "request_invoice_scan_reextract(uuid)",
      "claim_scan_idempotency(uuid,uuid,text)",
      "complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)",
      "abandon_scan_idempotency(uuid,uuid,text)",
      "create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)",
      "count_import_batch_rows(uuid)",
      "apply_import_batch_chunk(uuid,integer)",
      "resolve_import_batch_row(uuid,text,numeric)",
      "bulk_resolve_import_batch_rows(uuid,text)",
      "revert_import_batch(uuid)",
      "revert_import_session(uuid)",
      "accept_reconcile_batch(uuid,jsonb,uuid)",
      "undo_reconcile_batch(uuid)",
      "merge_wines(uuid,uuid)",
    ];

    for (const signature of exactSignatures) {
      expect(normalized, signature).toContain(`public.${signature}`);
    }
  });

  it("uses one lifecycle-aware current-role helper and never the legacy role helpers", () => {
    const helper = functionBody("current_site_role_at_least");

    expect(helper).toContain("security definer");
    expect(helper).toMatch(/set search_path\s*=\s*''/u);
    expect(helper).toContain("(select auth.uid())");
    expect(helper).toContain("public.memberships");
    expect(helper).toContain("public.restaurants");
    expect(helper).toContain("public.workspace_memberships");
    expect(helper).toContain("m.workspace_membership_id = wm.id");
    expect(helper).toContain("m.user_id = wm.user_id");
    expect(helper).toContain("r.workspace_id = wm.workspace_id");
    expect(helper).toContain("m.status = 'active'");
    expect(helper).toContain("wm.status = 'active'");
    expect(helper).toContain("m.revoked_at is null");
    expect(helper).toContain("wm.revoked_at is null");
    expect(helper).toContain("m.expires_at");
    expect(helper).toContain("wm.expires_at");
    expect(helper).toContain("statement_timestamp()");
    expect(helper).not.toContain("public.is_member(");
    expect(helper).not.toContain("public.is_member_with_role(");
    expect(helper).not.toContain("active_site");
    expect(helper).not.toContain("effective_site_capability");

    for (const name of protectedMutations.slice(4)) {
      expect(functionBody(name), name).toContain(
        "public.current_site_role_at_least",
      );
    }

    expect(functionBody("delete_wine_private")).toContain("'owner'");
    expect(functionBody("delete_wine_private")).not.toContain("'manager'");
  });

  it("preflights and enforces the closed metadata shapes before exposing them", () => {
    const manual = functionBody("wine_manual_overrides_valid");
    const enrichment = functionBody("wine_enrichment_metadata_valid");

    for (const field of ["drink_window", "region", "country", "varietal"]) {
      expect(manual).toContain(`'${field}'`);
    }
    expect(manual).toContain("cardinality");
    expect(manual).toContain("count(distinct");
    expect(manual).not.toContain("'colour'");

    for (const key of ["source", "fields_enriched", "enriched_at"]) {
      expect(enrichment).toContain(`'${key}'`);
    }
    expect(enrichment).toContain("rule_engine");
    expect(enrichment).toContain("lwin_fallback");
    expect(enrichment).toContain("count(*) from jsonb_object_keys");
    expect(enrichment).toContain("jsonb_array_length");
    expect(normalized).not.toContain("jsonb_object_length");
    expect(enrichment).toContain("extract(epoch");
    expect(enrichment).toContain("2000-01-01");
    expect(enrichment).toContain("2100-01-01");

    expect(normalized).toContain("c04_0157_historical_manual_overrides_invalid");
    expect(normalized).toContain("c04_0157_historical_enrichment_metadata_invalid");
    expect(normalized).toContain("wines_manual_overrides_valid_check");
    expect(normalized).toContain("wines_enrichment_metadata_valid_check");
    const historicalAdmission = normalized.slice(
      0,
      normalized.indexOf("alter table public.wines add constraint"),
    );
    expect(historicalAdmission).not.toMatch(
      /update public\.wines[\s\S]{0,240}(manual_overrides|enrichment_metadata)\s*=/u,
    );

    const addOverrides = functionBody("add_manual_overrides");
    expect(addOverrides).toContain("wine_manual_overrides_valid");
    expect(addOverrides).toContain("jsonb_build_object('wineid'");
    expect(addOverrides).toMatch(/'updated',\s*true/u);

    const enrich = functionBody("enrich_wines_batch");
    expect(enrich).toContain("jsonb_array_length(p_enrichments) > 2000");
    expect(enrich).toContain("wine_enrichment_metadata_valid");
    expect(enrich).toContain("jsonb_object_keys");
    expect(enrich).not.toContain("sqlerrm");
  });

  it("gates exact-site typed readers and preserves null, empty, and bounded wine filters", () => {
    for (const name of protectedReaders) {
      const body = functionBody(name);
      expect(body, name).toContain("security definer");
      expect(body, name).toMatch(/set search_path\s*=\s*''/u);
    }

    for (const name of [
      "read_inventory_costs",
      "read_wine_cost_flags",
      "read_invoice_scan_private",
      "read_invoice_scan_deletion_private",
      "read_import_batch_cost_rows",
      "read_cellar_health_private",
    ]) {
      expect(functionBody(name), name).toContain("'cost.read'");
    }
    for (const name of [
      "read_wine_pricing_strategy",
      "read_restaurant_pricing_defaults",
    ]) {
      expect(functionBody(name), name).toContain("'margin.read'");
    }
    for (const name of [
      "read_pricing_recommendations",
      "read_reconcile_action_private",
      "read_identity_merge_private",
    ]) {
      expect(functionBody(name), name).toContain("'cost.read'");
      expect(functionBody(name), name).toContain("'margin.read'");
    }

    for (const name of [
      "read_inventory_costs",
      "read_wine_pricing_strategy",
      "read_wine_cost_flags",
      "read_cellar_health_private",
    ]) {
      const body = functionBody(name);
      expect(body, name).toContain("p_wine_ids is null");
      expect(body, name).toContain("500");
      expect(body, name).toContain("count(distinct");
      expect(body, name).toContain("order by");
    }

    const invoice = functionBody("read_invoice_scan_private");
    expect(invoice).toContain("has_image");
    expect(invoice).toContain("image_count");
    const invoiceResult = invoice.slice(0, invoice.indexOf(" as $function$"));
    expect(invoiceResult).not.toContain("raw_image_path");
    expect(invoiceResult).not.toContain("extra_image_paths");
    expect(invoiceResult).not.toContain("object_name");
    expect(invoice).not.toContain("jsonb_build_object");

    const imported = functionBody("read_import_batch_cost_rows");
    expect(imported).toContain("p_after_row_number is null");
    expect(imported).toContain("p_limit is null");
    expect(imported).toContain("p_after_row_number >= 0");
    expect(imported).toContain("p_limit between 1 and 500");
    expect(imported).toContain("order by r.row_number asc, r.id asc");

    const display = functionBody("read_import_batch_display_rows");
    expect(display).toContain("public.current_site_role_at_least");
    expect(display).toContain("p_after_row_number is null");
    expect(display).toContain("p_limit is null");
    expect(display).toContain("jsonb_typeof(r.raw->'producer')='string'");
    expect(display).toContain("jsonb_typeof(r.raw->'name')='string'");
    expect(display).not.toContain("unit_cost");
    expect(display).not.toContain("last_error_message");

    const image = functionBody("read_invoice_image_target");
    expect(image).toContain("p_page_index not between 0 and 7");
    expect(image).toContain("public.current_site_role_at_least");
    expect(image).toContain("'cost.read'");
    expect(image).toContain("o.bucket_id='invoice-images'");
    expect(image).not.toContain("createsignedurl");
  });

  it("keeps inventory cost hidden across create and explicit-flag CAS patch receipts", () => {
    const create = functionBody("create_inventory_item_private");
    expect(create).toContain("public.current_site_role_at_least");
    expect(create).toContain("p_unit_cost numeric default 0");
    expect(create).toContain("p_currency text default null");
    expect(create).toContain("if p_unit_cost is null");
    expect(create).toContain("p_quantity between 0 and 100000");
    expect(create).toContain("p_unit_cost between 0 and 1000000");
    expect(create).toContain("w.restaurant_id = p_restaurant_id");
    expect(create).toContain("b.restaurant_id = p_restaurant_id");
    expect(create).toContain("s.restaurant_id = p_restaurant_id");
    expect(create).toContain("jsonb_build_object('inventoryitemid'");
    expect(create).not.toMatch(/jsonb_build_object\([^;]*unit_cost/u);

    const patch = functionBody("patch_inventory_item_private");
    expect(patch).toContain("for update");
    expect(patch).toContain("v_item.updated_at is distinct from p_expected_updated_at");
    expect(patch).toContain("case when p_set_quantity then p_quantity else v_item.quantity end");
    expect(patch).toContain("case when p_set_unit_cost then p_unit_cost else v_item.unit_cost end");
    expect(patch).toContain("p_set_unit_cost and p_unit_cost is null");
    expect(patch).toContain("physical_bottle_dependency");
    expect(patch).toContain("when sqlstate 'p04s1' then raise exception 'inventory_item_stale'");
    expect(patch).toContain("when sqlstate 'p04d1' then raise exception 'physical_bottle_dependency'");
    expect(patch).toContain("jsonb_build_object('inventoryitemid'");
    expect(patch).not.toMatch(/jsonb_build_object\([^;]*unit_cost/u);
  });

  it("binds the retry cache to actor, site, and kind with closed typed receipts", () => {
    const claim = functionBody("claim_scan_idempotency");
    const complete = functionBody("complete_scan_idempotency");
    const abandon = functionBody("abandon_scan_idempotency");

    for (const body of [claim, complete, abandon]) {
      expect(body).toContain("(select auth.uid())");
      expect(body).toContain("public.current_site_role_at_least");
      expect(body).toContain("claimed_by_user_id");
      expect(body).not.toContain("p_response_body");
      expect(body).not.toContain("sqlerrm");
    }
    for (const kind of [
      "invoice_scan_upload",
      "invoice_inventory_save",
      "bottle_inventory_save",
    ]) {
      expect(claim).toContain(`'${kind}'`);
      expect(complete).toContain(`'${kind}'`);
    }
    expect(claim).toContain("count(*) from jsonb_object_keys");
    expect(claim).toContain("jsonb_typeof(v_row.response_body->'version')='number'");
    expect(claim).toContain("s.id::text=v_row.response_body->>'scanid'");
    expect(claim).toContain("w.id::text=v_row.response_body->>'wineid'");
    expect(claim).toContain("c04_idempotency_conflict");
    expect(claim).toContain("p_kind is null");
    const actorGate = claim.indexOf(
      "v_row.claimed_by_user_id is distinct from v_actor",
    );
    const kindGate = claim.indexOf(
      "jsonb_typeof(v_row.response_body->'kind') is distinct from 'string'",
    );
    const ageGate = claim.indexOf(
      "v_row.created_at <= statement_timestamp()-interval '24 hours'",
    );
    expect(actorGate).toBeGreaterThan(-1);
    expect(kindGate).toBeGreaterThan(actorGate);
    expect(ageGate).toBeGreaterThan(kindGate);
    expect(complete).toContain("p_kind is null");
    expect(abandon).toContain("p_kind is null");
    expect(complete).toContain("c04_idempotency_expired");
    expect(complete).toContain("p_wine_count not between 0 and p_item_count");
    expect(complete).toContain("p_wine_id is not null");
    expect(complete).toContain("c04_idempotency_recompletion_mismatch");
    expect(normalized).toContain("24-hour scan transport retry cache");
    expect(normalized).toContain("not durable business-operation idempotency");
  });

  it("locks guarded scan, wine, and cache tables before historical snapshots", () => {
    const lockOrder = [
      "lock table public.invoice_scans in share row exclusive mode nowait",
      "lock table public.wines in share row exclusive mode nowait",
      "lock table public.scan_idempotency in share row exclusive mode nowait",
    ];
    for (const source of [normalized, preflight, normalizedDown]) {
      const positions = lockOrder.map((lock) => source.indexOf(lock));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions[0]).toBeLessThan(positions[1]);
      expect(positions[1]).toBeLessThan(positions[2]);
    }
    expect(normalized.indexOf(lockOrder[0])).toBeLessThan(
      normalized.indexOf("do $historical_metadata_preflight$"),
    );
  });

  it("closes helper execution and grants only exact protected RPC execution", () => {
    for (const name of [
      "current_site_role_at_least",
      "wine_manual_overrides_valid",
      "wine_enrichment_metadata_valid",
    ]) {
      expect(normalized).toContain(
        `revoke all on function public.${name}`,
      );
      const revoke = normalized.slice(
        normalized.indexOf(`revoke all on function public.${name}`),
      );
      expect(revoke.slice(0, 500)).toContain(
        "from public, anon, authenticated, service_role",
      );
    }

    for (const name of [
      ...protectedReaders,
      ...protectedMutations,
      ...operationalMutations,
    ]) {
      expect(normalized, name).toContain(`grant execute on function public.${name}`);
      expect(normalized, name).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^;]+\\) to authenticated`,
          "u",
        ),
      );
    }

    for (const signature of [
      "wine_manual_overrides_valid(text[])",
      "wine_enrichment_metadata_valid(jsonb)",
      "invoice_image_paths_valid(uuid,uuid,text,jsonb)",
    ]) {
      expect(normalized, signature).toContain(
        `grant execute on function public.${signature} to authenticated, service_role`,
      );
    }
    expect(normalized).not.toMatch(
      /grant execute on function public\.current_site_role_at_least\([^;]+\) to (authenticated|service_role)/u,
    );
    for (const name of ["invoice_line_items_valid", "invoice_edits_valid"]) {
      expect(normalized).toContain(`revoke all on function public.${name}`);
      expect(normalized).not.toMatch(
        new RegExp(`grant execute on function public\\.${name}\\(`, "u"),
      );
    }
    expect(normalized).toContain(
      "grant execute on function public.cleanup_scan_idempotency() to service_role",
    );
    expect(normalized).not.toContain(
      "grant execute on function public.cleanup_scan_idempotency() to authenticated",
    );

    for (const name of [
      "add_manual_overrides",
      "enrich_wines_batch",
      "create_import_batch",
      "count_import_batch_rows",
      "apply_import_batch_chunk",
      "revert_import_batch",
      "revert_import_session",
      "delete_invoice_scan",
      "merge_wines",
      "cleanup_scan_idempotency",
    ]) {
      expect(normalized).toContain(`public.${name}_pre_0157`);
      expect(normalized).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}_pre_0157\\([^;]+from public, anon, authenticated, service_role`,
          "u",
        ),
      );
    }

    expect(normalized).toContain(
      "create function public.dismiss_pricing_alert_private(",
    );
    expect(normalized).not.toContain(
      "alter function public.dismiss_pricing_alert(uuid,integer)",
    );
    expect(normalized).not.toContain(
      "public.dismiss_pricing_alert_pre_0157",
    );
    for (const name of [
      ...protectedReaders,
      ...protectedMutations,
      ...operationalMutations,
      "current_site_role_at_least",
      "wine_manual_overrides_valid",
      "wine_enrichment_metadata_valid",
      "invoice_line_items_valid",
      "invoice_edits_valid",
      "invoice_image_paths_valid",
      "cleanup_scan_idempotency",
    ]) {
      expect(normalized, name).toMatch(
        new RegExp(`alter function public\\.${name}\\([^;]+ owner to postgres`, "u"),
      );
    }

    expect(normalized).not.toMatch(
      /revoke\s+(select|insert|update|delete|all)\s+on\s+(table\s+)?public\.(inventory_items|wines|restaurants|pricing_recommendations|invoice_scans|invoice_scan_deletions|reconcile_actions|identity_merge_log|import_batch_rows|cellar_health|scan_idempotency)/u,
    );
  });

  it("uses fixed safe definer errors and adds no schema authority beyond actor binding", () => {
    expect(normalized).not.toContain("sqlerrm");
    expect(normalized).not.toMatch(/raise exception\s+[^;]*%/u);
    expect(normalized).not.toContain("using detail");
    expect(normalized).not.toContain("using hint");
    expect(normalized.match(/add column claimed_by_user_id uuid/gu)).toHaveLength(1);
    expect(normalized).not.toMatch(/alter table public\.[a-z_]+ add column (?!claimed_by_user_id)/u);

    for (const name of [
      "create_inventory_item_private",
      "patch_inventory_item_private",
      "review_invoice_scan",
      "commit_invoice_scan",
      "create_import_batch",
      "apply_import_batch_chunk",
      "accept_reconcile_batch",
      "undo_reconcile_batch",
    ]) {
      expect(functionBody(name), name).toContain("exception");
      expect(functionBody(name), name).toMatch(/c04_[a-z_]+_refused/u);
    }

    for (const name of [
      "review_invoice_scan",
      "commit_invoice_scan",
      "delete_invoice_scan",
      "request_invoice_scan_reextract",
    ]) {
      expect(functionBody(name), name).not.toContain("sqlerrm");
    }
    expect(functionBody("undo_reconcile_batch")).not.toContain(
      "reconcile_batch_not_found",
    );
    const commit = functionBody("commit_invoice_scan");
    expect(commit).toContain("where not (x.item?'wine_id')");
    expect(commit).toContain("jsonb_build_object('wine_id',v_created_ids[q.unmatched_ordinal])");
    expect(commit).toContain("set final_line_items=v_lines,committed_at=statement_timestamp()");
    expect(commit).not.toContain("count(distinct ii.wine_id)");

    const merge = functionBody("merge_wines");
    expect(merge).toContain("s.committed_at is null");
    expect(merge).toContain("moved_uncommitted_invoice_scans");
    expect(merge).toContain("lineage_mismatch_merge");
    expect(merge).toContain("wine_not_found");

    const removeWine = functionBody("delete_wine_private");
    expect(removeWine).toContain("public.invoice_scan_deletions");
    expect(removeWine).toContain("public.reconcile_actions");
    expect(removeWine).toContain("wine_has_dependencies");

    const applyImport = functionBody("apply_import_batch_chunk");
    expect(applyImport).toContain("error_message text,error_code text");
    expect(applyImport).toContain("error_message:=error_code");
    expect(functionBody("revert_import_session")).toContain("'batches',v_results");

    const reconcile = functionBody("accept_reconcile_batch");
    expect(reconcile).toContain("s.restaurant_id=p_restaurant_id order by s.id for update");
    expect(reconcile).toContain("w.restaurant_id=p_restaurant_id order by w.id for update");
    expect(reconcile).toContain("ii.restaurant_id=p_restaurant_id order by ii.id for update");
  });

  it("ships guarded paired down and production flight checks", () => {
    expect(existsSync(downPath)).toBe(true);
    expect(normalizedDown).toContain("c04_0157_down_actor_bound_cache_history_present");
    expect(normalizedDown).toContain("drop column claimed_by_user_id");
    expect(normalizedDown).toContain("rename to create_import_batch");
    expect(normalizedDown).toContain("rename to delete_invoice_scan");
    expect(normalizedDown).toContain("rename to merge_wines");
    expect(normalizedDown).toContain(
      "grant execute on function public.merge_wines(uuid,uuid) to authenticated",
    );
    expect(normalizedDown).not.toContain(
      "grant execute on function public.merge_wines(uuid,uuid) to public",
    );
    expect(normalizedDown).toContain("drop constraint wines_manual_overrides_valid_check");
    expect(normalizedDown).toContain("drop constraint invoice_scans_image_paths_valid_check");
    expect(existsSync(preflightPath)).toBe(true);
    expect(preflight).toContain("c04_0157_historical_invoice_image_path_invalid");
    expect(preflight).toContain("jsonb_object_keys");
    expect(preflight).not.toContain("jsonb_object_length");
    expect(existsSync(postflightPath)).toBe(true);
    expect(postflight).toContain("c04_0157_authenticated_rpc_acl_mismatch");
    expect(postflight).toContain("c04_0157_legacy_alias_executable");
    expect(postflight).toContain("c04_0157_constraint_validator_acl_mismatch");
    expect(postflight).toContain("search_path=\"\"");
    expect(postflight).toContain("v_owner is distinct from 'postgres'");
    expect(postflight).toContain("c04_0157_legacy_dismissal_compatibility_mismatch");
  });
});
