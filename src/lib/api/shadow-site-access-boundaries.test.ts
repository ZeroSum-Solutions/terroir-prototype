import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function productionSources(directory = SRC): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    if (!/\.(?:ts|tsx)$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return [];
    if (entry.name.endsWith(".d.ts")) return [];
    return [path];
  });
}

function projectPath(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

describe("shadow site access server boundary", () => {
  const sources = productionSources();

  it("keeps the observation token in exactly four server modules", () => {
    const tokenFiles = sources
      .filter((path) => /shadowAccess|ShadowSiteAccess/.test(readFileSync(path, "utf8")))
      .map(projectPath)
      .sort();

    expect(tokenFiles).toEqual([
      "src/lib/api/auth.ts",
      "src/lib/api/resolve-active-membership.ts",
      "src/lib/api/shadow-site-access.ts",
      "src/lib/auth-context.ts",
    ]);
  });

  it("prevents client modules from importing the server auth chain", () => {
    const serverImports = [
      "@/lib/api/auth",
      "@/lib/api/resolve-active-membership",
      "@/lib/api/shadow-site-access",
      "@/lib/auth-context",
    ];
    const violations = sources.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      if (!/^\s*["']use client["'];/m.test(source)) return [];
      return serverImports.some((moduleName) => source.includes(moduleName))
        ? [projectPath(path)]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps the app layout on an explicit provider-prop allowlist", () => {
    const layout = readFileSync(join(SRC, "app/(app)/layout.tsx"), "utf8");

    expect(layout).toContain(
      "const { restaurantId, restaurantName, userRole, user } = auth;",
    );
    expect(layout).toContain(
      "<RestaurantProvider restaurantId={restaurantId} restaurantName={restaurantName} userRole={userRole}>",
    );
    expect(layout).not.toMatch(/<RestaurantProvider[\s\S]*?\.\.\./);
    expect(layout).not.toContain("shadowAccess");
  });

  it("rejects wholesale auth-result serialization or object spreading in every caller", () => {
    const helperCall = /\b(?:requireMembership|requireOwner|requireRole|getAuthContext)\s*\(/;
    const unsafe = [
      /(?:NextResponse|Response)\.json\s*\(\s*auth\b/,
      /JSON\.stringify\s*\(\s*auth\b/,
      /\{\s*\.\.\.auth\b/,
      /<[\s\S]*?\{\s*\.\.\.auth\b/,
    ];
    const violations = sources.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      if (!helperCall.test(source)) return [];
      return unsafe.some((pattern) => pattern.test(source)) ? [projectPath(path)] : [];
    });

    expect(violations).toEqual([]);
  });
});
