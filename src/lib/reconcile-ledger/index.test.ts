import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AcceptActionsSchema,
  AcceptReconcileReceiptSchema,
  UndoReconcileReceiptSchema,
} from "./index";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const expectedLine = {
  id: "line-1",
  name: "Estate Red",
  producer: "Domaine Test",
  vintage: 2021,
  varietal: "Pinot Noir",
  region: "Burgundy",
  qty: 2,
  unitCost: 42.5,
  lineTotal: 85,
  currency: "USD",
  format: "750ml",
  confidence: 0.95,
  lowFields: ["vintage"],
};

describe("reconcile RPC contracts", () => {
  it("accepts the admitted four-action union and bounded current scan line", () => {
    expect(AcceptActionsSchema.parse([
      {
        action_type: "place_bin",
        subject_table: "inventory_items",
        subject_id: ID_A,
        patch: { bin_id: ID_B },
      },
      {
        action_type: "match_scan",
        subject_table: "invoice_scans",
        subject_id: ID_A,
        patch: { line_index: 499, wine_id: ID_B, expected_line: expectedLine },
      },
      {
        action_type: "link_lineage",
        subject_table: "wines",
        subject_id: ID_A,
        patch: { lineage_id: ID_B },
      },
      {
        action_type: "dismiss",
        subject_table: "wines",
        subject_id: ID_B,
        patch: {},
      },
    ])).toHaveLength(4);
  });

  it.each([
    ["missing required scan key", { ...expectedLine, confidence: undefined }],
    ["extra scan key", { ...expectedLine, lwin: "1000001" }],
    ["overlong UTF-8 scan string", { ...expectedLine, name: "é".repeat(251) }],
    ["fractional quantity", { ...expectedLine, qty: 1.5 }],
    ["invalid low field", { ...expectedLine, lowFields: ["wine_id"] }],
    ["duplicate low field", { ...expectedLine, lowFields: ["name", "name"] }],
  ])("rejects %s", (_label, line) => {
    expect(AcceptActionsSchema.safeParse([{
      action_type: "match_scan",
      subject_table: "invoice_scans",
      subject_id: ID_A,
      patch: { line_index: 0, wine_id: ID_B, expected_line: line },
    }]).success).toBe(false);
  });

  it("rejects duplicate subject keys and oversized aggregate payloads", () => {
    const duplicate = {
      action_type: "dismiss",
      subject_table: "wines",
      subject_id: ID_A,
      patch: {},
    };
    expect(AcceptActionsSchema.safeParse([duplicate, duplicate]).success).toBe(false);
    expect(AcceptActionsSchema.safeParse([{
      action_type: "match_scan",
      subject_table: "invoice_scans",
      subject_id: ID_A,
      patch: {
        line_index: 0,
        wine_id: ID_B,
        expected_line: { ...expectedLine, name: "x".repeat(2 * 1024 * 1024) },
      },
    }]).success).toBe(false);
  });

  it("decodes exact accept and undo receipts only", () => {
    const accept = { batchId: ID_A, actionCount: 1, status: "accepted" };
    const undo = {
      batchId: ID_A,
      actionCount: 1,
      status: "undone",
      undoneAt: "2026-09-26T12:34:56.000Z",
    };
    expect(AcceptReconcileReceiptSchema.parse(accept)).toEqual(accept);
    expect(UndoReconcileReceiptSchema.parse(undo)).toEqual(undo);
    expect(AcceptReconcileReceiptSchema.safeParse({ ...accept, extra: true }).success)
      .toBe(false);
    expect(UndoReconcileReceiptSchema.safeParse({ ...undo, undoneAt: "yesterday" }).success)
      .toBe(false);
  });
});

describe("reconcile production source boundary", () => {
  it("uses one mutation RPC and only a site-scoped identity read for undo", () => {
    const accept = source("src/app/api/reconcile-queue/accept/route.ts");
    const undo = source("src/app/api/reconcile-queue/undo/route.ts");
    expect(accept.match(/\.rpc\("accept_reconcile_batch"/g)).toHaveLength(1);
    expect(undo.match(/\.rpc\("undo_reconcile_batch"/g)).toHaveLength(1);
    expect(accept).not.toContain(".from(");
    expect(undo.match(/\.from\(/g)).toHaveLength(1);
    expect(undo).toContain('.from("reconcile_batches")');
    expect(undo).toContain('.select("id")');
    expect(undo).toContain('.eq("id", parsed.data.batch_id)');
    expect(undo).toContain('.eq("restaurant_id", auth.restaurantId)');
    expect(undo).not.toMatch(/\.(?:insert|update|upsert|delete)\(/);
    expect(undo.indexOf('.from("reconcile_batches")'))
      .toBeLessThan(undo.indexOf('.rpc("undo_reconcile_batch"'));
  });

  it("contains no legacy reconciliation mutation or compensation implementation", () => {
    const production = productionSource(resolve(process.cwd(), "src"));
    expect(production).not.toMatch(/\bacceptBatch\b/);
    expect(production).not.toMatch(/\bundoBatch\b/);

    const ledger = source("src/lib/reconcile-ledger/index.ts");
    expect(ledger).not.toContain('.from("reconcile_actions")');
    expect(ledger).not.toContain("acceptCompensation");
    expect(ledger).not.toContain("compensateUndo");
    expect(ledger).not.toContain('select("*")');
  });
});

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function productionSource(directory: string): string {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(productionSource(path));
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      files.push(`\n// ${relative(process.cwd(), path)}\n${readFileSync(path, "utf8")}`);
    }
  }
  return files.join("\n");
}
