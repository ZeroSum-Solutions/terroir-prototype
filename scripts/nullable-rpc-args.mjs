import ts from "typescript";

// Postgres function arguments have no NOT NULL metadata. Keep this explicit
// allowlist aligned with 0157/0158/0160's accepted NULL inputs; do not widen other inputs
// or function returns. A changed generator/schema shape must fail regeneration.
const NULLABLE_ARGS = {
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
  set_wine_pricing_strategy: { p_target_markup_ratio: "number", p_target_pour_cost_pct: "number" },
  assign_wine_sections_private: { p_section: "string" },
  create_invoice_scan_upload_manifest: { p_invoice_date: "string", p_invoice_number: "string" },
};

function propertyName(member) {
  if (!member.name) return undefined;
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) return member.name.text;
  return undefined;
}

function uniqueMember(typeLiteral, name, context) {
  const matches = typeLiteral.members.filter((member) => propertyName(member) === name);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one generated declaration: ${context}.${name}`);
  }
  const [member] = matches;
  if (!ts.isPropertySignature(member) || !member.type) {
    throw new Error(`Expected a typed property declaration: ${context}.${name}`);
  }
  return member;
}

function typeLiteralOf(member, context) {
  if (!ts.isTypeLiteralNode(member.type)) {
    throw new Error(`Expected a generated object type: ${context}`);
  }
  return member.type;
}

function isBaseType(node, expected) {
  if (expected === "string") return node.kind === ts.SyntaxKind.StringKeyword;
  if (expected === "number") return node.kind === ts.SyntaxKind.NumberKeyword;
  return expected === "string[]"
    && ts.isArrayTypeNode(node)
    && node.elementType.kind === ts.SyntaxKind.StringKeyword;
}

function isNullType(node) {
  return ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword;
}

function parseDatabase(body) {
  const sourceFile = ts.createSourceFile(
    "database.ts",
    body,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const first = sourceFile.parseDiagnostics[0];
    throw new Error(`Generated database types do not parse: ${first.messageText}`);
  }

  const aliases = sourceFile.statements.filter(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "Database",
  );
  if (aliases.length !== 1) {
    throw new Error("Expected exactly one generated declaration: Database");
  }
  if (!ts.isTypeLiteralNode(aliases[0].type)) {
    throw new Error("Expected Database to be a generated object type.");
  }

  const publicMember = uniqueMember(aliases[0].type, "public", "Database");
  const publicType = typeLiteralOf(publicMember, "Database.public");
  const functionsMember = uniqueMember(publicType, "Functions", "Database.public");
  return { sourceFile, functions: typeLiteralOf(functionsMember, "Database.public.Functions") };
}

function nullableTypeState(node, expected) {
  if (isBaseType(node, expected)) return "plain";
  if (
    ts.isUnionTypeNode(node)
    && node.types.length === 2
    && node.types.some((part) => isBaseType(part, expected))
    && node.types.some(isNullType)
  ) {
    return "nullable";
  }
  return "invalid";
}

function collectReplacements(body) {
  const { sourceFile, functions } = parseDatabase(body);
  const replacements = [];

  for (const [functionName, fields] of Object.entries(NULLABLE_ARGS)) {
    const functionMember = uniqueMember(functions, functionName, "Database.public.Functions");
    const functionType = typeLiteralOf(functionMember, `Database.public.Functions.${functionName}`);
    const argsMember = uniqueMember(functionType, "Args", `Database.public.Functions.${functionName}`);
    const argsType = typeLiteralOf(argsMember, `Database.public.Functions.${functionName}.Args`);

    for (const [fieldName, expected] of Object.entries(fields)) {
      const context = `Database.public.Functions.${functionName}.Args`;
      const field = uniqueMember(argsType, fieldName, context);
      if (functionName === "assign_wine_sections_private" && field.questionToken) {
        throw new Error(`Expected required generated argument: ${context}.${fieldName}.`);
      }
      const state = nullableTypeState(field.type, expected);
      if (state === "invalid") {
        throw new Error(`Unexpected generated type for ${context}.${fieldName}.`);
      }
      if (state === "plain") {
        replacements.push({
          end: field.type.getEnd(),
          start: field.type.getStart(sourceFile),
          text: `${expected} | null`,
        });
      }
    }
  }

  return replacements;
}

export function applyNullableRpcArgs(body) {
  const replacements = collectReplacements(body).sort((a, b) => b.start - a.start);
  let result = body;
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }

  if (collectReplacements(result).length !== 0) {
    throw new Error("Generated nullable RPC argument normalization was incomplete.");
  }
  return result;
}
