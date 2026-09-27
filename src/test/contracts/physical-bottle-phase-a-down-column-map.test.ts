import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0153_physical_bottle_expansion.sql"),
  "utf8",
);
const acceptance = readFileSync(
  resolve(
    process.cwd(),
    "supabase/tests/0153_physical_bottle_expansion/phase-a-down-acceptance.sql",
  ),
  "utf8",
);

const targetTables = new Set([
  "open_bottles",
  "pour_events",
  "bottle_closeouts",
  "inventory_command_receipts",
]);
const legacyReceiptOperationId =
  "public.inventory_command_receipts.operation_id";

function deriveAddedColumnPairs(source: string): string[] {
  const pairs: string[] = [];
  for (const statement of source.matchAll(
    /alter table public\.([a-z0-9_]+)\s+([\s\S]*?);/giu,
  )) {
    if (!targetTables.has(statement[1])) continue;
    for (const column of statement[2].matchAll(/\badd column\s+([a-z0-9_]+)/giu)) {
      pairs.push(`public.${statement[1]}.${column[1]}`);
    }
  }
  return pairs.sort();
}

function parseExactPairs(block: string): string[] {
  return Array.from(
    block.matchAll(
      /\('public\.([a-z0-9_]+)'::regclass,\s*'([a-z0-9_]+)'(?:::\w+)?\)/gu,
    ),
    (match) => `public.${match[1]}.${match[2]}`,
  ).sort();
}

function parseForbiddenPairs(source: string): string[] {
  const marker = source.match(
    /-- C06_PHASE_A_DOWN_COLUMN_PAIRS_BEGIN\n([\s\S]*?)-- C06_PHASE_A_DOWN_COLUMN_PAIRS_END/u,
  );
  if (marker) return parseExactPairs(marker[1]);

  const objectGate = source.indexOf("C06_DOWN_OBJECT_RESIDUE");
  const residueEnd = source.indexOf("C06_DOWN_COLUMN_RESIDUE", objectGate);
  const residueStart = source.lastIndexOf("if exists (", residueEnd);
  const block = source.slice(residueStart, residueEnd);
  const tables = Array.from(
    block.matchAll(/'public\.([a-z0-9_]+)'::regclass/gu),
    (match) => match[1],
  );
  const namesStart = block.indexOf("and a.attname in (");
  const namesEnd = block.indexOf(")", namesStart);
  const names = Array.from(
    block.slice(namesStart, namesEnd).matchAll(/'([a-z0-9_]+)'/gu),
    (match) => match[1],
  );
  return tables
    .flatMap((table) => names.map((name) => `public.${table}.${name}`))
    .sort();
}

function detectsResidue(present: string[], forbidden: string[]): boolean {
  const presentPairs = new Set(present);
  return forbidden.some((pair) => presentPairs.has(pair));
}

describe("C06 Phase A down column residue map", () => {
  it("permits the legacy receipt operation_id and rejects every 0153 addition", () => {
    const addedPairs = deriveAddedColumnPairs(migration);
    const forbiddenPairs = parseForbiddenPairs(acceptance);

    expect(addedPairs).toHaveLength(14);
    expect(new Set(forbiddenPairs).size).toBe(forbiddenPairs.length);
    expect(forbiddenPairs).toEqual(addedPairs);
    expect(forbiddenPairs).not.toContain(legacyReceiptOperationId);
    expect(detectsResidue([legacyReceiptOperationId], forbiddenPairs)).toBe(false);
    for (const pair of addedPairs) {
      expect(detectsResidue([pair], forbiddenPairs), pair).toBe(true);
    }
  });
});
