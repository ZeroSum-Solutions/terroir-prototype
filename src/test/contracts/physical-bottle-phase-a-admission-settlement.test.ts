import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/0153_physical_bottle_expansion.sql",
);
const preflightPath = resolve(
  process.cwd(),
  "scripts/0153-production-preflight.sql",
);
const downPath = resolve(
  process.cwd(),
  "supabase/migrations/down/0153_physical_bottle_expansion.down.sql",
);
const preflightFingerprintPath = resolve(
  process.cwd(),
  "supabase/tests/0153_physical_bottle_expansion/phase-a-preflight-fingerprint.sql",
);
const rehearsalPath = resolve(
  process.cwd(),
  "scripts/local/physical-bottle-phase-a-rehearsal.sh",
);
const testRelativePath =
  "src/test/contracts/physical-bottle-phase-a-admission-settlement.test.ts";

const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const down = readFileSync(downPath, "utf8");
const preflightFingerprint = readFileSync(preflightFingerprintPath, "utf8");
const rehearsal = readFileSync(rehearsalPath, "utf8");

const expectedPairs = [
  "public.bottle_closeouts.event_contract",
  "public.inventory_command_receipts.batch_entry_count",
  "public.inventory_command_receipts.command_version",
  "public.inventory_command_receipts.scope_kind",
  "public.open_bottles.identity_contract",
  "public.open_bottles.identity_origin",
  "public.open_bottles.nominal_capacity_ml",
  "public.open_bottles.opening_operation_id",
  "public.open_bottles.source_provenance",
  "public.open_bottles.state_version",
  "public.pour_events.event_contract",
  "public.pour_events.operation_entry_ordinal",
  "public.pour_events.operation_id",
  "public.pour_events.reversal_of_event_id",
].sort();

const expectedObjects = [
  "class:public.effective_service_pour_events",
  "class:public.inventory_command_bottle_effects",
  "procedure:public.current_inventory_contract_version()",
  "procedure:public.execute_physical_bottle_command(uuid,uuid,text,uuid,uuid,uuid,integer,text,text,integer,integer,uuid,uuid,text,boolean)",
  "procedure:public.execute_physical_reconciliation_batch(uuid,uuid,jsonb)",
  "procedure:public.list_active_physical_bottles(uuid)",
  "procedure:public.list_open_bottle_aggregates(uuid)",
].sort();

const expectedPreexistingConstraints = [
  "public.bottle_closeouts.bottle_closeouts_event_contract_check",
  "public.bottle_closeouts.bottle_closeouts_open_bottle_tenant_wine_fkey",
  "public.bottle_closeouts.bottle_closeouts_physical_shape_check",
  "public.inventory_command_receipts.inventory_command_receipts_batch_entry_count_check",
  "public.inventory_command_receipts.inventory_command_receipts_command_version_check",
  "public.inventory_command_receipts.inventory_command_receipts_scope_kind_check",
  "public.inventory_command_receipts.inventory_command_receipts_versioned_shape_check",
  "public.inventory_items.inventory_items_id_restaurant_wine_key",
  "public.open_bottles.open_bottles_id_restaurant_wine_key",
  "public.open_bottles.open_bottles_identity_contract_check",
  "public.open_bottles.open_bottles_identity_origin_check",
  "public.open_bottles.open_bottles_nominal_capacity_check",
  "public.open_bottles.open_bottles_physical_shape_check",
  "public.open_bottles.open_bottles_source_provenance_check",
  "public.open_bottles.open_bottles_state_version_check",
  "public.pour_events.pour_events_event_contract_check",
  "public.pour_events.pour_events_open_bottle_tenant_wine_fkey",
  "public.pour_events.pour_events_operation_entry_ordinal_check",
  "public.pour_events.pour_events_operation_receipt_fkey",
  "public.pour_events.pour_events_physical_shape_check",
  "public.pour_events.pour_events_reversal_of_event_fkey",
].sort();

const expectedReplacedConstraints = [
  "public.inventory_command_receipts.inventory_command_receipts_command_type_check",
  "public.pour_events.pour_events_kind_check",
].sort();

const expectedPreexistingIndexes = [
  "public.bottle_closeouts_open_bottle_tenant_wine_idx",
  "public.pour_events_open_bottle_tenant_wine_idx",
  "public.pour_events_operation_entry_key",
  "public.pour_events_reversal_key",
].sort();

const expectedSealedConstraintNames = [
  ...expectedPreexistingConstraints.map((identity) => identity.split(".").at(-1)!),
  ...expectedReplacedConstraints.map((identity) => identity.split(".").at(-1)!),
  "inventory_command_bottle_effects_bottle_fkey",
  "inventory_command_bottle_effects_effect_type_check",
  "inventory_command_bottle_effects_entry_ordinal_check",
  "inventory_command_bottle_effects_operation_bottle_effect_key",
  "inventory_command_bottle_effects_pkey",
  "inventory_command_bottle_effects_receipt_fkey",
].sort();

const fixtureRoots: string[] = [];
const fixtureParent = resolve(process.cwd(), "test-results");

function createFixtureRoot(prefix: string): string {
  mkdirSync(fixtureParent, { recursive: true });
  const root = mkdtempSync(join(fixtureParent, prefix));
  fixtureRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function extractMarkedBlock(source: string, marker: string): string {
  const expression = new RegExp(
    `(?:--|#)\\s*C06_${escapeRegExp(marker)}_BEGIN\\s*\\n([\\s\\S]*?)(?:--|#)\\s*C06_${escapeRegExp(marker)}_END`,
    "u",
  );
  const match = source.match(expression);
  if (!match) throw new Error(`Missing C06_${marker} marker block`);
  return match[1];
}

function normalizeSql(value: string): string {
  return value.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ").trim();
}

function parsePairs(block: string): string[] {
  const pairs = Array.from(
    block.matchAll(
      /\('public\.([a-z0-9_]+)'::regclass,\s*'([a-z0-9_]+)'\)/gu,
    ),
    (match) => `public.${match[1]}.${match[2]}`,
  );
  return pairs.sort();
}

function parseObjectIdentities(block: string): string[] {
  return Array.from(
    block.matchAll(/to_reg(class|procedure)\('([^']+)'\)/gu),
    (match) => `${match[1]}:${match[2]}`,
  ).sort();
}

function parseIndexIdentities(block: string): string[] {
  return Array.from(
    block.matchAll(/\('public\.([a-z0-9_]+)'\)/gu),
    (match) => `public.${match[1]}`,
  ).sort();
}

function parseQuotedNames(block: string): string[] {
  return Array.from(
    block.matchAll(/'([a-z][a-z0-9_]*)'/gu),
    (match) => match[1],
  ).sort();
}

function deriveDdlPairs(source: string): string[] {
  const pairs: string[] = [];
  const alterTable = /alter table public\.([a-z0-9_]+)\s+([\s\S]*?);/giu;
  for (const statement of source.matchAll(alterTable)) {
    for (const column of statement[2].matchAll(/\badd column\s+([a-z0-9_]+)/giu)) {
      pairs.push(`public.${statement[1]}.${column[1]}`);
    }
  }
  return pairs.sort();
}

function derivePreexistingConstraintIdentities(source: string): string[] {
  const identities: string[] = [];
  const alterTable = /alter table public\.([a-z0-9_]+)\s+([\s\S]*?);/giu;
  for (const statement of source.matchAll(alterTable)) {
    if (statement[1] === "inventory_command_bottle_effects") continue;
    for (const constraint of statement[2].matchAll(
      /\badd constraint\s+([a-z0-9_]+)/giu,
    )) {
      identities.push(`public.${statement[1]}.${constraint[1]}`);
    }
  }
  return identities.sort();
}

function derivePreexistingIndexIdentities(source: string): string[] {
  return Array.from(
    source.matchAll(
      /create\s+(?:unique\s+)?index\s+([a-z0-9_]+)\s+on\s+public\.([a-z0-9_]+)/giu,
    ),
    (match) => ({ index: `public.${match[1]}`, relation: match[2] }),
  )
    .filter(({ relation }) => relation !== "inventory_command_bottle_effects")
    .map(({ index }) => index)
    .sort();
}

type PhaseState = "pristine" | "complete_identity" | "partial_mixed";

function classifyIdentityState(
  presentPairs: Iterable<string>,
  presentObjects: Iterable<string>,
  presentConstraints: Iterable<string> = [],
  presentIndexes: Iterable<string> = [],
): PhaseState {
  const targetPairs = new Set(expectedPairs);
  const targetObjects = new Set(expectedObjects);
  const targetConstraints = new Set(expectedPreexistingConstraints);
  const targetIndexes = new Set(expectedPreexistingIndexes);
  const pairCount = new Set(
    Array.from(presentPairs).filter((identity) => targetPairs.has(identity)),
  ).size;
  const objectCount = new Set(
    Array.from(presentObjects).filter((identity) => targetObjects.has(identity)),
  ).size;
  const constraintCount = new Set(
    Array.from(presentConstraints).filter((identity) =>
      targetConstraints.has(identity),
    ),
  ).size;
  const indexCount = new Set(
    Array.from(presentIndexes).filter((identity) => targetIndexes.has(identity)),
  ).size;

  if (
    pairCount === 0 &&
    objectCount === 0 &&
    constraintCount === 0 &&
    indexCount === 0
  ) {
    return "pristine";
  }
  if (
    pairCount === 14 &&
    objectCount === 7 &&
    constraintCount === 21 &&
    indexCount === 4
  ) {
    return "complete_identity";
  }
  return "partial_mixed";
}

function assertOrdered(events: string[], expected: string[]): void {
  let cursor = -1;
  for (const event of expected) {
    const next = events.indexOf(event, cursor + 1);
    expect(next, `missing ordered event ${event}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

type ShellScenario =
  | "non-lock-failure"
  | "unexpected-success"
  | "diff-failure"
  | "ambiguous-owner"
  | "term-resistant";

function runShellScenario(scenario: ShellScenario) {
  const root = createFixtureRoot("c06-holder-contract-");
  const proof = join(root, "proof");
  mkdirSync(proof);
  const fingerprint = join(root, "fingerprint.sql");
  const migrationFile = join(root, "migration.sql");
  writeFileSync(fingerprint, "select 'fingerprint';\n");
  writeFileSync(migrationFile, "select 'migration';\n");

  const lifecycle = extractMarkedBlock(rehearsal, "HOLDER_SETTLEMENT");
  const runner = join(root, "runner.sh");
  writeFileSync(
    runner,
    `#!/bin/bash
set -euo pipefail
proof_dir="$C06_STUB_ROOT/proof"
container=fake-container
pg_user=fake-user
run_id=unit
fingerprint_calls=0

${lifecycle}

c06_child_initial_wait_attempts=3
c06_child_term_wait_attempts=3
c06_child_kill_wait_attempts=3
c06_child_wait_delay=0.01

docker() {
  local arguments="$*"
  if [[ "$arguments" == *"pg_sleep(60)"* ]]; then
    if [ "$C06_SCENARIO" = "term-resistant" ]; then
      trap '' TERM
      while true; do sleep 0.01; done
    fi
    for attempt in $(seq 1 100); do
      if [ -f "$C06_STUB_ROOT/terminate" ]; then
        return 1
      fi
      sleep 0.01
    done
    return 124
  fi
  if [ "$C06_SCENARIO" = "unexpected-success" ]; then
    printf '%s\n' 'unexpected success'
    return 0
  fi
  printf '%s\n' 'ERROR: P0001 injected non-lock failure' >&2
  return 1
}

psql_cmd() {
  local arguments="$*"
  case "$arguments" in
    *"select pid"*)
      if [ "$C06_SCENARIO" = "ambiguous-owner" ]; then
        printf '%s\n' '4242' '4343'
      else
        printf '%s\n' '4242'
      fi
      ;;
    *"pg_terminate_backend"*)
      : > "$C06_STUB_ROOT/terminate"
      printf '%s\n' 't'
      ;;
    *"select count(*)"*)
      if [ "$C06_SCENARIO" = "ambiguous-owner" ]; then
        printf '%s\n' '2'
      else
        printf '%s\n' '0'
      fi
      ;;
    *) printf '%s\n' "unexpected fake psql_cmd: $arguments" >&2; return 97 ;;
  esac
}

psql_file() {
  fingerprint_calls=$((fingerprint_calls + 1))
  if [ "$C06_SCENARIO" = "diff-failure" ] && [ "$fingerprint_calls" -gt 1 ]; then
    printf '%s\n' 'changed'
  else
    printf '%s\n' 'stable'
  fi
}

unrelated_pid=
if [ "$C06_SCENARIO" = "term-resistant" ]; then
  sleep 10 &
  unrelated_pid=$!
fi

set +e
run_lock_refusal source_db forward inventory_items "$C06_FINGERPRINT" "$C06_MIGRATION" single
run_status=$?
c06_settle_all_owned_processes
settle_status=$?
set -e
sealed=0
if [ -f "$proof_dir/owned-processes-settled.txt" ] && [ -f "$proof_dir/owned-process-evidence-ready.txt" ]; then
  c06_record_owned_event finalizer final-evidence-seal
  printf '%s\n' sealed > "$proof_dir/final-evidence-seal.txt"
  sealed=1
fi
unrelated_alive=not-applicable
if [ -n "$unrelated_pid" ]; then
  unrelated_alive=0
  if kill -0 "$unrelated_pid" 2>/dev/null; then
    unrelated_alive=1
    kill "$unrelated_pid"
    wait "$unrelated_pid" 2>/dev/null || true
  fi
fi
printf 'RUN_STATUS=%s SETTLE_STATUS=%s SEALED=%s UNRELATED_ALIVE=%s\n' "$run_status" "$settle_status" "$sealed" "$unrelated_alive"
`,
  );
  chmodSync(runner, 0o700);

  const result = spawnSync("/bin/bash", ["--noprofile", "--norc", runner], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: "/usr/bin:/bin",
      C06_STUB_ROOT: root,
      C06_SCENARIO: scenario,
      C06_FINGERPRINT: fingerprint,
      C06_MIGRATION: migrationFile,
    },
    timeout: 5_000,
  });
  const eventPath = join(proof, "owned-process-events.tsv");
  const events = readFileSync(eventPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split("\t")[1]);

  return { result, root, proof, events };
}

function runExitFinalizerScenario() {
  const root = createFixtureRoot("c06-holder-exit-contract-");
  const proof = join(root, "proof");
  mkdirSync(proof);
  const lifecycle = extractMarkedBlock(rehearsal, "HOLDER_SETTLEMENT");
  const runner = join(root, "runner.sh");
  writeFileSync(
    runner,
    `#!/bin/bash
set -euo pipefail
proof_dir="$C06_STUB_ROOT/proof"
container=fake-container
pg_user=fake-user
run_id=unit

${lifecycle}

c06_child_initial_wait_attempts=3
c06_child_term_wait_attempts=3
c06_child_kill_wait_attempts=3
c06_child_wait_delay=0.01

docker() {
  for attempt in $(seq 1 100); do
    if [ -f "$C06_STUB_ROOT/terminate" ]; then
      return 1
    fi
    sleep 0.01
  done
  return 124
}

psql_cmd() {
  local arguments="$*"
  case "$arguments" in
    *"select pid"*) printf '%s\n' '4242' ;;
    *"pg_terminate_backend"*)
      : > "$C06_STUB_ROOT/terminate"
      printf '%s\n' 't'
      ;;
    *"select count(*)"*) printf '%s\n' '0' ;;
    *) return 97 ;;
  esac
}

trap c06_finalize_owned_processes EXIT
docker exec fake psql -c 'select pg_sleep(60)' > "$proof_dir/holder.txt" 2>&1 &
holder_pid=$!
c06_register_owned_process "$holder_pid" source_db c06_exit_finalizer_unit exit-finalizer
c06_set_owned_backend "$c06_registered_index" 4242
exit 9
`,
  );
  chmodSync(runner, 0o700);
  const result = spawnSync("/bin/bash", ["--noprofile", "--norc", runner], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: "/usr/bin:/bin",
      C06_STUB_ROOT: root,
    },
    timeout: 5_000,
  });
  const events = readFileSync(join(proof, "owned-process-events.tsv"), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split("\t")[1]);
  return { result, proof, events };
}

describe("C06 Phase A exact catalog admission", () => {
  it("keeps every admission inventory aligned with all relevant DDL", () => {
    const migrationPairs = parsePairs(
      extractMarkedBlock(migration, "PHASE_A_COLUMN_PAIRS"),
    );
    const preflightPairs = parsePairs(
      extractMarkedBlock(preflight, "PHASE_A_COLUMN_PAIRS"),
    );
    const migrationConstraints = parsePairs(
      extractMarkedBlock(migration, "PHASE_A_CONSTRAINT_IDENTITIES"),
    );
    const preflightConstraints = parsePairs(
      extractMarkedBlock(preflight, "PHASE_A_CONSTRAINT_IDENTITIES"),
    );
    const migrationIndexes = parseIndexIdentities(
      extractMarkedBlock(migration, "PHASE_A_INDEX_IDENTITIES"),
    );
    const preflightIndexes = parseIndexIdentities(
      extractMarkedBlock(preflight, "PHASE_A_INDEX_IDENTITIES"),
    );

    expect(new Set(migrationPairs).size).toBe(14);
    expect(migrationPairs).toEqual(expectedPairs);
    expect(preflightPairs).toEqual(expectedPairs);
    expect(deriveDdlPairs(migration)).toEqual(expectedPairs);
    expect(migrationConstraints).toEqual(expectedPreexistingConstraints);
    expect(preflightConstraints).toEqual(expectedPreexistingConstraints);
    expect(derivePreexistingConstraintIdentities(migration)).toEqual(
      [...expectedPreexistingConstraints, ...expectedReplacedConstraints].sort(),
    );
    expect(migrationIndexes).toEqual(expectedPreexistingIndexes);
    expect(preflightIndexes).toEqual(expectedPreexistingIndexes);
    expect(derivePreexistingIndexIdentities(migration)).toEqual(
      expectedPreexistingIndexes,
    );
    expect(rehearsal).toContain("constraint_collision");
    expect(rehearsal).toContain("index_wrong_kind");
    expect(rehearsal).toContain(
      "add constraint open_bottles_identity_contract_check check(remaining_ml>=0)",
    );
    expect(rehearsal).toContain(
      "create sequence public.pour_events_open_bottle_tenant_wine_idx",
    );
    expect(preflightFingerprint).toContain(
      "c06_preexisting_index_identities",
    );
    for (const index of expectedPreexistingIndexes) {
      expect(preflightFingerprint).toContain(`'${index.slice("public.".length)}'`);
    }
  });

  it("keeps the exact object inventory and classifier expression identical", () => {
    const migrationObjects = extractMarkedBlock(
      migration,
      "PHASE_A_OBJECT_IDENTITIES",
    );
    const preflightObjects = extractMarkedBlock(
      preflight,
      "PHASE_A_OBJECT_IDENTITIES",
    );
    const migrationClassifier = normalizeSql(
      extractMarkedBlock(migration, "PHASE_A_STATE_CLASSIFIER"),
    );
    const preflightClassifier = normalizeSql(
      extractMarkedBlock(preflight, "PHASE_A_STATE_CLASSIFIER"),
    );

    expect(parseObjectIdentities(migrationObjects)).toEqual(expectedObjects);
    expect(parseObjectIdentities(preflightObjects)).toEqual(expectedObjects);
    expect(migrationClassifier).toBe(preflightClassifier);
    expect(migrationClassifier).toContain("v_present_column_pair_count = 14");
    expect(migrationClassifier).toContain("v_present_object_count = 7");
    expect(migrationClassifier).toContain(
      "v_present_constraint_identity_count = 21",
    );
    expect(migrationClassifier).toContain(
      "v_present_index_identity_count = 4",
    );
  });

  it("admits the legacy receipt pair and wrong-table same-name controls", () => {
    expect(
      classifyIdentityState(["public.inventory_command_receipts.operation_id"], []),
    ).toBe("pristine");

    const tables = [
      "public.open_bottles",
      "public.inventory_command_receipts",
      "public.pour_events",
      "public.bottle_closeouts",
    ];
    const wrongTablePairs = Array.from(
      new Set(expectedPairs.map((pair) => pair.split(".").at(-1)!)),
      (column) => {
        const table = tables.find(
          (candidate) => !expectedPairs.includes(`${candidate}.${column}`),
        );
        if (!table) throw new Error(`No wrong-table control for ${column}`);
        return `${table}.${column}`;
      },
    );
    expect(classifyIdentityState(wrongTablePairs, [])).toBe("pristine");
  });

  it("classifies every exact singleton and every 13-of-14 set as partial", () => {
    for (const pair of expectedPairs) {
      expect(classifyIdentityState([pair], [])).toBe("partial_mixed");
      expect(
        classifyIdentityState(
          expectedPairs.filter((candidate) => candidate !== pair),
          expectedObjects,
          expectedPreexistingConstraints,
          expectedPreexistingIndexes,
        ),
      ).toBe("partial_mixed");
    }
    expect(classifyIdentityState(expectedPairs.slice(0, 2), [])).toBe(
      "partial_mixed",
    );
  });

  it("classifies partial object/pair combinations without treating wrong kind as absent", () => {
    for (const object of expectedObjects) {
      expect(classifyIdentityState([], [object])).toBe("partial_mixed");
    }
    for (const constraint of expectedPreexistingConstraints) {
      expect(classifyIdentityState([], [], [constraint])).toBe("partial_mixed");
    }
    for (const index of expectedPreexistingIndexes) {
      expect(classifyIdentityState([], [], [], [index])).toBe("partial_mixed");
    }
    for (let objectCount = 0; objectCount < 7; objectCount += 1) {
      expect(
        classifyIdentityState(
          expectedPairs,
          expectedObjects.slice(0, objectCount),
          expectedPreexistingConstraints,
          expectedPreexistingIndexes,
        ),
      ).toBe("partial_mixed");
    }
    for (let pairCount = 0; pairCount < 14; pairCount += 1) {
      expect(
        classifyIdentityState(
          expectedPairs.slice(0, pairCount),
          expectedObjects,
          expectedPreexistingConstraints,
          expectedPreexistingIndexes,
        ),
      ).toBe("partial_mixed");
    }
    expect(classifyIdentityState([], [])).toBe("pristine");
    expect(classifyIdentityState([], [], expectedReplacedConstraints)).toBe(
      "pristine",
    );
    expect(
      classifyIdentityState(
        expectedPairs,
        expectedObjects,
        expectedPreexistingConstraints,
        expectedPreexistingIndexes,
      ),
    ).toBe("complete_identity");

    const migrationObjects = extractMarkedBlock(
      migration,
      "PHASE_A_OBJECT_IDENTITIES",
    );
    const wrongKindObject = {
      identity: "class:public.inventory_command_bottle_effects",
      relkind: "S",
    };
    expect(wrongKindObject.relkind).not.toBe("r");
    expect(parseObjectIdentities(migrationObjects)).toContain(
      wrongKindObject.identity,
    );
    expect(classifyIdentityState([], [wrongKindObject.identity])).toBe(
      "partial_mixed",
    );

    const wrongKindIndex = {
      identity: "public.pour_events_open_bottle_tenant_wine_idx",
      relkind: "S",
    };
    const migrationIndexes = extractMarkedBlock(
      migration,
      "PHASE_A_INDEX_IDENTITIES",
    );
    const indexAdmission = normalizeSql(
      migration.slice(
        migration.indexOf("-- C06_PHASE_A_INDEX_IDENTITIES_BEGIN"),
        migration.indexOf("-- C06_PHASE_A_STATE_CLASSIFIER_BEGIN"),
      ),
    );
    expect(wrongKindIndex.relkind).not.toBe("i");
    expect(parseIndexIdentities(migrationIndexes)).toContain(
      wrongKindIndex.identity,
    );
    expect(classifyIdentityState([], [], [], [wrongKindIndex.identity])).toBe(
      "partial_mixed",
    );

    const wrongKindConstraint = {
      identity: "public.open_bottles.open_bottles_identity_contract_check",
      contype: "f",
    };
    const migrationConstraints = extractMarkedBlock(
      migration,
      "PHASE_A_CONSTRAINT_IDENTITIES",
    );
    const constraintAdmission = normalizeSql(
      migration.slice(
        migration.indexOf("-- C06_PHASE_A_CONSTRAINT_IDENTITIES_BEGIN"),
        migration.indexOf("-- C06_PHASE_A_INDEX_IDENTITIES_BEGIN"),
      ),
    );
    expect(wrongKindConstraint.contype).not.toBe("c");
    expect(parsePairs(migrationConstraints)).toContain(
      wrongKindConstraint.identity,
    );
    expect(
      classifyIdentityState([], [], [wrongKindConstraint.identity]),
    ).toBe("partial_mixed");

    expect(migrationObjects).not.toContain("relkind");
    expect(indexAdmission).toContain(
      "where to_regclass(expected.identity) is not null",
    );
    expect(indexAdmission).not.toContain("relkind");
    expect(constraintAdmission).toContain(
      "join pg_catalog.pg_constraint c on c.conrelid = expected.relid and c.conname = expected.conname",
    );
    expect(constraintAdmission).not.toContain("contype");
    expect(preflight).toContain("c.relkind in ('r', 'p')");
    expect(preflight).toContain("c.relkind = 'v'");
    expect(preflight).toContain("p.prokind is distinct from 'f'");
  });

  it("scopes guarded-down seal inventory and definition validation to six relations", () => {
    const guard = normalizeSql(
      extractMarkedBlock(down, "PHASE_A_DOWN_SEALED_CONSTRAINT_GUARD"),
    );
    const names = parseQuotedNames(
      extractMarkedBlock(down, "PHASE_A_DOWN_EXPECTED_SEALED_CONSTRAINTS"),
    );

    expect(names).toEqual(expectedSealedConstraintNames);
    expect(guard).toContain(
      "obj_description(c.oid, 'pg_constraint') like 'C06_DEFINITION_MD5:%'",
    );
    expect(guard).toContain("'public.inventory_items'::regclass");
    expect(guard).toContain(
      "'public.inventory_command_bottle_effects'::regclass",
    );
    expect(guard).not.toContain("c.conname = any");
    expect(
      guard.match(
        /obj_description\(c\.oid, 'pg_constraint'\) like 'C06_DEFINITION_MD5:%'/gu,
      ),
    ).toHaveLength(2);
    for (const relation of [
      "inventory_items",
      "open_bottles",
      "inventory_command_receipts",
      "pour_events",
      "bottle_closeouts",
      "inventory_command_bottle_effects",
    ]) {
      expect(
        guard.match(new RegExp(`'public\\.${relation}'::regclass`, "gu")),
      ).toHaveLength(2);
    }
    expect(rehearsal).toContain("extra_sealed_constraint");
    expect(rehearsal).toContain("renamed_sealed_constraint");
    expect(rehearsal).toContain("unrelated_same_named_constraint");
    expect(rehearsal).toContain(
      "rename constraint open_bottles_state_version_check to open_bottles_state_version_check_renamed",
    );
    expect(rehearsal).toContain(
      "alter table public.restaurants add constraint open_bottles_state_version_check",
    );
  });

  it("binds the new no-database contract test into the exact-14 source set", () => {
    expect(rehearsal).toContain(`  "${testRelativePath}"`);
    expect(rehearsal).toContain("exact 14-path source set");

    const executionTail =
      rehearsal.split("# C06_HOLDER_SETTLEMENT_END")[1] ?? "";
    const settlementGate = executionTail.lastIndexOf(
      "c06_settle_all_owned_processes",
    );
    const sourceSeal = executionTail.indexOf(
      '(cd "$repo_root" && shasum -a 256 "${source_paths[@]}")',
    );
    expect(executionTail).toContain("trap c06_finalize_owned_processes EXIT");
    expect(settlementGate).toBeGreaterThan(0);
    expect(sourceSeal).toBeGreaterThan(settlementGate);
  });
});

describe("C06 Phase A owned-holder settlement", () => {
  it("waits and proves stable evidence before sealing a non-55P03 failure", () => {
    const { result, events, proof } = runShellScenario("non-lock-failure");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RUN_STATUS=1 SETTLE_STATUS=0 SEALED=1");
    assertOrdered(events, [
      "registered",
      "migration-failed",
      "sqlstate-failed",
      "termination-requested",
      "local-child-waited",
      "zero-sessions",
      "after-fingerprint",
      "fingerprint-diff",
      "settlement-complete",
      "final-evidence-seal",
    ]);
    expect(readFileSync(join(proof, "owned-processes-settled.txt"), "utf8"))
      .toContain("COUNT=1");
    const registry = readFileSync(join(proof, "owned-processes.tsv"), "utf8")
      .trim()
      .split("\n")[1]
      .split("\t");
    expect(spawnSync("/bin/kill", ["-0", registry[1]]).status).not.toBe(0);
    const sealedBefore = readFileSync(join(proof, "final-evidence-seal.txt"));
    spawnSync("/bin/sleep", ["0.05"]);
    expect(readFileSync(join(proof, "final-evidence-seal.txt"))).toEqual(
      sealedBefore,
    );
  });

  it("settles before reporting unexpected migration success", () => {
    const { result, events } = runShellScenario("unexpected-success");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RUN_STATUS=1 SETTLE_STATUS=0 SEALED=1");
    assertOrdered(events, [
      "migration-succeeded",
      "termination-requested",
      "local-child-waited",
      "zero-sessions",
      "after-fingerprint",
      "fingerprint-diff",
      "settlement-complete",
    ]);
  });

  it("settles but blocks sealing when the after fingerprint differs", () => {
    const { result, events, proof } = runShellScenario("diff-failure");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RUN_STATUS=1 SETTLE_STATUS=0 SEALED=0");
    assertOrdered(events, [
      "termination-requested",
      "local-child-waited",
      "zero-sessions",
      "after-fingerprint",
      "fingerprint-diff-failed",
      "settlement-complete",
    ]);
    expect(() =>
      readFileSync(join(proof, "owned-process-evidence-ready.txt"), "utf8"),
    ).toThrow();
    expect(events).not.toContain("final-evidence-seal");
  });

  it("refuses ambiguous backend ownership without terminating or sealing", () => {
    const { result, events } = runShellScenario("ambiguous-owner");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RUN_STATUS=1 SETTLE_STATUS=1 SEALED=0");
    expect(events).toContain("registered");
    expect(events).toContain("local-child-waited");
    expect(events).not.toContain("termination-requested");
    expect(events).not.toContain("settlement-complete");
    expect(events).not.toContain("final-evidence-seal");
  });

  it("escalates a TERM-resistant owned child finitely without touching an unrelated child", () => {
    const { result, events } = runShellScenario("term-resistant");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "RUN_STATUS=1 SETTLE_STATUS=0 SEALED=1 UNRELATED_ALIVE=1",
    );
    assertOrdered(events, [
      "termination-requested",
      "local-child-term-requested",
      "local-child-kill-requested",
      "local-child-waited",
      "zero-sessions",
      "settlement-complete",
      "final-evidence-seal",
    ]);
  });

  it("uses the EXIT finalizer to wait an owned child while preserving failure", () => {
    const { result, events, proof } = runExitFinalizerScenario();

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(9);
    assertOrdered(events, [
      "registered",
      "termination-requested",
      "local-child-waited",
      "zero-sessions",
      "settlement-complete",
    ]);
    expect(readFileSync(join(proof, "owned-processes-settled.txt"), "utf8"))
      .toContain("COUNT=1");
    expect(() =>
      readFileSync(join(proof, "owned-process-evidence-ready.txt"), "utf8"),
    ).toThrow();

    const registry = readFileSync(join(proof, "owned-processes.tsv"), "utf8")
      .trim()
      .split("\n")[1]
      .split("\t");
    const childProbe = spawnSync("/bin/kill", ["-0", registry[1]], {
      encoding: "utf8",
    });
    expect(childProbe.status).not.toBe(0);
  });
});
