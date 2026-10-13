import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ requireMembership: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  requireMembership: (...args: unknown[]) => auth.requireMembership(...args),
}));

const limits = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => limits.rateLimit(...args),
}));

const { POST } = await import("./route");

const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SITE = "11111111-1111-4111-8111-111111111111";

function receipt(scanId = KEY) {
  return {
    version: 1,
    kind: "invoice_scan_upload",
    scanId,
    status: "queued",
    itemCount: 0,
  };
}

function makeSupabase(options: {
  claim?: { data: unknown; error: unknown };
  create?: { data: unknown; error: unknown };
  complete?: { data: unknown; error: unknown };
  abandon?: { data: unknown; error: unknown };
  uploadErrorAt?: number;
  pending?: { data: unknown; error: unknown };
  pendingPages?: boolean[];
} = {}) {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const uploadCalls: Array<{ path: string; bytes: Buffer; options: unknown }> = [];
  let uploadIndex = 0;
  let pendingIndex = 0;
  return {
    rpcCalls,
    uploadCalls,
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "claim_scan_idempotency") {
        return options.claim ?? {
          data: [{ disposition: "claimed", receipt: null }],
          error: null,
        };
      }
      if (name === "create_invoice_scan_upload_manifest") {
        return options.create ?? {
          data: { scanId: KEY, status: "queued" },
          error: null,
        };
      }
      if (name === "can_resume_invoice_upload") {
        if (options.pendingPages) {
          return { data: options.pendingPages[pendingIndex++], error: null };
        }
        return options.pending ?? { data: false, error: null };
      }
      if (name === "complete_scan_idempotency") {
        return options.complete ?? { data: receipt(), error: null };
      }
      if (name === "abandon_scan_idempotency") {
        return options.abandon ?? { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async (path: string, bytes: Buffer, uploadOptions: unknown) => {
          uploadIndex += 1;
          uploadCalls.push({ path, bytes, options: uploadOptions });
          return {
            error:
              uploadIndex === options.uploadErrorAt
                ? { message: "private storage detail" }
                : null,
          };
        }),
      })),
    },
  };
}

function allow(supabase: ReturnType<typeof makeSupabase>) {
  auth.requireMembership.mockResolvedValue({
    supabase,
    user: { id: "22222222-2222-4222-8222-222222222222" },
    restaurantId: SITE,
    role: "staff",
  });
}

function formRequest(files: File[], key: string | null = KEY): NextRequest {
  const form = new FormData();
  for (const file of files) form.append("file", file);
  const headers = new Headers();
  if (key) headers.set("Idempotency-Key", key);
  return new Request("http://localhost/api/scan", {
    method: "POST",
    headers,
    body: form,
  }) as unknown as NextRequest;
}

function image(name = "invoice.jpg", type = "image/jpeg") {
  return new File(["invoice bytes"], name, { type });
}

describe("POST /api/scan upload/enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limits.rateLimit.mockReturnValue({ ok: true });
  });

  it("returns auth failures before cache or storage work", async () => {
    auth.requireMembership.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const response = await POST(formRequest([image()]));
    expect(response.status).toBe(401);
  });

  it("requires a valid UUID idempotency key before storage or RPC work", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await POST(formRequest([image()], null));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "idempotency_key_required" },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.uploadCalls).toEqual([]);
  });

  it("fails closed on a claim error and performs no upload", async () => {
    const supabase = makeSupabase({
      claim: { data: null, error: { code: "XX000", message: "private" } },
    });
    allow(supabase);

    const response = await POST(formRequest([image()]));

    expect(response.status).toBe(500);
    expect(supabase.uploadCalls).toEqual([]);
    expect(supabase.rpcCalls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
    ]);
  });

  it("returns an exact replay without touching storage or the create RPC", async () => {
    const supabase = makeSupabase({
      claim: {
        data: [{ disposition: "replay", receipt: receipt() }],
        error: null,
      },
    });
    allow(supabase);

    const response = await POST(formRequest([image()]));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(receipt());
    expect(supabase.uploadCalls).toEqual([]);
    expect(supabase.rpcCalls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
    ]);
  });

  it("uploads one page, atomically creates/enqueues, and completes a typed receipt", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await POST(formRequest([image()]));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(receipt());
    expect(supabase.uploadCalls).toEqual([
      expect.objectContaining({
        path: `${SITE}/${KEY}.jpg`,
        options: {
          contentType: "image/jpeg",
          upsert: false,
          metadata: { sha256: createHash("sha256").update("invoice bytes").digest("hex") },
        },
      }),
    ]);
    expect(supabase.rpcCalls).toContainEqual({
      name: "create_invoice_scan_upload_manifest",
      args: {
        p_restaurant_id: SITE,
        p_scan_id: KEY,
        p_object_name: `${SITE}/${KEY}.jpg`,
        p_object_names: [`${SITE}/${KEY}.jpg`],
        p_distributor_name: "Unknown",
        p_invoice_number: null,
        p_invoice_date: null,
      },
    });
    expect(supabase.rpcCalls.at(-1)).toEqual({
      name: "complete_scan_idempotency",
      args: expect.objectContaining({
        p_kind: "invoice_scan_upload",
        p_scan_id: KEY,
        p_item_count: 0,
        p_wine_count: null,
        p_wine_id: null,
      }),
    });
  });

  it("uploads every page under the admitted deterministic convention", async () => {
    const supabase = makeSupabase();
    allow(supabase);

    const response = await POST(
      formRequest([image("one.jpg"), image("two.png", "image/png")]),
    );

    expect(response.status).toBe(202);
    expect(supabase.uploadCalls.map((call) => call.path)).toEqual([
      `${SITE}/${KEY}_page1.jpg`,
      `${SITE}/${KEY}_page2.png`,
    ]);
    expect(supabase.rpcCalls).toContainEqual({
      name: "create_invoice_scan_upload_manifest",
      args: expect.objectContaining({
        p_object_name: `${SITE}/${KEY}_page1.jpg`,
        p_object_names: [`${SITE}/${KEY}_page1.jpg`, `${SITE}/${KEY}_page2.png`],
      }),
    });
  });

  it("abandons a known failed deterministic upload and does not create a scan", async () => {
    const supabase = makeSupabase({ uploadErrorAt: 2 });
    allow(supabase);

    const response = await POST(
      formRequest([image("one.jpg"), image("two.png", "image/png")]),
    );

    expect(response.status).toBe(500);
    expect(supabase.rpcCalls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency",
      "can_resume_invoice_upload",
      "can_resume_invoice_upload",
      "abandon_scan_idempotency",
    ]);
  });

  it("resumes an exact actor-owned pending page without overwriting storage", async () => {
    const supabase = makeSupabase({ pending: { data: true, error: null } });
    allow(supabase);
    const response = await POST(formRequest([image()]));
    expect(response.status).toBe(202);
    expect(supabase.uploadCalls).toEqual([]);
    expect(supabase.rpcCalls).toContainEqual({
      name: "can_resume_invoice_upload",
      args: {
        p_restaurant_id: SITE, p_scan_id: KEY, p_object_name: `${SITE}/${KEY}.jpg`,
        p_sha256: createHash("sha256").update("invoice bytes").digest("hex"),
        p_byte_size: 13, p_mime_type: "image/jpeg",
      },
    });
  });

  it("reuses the first pending page and inserts only the missing second page", async () => {
    const supabase = makeSupabase({ pendingPages: [true, false] });
    allow(supabase);
    const response = await POST(formRequest([image("one.jpg"), image("two.png", "image/png")]));
    expect(response.status).toBe(202);
    expect(supabase.uploadCalls.map((call) => call.path)).toEqual([`${SITE}/${KEY}_page2.png`]);
    expect(supabase.rpcCalls).toContainEqual({
      name: "create_invoice_scan_upload_manifest",
      args: expect.objectContaining({
        p_object_names: [`${SITE}/${KEY}_page1.jpg`, `${SITE}/${KEY}_page2.png`],
      }),
    });
  });

  it.each([
    { data: true, error: { message: "private" } },
    { data: null, error: null },
    { data: "true", error: null },
  ])("refuses invalid pending-page admission before storage or enqueue", async (pending) => {
    const supabase = makeSupabase({ pending });
    allow(supabase);
    const response = await POST(formRequest([image()]));
    expect(response.status).toBe(500);
    expect(supabase.uploadCalls).toEqual([]);
    expect(supabase.rpcCalls.map((call) => call.name)).toEqual([
      "claim_scan_idempotency", "can_resume_invoice_upload", "abandon_scan_idempotency",
    ]);
  });

  it("uses the JSON object's exact scan id and never downloads or signs it", async () => {
    const objectScan = "33333333-3333-4333-8333-333333333333";
    const supabase = makeSupabase({
      create: {
        data: { scanId: objectScan, status: "queued" },
        error: null,
      },
      complete: { data: receipt(objectScan), error: null },
    });
    allow(supabase);
    const response = await POST(
      new Request("http://localhost/api/scan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": KEY,
        },
        body: JSON.stringify({ imagePath: `${SITE}/${objectScan}.heic` }),
      }) as unknown as NextRequest,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(receipt(objectScan));
    expect(supabase.uploadCalls).toEqual([]);
    expect(supabase.rpcCalls).toContainEqual({
      name: "create_invoice_scan_upload_manifest",
      args: expect.objectContaining({
        p_scan_id: objectScan,
        p_object_name: `${SITE}/${objectScan}.heic`,
        p_object_names: [`${SITE}/${objectScan}.heic`],
      }),
    });
  });

  it("rejects a JSON path outside the exact site/scan convention", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(
      new Request("http://localhost/api/scan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": KEY,
        },
        body: JSON.stringify({ imagePath: `${SITE}/folder/invoice.jpg` }),
      }) as unknown as NextRequest,
    );
    expect(response.status).toBe(404);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects mixed PDF batches before cache or storage work", async () => {
    const supabase = makeSupabase();
    allow(supabase);
    const response = await POST(
      formRequest([
        image("invoice.pdf", "application/pdf"),
        image("page.jpg", "image/jpeg"),
      ]),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "mixed_pdf_batch" },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.uploadCalls).toEqual([]);
  });
});
