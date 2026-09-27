import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), expire: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ getAuthContext: mocks.auth }));
vi.mock("@/domains/scanning/stalled-scans", () => ({ expireStalledScans: mocks.expire }));
vi.mock("@sentry/nextjs", () => ({ captureException: mocks.capture }));
vi.mock("./export-csv-button", () => ({ ExportCsvButton: () => <button>Export</button> }));
vi.mock("./scan-status-select", () => ({ ScanStatusSelect: () => <div>Status filter</div> }));

const { default: ScansPage } = await import("./page");
const row = {
  id: "scan-1", distributor_name: "Test distributor", invoice_number: null,
  invoice_date: null, status: "failed", item_count: 0, accuracy_score: null,
  status_reason: "stalled", created_at: "2026-09-01T00:00:00Z",
};
const warning = "We couldn&#x27;t check for stalled scans. Scan history is still available. Reload to try again.";

function setup(rows = [row], historyError: unknown = null) {
  const supabase = {
    from: vi.fn(() => {
      let head = false;
      const query = {
        select: vi.fn((_columns: string, options?: { head?: boolean }) => { head = !!options?.head; return query; }),
        eq: vi.fn(() => query), order: vi.fn(() => query), range: vi.fn(() => query),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: head ? null : rows, count: rows.length, error: head ? null : historyError,
        }).then(resolve),
      };
      return query;
    }),
  };
  mocks.auth.mockResolvedValue({ supabase, restaurantId: "site-1" });
  return supabase;
}

beforeEach(() => { vi.clearAllMocks(); mocks.expire.mockResolvedValue(0); });
afterEach(() => vi.restoreAllMocks());

describe("scan history housekeeping recovery", () => {
  it.each([true, false])("renders no warning after successful expiry (populated=%s)", async (populated) => {
    const supabase = setup(populated ? [row] : []);
    const html = renderToStaticMarkup(await ScansPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("check for stalled scans");
    expect(html).toContain(populated ? "Test distributor" : "No scans yet");
    expect(mocks.expire).toHaveBeenCalledExactlyOnceWith({ supabase, restaurantId: "site-1" });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves history and filter-specific reload on expiry failure (populated=%s)", async (populated) => {
    setup(populated ? [row] : []);
    const error = { code: "42501", message: "secret database detail site-1" };
    mocks.expire.mockRejectedValue(error);
    const page = populated ? "3" : "1";
    const html = renderToStaticMarkup(await ScansPage({ searchParams: Promise.resolve({ page, status: "processing" }) }));
    expect(html).toContain(warning);
    expect(html).toContain(populated ? "Test distributor" : "No scans in progress");
    expect(html).toContain(populated ? 'href="/scans?page=3&amp;status=processing"' : 'href="/scans?status=processing"');
    expect(html).toContain("Reload scan history");
    expect(html).not.toContain("42501");
    expect(html).not.toContain("secret database detail");
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(error, { tags: { surface: "scans", phase: "expire-stalled" } });
  });

  it("keeps a history-read error distinct from the housekeeping warning", async () => {
    setup([], { message: "history read failed" });
    mocks.expire.mockRejectedValue(new Error("housekeeping failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(await ScansPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Failed to load scan history.");
    expect(html).not.toContain("Scan history is still available");
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it("does not attempt housekeeping without an authenticated site", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await ScansPage({ searchParams: Promise.resolve({}) })).toBeNull();
    expect(mocks.expire).not.toHaveBeenCalled();
  });
});
