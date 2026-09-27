#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  APPROVED_FEATURE_COUNT,
  BUDGET_DECISION,
  COMPLETION_RULES,
  SCHEMA_VERSION,
  SOURCE_FILE,
  deriveCriterion,
  metadataForRequirement,
  parseCoreFeatures,
  verifyFeatureLedger,
} from "./verify-feature-ledger.mjs";

export const APPROVED_SOURCE_REPLACEMENTS = [
  {
    id: "TER-CF-142",
    domain: "pour_and_open_bottles",
    fromSourceText: "System opens a new bottle if none is currently open for the wine + format",
    toSourceText: "Opening is an explicit command that consumes one identified same-site source-lot unit and returns a new immutable bottle ID; an active bottle never triggers or blocks an implicit replacement",
  },
  {
    id: "TER-CF-143",
    domain: "pour_and_open_bottles",
    fromSourceText: "System decrements the open bottle's remaining ounces by the pour amount",
    toSourceText: "A pour decrements only the selected physical bottle's integer remaining mL; it never spills into another bottle",
  },
  {
    id: "TER-CF-146",
    domain: "pour_and_open_bottles",
    fromSourceText: "System maintains the open_bottles table via pour_events_maintain_open_bottle trigger",
    toSourceText: "Contract-2 events mutate by exact bottle ID with site/wine containment; no event trigger updates every open bottle of a wine",
  },
  {
    id: "TER-CF-147",
    domain: "pour_and_open_bottles",
    fromSourceText: "User can cancel/undo the most recent pour",
    toSourceText: "Undo appends one linked version-2 compensation against an exact eligible event; it never deletes evidence or targets “latest for wine”",
  },
  {
    id: "TER-CF-148",
    domain: "pour_and_open_bottles",
    fromSourceText: "User can view all currently open bottles at /cellar/open",
    toSourceText: "/cellar/open shows every active physical bottle as a distinct stable identity using its captured capacity and provenance state",
  },
  {
    id: "TER-CF-150",
    domain: "pour_and_open_bottles",
    fromSourceText: "User can atomically close only the selected open-bottle lifecycle identified by row ID plus opened_at, recording its discarded remaining volume",
    toSourceText: "Measured close and discard act only on the selected immutable bottle ID; discard records its exact remainder as spill and is not a measured closeout",
  },
  {
    id: "TER-CF-151",
    domain: "pour_and_open_bottles",
    fromSourceText: "System applies bottle-opening, pour, spill and close operations through the atomic execute_inventory_command database function",
    toSourceText: "Fresh physical open, pour, spill, close, discard, and undo writes use execute_physical_bottle_command; completed version-1 receipts remain replay-only",
  },
  {
    id: "TER-CF-152",
    domain: "pour_and_open_bottles",
    fromSourceText: "System rejects pours when no inventory remains",
    toSourceText: "Insufficient selected-bottle volume is non-mutating and never auto-opens, splits, or substitutes another bottle",
  },
  {
    id: "TER-CF-153",
    domain: "pour_and_open_bottles",
    fromSourceText: "User can configure default pour sizes per format (e.g., 5oz red glass)",
    toSourceText: "Venue-managed presets are positive integer-mL snapshots and include tasting sizes; editing a preset cannot change an in-flight service action",
  },
  {
    id: "TER-CF-157",
    domain: "reconciliation",
    fromSourceText: "System lists every open bottle with its tracked remaining volume",
    toSourceText: "Reconciliation lists exact active bottle IDs with remaining mL, captured capacity, and the state version frozen into the draft",
  },
  {
    id: "TER-CF-159",
    domain: "reconciliation",
    fromSourceText: "System computes variance and persists adjustments via reconcile_open_bottle",
    toSourceText: "Reconciliation variance is written as an exact-bottle version-2 event/effect under one batch receipt, not through the retired scalar wine-only RPC",
  },
  {
    id: "TER-CF-160",
    domain: "reconciliation",
    fromSourceText: "User can reconcile all open bottles in one batch via reconcile_open_bottles_batch",
    toSourceText: "Every reconciliation, including one bottle, uses one all-or-none execute_physical_reconciliation_batch call and one immutable operation UUID/payload",
  },
  {
    id: "TER-CF-161",
    domain: "reconciliation",
    fromSourceText: "System logs each reconciliation as an availability_event with the manager's user ID",
    toSourceText: "Each committed reconciliation entry has exact bottle/wine event and effect evidence; no availability event is allowed to stand in for physical identity",
  },
  {
    id: "TER-CF-164",
    domain: "reconciliation",
    fromSourceText: "System enforces manager-or-owner role for reconciliation writes",
    toSourceText: "The database revalidates current manager/owner authority for execution and exact replay; route UI state is not the authority",
  },
  {
    id: "TER-CF-192",
    domain: "api_layer",
    fromSourceText: "POST /api/pour records a pour event",
    toSourceText: "POST /api/pour requires an operation UUID and exactly one exact-bottle or predecessor-opening selector in physical mode, with no implicit open/split/substitution",
  },
  {
    id: "TER-CF-193",
    domain: "api_layer",
    fromSourceText: "POST /api/reconcile reconciles one or more open bottles",
    toSourceText: "POST /api/reconcile accepts one exact-bottle batch with frozen expected versions and replays only the same canonical payload",
  },
  {
    id: "TER-CF-244",
    domain: "database_constraints_and_functions",
    fromSourceText: "System treats execute_inventory_command as the canonical database entry point for new bottle-opening, pour, spill and close callers and retains record_pour only for legacy compatibility",
    toSourceText: "Version 2 uses the physical scalar and batch RPCs; execute_inventory_command is completed-version-1 replay-only and all other legacy writers are retired",
  },
  {
    id: "TER-CF-245",
    domain: "database_constraints_and_functions",
    fromSourceText: "reconcile_open_bottle and reconcile_open_bottles_batch settle inventory",
    toSourceText: "execute_physical_reconciliation_batch is the only physical reconciliation writer, including for a one-entry batch",
  },
  {
    id: "TER-CF-263",
    domain: "testing_quality",
    fromSourceText: "Playwright covers the pour + reconcile end-to-end",
    toSourceText: "Browser coverage exercises distinct bottle selection, interrupted exact-payload retry, atomic reconciliation, and readable ambiguity/errors at 320px and 390px",
  },
  {
    id: "TER-CF-273",
    domain: "inventory_operation_integrity",
    fromSourceText: "System applies explicit bottle opening and closing atomically to the open-bottle lifecycle identified by row ID plus opened_at",
    toSourceText: "Fresh opens and closes target immutable physical bottle IDs; row ID plus opened_at remains only a version-1 historical receipt shape",
  },
];

const keyFor = (domain, sourceText) => `${domain}\u0000${sourceText}`;

function assertUniqueAssertions(features) {
  const seen = new Map();
  for (const feature of features) {
    const previous = seen.get(feature.sourceText);
    if (previous) {
      throw new Error(
        `duplicate source assertion at orders ${previous} and ${feature.sourceOrder}: ${feature.sourceText}`,
      );
    }
    seen.set(feature.sourceText, feature.sourceOrder);
  }
}

export function createInitialLedger(
  source,
  approvedFeatureCount = APPROVED_FEATURE_COUNT,
  completionRules = COMPLETION_RULES,
) {
  const features = parseCoreFeatures(source);
  assertUniqueAssertions(features);
  if (features.length !== approvedFeatureCount) {
    throw new Error(
      `source feature count must remain ${approvedFeatureCount}; received ${features.length}`,
    );
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceFile: SOURCE_FILE,
    featureCount: features.length,
    budgetResolution: {
      ...BUDGET_DECISION,
      approvedActiveCount: approvedFeatureCount,
    },
    items: features.map((feature) => ({
      id: `TER-CF-${String(feature.sourceOrder).padStart(3, "0")}`,
      ...feature,
      ...deriveCriterion(feature.sourceText),
      status: "active",
      ...metadataForRequirement(feature.sourceOrder, completionRules),
    })),
  };
}

export function generateFeatureLedger({
  source,
  previousLedger,
  approvedFeatureCount = APPROVED_FEATURE_COUNT,
  completionRules = COMPLETION_RULES,
  replacements = APPROVED_SOURCE_REPLACEMENTS,
}) {
  const features = parseCoreFeatures(source);
  assertUniqueAssertions(features);
  if (features.length !== approvedFeatureCount) {
    throw new Error(
      `source feature count must remain ${approvedFeatureCount}; received ${features.length}`,
    );
  }
  if (!previousLedger || !Array.isArray(previousLedger.items)) {
    throw new Error("previous feature ledger must contain an items array");
  }

  const priorByKey = new Map();
  const priorById = new Map();
  for (const item of previousLedger.items) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.domain !== "string" ||
      typeof item.sourceText !== "string"
    ) {
      throw new Error("previous feature ledger contains an invalid item");
    }
    if (!/^TER-CF-\d{3,}$/.test(item.id)) {
      throw new Error(`invalid previous ID: ${item.id}`);
    }
    const key = keyFor(item.domain, item.sourceText);
    if (priorByKey.has(key)) throw new Error(`duplicate previous assertion: ${item.sourceText}`);
    if (priorById.has(item.id)) throw new Error(`duplicate previous ID: ${item.id}`);
    priorByKey.set(key, item);
    priorById.set(item.id, item);
  }

  const replacementByTarget = new Map();
  for (const replacement of replacements) {
    const key = keyFor(replacement.domain, replacement.toSourceText);
    if (replacementByTarget.has(key)) {
      throw new Error(`duplicate replacement target: ${replacement.toSourceText}`);
    }
    replacementByTarget.set(key, replacement);
  }

  const claimedIds = new Set();
  const pending = features.map((feature) => {
    let prior = priorByKey.get(keyFor(feature.domain, feature.sourceText));
    if (!prior) {
      const replacement = replacementByTarget.get(
        keyFor(feature.domain, feature.sourceText),
      );
      if (replacement) {
        prior = priorById.get(replacement.id);
        if (
          !prior ||
          prior.domain !== replacement.domain ||
          !(replacement.fromSourceTexts ?? [replacement.fromSourceText]).includes(
            prior.sourceText,
          )
        ) {
          throw new Error(`replacement source does not match ${replacement.id}`);
        }
      }
    }
    if (!prior) return { feature, prior: null };
    if (claimedIds.has(prior.id)) throw new Error(`previous ID reused: ${prior.id}`);
    if (prior.sourceOrder !== feature.sourceOrder) {
      throw new Error(
        `existing assertion ${prior.id} moved from source order ${prior.sourceOrder} to ${feature.sourceOrder}`,
      );
    }
    claimedIds.add(prior.id);
    return { feature, prior };
  });

  const unclaimed = previousLedger.items.filter((item) => !claimedIds.has(item.id));
  if (unclaimed.length > 0) {
    throw new Error(
      `source assertion changed or was removed without an explicit replacement: ${unclaimed[0].id}`,
    );
  }

  let nextId = Math.max(
    0,
    ...previousLedger.items.map((item) => Number(item.id.slice("TER-CF-".length))),
  );
  const items = pending.map(({ feature, prior }) => {
    if (prior) {
      return {
        id: prior.id,
        ...feature,
        ...deriveCriterion(feature.sourceText),
        status: prior.status,
        ...metadataForRequirement(feature.sourceOrder, completionRules),
      };
    }
    nextId += 1;
    return {
      id: `TER-CF-${String(nextId).padStart(3, "0")}`,
      ...feature,
      ...deriveCriterion(feature.sourceText),
      status: "active",
      ...metadataForRequirement(feature.sourceOrder, completionRules),
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceFile: SOURCE_FILE,
    featureCount: items.length,
    budgetResolution: {
      ...BUDGET_DECISION,
      approvedActiveCount: approvedFeatureCount,
    },
    items,
  };
}

export const renderFeatureLedger = (ledger) => `${JSON.stringify(ledger, null, 2)}\n`;

function runCli() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("Usage: node scripts/generate-feature-ledger.mjs --write|--check");
    process.exitCode = 1;
    return;
  }
  const specPath = path.resolve("app_spec.txt");
  const ledgerPath = path.resolve("docs/feature-ledger.json");
  try {
    const source = fs.readFileSync(specPath, "utf8");
    const previousLedger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    const completionPlan = fs.readFileSync(
      path.resolve("docs/plans/2026-07-20-terroir-completion-spec.md"),
      "utf8",
    );
    const generated = generateFeatureLedger({ source, previousLedger });
    const errors = verifyFeatureLedger(source, generated, completionPlan);
    if (errors.length > 0) {
      throw new Error(`generated ledger failed verification:\n- ${errors.join("\n- ")}`);
    }
    const rendered = renderFeatureLedger(generated);
    if (mode === "--check") {
      if (fs.readFileSync(ledgerPath, "utf8") !== rendered) {
        throw new Error("generated feature ledger is stale");
      }
      console.log(`Generated feature ledger verified: ${generated.featureCount} stable requirements.`);
      return;
    }
    const temporaryPath = `${ledgerPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, rendered);
    fs.renameSync(temporaryPath, ledgerPath);
    console.log(`Generated feature ledger: ${generated.featureCount} stable requirements.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
