import { beforeEach, describe, expect, it, vi } from "vitest";

/** Pipeline regressions after retiring remote per-stage scan telemetry. */

const mockExtractOcr = vi.fn();
const mockExtractFromOcr = vi.fn();
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  loggerInfo: vi.fn(),
  startSpan: vi.fn(),
}));
vi.mock("@/adapters/ocr/azure-document-intelligence", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/adapters/ocr/azure-document-intelligence")>();
  return {
    ...actual,
    OcrError: class OcrError extends Error {},
    extractOcr: (...args: unknown[]) => mockExtractOcr(...args),
  };
});
vi.mock("@/adapters/llm/anthropic-invoice-extraction", () => ({
  AiExtractError: class AiExtractError extends Error {},
  extractFromOcr: (...args: unknown[]) => mockExtractFromOcr(...args),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: sentry.captureException,
  logger: { info: sentry.loggerInfo },
  startSpan: sentry.startSpan,
}));

const { processInvoiceScanOnce } = await import("./invoice-scan-service");

function lineItem(overrides: Record<string, unknown> = {}) {
  return {
    name: "Volnay",
    producer: "Domaine Test",
    vintage: 2022,
    varietal: "Pinot Noir",
    region: "Burgundy",
    currency: "USD",
    format: "750ml",
    lowFields: [],
    ...overrides,
  };
}

/** Three-line invoice where every line and the invoice total reconcile. */
function reconciledInvoice(confidence = 0.95) {
  return {
    distributor: "Test Distributor",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-07-24",
    lineItems: [
      lineItem({ qty: 6, unitCost: 45, lineTotal: 270, confidence }),
      lineItem({ name: "Barolo", qty: 3, unitCost: 62.5, lineTotal: 187.5, confidence }),
      lineItem({ name: "Chablis", qty: 12, unitCost: 28, lineTotal: 336, confidence }),
    ],
    invoiceTotal: 793.5,
    taxAndFees: null,
  };
}

/** Same invoice, but the third line's unit cost was misread (28 -> 18). */
function mismatchedInvoice(confidence = 0.9) {
  const invoice = reconciledInvoice(confidence);
  invoice.lineItems[2] = lineItem({
    name: "Chablis",
    qty: 12,
    unitCost: 18,
    lineTotal: 336,
    confidence,
  });
  return invoice;
}

function makeSupabase() {
  // Chainable AND directly awaitable, matching real supabase-js query
  // builders — the persist write now chains .eq().eq().select("id")
  // (fenced on status='processing', Grok-2); resolving with a non-empty
  // row array means the fence matches, keeping these no-remote-timing tests
  // on the same 200 happy path as before.
  function node(): Record<string, unknown> {
    const n: Record<string, unknown> = {};
    n.eq = vi.fn(() => n);
    n.select = vi.fn(() => n);
    n.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({ data: [{ id: "scan-a" }], error: null }).then(resolve, reject);
    return n;
  }
  const update = vi.fn(() => node());
  const builder = { update };
  return { supabase: { from: vi.fn(() => builder) }, update };
}

async function runScan(
  supabase: unknown,
  extra: Partial<Parameters<typeof processInvoiceScanOnce>[0]> = {},
) {
  return processInvoiceScanOnce({
    supabase: supabase as never,
    restaurantId: "restaurant-a",
    userId: "user-a",
    fileBuffer: Buffer.from("invoice"),
    mimeType: "image/jpeg",
    preCreatedScanId: "scan-a",
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExtractOcr.mockResolvedValue({ rawText: "invoice text", tables: [] });
});

function expectNoRemoteTiming() {
  expect(sentry.startSpan).not.toHaveBeenCalled();
  expect(sentry.loggerInfo).not.toHaveBeenCalled();
  expect(sentry.captureException).not.toHaveBeenCalled();
}

describe("processInvoiceScanOnce without remote scan timing", () => {
  it("completes each single-page stage once and preserves the reconciled result", async () => {
    mockExtractFromOcr.mockResolvedValueOnce(reconciledInvoice());
    const { supabase, update } = makeSupabase();

    const result = await runScan(supabase);

    expect(result.status).toBe(200);
    expect((result.body as { arithmetic: { ok: boolean } }).arithmetic.ok).toBe(true);
    expect(mockExtractOcr).toHaveBeenCalledOnce();
    expect(mockExtractFromOcr).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expectNoRemoteTiming();
  });

  it("processes each page once, merges once, and persists once", async () => {
    mockExtractOcr.mockImplementation(async (buffer: Buffer) =>
      buffer.toString() === "page one"
        ? { rawText: "PAGE ONE", tables: [] }
        : { rawText: "PAGE TWO", tables: [] },
    );
    mockExtractFromOcr.mockResolvedValueOnce(reconciledInvoice());
    const { supabase, update } = makeSupabase();

    const result = await runScan(supabase, {
      fileBuffer: Buffer.from("page one"),
      extraFiles: [{ buffer: Buffer.from("page two"), mimeType: "image/png" }],
    });

    expect(result.status).toBe(200);
    expect(mockExtractOcr).toHaveBeenCalledTimes(2);
    expect(mockExtractFromOcr).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expectNoRemoteTiming();
  });

  it("keeps the single arithmetic retry and successful result", async () => {
    mockExtractFromOcr
      .mockResolvedValueOnce(mismatchedInvoice())
      .mockResolvedValueOnce(reconciledInvoice(0.97));
    const { supabase, update } = makeSupabase();

    const result = await runScan(supabase);

    expect(result.status).toBe(200);
    expect((result.body as { arithmetic: { ok: boolean } }).arithmetic.ok).toBe(true);
    expect(mockExtractOcr).toHaveBeenCalledOnce();
    expect(mockExtractFromOcr).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce();
    expectNoRemoteTiming();
  });

  it("persists the same arithmetic-failure result after the one retry", async () => {
    mockExtractFromOcr
      .mockResolvedValueOnce(mismatchedInvoice())
      .mockResolvedValueOnce(mismatchedInvoice());
    const { supabase, update } = makeSupabase();

    const result = await runScan(supabase);

    expect(result.status).toBe(200);
    expect((result.body as { arithmetic: { ok: boolean } }).arithmetic.ok).toBe(false);
    expect(mockExtractOcr).toHaveBeenCalledOnce();
    expect(mockExtractFromOcr).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce();
    expectNoRemoteTiming();
  });

  it("does not depend on a startSpan export", async () => {
    vi.resetModules();
    const captureException = vi.fn();
    vi.doMock("@sentry/nextjs", () => ({ captureException }));
    vi.doMock("@/adapters/ocr/azure-document-intelligence", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@/adapters/ocr/azure-document-intelligence")>();
      return {
        ...actual,
        OcrError: class OcrError extends Error {},
        extractOcr: (...args: unknown[]) => mockExtractOcr(...args),
      };
    });
    vi.doMock("@/adapters/llm/anthropic-invoice-extraction", () => ({
      AiExtractError: class AiExtractError extends Error {},
      extractFromOcr: (...args: unknown[]) => mockExtractFromOcr(...args),
    }));
    const { processInvoiceScanOnce: processWithoutStartSpan } = await import(
      "./invoice-scan-service"
    );

    mockExtractFromOcr
      .mockResolvedValueOnce(mismatchedInvoice())
      .mockResolvedValueOnce(reconciledInvoice(0.97));
    const { supabase } = makeSupabase();

    const result = await processWithoutStartSpan({
      supabase: supabase as never,
      restaurantId: "restaurant-a",
      userId: "user-a",
      fileBuffer: Buffer.from("invoice"),
      mimeType: "image/jpeg",
      preCreatedScanId: "scan-a",
    });

    expect(result.status).toBe(200);
    expect(mockExtractFromOcr).toHaveBeenCalledTimes(2);
    const body = result.body as { arithmetic: { ok: boolean } };
    expect(body.arithmetic.ok).toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });
});
