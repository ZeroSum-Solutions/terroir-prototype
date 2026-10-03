import { describe, expect, it } from "vitest";
import { applyNullableRpcArgs } from "../../../scripts/nullable-rpc-args.mjs";

const functions = {
  complete_scan_idempotency: { p_scan_id: "string", p_wine_count: "number", p_wine_id: "string" },
  create_inventory_item_private: { p_bin_id: "string", p_bin_location: "string", p_currency: "string", p_format: "string", p_invoice_scan_id: "string", p_section: "string" },
  create_invoice_scan_upload: { p_invoice_date: "string", p_invoice_number: "string" },
  patch_inventory_item_private: { p_bin_id: "string", p_bin_location: "string", p_currency: "string", p_format: "string", p_quantity: "number", p_section: "string", p_unit_cost: "number" },
  read_cellar_health_private: { p_wine_ids: "string[]" },
  read_inventory_costs: { p_wine_ids: "string[]" },
  read_wine_cost_flags: { p_wine_ids: "string[]" },
  read_wine_pricing_strategy: { p_wine_ids: "string[]" },
  review_invoice_scan: { p_invoice_date: "string", p_invoice_number: "string" },
  save_bottle_inventory_private: { p_country: "string", p_format: "string", p_vintage: "number" },
  assign_wine_sections_private: { p_section: "string" },
  set_wine_pricing_strategy: { p_target_markup_ratio: "number", p_target_pour_cost_pct: "number" },
  create_invoice_scan_upload_manifest: { p_invoice_date: "string", p_invoice_number: "string" },
};

function multilineFunction(name: string, args: Record<string, string>) {
  return `      ${name}: {
        Args: {
          p_required_actor: string
${Object.entries(args).map(([field, type]) => `          ${field}: ${type}`).join("\n")}
        }
        Returns: { value: number }[]
      }`;
}

function inlineFunction(name: string, args: Record<string, string>) {
  return `      ${name}: {
        Args: { p_required_actor: string; ${Object.entries(args).map(([field, type]) => `${field}?: ${type}`).join("; ")} }
        Returns: { value: number }[]
      }`;
}

const entries = Object.entries(functions);
const body = `export type Database = {
  public: {
    Tables: { unchanged: { Row: { value: number } } }
    Functions: {
${entries.map(([name, args], index) => index % 2 === 0 ? multilineFunction(name, args) : inlineFunction(name, args)).join("\n")}
    }
    Enums: { role: "staff" | "manager" }
  }
}
export const Constants = {
  public: { Enums: { role: ["staff", "manager"] } },
} as const
`;

describe("closed nullable RPC argument normalization", () => {
  it("changes only the 32 exact accepted nullable argument type spans", () => {
    const result = applyNullableRpcArgs(body);
    expect(result.match(/ \| null/g)).toHaveLength(32);
    const expected = [...body.matchAll(/p_(?:bin_id|bin_location|country|currency|format|invoice_scan_id|section|invoice_date|invoice_number|quantity|unit_cost|vintage|wine_ids|scan_id|wine_count|wine_id|target_markup_ratio|target_pour_cost_pct)\??: (?:string\[\]|string|number)/g)];
    expect(expected).toHaveLength(32);

    let restored = result;
    for (const [name, args] of entries) {
      for (const [field, type] of Object.entries(args)) {
        const optional = entries.findIndex(([entryName]) => entryName === name) % 2 === 1 ? "?" : "";
        expect(result).toContain(`${field}${optional}: ${type} | null`);
      }
    }
    restored = restored.replace(/(p_(?:bin_id|bin_location|country|currency|format|invoice_scan_id|section|invoice_date|invoice_number|quantity|unit_cost|vintage|wine_ids|scan_id|wine_count|wine_id|target_markup_ratio|target_pour_cost_pct)\??: (?:string\[\]|string|number)) \| null/g, "$1");
    expect(restored).toBe(body);
    expect(result).toContain("p_required_actor: string");
    expect(result).not.toContain("p_required_actor: string | null");
    expect(result).toContain("Returns: { value: number }[]");
    expect(result).toContain('Enums: { role: "staff" | "manager" }');
    expect(result).toContain('public: { Enums: { role: ["staff", "manager"] } }');
  });

  it("is idempotent after exact normalization", () => {
    const normalized = applyNullableRpcArgs(body);
    expect(applyNullableRpcArgs(normalized)).toBe(normalized);
  });

  it("allows clearing a section without widening its required site or wine-set inputs", () => {
    const input = body.replace(
      multilineFunction("assign_wine_sections_private", functions.assign_wine_sections_private),
      multilineFunction("assign_wine_sections_private", {
        p_restaurant_id: "string", p_wine_ids: "string[]", p_section: "string",
      }),
    );
    const normalized = applyNullableRpcArgs(input);
    const result = normalized.slice(normalized.indexOf("assign_wine_sections_private:"));
    expect(result).toContain("p_section: string | null");
    for (const field of ["p_restaurant_id: string", "p_wine_ids: string[]"]) {
      expect(result).toContain(field);
      expect(result).not.toContain(`${field} | null`);
    }
    expect(result).toContain("Returns: { value: number }[]");
  });

  it("keeps bottle identity, quantity and captured cost required and nonnullable", () => {
    const input = body.replace(
      "p_country?: string; p_format?: string; p_vintage?: number",
      "p_country?: string; p_format?: string; p_vintage?: number; p_restaurant_id: string; p_key: string; p_quantity: number; p_unit_cost: number",
    );
    const normalized = applyNullableRpcArgs(input);
    const result = normalized.slice(normalized.indexOf("save_bottle_inventory_private:"), normalized.indexOf("set_wine_pricing_strategy:"));
    expect(result).toContain("p_country?: string | null");
    expect(result).toContain("p_format?: string | null");
    expect(result).toContain("p_vintage?: number | null");
    for (const field of ["p_restaurant_id: string", "p_key: string", "p_quantity: number", "p_unit_cost: number"]) {
      expect(result).toContain(field);
      expect(result).not.toContain(`${field} | null`);
    }
  });

  it.each([
    ["missing function", body.replace("      review_invoice_scan:", "      renamed_review_invoice_scan:")],
    ["missing bottle writer", body.replace("      save_bottle_inventory_private:", "      missing_bottle_writer:")],
    ["missing section writer", body.replace("      assign_wine_sections_private:", "      missing_section_writer:")],
    ["wrong section type", body.replace(
      multilineFunction("assign_wine_sections_private", functions.assign_wine_sections_private),
      multilineFunction("assign_wine_sections_private", { p_section: "number" }),
    )],
    ["optional section", body.replace(
      multilineFunction("assign_wine_sections_private", functions.assign_wine_sections_private),
      multilineFunction("assign_wine_sections_private", functions.assign_wine_sections_private)
        .replace("p_section: string", "p_section?: string"),
    )],
    ["optional nullable section", body.replace(
      multilineFunction("assign_wine_sections_private", functions.assign_wine_sections_private),
      multilineFunction("assign_wine_sections_private", functions.assign_wine_sections_private)
        .replace("p_section: string", "p_section?: string | null"),
    )],
    ["wrong bottle vintage type", body.replace("p_vintage?: number", "p_vintage?: string")],
    ["wrong field type", body.replace("p_invoice_date: string", "p_invoice_date: number")],
    ["missing field", body.replace("          p_scan_id: string\n", "")],
    ["duplicate field", body.replace("          p_scan_id: string\n", "          p_scan_id: string\n          p_scan_id: string\n")],
    ["missing Functions", body.replace("    Functions: {", "    MissingFunctions: {")],
    ["duplicate function", body.replace("      review_invoice_scan:", `${multilineFunction("review_invoice_scan", functions.review_invoice_scan)}\n      review_invoice_scan:`)],
    ["non-object Args", body.replace("Args: { p_required_actor: string;", "Args: string & { p_required_actor: string;")],
    ["malformed TypeScript", body + "{"],
  ])("rejects %s drift", (_label, input) => {
    expect(() => applyNullableRpcArgs(input)).toThrow();
  });

  it("rejects a duplicate Database alias instead of touching an ambiguous schema", () => {
    expect(() => applyNullableRpcArgs(`${body}\n${body}`)).toThrow(/exactly one.*Database/);
  });
});
