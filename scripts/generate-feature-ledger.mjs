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
    id: "TER-CF-150",
    domain: "pour_and_open_bottles",
    fromSourceText: "User can manually close an open bottle and discard remaining",
    toSourceText:
      "User can atomically close only the selected open-bottle lifecycle identified by row ID plus opened_at, recording its discarded remaining volume",
  },
  {
    id: "TER-CF-151",
    domain: "pour_and_open_bottles",
    fromSourceTexts: [
      "System exposes record_pour DB function as the only write path for pours",
      "System applies service inventory mutations through the atomic execute_inventory_command database function",
    ],
    toSourceText:
      "System applies bottle-opening, pour, spill and close operations through the atomic execute_inventory_command database function",
  },
  {
    id: "TER-CF-244",
    domain: "database_constraints_and_functions",
    fromSourceText: "record_pour is the canonical pour-write entry point",
    toSourceText:
      "System treats execute_inventory_command as the canonical database entry point for new bottle-opening, pour, spill and close callers and retains record_pour only for legacy compatibility",
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
