import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routes = [
  "open-bottles/route.ts",
  "pour/route.ts",
  "pour/undo/route.ts",
  "open-bottles/close/route.ts",
  "open-bottles/[id]/close/route.ts",
];
const apiDirectory = dirname(fileURLToPath(import.meta.url));

describe("inventory command route architecture", () => {
  it.each(routes)("keeps %s on the authenticated command path", (relativePath) => {
    const source = readFileSync(join(apiDirectory, relativePath), "utf8");

    expect(source).toContain("requireMembership");
    expect(source).toContain("requireInventoryOperationId");
    expect(source).not.toContain("createServiceRoleClient");
    expect(source).not.toContain("@/lib/supabase/service-role");
    expect(source).not.toContain('rpc("record_pour"');
    expect(source).not.toContain('rpc("close_open_bottle"');
    if (relativePath.includes("/close/route.ts") || relativePath === "open-bottles/close/route.ts" ||
      relativePath === "pour/undo/route.ts") {
      expect(source).toContain("getInventoryContractVersion");
    }
  });
});
