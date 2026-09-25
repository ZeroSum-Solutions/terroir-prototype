import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

const mockRevertImportSession = vi.fn();
vi.mock("@/domains/import/session-service", () => ({
  revertImportSession: (...args: unknown[]) => mockRevertImportSession(...args),
}));

const { POST } = await import("./route");

const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const supabase = { rpc: vi.fn() };

function request() {
  return new Request(`http://localhost/api/import/sessions/${SESSION_ID}/revert`, { method: "POST" }) as NextRequest;
}

function params() {
  return Promise.resolve({ id: SESSION_ID });
}

describe("POST /api/import/sessions/[id]/revert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMembership.mockResolvedValue({ supabase, restaurantId: "restaurant-a", role: "staff" });
  });

  it("returns 409 with retained child outcomes for a dependency-blocked session", async () => {
    const batches = [
      { batchId: "b2", chunkIndex: 2, skipped: true, reason: "physical_bottle_dependency" },
      { batchId: "b1", chunkIndex: 1, skipped: false, revertedCount: 3 },
    ];
    mockRevertImportSession.mockResolvedValue({
      ok: false,
      error: {
        code: "physical_bottle_dependency",
        message: "Import session cannot be fully reverted because physical bottles depend on imported inventory.",
      },
      batches,
    });

    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "physical_bottle_dependency",
        message: "Import session cannot be fully reverted because physical bottles depend on imported inventory.",
        details: { batches },
      },
    });
  });

  it("keeps successful session reverts at 200", async () => {
    const batches = [{ batchId: "b1", chunkIndex: 1, skipped: false, revertedCount: 3 }];
    mockRevertImportSession.mockResolvedValue({ ok: true, sessionId: SESSION_ID, batches });
    const response = await POST(request(), { params: params() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: SESSION_ID, batches });
  });

  it("keeps not-found at 404 and unknown failures sanitized", async () => {
    mockRevertImportSession.mockResolvedValueOnce({
      ok: false,
      error: { code: "not_found", message: "Import session not found." },
    });
    const missing = await POST(request(), { params: params() });
    expect(missing.status).toBe(404);

    mockRevertImportSession.mockRejectedValueOnce(new Error("sensitive database detail"));
    const failed = await POST(request(), { params: params() });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: { code: "internal_error", message: "Internal server error." } });
  });
});
