export type PhysicalReconcileEntry = {
  open_bottle_id: string;
  expected_state_version: number;
  target_remaining_ml: number;
  note: string | null;
};

export type PhysicalReconcileItem = {
  openBottleId: string;
  wineId: string;
  producer: string;
  name: string;
  vintage: number | null;
  nominalCapacityMl: number;
  remainingMl: number;
  openedAt: string;
  preservationMethod: "coravin" | "argon" | "vacuum" | "none";
  sourceProvenance: "known" | "legacy_unknown";
  sourceBinLocation: string | null;
  stateVersion: number;
};

type ReconcileWine = {
  id: string;
  producer: string;
  name: string;
  vintage: number | null;
};

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normalizePostgresUuid(uuid: string): string {
  const normalized = uuid.toLowerCase();
  if (!CANONICAL_UUID.test(normalized)) throw new Error("invalid_uuid");
  return normalized;
}

export function comparePostgresUuids(left: string, right: string): number {
  const normalizedLeft = normalizePostgresUuid(left).replaceAll("-", "");
  const normalizedRight = normalizePostgresUuid(right).replaceAll("-", "");
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

export function canonicalizePhysicalReconcileEntries(
  entries: readonly PhysicalReconcileEntry[],
): PhysicalReconcileEntry[] {
  return entries
    .map((entry) => ({
      open_bottle_id: normalizePostgresUuid(entry.open_bottle_id),
      expected_state_version: entry.expected_state_version,
      target_remaining_ml: entry.target_remaining_ml,
      note: entry.note,
    }))
    .sort((left, right) =>
      comparePostgresUuids(left.open_bottle_id, right.open_bottle_id),
    );
}

export function serializePhysicalReconcileRequest(
  entries: readonly PhysicalReconcileEntry[],
): string {
  return JSON.stringify({ entries: canonicalizePhysicalReconcileEntries(entries) });
}

export type PhysicalReconcileValidation =
  | { ok: true; entries: PhysicalReconcileEntry[] }
  | { ok: false; message: string };

export function validateNewPhysicalReconcileRequest(
  entries: readonly PhysicalReconcileEntry[],
  items: readonly PhysicalReconcileItem[],
): PhysicalReconcileValidation {
  if (entries.length < 1 || entries.length > 100) {
    return { ok: false, message: "Reconciliation must contain between 1 and 100 bottles." };
  }
  let canonical: PhysicalReconcileEntry[];
  try {
    canonical = canonicalizePhysicalReconcileEntries(entries);
  } catch {
    return { ok: false, message: "A bottle identity could not be verified." };
  }
  if (new Set(canonical.map((entry) => entry.open_bottle_id)).size !== canonical.length) {
    return { ok: false, message: "A bottle appears more than once in this reconciliation." };
  }
  const itemById = new Map<string, PhysicalReconcileItem>();
  for (const item of items) {
    let bottleId: string;
    try {
      bottleId = normalizePostgresUuid(item.openBottleId);
      normalizePostgresUuid(item.wineId);
    } catch {
      return { ok: false, message: "A bottle identity could not be verified." };
    }
    if (itemById.has(bottleId) || !Number.isInteger(item.nominalCapacityMl) ||
      item.nominalCapacityMl <= 0 || item.nominalCapacityMl > 2_147_483_647 ||
      !Number.isSafeInteger(item.stateVersion) || item.stateVersion < 0) {
      return { ok: false, message: "Bottle state could not be verified. Refresh and try again." };
    }
    itemById.set(bottleId, item);
  }
  for (const entry of canonical) {
    const item = itemById.get(entry.open_bottle_id);
    if (!item || !Number.isSafeInteger(entry.expected_state_version) ||
      entry.expected_state_version < 0 || entry.expected_state_version >= Number.MAX_SAFE_INTEGER ||
      entry.expected_state_version !== item.stateVersion ||
      !Number.isInteger(entry.target_remaining_ml) || entry.target_remaining_ml < 0 ||
      entry.target_remaining_ml > item.nominalCapacityMl ||
      (entry.note !== null && (typeof entry.note !== "string" || entry.note.length > 500))) {
      return { ok: false, message: "Check each bottle's volume and state before saving." };
    }
  }
  return { ok: true, entries: canonical };
}

export function buildPhysicalReconcileItems(
  bottles: readonly PhysicalBottleSummary[],
  wines: readonly ReconcileWine[],
): PhysicalReconcileItem[] {
  const wineById = new Map(wines.map((wine) => [wine.id, wine]));
  return bottles.map((bottle) => {
    const wine = wineById.get(bottle.wineId);
    if (bottle.identityContract !== 2 || bottle.nominalCapacityMl === null || !wine) {
      throw new Error("invalid_physical_reconciliation_item");
    }
    return {
      openBottleId: bottle.id,
      wineId: bottle.wineId,
      producer: wine.producer,
      name: wine.name,
      vintage: wine.vintage,
      nominalCapacityMl: bottle.nominalCapacityMl,
      remainingMl: bottle.remainingMl,
      openedAt: bottle.openedAt,
      preservationMethod: bottle.preservationMethod,
      sourceProvenance: bottle.sourceProvenance,
      sourceBinLocation: bottle.sourceBinLocation,
      stateVersion: bottle.stateVersion,
    };
  }).sort((left, right) => comparePostgresUuids(left.openBottleId, right.openBottleId));
}

export function isPhysicalReconcileResponse(
  value: unknown,
  operationId: string,
  requestedEntries: readonly PhysicalReconcileEntry[],
): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["operation_id", "command", "entries"]) ||
    value.operation_id !== operationId || value.command !== "reconcile_batch" ||
    !Array.isArray(value.entries)) return false;
  const requested = canonicalizePhysicalReconcileEntries(requestedEntries);
  if (value.entries.length !== requested.length) return false;
  return value.entries.every((entry, index) => {
    const expected = requested[index];
    return isRecord(entry) && hasExactKeys(entry, [
      "entry_ordinal", "open_bottle_id", "wine_id", "pour_event_id",
      "remaining_ml", "state_version",
    ]) && entry.entry_ordinal === index &&
      entry.open_bottle_id === expected.open_bottle_id &&
      typeof entry.wine_id === "string" && isUuid(entry.wine_id) &&
      typeof entry.pour_event_id === "string" && isUuid(entry.pour_event_id) &&
      entry.remaining_ml === expected.target_remaining_ml &&
      entry.state_version === expected.expected_state_version + 1;
  });
}

function isUuid(value: string): boolean {
  return CANONICAL_UUID.test(value.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}
import type { PhysicalBottleSummary } from "@/lib/wine-list/shapes";
