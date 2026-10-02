import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8",
);

describe("/api/scan architecture boundary", () => {
  it("queues through the closed upload RPC without synchronous provider or protected-table work", () => {
    expect(routeSource).toContain("create_invoice_scan_upload");
    expect(routeSource).toContain("withIdempotency");
    expect(routeSource).not.toContain("@/domains/scanning/invoice-scan-service");
    expect(routeSource).not.toMatch(
      /@\/lib\/scanner\/(?:ai-extract|ocr-service|scoring)/,
    );
    expect(routeSource).not.toContain('.from("invoice_scans")');
    expect(routeSource).not.toContain("createServiceClient");
    expect(routeSource).not.toContain("@sentry/nextjs");
  });
});
