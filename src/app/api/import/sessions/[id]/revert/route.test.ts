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

  it("returns 409 with no child outcomes for a rolled-back dependency-blocked session", async () => {
    mockRevertImportSession.mockResolvedValue({
      ok: false,
      error: {
        code: "physical_bottle_dependency",
        message: "Import session cannot be fully reverted because physical bottles depend on imported inventory.",
      },
      batches: [],
    });

    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "physical_bottle_dependency",
        message: "Import session cannot be fully reverted because physical bottles depend on imported inventory.",
        details: { batches: [] },
      },
    });
  });

  it("returns a safe 409 with no child outcomes for a rolled-back shared-source conflict", async () => {
    mockRevertImportSession.mockResolvedValue({
      ok: false,
      error: {
        code: "import_source_conflict",
        message: "Import inventory is linked to multiple import rows, so this revert was not performed. Wine catalog entries and import history are unchanged. Ask a manager to review the import.",
      },
      batches: [],
    });

    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "import_source_conflict",
        message: "Import inventory is linked to multiple import rows, so this revert was not performed. Wine catalog entries and import history are unchanged. Ask a manager to review the import.",
        details: { batches: [] },
      },
    });
  });

  it("keeps successful session reverts at 200", async () => {
    const batches = [{
      batchId: "11111111-1111-4111-8111-111111111111",
      chunkIndex: 1,
      skipped: false,
      revertedCount: 3,
      orphanWinesDeleted: 0,
      lwinStampsCleared: 1,
    }];
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

    mockRevertImportSession.mockResolvedValueOnce({
      ok: false,
      error: { code: "internal_error", message: "Could not revert import session." },
    });
    const failed = await POST(request(), { params: params() });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: { code: "internal_error", message: "Could not revert import session." },
    });
  });
});
