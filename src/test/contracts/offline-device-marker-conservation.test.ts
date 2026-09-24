import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = path.join(process.cwd(), "src");
const markerModule = "@/domains/offline/device-lock";

function productionSources(directory = sourceRoot): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const absolute = path.join(directory, entry);
      if (statSync(absolute).isDirectory()) return productionSources(absolute);
      if (!/\.tsx?$/.test(entry) || /\.(?:test|spec)\.tsx?$/.test(entry)) {
        return [];
      }
      return [absolute];
    })
    .sort();
}

function relative(file: string) {
  return path.relative(process.cwd(), file);
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

function importedMarkerAliases(file: string, source: string) {
  const aliases = new Set<string>();
  for (const statement of parseSource(file, source).statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== markerModule ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const binding of statement.importClause.namedBindings.elements) {
      if ((binding.propertyName ?? binding.name).text === "DEVICE_LOCK_COOKIE_NAME") {
        aliases.add(binding.name.text);
      }
    }
  }
  return aliases;
}

type MarkerMutation = {
  file: string;
  method: "delete" | "set";
  form: "object" | "positional";
};

function markerMutations(file: string, source: string): MarkerMutation[] {
  const aliases = importedMarkerAliases(file, source);
  if (relative(file) === "src/domains/offline/device-lock.ts") {
    aliases.add("DEVICE_LOCK_COOKIE_NAME");
  }
  if (aliases.size === 0) return [];

  const sourceFile = parseSource(file, source);
  const mutations: MarkerMutation[] = [];
  const isMarkerName = (node: ts.Node | undefined) =>
    !!node && ts.isIdentifier(node) && aliases.has(node.text);

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "set" ||
        node.expression.name.text === "delete")
    ) {
      const method = node.expression.name.text;
      const first = node.arguments[0];
      if (isMarkerName(first)) {
        mutations.push({ file: relative(file), method, form: "positional" });
      } else if (first && ts.isObjectLiteralExpression(first)) {
        const nameProperty = first.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ((ts.isIdentifier(property.name) && property.name.text === "name") ||
              (ts.isStringLiteral(property.name) && property.name.text === "name")),
        );
        if (nameProperty && isMarkerName(nameProperty.initializer)) {
          mutations.push({ file: relative(file), method, form: "object" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return mutations;
}

function inventoryMarkerMutations(entries: Map<string, string>) {
  return [...entries].flatMap(([file, source]) => markerMutations(file, source));
}

describe("offline device marker conservation", () => {
  const sources = productionSources();
  const contents = new Map(sources.map((file) => [file, readFileSync(file, "utf8")]));

  it("keeps the marker literal and imports in the reviewed modules", () => {
    const literalOwners = sources
      .filter((file) => contents.get(file)?.includes("terroir_device_locked"))
      .map(relative);
    const importers = sources
      .filter((file) => contents.get(file)?.includes(markerModule))
      .map(relative);

    expect(literalOwners).toEqual(["src/domains/offline/device-lock.ts"]);
    expect(importers).toEqual([
      "src/app/(app)/offline-context-provider.tsx",
      "src/app/(app)/offline-session-boundary.tsx",
      "src/app/api/dev-login/route.ts",
      "src/app/auth/callback/route.ts",
      "src/app/auth/confirm/route.ts",
      "src/app/auth/signout/route.ts",
      "src/app/login/actions.ts",
      "src/domains/offline/eligibility.ts",
      "src/lib/api/active-restaurant.ts",
      "src/lib/supabase/proxy.ts",
    ]);
  });

  it("allows only the reviewed post-commit marker-clear primitive", () => {
    const violations: string[] = [];
    for (const [file, source] of contents) {
      for (const alias of importedMarkerAliases(file, source)) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const forbidden = [
          new RegExp(`\\.delete\\(\\s*${escaped}\\s*\\)`),
          new RegExp(`\\.set\\(\\s*${escaped}[\\s\\S]{0,240}maxAge\\s*:\\s*0`),
          new RegExp(`\\.set\\(\\s*${escaped}[\\s\\S]{0,240}expires\\s*:`),
        ];
        if (forbidden.some((pattern) => pattern.test(source))) {
          violations.push(relative(file));
        }
      }
    }

    const markerSource = contents.get(
      path.join(sourceRoot, "domains/offline/device-lock.ts"),
    )!;
    const exportedDestructiveNames = [...markerSource.matchAll(
      /export\s+(?:async\s+)?function\s+(\w*(?:delete|clear|expire)\w*)/gi,
    )].map((match) => match[1]);
    expect(exportedDestructiveNames).toEqual(["clearReprovisionMarkerAfterCommit"]);
    expect(violations).toEqual([]);

    const clearCallers = sources
      .filter((file) => relative(file) !== "src/domains/offline/device-lock.ts")
      .filter((file) => contents.get(file)?.includes("clearReprovisionMarkerAfterCommit("))
      .map(relative);
    expect(clearCallers).toEqual(["src/app/(app)/offline-context-provider.tsx"]);
  });

  it("allows only the two reviewed direct marker writes", () => {
    expect(inventoryMarkerMutations(contents)).toEqual([
      {
        file: "src/app/auth/signout/route.ts",
        method: "set",
        form: "positional",
      },
      {
        file: "src/domains/offline/device-lock.ts",
        method: "set",
        form: "positional",
      },
    ]);
  });

  it("detects aliased positional and object mutations with inline options", () => {
    const allowedImporter = path.join(sourceRoot, "lib/supabase/proxy.ts");
    const mutated = new Map(contents);
    mutated.set(
      allowedImporter,
      `${contents.get(allowedImporter)}\n\n` +
        `import { DEVICE_LOCK_COOKIE_NAME /* alias */ as MARKER_NAME } from "${markerModule}";\n` +
        "response.cookies.set(MARKER_NAME, \"1\", { path: \"/\", maxAge: 999 });\n" +
        "response.cookies.delete({ name: MARKER_NAME });\n",
    );

    expect(inventoryMarkerMutations(mutated)).toEqual([
      {
        file: "src/app/auth/signout/route.ts",
        method: "set",
        form: "positional",
      },
      {
        file: "src/domains/offline/device-lock.ts",
        method: "set",
        form: "positional",
      },
      {
        file: "src/lib/supabase/proxy.ts",
        method: "set",
        form: "positional",
      },
      {
        file: "src/lib/supabase/proxy.ts",
        method: "delete",
        form: "object",
      },
    ]);
  });

  it("limits marker writers to the reviewed sign-out and auth transitions", () => {
    const helperWriters = sources
      .filter((file) => {
        if (relative(file) === "src/domains/offline/device-lock.ts") return false;
        return contents.get(file)?.includes("setDeviceLockCookie(");
      })
      .map(relative);
    const clientWriters = sources
      .filter((file) => {
        if (relative(file) === "src/domains/offline/device-lock.ts") return false;
        return contents.get(file)?.includes("writeClientDeviceLock(");
      })
      .map(relative);
    const directOptionWriters = sources
      .filter((file) => {
        if (relative(file) === "src/domains/offline/device-lock.ts") return false;
        return contents.get(file)?.includes("deviceLockCookieOptions()");
      })
      .map(relative);

    expect(helperWriters).toEqual([
      "src/app/api/dev-login/route.ts",
      "src/app/auth/callback/route.ts",
      "src/app/auth/confirm/route.ts",
      "src/app/login/actions.ts",
      "src/lib/api/active-restaurant.ts",
    ]);
    expect(clientWriters).toEqual([
      "src/app/(app)/offline-session-boundary.tsx",
    ]);
    expect(directOptionWriters).toEqual(["src/app/auth/signout/route.ts"]);
  });

  it("does not confuse active-restaurant cleanup with marker deletion", () => {
    const activeRestaurant = readFileSync(
      path.join(sourceRoot, "lib/api/active-restaurant.ts"),
      "utf8",
    );
    expect(activeRestaurant).toContain("store.delete(COOKIE_NAME)");
    expect(activeRestaurant).toContain(
      'const COOKIE_NAME = "active_restaurant_id"',
    );
  });
});
