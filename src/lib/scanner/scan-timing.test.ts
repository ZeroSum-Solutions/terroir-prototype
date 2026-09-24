import { beforeEach, describe, expect, it, vi } from "vitest";

/** Local-only scan timing against the real User Timing implementation. */

const loggerInfo = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({
  logger: { info: loggerInfo },
}));

const { markScanStage, reportScanStage } = await import("./scan-timing");

beforeEach(() => {
  loggerInfo.mockClear();
  performance.clearMarks();
  performance.clearMeasures();
});

describe("markScanStage / reportScanStage", () => {
  it("measures a marked stage without exporting it", async () => {
    markScanStage("prep", "start");
    await new Promise((resolve) => setTimeout(resolve, 5));
    markScanStage("prep", "end");

    const duration = reportScanStage("scan-123", "prep", { fileCount: 2 });

    expect(duration).not.toBeNull();
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it("returns null and logs nothing when the stage was never marked", () => {
    const duration = reportScanStage("scan-123", "capture");

    expect(duration).toBeNull();
    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it("returns null when only the start mark exists (e.g. an in-flight or abandoned stage)", () => {
    markScanStage("upload", "start");

    const duration = reportScanStage("scan-123", "upload");

    expect(duration).toBeNull();
    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it("clears its marks after reporting, so a retried scan measures fresh boundaries", () => {
    markScanStage("render", "start");
    markScanStage("render", "end");
    reportScanStage("scan-1", "render");

    expect(performance.getEntriesByName("terroir:scan:render:start")).toHaveLength(0);
    expect(performance.getEntriesByName("terroir:scan:render:end")).toHaveLength(0);
  });

  it("measures the latest mark pair when a stage is marked twice in a row (retry)", async () => {
    markScanStage("capture", "start");
    await new Promise((resolve) => setTimeout(resolve, 2));
    markScanStage("capture", "end");
    reportScanStage("scan-1", "capture");
    markScanStage("capture", "start");
    await new Promise((resolve) => setTimeout(resolve, 20));
    markScanStage("capture", "end");
    const secondDuration = reportScanStage("scan-2", "capture");

    expect(secondDuration).not.toBeNull();
    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it("never throws even if performance is unavailable", () => {
    const original = globalThis.performance;
    // @ts-expect-error — simulating an environment without the User Timing API.
    delete globalThis.performance;

    expect(() => markScanStage("prep", "start")).not.toThrow();
    expect(() => reportScanStage("scan-1", "prep")).not.toThrow();
    expect(reportScanStage("scan-1", "prep")).toBeNull();

    globalThis.performance = original;
  });
});
