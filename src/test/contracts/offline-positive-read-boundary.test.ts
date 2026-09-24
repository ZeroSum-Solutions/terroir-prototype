import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = path.join(process.cwd(), "src");
const databaseModule = "@/domains/offline/database";
const databaseModulePath = path.join(sourceRoot, "domains/offline/database");
const nativeReadHelper = "readSoleUsableProjection";
const browserSpecPath = path.join(process.cwd(), "e2e/offline-positive-eligibility.test.ts");
const guardOperands = [
  "supabaseUrl",
  "publishableKey",
  "serviceRoleKey",
  "devEmail",
  "isLoopbackUrl(supabaseUrl)",
  "process.env.PLAYWRIGHT_BASE_URL === APP_ORIGIN",
  'process.env.AUTH_E2E_ENABLED !== "1"',
];

function productionSources(directory = sourceRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) return productionSources(absolute);
    if (!/\.tsx?$/.test(entry) || /\.(?:test|spec)\.tsx?$/.test(entry)) return [];
    return [absolute];
  }).sort();
}

function relative(file: string) {
  return path.relative(process.cwd(), file);
}

function importsNativeDatabase(file: string, specifier: string): boolean {
  if (specifier === databaseModule) return true;
  return specifier.startsWith(".") &&
    path.resolve(path.dirname(file), specifier) === databaseModulePath;
}

function parseSource(file: string, source: string) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function nativeReadCallCount(file: string, source: string): number {
  const sourceFile = parseSource(file, source);
  const aliases = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !importsNativeDatabase(file, statement.moduleSpecifier.text) ||
      !statement.importClause?.namedBindings
    ) continue;
    const bindings = statement.importClause.namedBindings;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const binding of bindings.elements) {
      if ((binding.propertyName ?? binding.name).text === nativeReadHelper) {
        aliases.add(binding.name.text);
      }
    }
  }

  let calls = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      if (
        (ts.isIdentifier(target) && aliases.has(target.text)) ||
        (ts.isPropertyAccessExpression(target) &&
          ts.isIdentifier(target.expression) &&
          namespaces.has(target.expression.text) &&
          target.name.text === nativeReadHelper)
      ) calls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function variableInitializer(sourceFile: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer;
      }
    }
  }
}

function isProcessEnv(expression: ts.Expression, name: string): boolean {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === name &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "env" &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "process";
}

function conjunctionOperands(expression: ts.Expression): ts.Expression[] {
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [
      ...conjunctionOperands(expression.left),
      ...conjunctionOperands(expression.right),
    ];
  }
  return [expression];
}

function matchesGuardOperand(expression: ts.Expression, index: number): boolean {
  if (index < 4) {
    return ts.isIdentifier(expression) && expression.text === [
      "supabaseUrl",
      "publishableKey",
      "serviceRoleKey",
      "devEmail",
    ][index];
  }
  if (index === 4) {
    return ts.isCallExpression(expression) && expression.arguments.length === 1 &&
      ts.isIdentifier(expression.expression) && expression.expression.text === "isLoopbackUrl" &&
      ts.isIdentifier(expression.arguments[0]) && expression.arguments[0].text === "supabaseUrl";
  }
  if (!ts.isBinaryExpression(expression)) return false;
  if (index === 5) {
    return expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      isProcessEnv(expression.left, "PLAYWRIGHT_BASE_URL") &&
      ts.isIdentifier(expression.right) && expression.right.text === "APP_ORIGIN";
  }
  return expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    isProcessEnv(expression.left, "AUTH_E2E_ENABLED") &&
    ts.isStringLiteral(expression.right) && expression.right.text === "1";
}

function hasExactGuardDecision(sourceFile: ts.SourceFile): boolean {
  const initializer = variableInitializer(sourceFile, "canUseGuardedFixture");
  if (
    !initializer ||
    !ts.isCallExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== "Boolean" ||
    initializer.arguments.length !== 1
  ) return false;
  const operands = conjunctionOperands(initializer.arguments[0]);
  return operands.length === 7 &&
    operands.every((operand, index) => matchesGuardOperand(operand, index));
}

function hasExactFixtureInitializers(sourceFile: ts.SourceFile): boolean {
  const appOrigin = variableInitializer(sourceFile, "APP_ORIGIN");
  if (!appOrigin || !ts.isStringLiteral(appOrigin) ||
    appOrigin.text !== "http://127.0.0.1:3000") return false;
  return [
    ["supabaseUrl", "NEXT_PUBLIC_SUPABASE_URL"],
    ["publishableKey", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    ["serviceRoleKey", "SUPABASE_SERVICE_ROLE_KEY"],
    ["devEmail", "DEV_BYPASS_EMAIL"],
  ].every(([variable, environment]) => {
    const initializer = variableInitializer(sourceFile, variable);
    return initializer !== undefined && isProcessEnv(initializer, environment);
  });
}

function hasExactLoopbackPredicate(sourceFile: ts.SourceFile): boolean {
  const declarations = sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "isLoopbackUrl");
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  const parameter = declaration.parameters[0];
  if (
    declaration.parameters.length !== 1 ||
    !parameter ||
    !ts.isIdentifier(parameter.name) ||
    parameter.name.text !== "value" ||
    parameter.dotDotDotToken !== undefined ||
    parameter.questionToken !== undefined ||
    parameter.initializer !== undefined ||
    parameter.type?.kind !== ts.SyntaxKind.StringKeyword ||
    declaration.type?.kind !== ts.SyntaxKind.BooleanKeyword ||
    !declaration.body ||
    declaration.body.statements.length !== 1
  ) return false;

  const tryStatement = declaration.body.statements[0];
  if (
    !ts.isTryStatement(tryStatement) ||
    tryStatement.tryBlock.statements.length !== 1 ||
    !tryStatement.catchClause ||
    tryStatement.catchClause.variableDeclaration !== undefined ||
    tryStatement.catchClause.block.statements.length !== 1 ||
    tryStatement.finallyBlock !== undefined
  ) return false;

  const tryReturn = tryStatement.tryBlock.statements[0];
  if (!ts.isReturnStatement(tryReturn) || !tryReturn.expression ||
    !ts.isCallExpression(tryReturn.expression)) return false;
  const includesCall = tryReturn.expression;
  if (includesCall.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(includesCall.expression) ||
    includesCall.expression.name.text !== "includes" ||
    !ts.isArrayLiteralExpression(includesCall.expression.expression)) return false;
  const hostnames = includesCall.expression.expression.elements;
  if (hostnames.length !== 3 || !hostnames.every((hostname, index) =>
    ts.isStringLiteral(hostname) && hostname.text === ["127.0.0.1", "localhost", "::1"][index])) {
    return false;
  }

  const hostname = includesCall.arguments[0];
  if (!ts.isPropertyAccessExpression(hostname) || hostname.name.text !== "hostname" ||
    !ts.isNewExpression(hostname.expression) ||
    !ts.isIdentifier(hostname.expression.expression) ||
    hostname.expression.expression.text !== "URL" ||
    hostname.expression.arguments?.length !== 1 ||
    !ts.isIdentifier(hostname.expression.arguments[0]) ||
    hostname.expression.arguments[0].text !== "value") return false;

  const catchReturn = tryStatement.catchClause.block.statements[0];
  return ts.isReturnStatement(catchReturn) &&
    catchReturn.expression?.kind === ts.SyntaxKind.FalseKeyword;
}

function isGuardSkip(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)) return false;
  const call = statement.expression;
  if (
    !ts.isPropertyAccessExpression(call.expression) ||
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== "test" ||
    call.expression.name.text !== "skip" ||
    call.arguments.length !== 2 ||
    !ts.isPrefixUnaryExpression(call.arguments[0]) ||
    call.arguments[0].operator !== ts.SyntaxKind.ExclamationToken ||
    !ts.isIdentifier(call.arguments[0].operand) ||
    call.arguments[0].operand.text !== "canUseGuardedFixture"
  ) return false;
  return ts.isStringLiteral(call.arguments[1]);
}

function positiveEligibilitySuite(statement: ts.Statement): ts.CallExpression | null {
  if (!ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)) return null;
  const call = statement.expression;
  return ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === "test" &&
    call.expression.name.text === "describe" &&
    call.arguments.length === 2 &&
    ts.isStringLiteral(call.arguments[0]) &&
    call.arguments[0].text === "positive offline eligibility"
    ? call
    : null;
}

function hasSoleDirectTopLevelTestRegistration(sourceFile: ts.SourceFile): boolean {
  const registrations = sourceFile.statements.filter((statement) => {
    if (!ts.isExpressionStatement(statement) ||
      !ts.isCallExpression(statement.expression)) return false;
    let target: ts.Expression = statement.expression.expression;
    while (ts.isPropertyAccessExpression(target)) target = target.expression;
    return ts.isIdentifier(target) && target.text === "test";
  });
  return registrations.length === 1 && positiveEligibilitySuite(registrations[0]) !== null;
}

function hasFirstDirectSuiteGuard(sourceFile: ts.SourceFile): boolean {
  const suites = sourceFile.statements
    .map(positiveEligibilitySuite)
    .filter((suite): suite is ts.CallExpression => suite !== null);
  if (suites.length !== 1) return false;
  const callback = suites[0].arguments[1];
  if ((!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    !ts.isBlock(callback.body)) return false;
  return callback.body.statements.length > 0 && isGuardSkip(callback.body.statements[0]);
}

function browserGuardContract(source: string): boolean {
  const sourceFile = parseSource(browserSpecPath, source);
  return hasExactFixtureInitializers(sourceFile) &&
    hasExactLoopbackPredicate(sourceFile) &&
    hasExactGuardDecision(sourceFile) &&
    hasSoleDirectTopLevelTestRegistration(sourceFile) &&
    hasFirstDirectSuiteGuard(sourceFile);
}

function browserFixture({
  guard = guardOperands.join(" && "),
  suiteBody = `
    test.skip(!canUseGuardedFixture, "guarded");
    test("fixture", () => undefined);
  `,
}: {
  guard?: string;
  suiteBody?: string;
} = {}): string {
  return `
    const APP_ORIGIN = "http://127.0.0.1:3000";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const devEmail = process.env.DEV_BYPASS_EMAIL;
    function isLoopbackUrl(value: string): boolean {
      try {
        return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
      } catch {
        return false;
      }
    }
    const canUseGuardedFixture = Boolean(${guard});
    test.describe("positive offline eligibility", () => {${suiteBody}});
  `;
}

function nativeReadCallers(entries: Map<string, string>): string[] {
  return [...entries]
    .filter(([file]) => relative(file) !== "src/domains/offline/database.ts")
    .filter(([file, source]) => nativeReadCallCount(file, source) > 0)
    .map(([file]) => relative(file))
    .sort();
}

describe("offline positive-read boundary", () => {
  const sources = productionSources();
  const contents = new Map(sources.map((file) => [file, readFileSync(file, "utf8")]));
  const browserSource = readFileSync(browserSpecPath, "utf8");

  it("allows only eligibility.ts to call the native positive-read helper", () => {
    expect(nativeReadCallers(contents)).toEqual(["src/domains/offline/eligibility.ts"]);
  });

  it("detects aliased and namespace calls outside the eligibility boundary", () => {
    const mutated = new Map(contents);
    mutated.set(
      path.join(sourceRoot, "lib/api/aliased-offline-reader.ts"),
      `import { ${nativeReadHelper} as readProjection } from "${databaseModule}";\n` +
        "readProjection({});\n",
    );
    mutated.set(
      path.join(sourceRoot, "lib/api/namespaced-offline-reader.ts"),
      `import * as offlineDatabase from "${databaseModule}";\n` +
        `offlineDatabase.${nativeReadHelper}({});\n`,
    );

    expect(nativeReadCallers(mutated)).toEqual([
      "src/domains/offline/eligibility.ts",
      "src/lib/api/aliased-offline-reader.ts",
      "src/lib/api/namespaced-offline-reader.ts",
    ]);
  });

  it("keeps browser requests behind the loopback Supabase fixture guard", () => {
    expect(browserGuardContract(browserSource)).toBe(true);
    expect(browserGuardContract(browserFixture())).toBe(true);
  });

  it.each([
    [
      "an always-true loopback predicate",
      'return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);',
      "return true;",
    ],
    [
      "a broadened loopback hostname allowlist",
      'return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);',
      'return ["127.0.0.1", "localhost", "::1", "example.com"].includes(new URL(value).hostname);',
    ],
  ])("rejects %s in the real browser source", (_label, current, replacement) => {
    const mutated = browserSource.replace(current, replacement);
    expect(mutated).not.toBe(browserSource);
    expect(browserGuardContract(mutated)).toBe(false);
  });

  it.each([
    ["a bare top-level test", '\ntest("unguarded future registration", () => undefined);\n'],
    ["a second top-level describe", '\ntest.describe("unguarded future suite", () => undefined);\n'],
  ])("rejects %s in the real browser source", (_label, registration) => {
    expect(browserGuardContract(`${browserSource}${registration}`)).toBe(false);
  });

  it.each([
    ["one conjunction changed to a disjunction",
      guardOperands.join(" && ").replace(" && ", " || ")],
    ["constant-true bypass", `${guardOperands.slice(0, 4).join(" && ")} && ` +
      `(${guardOperands[4]} || true) && ${guardOperands.slice(5).join(" && ")}`],
  ])("rejects %s in the browser guard", (_label, guard) => {
    expect(browserGuardContract(browserFixture({ guard }))).toBe(false);
  });

  it.each(guardOperands.map((operand, index) => [operand, index] as const))(
    "rejects a missing %s condition",
    (_operand, index) => {
      const guard = guardOperands.filter((_, candidate) => candidate !== index).join(" && ");
      expect(browserGuardContract(browserFixture({ guard }))).toBe(false);
    },
  );

  it.each(guardOperands.map((operand, index) => [operand, index] as const))(
    "rejects a bypassed %s condition",
    (_operand, index) => {
      const guard = guardOperands.map((operand, candidate) =>
        candidate === index ? "true" : operand).join(" && ");
      expect(browserGuardContract(browserFixture({ guard }))).toBe(false);
    },
  );

  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL", "process.env.NEXT_PUBLIC_SUPABASE_URL"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    ["SUPABASE_SERVICE_ROLE_KEY", "process.env.SUPABASE_SERVICE_ROLE_KEY"],
    ["DEV_BYPASS_EMAIL", "process.env.DEV_BYPASS_EMAIL"],
    ["APP_ORIGIN", '"http://127.0.0.1:3000"'],
  ])("rejects a redirected %s initializer", (_label, initializer) => {
    expect(browserGuardContract(browserFixture().replace(initializer, '"unsafe"'))).toBe(false);
  });

  it.each([
    ["skip nested in one test", `
      test("unguarded", () => {
        test.skip(!canUseGuardedFixture, "guarded");
      });
    `],
    ["skip nested in a conditional", `
      if (canUseGuardedFixture) {
        test.skip(!canUseGuardedFixture, "guarded");
      }
      test("unguarded", () => undefined);
    `],
    ["skip after test registration", `
      test("unguarded", () => undefined);
      test.skip(!canUseGuardedFixture, "guarded");
    `],
    ["skip after request-capable setup", `
      test.beforeEach(() => fetch("/api/offline-context"));
      test.skip(!canUseGuardedFixture, "guarded");
      test("unguarded", () => undefined);
    `],
  ])("rejects %s", (_label, suiteBody) => {
    expect(browserGuardContract(browserFixture({ suiteBody }))).toBe(false);
  });
});
