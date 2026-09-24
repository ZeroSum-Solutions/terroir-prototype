import {
  isJsonObject,
  isLosslessNumber,
  LosslessJson,
  TOAST_MODIFIER_DEPTH_LIMIT,
} from "./contracts";

const UNITS = new Set([
  "NONE", "LB", "OZ", "KG", "G", "GAL", "L", "ML", "FL_OZ",
  "M", "CM", "FT", "IN", "YD",
]);
const NONPHYSICAL_TYPES = new Set([
  "TOAST_CARD_SELL",
  "TOAST_CARD_RELOAD",
  "HOUSE_ACCOUNT_PAY_BALANCE",
]);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

export type SelectionObservation = Readonly<{
  guid: string | null;
  itemGuid: string | null;
  checkGuid: string | null;
  parentGuid: string | null;
  depth: number;
  quantityToken: string | null;
  unit: string | null;
  createdDate: string | null;
  modifiedDate: string | null;
  fulfillmentStatus: string | null;
  selectionType: string | null;
  splitOriginGuid: string | null;
  deferred: boolean;
  voided: boolean;
  deleted: boolean;
  refunded: boolean;
  excludedReason: "deferred" | "nonphysical_selection_type" | null;
}>;

export type SelectionExtraction = Readonly<{
  selections: SelectionObservation[];
  issues: string[];
  incomplete: boolean;
}>;

export type SelectionMappingCandidate =
  | Readonly<{
      approvalState: "unreviewed";
      conversionId?: string | null;
    }>
  | Readonly<{
      approvalState: "approved";
      conversionId: string;
      sourceItemGuid: string;
      sourceUnit: string;
      targetVariantId: string;
      targetFormatId: string;
      effectiveFrom: string;
      effectiveUntil: string | null;
      reviewedByActorId: string;
      reviewedAt: string;
    }>;

function string(value: LosslessJson | undefined) {
  return typeof value === "string" && value.length ? value : null;
}

function bool(value: LosslessJson | undefined) {
  return typeof value === "boolean" ? value : false;
}

function nestedGuid(value: LosslessJson | undefined) {
  return value !== undefined && isJsonObject(value) ? string(value.guid) : null;
}

function selectionsFromChecks(order: { [key: string]: LosslessJson }) {
  const result: Array<{ checkGuid: string | null; selection: LosslessJson }> = [];
  if (!Array.isArray(order.checks)) return result;
  for (const check of order.checks) {
    if (isJsonObject(check) && Array.isArray(check.selections)) {
      result.push(...check.selections.map((selection) => ({
        checkGuid: string(check.guid),
        selection,
      })));
    }
  }
  return result;
}

export function extractSelections(
  order: { [key: string]: LosslessJson },
): SelectionExtraction {
  const selections: SelectionObservation[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();

  const visit = (
    value: LosslessJson,
    checkGuid: string | null,
    parentGuid: string | null,
    depth: number,
  ) => {
    if (!isJsonObject(value)) {
      issues.push("selection_not_object");
      return;
    }
    if (depth > TOAST_MODIFIER_DEPTH_LIMIT) {
      issues.push("modifier_depth_exceeded");
      return;
    }
    const guid = string(value.guid);
    if (guid && seen.has(guid)) {
      issues.push("duplicate_selection_guid");
      return;
    }
    if (guid) seen.add(guid);

    const selectionType = string(value.selectionType);
    const deferred = bool(value.deferred);
    selections.push({
      guid,
      itemGuid: nestedGuid(value.item),
      checkGuid,
      parentGuid,
      depth,
      quantityToken: isLosslessNumber(value.quantity) ? value.quantity.raw : null,
      unit: string(value.unitOfMeasure),
      createdDate: string(value.createdDate),
      modifiedDate: string(value.modifiedDate),
      fulfillmentStatus: string(value.fulfillmentStatus),
      selectionType,
      splitOriginGuid: nestedGuid(value.splitOrigin),
      deferred,
      voided: bool(value.voided),
      deleted: bool(value.deleted),
      refunded: isJsonObject(value.refundDetails),
      excludedReason: deferred
        ? "deferred"
        : selectionType && NONPHYSICAL_TYPES.has(selectionType)
          ? "nonphysical_selection_type"
          : null,
    });

    if (!Array.isArray(value.modifiers)) return;
    for (const modifier of value.modifiers) visit(modifier, checkGuid, guid, depth + 1);
  };

  for (const { checkGuid, selection } of selectionsFromChecks(order)) {
    visit(selection, checkGuid, null, 0);
  }
  return {
    selections,
    issues: [...new Set(issues)],
    incomplete: issues.length > 0,
  };
}

export function assessAutomatedMapping(
  selection: SelectionObservation,
  mapping: SelectionMappingCandidate | null,
) {
  const reasons: string[] = [];
  if (!selection.guid) reasons.push("missing_selection_guid");
  if (!selection.itemGuid) reasons.push("missing_item_guid");
  if (!selection.quantityToken) reasons.push("missing_quantity");
  if (!selection.unit) reasons.push("missing_unit");
  else if (!UNITS.has(selection.unit)) reasons.push("unknown_unit");
  const occurrenceTime = instant(selection.createdDate);
  if (occurrenceTime === null) {
    reasons.push("missing_occurrence_time");
  }
  if (!mapping || mapping.approvalState !== "approved") {
    reasons.push("mapping_not_approved");
  } else {
    const effectiveFrom = instant(mapping.effectiveFrom);
    const effectiveUntil = mapping.effectiveUntil === null
      ? null
      : instant(mapping.effectiveUntil);
    const complete = [
      mapping.conversionId,
      mapping.sourceItemGuid,
      mapping.sourceUnit,
      mapping.targetVariantId,
      mapping.targetFormatId,
      mapping.reviewedByActorId,
    ].every((value) => typeof value === "string" && value.trim().length > 0) &&
      instant(mapping.reviewedAt) !== null &&
      effectiveFrom !== null &&
      (mapping.effectiveUntil === null || effectiveUntil !== null);
    if (!complete) {
      reasons.push("incomplete_approved_mapping");
    } else if (effectiveUntil !== null && effectiveUntil <= effectiveFrom!) {
      reasons.push("invalid_mapping_effective_interval");
    } else {
      if (mapping.sourceItemGuid !== selection.itemGuid) {
        reasons.push("mapping_item_mismatch");
      }
      if (mapping.sourceUnit !== selection.unit) {
        reasons.push("mapping_unit_mismatch");
      }
      if (occurrenceTime !== null && occurrenceTime < effectiveFrom!) {
        reasons.push("mapping_not_yet_effective");
      } else if (
        occurrenceTime !== null &&
        effectiveUntil !== null &&
        occurrenceTime >= effectiveUntil
      ) {
        reasons.push("mapping_expired");
      }
    }
  }
  if (selection.selectionType === "OPEN_ITEM" || selection.selectionType === "SPECIAL_REQUEST") {
    reasons.push("reason_coded_manual_review");
  }
  return reasons.length
    ? { status: "needs_review" as const, reasons }
    : { status: "ready" as const, reasons: [] };
}

function instant(value: string | null | undefined) {
  if (!value || !ISO_INSTANT.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function selectMappedContributions(
  selections: SelectionObservation[],
  liquidIdByItemGuid: ReadonlyMap<string, string>,
) {
  const byGuid = new Map(
    selections.flatMap((selection) => selection.guid ? [[selection.guid, selection] as const] : []),
  );
  const contributions: Array<{ selectionGuid: string; liquidId: string }> = [];
  const issues: string[] = [];
  for (const selection of selections) {
    if (!selection.guid || !selection.itemGuid || selection.excludedReason) continue;
    const liquidId = liquidIdByItemGuid.get(selection.itemGuid);
    if (!liquidId) continue;
    let ancestorGuid = selection.parentGuid;
    let duplicateAncestor = false;
    while (ancestorGuid) {
      const ancestor = byGuid.get(ancestorGuid);
      if (!ancestor) break;
      if (
        ancestor.itemGuid &&
        liquidIdByItemGuid.get(ancestor.itemGuid) === liquidId
      ) {
        duplicateAncestor = true;
        break;
      }
      ancestorGuid = ancestor.parentGuid;
    }
    if (duplicateAncestor) {
      issues.push("ancestor_descendant_same_liquid");
    } else {
      contributions.push({ selectionGuid: selection.guid, liquidId });
    }
  }
  return { contributions, issues: [...new Set(issues)] };
}
