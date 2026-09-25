import { describe, expect, it } from "vitest";
import {
  canonicalizePhysicalReconcileEntries,
  buildPhysicalReconcileItems,
  comparePostgresUuids,
  serializePhysicalReconcileRequest,
  validateNewPhysicalReconcileRequest,
} from "./reconcile-contract";

const BASE = "00000000-0000-4000-8000-0000000000";

describe("PostgreSQL UUID reconciliation ordering", () => {
  it.each([
    [`${BASE}0f`, `${BASE}10`],
    ["00000000-0000-4000-8000-00000000ffff", "00000000-0000-4000-8000-000000010000"],
    ["0fffffff-ffff-4fff-8fff-ffffffffffff", "10000000-0000-4000-8000-000000000000"],
  ])("sorts %s before %s", (left, right) => {
    expect(comparePostgresUuids(left, right)).toBeLessThan(0);
    expect(comparePostgresUuids(right, left)).toBeGreaterThan(0);
  });

  it("normalizes case and emits byte-stable canonical request JSON", () => {
    const first = {
      open_bottle_id: `${BASE}10`.toUpperCase(),
      expected_state_version: 8,
      target_remaining_ml: 300,
      note: null,
    };
    const second = {
      open_bottle_id: `${BASE}0f`,
      expected_state_version: 4,
      target_remaining_ml: 125,
      note: "counted",
    };

    expect(serializePhysicalReconcileRequest([first, second])).toBe(
      serializePhysicalReconcileRequest([second, first]),
    );
    expect(canonicalizePhysicalReconcileEntries([first, second])).toEqual([
      second,
      { ...first, open_bottle_id: first.open_bottle_id.toLowerCase() },
    ]);
  });

  it("builds one exact DTO per sibling and rejects non-physical rows", () => {
    const bottle = {
      id: `${BASE}0f`, wineId: "11111111-1111-4111-8111-111111111111",
      remainingMl: 300, nominalCapacityMl: 750,
      openedAt: "2026-09-24T12:00:00.000Z", preservationMethod: "none" as const,
      sourceProvenance: "known" as const, sourceBinLocation: "A1",
      identityContract: 2 as const, identityOrigin: "native" as const, stateVersion: 4,
    };
    const wine = { id: bottle.wineId, producer: "Producer", name: "Wine", vintage: 2022 };
    expect(buildPhysicalReconcileItems([bottle, { ...bottle, id: `${BASE}10` }], [wine]))
      .toMatchObject([
        { openBottleId: `${BASE}0f`, stateVersion: 4, nominalCapacityMl: 750 },
        { openBottleId: `${BASE}10`, stateVersion: 4, nominalCapacityMl: 750 },
      ]);
    expect(() => buildPhysicalReconcileItems([
      { ...bottle, identityContract: 1, nominalCapacityMl: null, identityOrigin: "legacy_slot" },
    ], [wine])).toThrow("invalid_physical_reconciliation_item");
  });

  it("rejects unsafe new operations before UUID freeze", () => {
    const item = buildPhysicalReconcileItems([{
      id: `${BASE}0f`, wineId: "11111111-1111-4111-8111-111111111111",
      remainingMl: 300, nominalCapacityMl: 750,
      openedAt: "2026-09-24T12:00:00.000Z", preservationMethod: "none",
      sourceProvenance: "known", sourceBinLocation: null,
      identityContract: 2, identityOrigin: "native", stateVersion: 4,
    }], [{
      id: "11111111-1111-4111-8111-111111111111",
      producer: "Producer", name: "Wine", vintage: 2022,
    }])[0];
    const entry = {
      open_bottle_id: item.openBottleId,
      expected_state_version: 4,
      target_remaining_ml: 100,
      note: null,
    };
    expect(validateNewPhysicalReconcileRequest([entry], [item])).toMatchObject({ ok: true });
    expect(validateNewPhysicalReconcileRequest([
      { ...entry, target_remaining_ml: 100.5 },
    ], [item])).toMatchObject({ ok: false });
    expect(validateNewPhysicalReconcileRequest([
      { ...entry, target_remaining_ml: 751 },
    ], [item])).toMatchObject({ ok: false });
    expect(validateNewPhysicalReconcileRequest([
      { ...entry, expected_state_version: Number.MAX_SAFE_INTEGER },
    ], [item])).toMatchObject({ ok: false });
    expect(validateNewPhysicalReconcileRequest(Array.from({ length: 101 }, (_, index) => ({
      ...entry,
      open_bottle_id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    })), [item])).toMatchObject({ ok: false });
  });
});
