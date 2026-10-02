import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preflightPath = "scripts/staff-cost-seal-baseline-preflight.sql";
const preflight = existsSync(preflightPath)
  ? readFileSync(preflightPath, "utf8")
  : "";

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex + start.length);
  return source.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}

function normalizedSql(source: string): string {
  return source
    .replace(/--[^\n]*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

type SqlToken = {
  kind: "identifier" | "dot" | "left_paren" | "barrier";
  value?: string;
  quoted?: boolean;
};

type SqlLexResult = {
  tokens: SqlToken[];
  violations: string[];
  allowedMetacommandCount: number;
  structuralDoCount: number;
  doKeywordCount: number;
};

const structuralDoTag = "$structural_admission$";

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Z_]/iu.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Z0-9_$]/iu.test(character);
}

function lexExecutableSql(source: string, topLevel = true): SqlLexResult {
  const result: SqlLexResult = {
    tokens: [],
    violations: [],
    allowedMetacommandCount: 0,
    structuralDoCount: 0,
    doKeywordCount: 0,
  };
  let index = 0;
  let pendingDo = false;

  const mergeBody = (body: SqlLexResult) => {
    result.tokens.push(...body.tokens);
    result.violations.push(...body.violations);
    result.allowedMetacommandCount += body.allowedMetacommandCount;
  };
  const refusePendingDo = () => {
    if (pendingDo) result.violations.push("unexpected_do_body");
    pendingDo = false;
  };

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && next === "-") {
      const lineEnd = source.indexOf("\n", index + 2);
      index = lineEnd < 0 ? source.length : lineEnd;
      continue;
    }
    if (character === "/" && next === "*") {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === "/" && source[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (source[index] === "*" && source[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth > 0) result.violations.push("unterminated_block_comment");
      continue;
    }
    if (character === "\\") {
      refusePendingDo();
      const lineStart = source.lastIndexOf("\n", index - 1) + 1;
      const nextLineEnd = source.indexOf("\n", index);
      const lineEnd = nextLineEnd < 0 ? source.length : nextLineEnd;
      const rawLine = source.slice(lineStart, lineEnd);
      if (rawLine === "\\set ON_ERROR_STOP on") {
        result.allowedMetacommandCount += 1;
      } else {
        result.violations.push("psql_metacommand_allowlist");
      }
      index = lineEnd;
      continue;
    }

    const isEscapeString = (character === "e" || character === "E")
      && next === "'"
      && !isIdentifierPart(source[index - 1]);
    if (character === "'" || isEscapeString) {
      refusePendingDo();
      const escapeBackslashes = isEscapeString;
      index += isEscapeString ? 2 : 1;
      let terminated = false;
      while (index < source.length) {
        if (escapeBackslashes && source[index] === "\\") {
          index += 2;
        } else if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          terminated = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!terminated) result.violations.push("unterminated_single_quote");
      continue;
    }
    if (character === '"') {
      refusePendingDo();
      index += 1;
      let value = "";
      let terminated = false;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          value += '"';
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          terminated = true;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (!terminated) result.violations.push("unterminated_double_quote");
      result.tokens.push({ kind: "identifier", value, quoted: true });
      continue;
    }
    if (character === "$") {
      const tag = source.slice(index).match(/^\$(?:[A-Z_][A-Z0-9_]*)?\$/iu)?.[0];
      if (tag !== undefined) {
        const bodyStart = index + tag.length;
        const bodyEnd = source.indexOf(tag, bodyStart);
        if (bodyEnd < 0) {
          result.violations.push("unterminated_dollar_quote");
          break;
        }
        if (pendingDo) {
          if (!topLevel || tag !== structuralDoTag) {
            result.violations.push("unexpected_do_body");
          } else {
            result.structuralDoCount += 1;
            mergeBody(lexExecutableSql(source.slice(bodyStart, bodyEnd), false));
          }
          pendingDo = false;
        } else if (tag === structuralDoTag) {
          result.violations.push("unexpected_do_body");
        }
        index = bodyEnd + tag.length;
        continue;
      }
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(source[index])) index += 1;
      const value = source.slice(start, index).toLowerCase();
      if (pendingDo) refusePendingDo();
      result.tokens.push({ kind: "identifier", value, quoted: false });
      if (value === "do") {
        if (topLevel) {
          result.doKeywordCount += 1;
          pendingDo = true;
        } else {
          result.violations.push("unexpected_do_body");
        }
      }
      continue;
    }

    if (pendingDo) refusePendingDo();
    result.tokens.push(
      character === "."
        ? { kind: "dot" }
        : character === "("
          ? { kind: "left_paren" }
          : { kind: "barrier" },
    );
    index += 1;
  }

  refusePendingDo();
  if (topLevel) {
    if (result.allowedMetacommandCount !== 1) {
      result.violations.push("psql_metacommand_allowlist");
    }
    if (result.doKeywordCount !== 1 || result.structuralDoCount !== 1) {
      result.violations.push("unexpected_do_body");
    }
  }
  return result;
}

function readOnlySafetyViolations(source: string): string[] {
  const normalized = normalizedSql(source);
  const lexed = lexExecutableSql(source);
  const violations = [...lexed.violations];
  const { tokens } = lexed;

  for (let index = 0; index < tokens.length - 3; index += 1) {
    const [schema, dot, routine, leftParen] = tokens.slice(index, index + 4);
    if (
      schema.kind === "identifier"
      && dot.kind === "dot"
      && routine.kind === "identifier"
      && leftParen.kind === "left_paren"
      && schema.value !== "pg_catalog"
    ) {
      violations.push("application_routine_call");
    }
  }
  const unquotedWords = tokens
    .filter((token) => token.kind === "identifier" && !token.quoted)
    .map((token) => token.value);
  if (!normalized.includes("set local row_security = off")) {
    violations.push("row_security_setting");
  }
  if (unquotedWords.includes("lock")) violations.push("explicit_lock");
  const wordAt = (index: number, value: string) =>
    tokens[index]?.kind === "identifier"
    && !tokens[index].quoted
    && tokens[index].value === value;
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      wordAt(index, "for")
      && (
        wordAt(index + 1, "update")
        || wordAt(index + 1, "share")
        || (wordAt(index + 1, "key") && wordAt(index + 2, "share"))
        || (
          wordAt(index + 1, "no")
          && wordAt(index + 2, "key")
          && wordAt(index + 3, "update")
        )
      )
    ) {
      violations.push("row_lock");
    }
  }
  if (["call", "execute", "perform"].some((word) => unquotedWords.includes(word))) {
    violations.push("routine_execution");
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (
      tokens[index].kind === "identifier"
      && tokens[index + 1].kind === "left_paren"
      && /^(?:pg_advisory|pg_sleep)/u.test(tokens[index].value ?? "")
    ) {
      violations.push("unsafe_pg_call");
    }
  }
  if (
    ["insert", "update", "delete", "merge", "truncate", "alter", "create", "drop", "grant", "revoke", "copy"]
      .some((word) => unquotedWords.includes(word))
  ) {
    violations.push("mutation");
  }
  return [...new Set(violations)];
}

function mutateMarkedBlock(
  source: string,
  start: string,
  end: string,
  mutation: (block: string) => string,
): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return source;
  const blockEnd = endIndex + end.length;
  return [
    source.slice(0, startIndex),
    mutation(source.slice(startIndex, blockEnd)),
    source.slice(blockEnd),
  ].join("");
}

function policyInventoryViolations(source: string): string[] {
  const block = normalizedSql(sliceBetween(
    source,
    "-- C04_STORAGE_POLICY_INVENTORY_BEGIN",
    "-- C04_STORAGE_POLICY_INVENTORY_END",
  ));
  const violations: string[] = [];
  if (!block.includes("from pg_catalog.pg_policy p")) {
    violations.push("missing_policy_catalog");
  }
  if (!block.includes("n.nspname = 'storage'")) {
    violations.push("missing_storage_scope");
  }
  if (!block.includes("c.relname = 'objects'")) {
    violations.push("missing_objects_scope");
  }
  if (/\bp\.polname\s*(?:=|in\b)/u.test(block)) {
    violations.push("named_policy_filter");
  }
  if (/\bp\.polcmd\s*(?:=|in\b)/u.test(block)) {
    violations.push("command_filter");
  }
  if (/\b(?:and|where)\s+false\b|\blimit\s+0\b/u.test(block)) {
    violations.push("empty_inventory");
  }
  return violations;
}

function routineSetGateViolations(source: string): string[] {
  const gate = normalizedSql(sliceBetween(
    source,
    "-- C04_ROUTINE_SET_GATE_BEGIN",
    "-- C04_ROUTINE_SET_GATE_END",
  ));
  const required = [
    "left join pg_catalog.pg_proc p",
    "pg_catalog.to_regprocedure(e.signature)",
    "resolved.prokind = 'f'",
    "resolved.proowner = pg_catalog.to_regrole('postgres')",
    "candidate.pronamespace",
    "n.nspname = 'public'",
    "protected.proname = candidate.proname",
    "where not exists",
    "admitted.oid = candidate.oid",
    "v_count <> 62 or v_extra_count <> 0",
    "c04_staff_cost_routine_set_invalid",
  ];
  return required.filter((entry) => !gate.includes(entry));
}

function operatorGateViolations(source: string): string[] {
  const gate = normalizedSql(sliceBetween(
    source,
    "-- C04_OPERATOR_GATE_BEGIN",
    "-- C04_OPERATOR_GATE_END",
  ));
  const required = [
    "current_user <> session_user",
    "current_user <> 'postgres'",
    "operator_role.rolname = current_user",
    "operator_role.rolsuper or operator_role.rolbypassrls",
    "pg_catalog.current_setting('row_security') <> 'off'",
    "c04_staff_cost_operator_identity_invalid",
    "c04_staff_cost_operator_authority_invalid",
    "c04_staff_cost_row_security_guard_invalid",
  ];
  return required.filter((entry) => !gate.includes(entry));
}

const expectedRelations = [
  "cellar_health",
  "identity_merge_log",
  "import_batch_rows",
  "inventory_items",
  "invoice_scan_deletions",
  "invoice_scans",
  "pricing_recommendations",
  "reconcile_actions",
  "restaurants",
  "scan_idempotency",
  "wines",
].sort();

const expectedRoutines = [
  "public.abandon_scan_idempotency(uuid,uuid,text)",
  "public.accept_reconcile_batch(uuid,jsonb,uuid)",
  "public.add_manual_overrides(uuid,text[])",
  "public.apply_import_batch_chunk(uuid,integer)",
  "public.assign_wine_sections_private(uuid,uuid[],text)",
  "public.bulk_resolve_import_batch_rows(uuid,text)",
  "public.claim_invoice_extract_job(text)",
  "public.claim_scan_idempotency(uuid,uuid,text)",
  "public.cleanup_scan_idempotency()",
  "public.commit_invoice_scan(uuid)",
  "public.complete_scan_idempotency(uuid,uuid,text,uuid,integer,integer,uuid)",
  "public.count_import_batch_rows(uuid)",
  "public.create_import_batch(uuid,uuid,text,integer,jsonb,uuid,integer,integer,text,text)",
  "public.create_inventory_item_private(uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,public.added_via)",
  "public.create_invoice_scan_upload(uuid,uuid,text,text,text,date)",
  "public.current_inventory_contract_version()",
  "public.current_site_role_at_least(uuid,public.membership_role)",
  "public.delete_invoice_scan(uuid)",
  "public.delete_wine_private(uuid,uuid,timestamp with time zone)",
  "public.dismiss_pricing_alert(uuid,integer)",
  "public.dismiss_pricing_alert_private(uuid,integer)",
  "public.effective_site_capability(uuid,text)",
  "public.effective_site_ids(text)",
  "public.enqueue_invoice_extract_job(uuid,uuid)",
  "public.enrich_wines_batch(uuid,jsonb)",
  "public.expire_stalled_invoice_scans(uuid)",
  "public.invoice_edits_valid(jsonb)",
  "public.invoice_image_paths_valid(uuid,uuid,text,jsonb)",
  "public.invoice_line_items_valid(jsonb)",
  "public.merge_wines(uuid,uuid)",
  "public.mirror_bin_code_to_inventory_items()",
  "public.patch_inventory_item_private(uuid,timestamp with time zone,boolean,integer,boolean,numeric,boolean,text,boolean,uuid,boolean,text,boolean,text,boolean,text)",
  "public.read_cellar_health_private(uuid,uuid[])",
  "public.read_current_operational_memberships(uuid)",
  "public.read_identity_merge_private(uuid)",
  "public.read_import_batch_cost_rows(uuid,integer,integer)",
  "public.read_import_batch_display_rows(uuid,integer,integer)",
  "public.read_inventory_costs(uuid,uuid[])",
  "public.read_invoice_image_target(uuid,integer)",
  "public.read_invoice_scan_deletion_private(uuid)",
  "public.read_invoice_scan_private(uuid)",
  "public.read_pricing_recommendations(uuid)",
  "public.read_reconcile_action_private(uuid)",
  "public.read_restaurant_pricing_defaults(uuid)",
  "public.read_wine_cost_flags(uuid,uuid[])",
  "public.read_wine_pricing_strategy(uuid,uuid[])",
  "public.receive_bottle_at_location_private(uuid,uuid,uuid,text,uuid)",
  "public.reclaim_stuck_invoice_extract_jobs(integer)",
  "public.request_invoice_scan_reextract(uuid)",
  "public.resolve_import_batch_row(uuid,text,numeric)",
  "public.revert_import_batch(uuid)",
  "public.revert_import_batch_core_private(uuid,uuid[])",
  "public.revert_import_batch_private(uuid)",
  "public.revert_import_session(uuid)",
  "public.review_invoice_scan(uuid,timestamp with time zone,text,text,date,jsonb,jsonb)",
  "public.save_bottle_inventory_private(uuid,uuid,text,text,integer,text,text,text,text,integer,numeric)",
  "public.set_restaurant_pricing_defaults(uuid,numeric,numeric)",
  "public.set_wine_overpaid_flag(uuid,uuid,boolean)",
  "public.set_wine_pricing_strategy(uuid,uuid,numeric,numeric)",
  "public.undo_reconcile_batch(uuid)",
  "public.wine_enrichment_metadata_valid(jsonb)",
  "public.wine_manual_overrides_valid(text[])",
].sort();

function markedStrings(start: string, end: string): string[] {
  return [...sliceBetween(preflight, start, end).matchAll(/\('([^']+)'\)/gu)]
    .map((match) => match[1])
    .sort();
}

describe("staff-cost seal structural baseline preflight", () => {
  it("is a bounded read-only snapshot with no application routine execution", () => {
    expect(existsSync(preflightPath)).toBe(true);
    const normalized = normalizedSql(preflight);

    expect(lexExecutableSql(preflight).allowedMetacommandCount).toBe(1);
    expect(normalized).toContain(
      "begin transaction isolation level repeatable read, read only",
    );
    expect(normalized).toContain("set local statement_timeout");
    expect(normalized).toContain("set local lock_timeout");
    expect(normalized).toContain("set local idle_in_transaction_session_timeout");
    expect(normalized).toContain("set local search_path = pg_catalog");
    expect(normalized).toContain("set local row_security = off");
    expect(readOnlySafetyViolations(preflight)).toEqual([]);
    expect(operatorGateViolations(preflight)).toEqual([]);
    expect(normalized).toContain("rollback");
    expect(normalized).toContain("c04_staff_cost_baseline_preflight_pass");

    const applicationCall = preflight.replace(
      "rollback;",
      "select public.some_function();\nrollback;",
    );
    expect(readOnlySafetyViolations(applicationCall)).toContain(
      "application_routine_call",
    );
    for (const metacommand of [
      "\\i /tmp/untrusted.sql",
      "\\! echo unsafe",
      "\\gexec",
    ]) {
      expect(readOnlySafetyViolations(`${preflight}\n${metacommand}`)).toContain(
        "psql_metacommand_allowlist",
      );
    }

    for (const removedGuard of [
      "current_user <> session_user",
      "current_user <> 'postgres'",
      "operator_role.rolsuper or operator_role.rolbypassrls",
      "pg_catalog.current_setting('row_security') <> 'off'",
    ]) {
      const mutation = preflight.replace(removedGuard, "true");
      expect(operatorGateViolations(mutation)).not.toEqual([]);
    }
    const rowSecurityMutation = preflight.replace(
      "set local row_security = off;",
      "set local row_security = on;",
    );
    expect(readOnlySafetyViolations(rowSecurityMutation)).toContain(
      "row_security_setting",
    );
  });

  it("pins exactly the eleven sealed relations and all table/column ACL dimensions", () => {
    expect(
      markedStrings(
        "-- C04_EXPECTED_RELATIONS_BEGIN",
        "-- C04_EXPECTED_RELATIONS_END",
      ),
    ).toEqual(expectedRelations);
    expect(preflight).toContain("pg_catalog.aclexplode");
    expect(preflight).toContain("pg_catalog.acldefault('r', t.relowner)");
    expect(preflight).toContain("a.attacl is not null");
    expect(preflight).toContain("owner_name");
    expect(preflight).toContain("grantor_name");
    expect(preflight).toContain("grantee_name");
    expect(preflight).toContain("privilege_type");
    expect(preflight).toContain("is_grantable");
    expect(preflight).toContain("column_name");
    expect(preflight).toContain("owner_role.rolname = 'postgres'");
    expect(preflight).not.toMatch(/\bon\s+all\s+tables\b/iu);
  });

  it("lexes whole-stream metacommands, qualified calls, and executable DO bodies", () => {
    const beforeRollback = (fragment: string) => preflight.replace(
      "rollback;",
      () => `${fragment}\nrollback;`,
    );

    for (const mutation of [
      "select 1; \\gexec",
      "select 1; \\i /tmp/unreviewed.sql",
      "select 1; \\! /usr/bin/true",
    ]) {
      expect(readOnlySafetyViolations(beforeRollback(mutation))).toContain(
        "psql_metacommand_allowlist",
      );
    }
    expect(
      readOnlySafetyViolations(`${preflight}\n\\set ON_ERROR_STOP on`),
    ).toContain("psql_metacommand_allowlist");

    for (const mutation of [
      'select public."some_function"();',
      'select "public"."some_function"();',
      'select other_schema."some_function"();',
      'select "PG_CATALOG"."count"();',
    ]) {
      expect(readOnlySafetyViolations(beforeRollback(mutation))).toContain(
        "application_routine_call",
      );
    }

    const doMutation = preflight.replace(
      "-- C04_OPERATOR_GATE_END",
      "perform public.foo();\n  -- C04_OPERATOR_GATE_END",
    );
    expect(readOnlySafetyViolations(doMutation)).toContain(
      "application_routine_call",
    );
    expect(readOnlySafetyViolations(doMutation)).toContain("routine_execution");

    for (const mutation of [
      "call pg_catalog.count();",
      "execute 'select 1';",
      "perform pg_catalog.count();",
    ]) {
      expect(readOnlySafetyViolations(beforeRollback(mutation))).toContain(
        "routine_execution",
      );
    }
    for (const mutation of [
      "select pg_catalog.pg_sleep(1);",
      "select pg_catalog.pg_advisory_lock(1);",
    ]) {
      expect(readOnlySafetyViolations(beforeRollback(mutation))).toContain(
        "unsafe_pg_call",
      );
    }

    for (const [mutation, violation] of [
      ["select 'unterminated;", "unterminated_single_quote"],
      ["select E'unterminated\\", "unterminated_single_quote"],
      ['select "unterminated;', "unterminated_double_quote"],
      ["select $body$unterminated;", "unterminated_dollar_quote"],
      ["select 1 /* outer /* inner */;", "unterminated_block_comment"],
      ["do $other$ begin null; end $other$;", "unexpected_do_body"],
    ] as const) {
      expect(readOnlySafetyViolations(beforeRollback(mutation))).toContain(
        violation,
      );
    }

    for (const inert of [
      "select $$ public.foo(); \\gexec $$;",
      "select E'public.foo(); \\\\gexec';",
      'select "pg_catalog"."count"();',
      "select 1 /* outer /* public.foo(); */ still outer */;",
    ]) {
      expect(readOnlySafetyViolations(beforeRollback(inert)), inert).toEqual([]);
    }
  });

  it("refuses any owned sequence because the frozen eleven-table source has none", () => {
    expect(preflight).toContain("pg_catalog.pg_depend");
    expect(preflight).toContain("C04_STAFF_COST_UNEXPECTED_OWNED_SEQUENCE");
    expect(preflight).toContain("'owned_sequence_count'::text");
    expect(preflight).toContain("0::bigint as structural_count");
  });

  it("captures the private bucket and both exact invoice-image policies", () => {
    expect(preflight).toContain("from storage.buckets b");
    expect(preflight).toContain("b.id = 'invoice-images'");
    expect(preflight).toContain("20971520");
    expect(preflight).toContain("members can upload invoice images");
    expect(preflight).toContain("members can read invoice images");
    expect(preflight).toContain("pg_catalog.pg_get_expr(p.polqual, p.polrelid)");
    expect(preflight).toContain(
      "pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)",
    );
    expect(preflight).toContain("p.polpermissive");
    expect(preflight).toContain("p.polcmd");
    expect(preflight).toContain("p.polroles");
    expect(preflight).toContain("relation_owner");
    expect(preflight).toContain("p.relrowsecurity");
    expect(preflight).toContain("untrusted_using_expression");
    expect(preflight).toContain("untrusted_check_expression");
    expect(policyInventoryViolations(preflight)).toEqual([]);

    const namedOnly = mutateMarkedBlock(
      preflight,
      "-- C04_STORAGE_POLICY_INVENTORY_BEGIN",
      "-- C04_STORAGE_POLICY_INVENTORY_END",
      (block) => block.replace(
        "and c.relname = 'objects'",
        "and c.relname = 'objects'\n     and p.polname in ('members can read invoice images')",
      ),
    );
    expect(policyInventoryViolations(namedOnly)).toContain(
      "named_policy_filter",
    );

    const emptyInventory = mutateMarkedBlock(
      preflight,
      "-- C04_STORAGE_POLICY_INVENTORY_BEGIN",
      "-- C04_STORAGE_POLICY_INVENTORY_END",
      (block) => block.replace(
        "and c.relname = 'objects'",
        "and c.relname = 'objects'\n     and false",
      ),
    );
    expect(policyInventoryViolations(emptyInventory)).toContain(
      "empty_inventory",
    );
  });

  it("pins every accepted current routine and the legacy dismissal definition/ACL", () => {
    expect(
      markedStrings(
        "-- C04_EXPECTED_ROUTINES_BEGIN",
        "-- C04_EXPECTED_ROUTINES_END",
      ),
    ).toEqual(expectedRoutines);
    expect(preflight).toContain("pg_catalog.pg_get_functiondef(r.oid)");
    expect(preflight).toContain("pg_catalog.pg_get_function_result(r.oid)");
    expect(preflight).toContain("r.prosecdef");
    expect(preflight).toContain("r.proconfig");
    expect(preflight).toContain("r.prokind");
    expect(preflight).toContain("pg_catalog.acldefault('f', r.proowner)");
    expect(preflight).toContain("public.dismiss_pricing_alert(uuid,integer)");
    expect(routineSetGateViolations(preflight)).toEqual([]);
    for (const signature of expectedRoutines) {
      expect(preflight.split(`('${signature}')`).length).toBeGreaterThanOrEqual(4);
    }

    const acceptsProcedure = preflight.replace(
      "resolved.prokind = 'f'",
      "resolved.prokind = resolved.prokind",
    );
    expect(routineSetGateViolations(acceptsProcedure)).not.toEqual([]);
    const acceptsForeignOwner = preflight.replace(
      "resolved.proowner = pg_catalog.to_regrole('postgres')",
      "resolved.proowner = resolved.proowner",
    );
    expect(routineSetGateViolations(acceptsForeignOwner)).not.toEqual([]);
    const ignoresOverload = preflight.replace("where not exists (", "where exists (");
    expect(routineSetGateViolations(ignoresOverload)).not.toEqual([]);
  });

  it("uses core SHA-256 fingerprints without emitting the legacy body", () => {
    expect(preflight).not.toContain("pg_catalog.md5");
    expect(preflight).not.toContain("definition_md5");
    expect(preflight.match(/pg_catalog\.sha256/gu)).toHaveLength(2);
    expect(preflight.match(/pg_catalog\.convert_to/gu)).toHaveLength(2);
    expect(preflight.match(/pg_catalog\.encode/gu)).toHaveLength(2);
    expect(preflight).toContain("definition_sha256");
    expect(preflight).not.toContain("C04_LEGACY_DISMISS_DEFINITION");
    expect(preflight).not.toContain("as function_definition");
  });

  it("requires validated metadata, image-path, cache, and job structural constraints", () => {
    for (const constraint of [
      "wines_manual_overrides_valid_check",
      "wines_enrichment_metadata_valid_check",
      "invoice_scans_image_paths_valid_check",
      "scan_idempotency_pkey",
      "background_jobs_attempt_window",
      "background_jobs_job_type_check",
      "background_jobs_status_check",
    ]) {
      expect(preflight).toContain(constraint);
    }
    expect(preflight).toContain("pg_catalog.pg_get_constraintdef");
    expect(preflight).toContain("convalidated");
    expect(preflight).toContain("C04_STAFF_COST_REQUIRED_CONSTRAINT_INVALID");
  });

  it("does not inspect protected rows and names every historical admission gap", () => {
    for (const relation of expectedRelations) {
      expect(normalizedSql(preflight)).not.toContain(`from public.${relation}`);
    }
    expect(normalizedSql(preflight)).not.toContain("from public.background_jobs");
    expect(preflight).toContain("C04_HISTORY_WINE_METADATA_NOT_COVERED");
    expect(preflight).toContain("C04_HISTORY_INVOICE_PATHS_NOT_COVERED");
    expect(preflight).toContain("C04_HISTORY_SCAN_CACHE_NOT_COVERED");
    expect(preflight).toContain("C04_HISTORY_BACKGROUND_JOBS_SEPARATE_PROBE");
    expect(preflight).toContain("C04_APP_SHA_EXTERNAL_RECEIPT_REQUIRED");
  });
});
