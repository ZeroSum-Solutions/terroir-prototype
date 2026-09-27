import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/0157-production-remediation.sql", "utf8");
const normalized = source
  .replace(/--[^\n]*/gu, " ")
  .replace(/\s+/gu, " ")
  .trim()
  .toLowerCase();

describe("0157 production identity remediation", () => {
  it("requires an exact caller-supplied scan preimage", () => {
    expect(source).toContain(":'target_scan_id'");
    expect(source).toContain(":'expected_lines'");
    expect(source).toContain(":'expected_preimage_md5'");
    expect(normalized).toContain(
      "pg_catalog.md5(v_scan.final_line_items::text) <> v_expected_preimage_md5",
    );
    expect(normalized).toContain("for update");
  });

  it("requires a unique contained inventory identity for every line", () => {
    expect(normalized).toContain("ii.invoice_scan_id = v_scan.id");
    expect(normalized).toContain("ii.restaurant_id = v_scan.restaurant_id");
    expect(normalized).toContain("v_candidate_count <> 1");
    expect(normalized).toContain("v_wine_id = any(v_used_wine_ids)");
    expect(normalized).toContain("v_inventory_rows <> v_expected_lines");
    expect(normalized).toContain("v_inventory_wines <> v_expected_lines");
  });

  it("only adds wine_id and leaves transaction ownership to the caller", () => {
    expect(normalized).toContain(
      "v_item || pg_catalog.jsonb_build_object('wine_id', v_wine_id)",
    );
    expect(normalized).toContain("get diagnostics v_updated_rows = row_count");
    expect(normalized).not.toMatch(/^\s*(begin|commit|rollback)\s*;/gimu);
    expect(normalized).not.toContain("delete from");
    expect(normalized).not.toContain("insert into");
  });
});
