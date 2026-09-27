import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockRequireMembership = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => mockRequireMembership(...args),
}));

const mockRevertImportBatch = vi.fn();
vi.mock("@/domains/import/batch-service", () => ({
  revertImportBatch: (...args: unknown[]) => mockRevertImportBatch(...args),
}));

const { POST } = await import("./route");

const BATCH_ID = "11111111-1111-4111-8111-111111111111";

function request() {
  return new Request(`http://localhost/api/import/batches/${BATCH_ID}/revert`, {
    method: "POST",
  }) as unknown as NextRequest;
}
function params() {
  return Promise.resolve({ id: BATCH_ID });
}

function makeSupabase(batch: unknown) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: batch, error: null }) }),
        }),
      }),
    })),
  };
}

function allow(supabase: unknown) {
  mockRequireMembership.mockResolvedValue({
    supabase,
    restaurantId: "restaurant-a",
    user: { id: "user-a" },
    role: "staff",
  });
}

describe("POST /api/import/batches/[id]/revert", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s for a batch not visible to this tenant and never calls revert", async () => {
    allow(makeSupabase(null));
    const response = await POST(request(), { params: params() });
    expect(response.status).toBe(404);
    expect(mockRevertImportBatch).not.toHaveBeenCalled();
  });

  it("preserves the compatible already-reverted conflict envelope", async () => {
    allow(makeSupabase({ id: BATCH_ID }));
    mockRevertImportBatch.mockResolvedValue({
      ok: false,
      error: { code: "already_reverted", message: "Import batch is already reverted." },
    });
    const response = await POST(request(), { params: params() });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "not_completed", message: "Import batch is already reverted." },
    });
  });

  it("returns the stable 409 envelope for a physical-bottle dependency", async () => {
    allow(makeSupabase({ id: BATCH_ID }));
    mockRevertImportBatch.mockResolvedValue({
      ok: false,
      error: {
        code: "physical_bottle_dependency",
        message: "Import batch cannot be reverted because physical bottles depend on its source inventory.",
      },
    });
    const response = await POST(request(), { params: params() });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "physical_bottle_dependency",
        message: "Import batch cannot be reverted because physical bottles depend on its source inventory.",
      },
    });
  });

  it("returns a safe 409 when inventory is linked to multiple import rows", async () => {
    allow(makeSupabase({ id: BATCH_ID }));
    mockRevertImportBatch.mockResolvedValue({
      ok: false,
      error: {
        code: "import_source_conflict",
        message: "Import inventory is linked to multiple import rows, so this revert was not performed. Wine catalog entries and import history are unchanged. Ask a manager to review the import.",
      },
    });
    const response = await POST(request(), { params: params() });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "import_source_conflict",
        message: "Import inventory is linked to multiple import rows, so this revert was not performed. Wine catalog entries and import history are unchanged. Ask a manager to review the import.",
      },
    });
  });

  it("returns only the compatible committed count envelope and passes no service client", async () => {
    const supabase = makeSupabase({ id: BATCH_ID });
    allow(supabase);
    mockRevertImportBatch.mockResolvedValue({
      ok: true,
      revertedCount: 7,
      orphanWinesDeleted: 0,
      lwinStampsCleared: 1,
    });
    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revertedCount: 7,
      orphanWinesDeleted: 0,
      lwinStampsCleared: 1,
    });
    expect(mockRevertImportBatch).toHaveBeenCalledWith(
      supabase,
      "restaurant-a",
      BATCH_ID,
    );
  });

  it("returns a fixed 500 for a malformed receipt or unexpected database failure", async () => {
    allow(makeSupabase({ id: BATCH_ID }));
    mockRevertImportBatch.mockResolvedValue({
      ok: false,
      error: { code: "internal_error", message: "Could not revert import batch." },
    });
    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Could not revert import batch." },
    });
  });
});
