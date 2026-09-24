import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  captureException: vi.fn(),
  loggerInfo: vi.fn(),
  startSpan: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: sentryMock.captureException,
  logger: { info: sentryMock.loggerInfo },
  startSpan: sentryMock.startSpan,
}));

const { withScanSpan } = await import("./scan-telemetry");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withScanSpan", () => {
  it("returns fn's resolved value exactly once without using the SDK", async () => {
    const fn = vi.fn().mockResolvedValue("ocr-result");
    const result = await withScanSpan("ocr.page", { pageIndex: 0 }, fn);

    expect(result).toBe("ocr-result");
    expect(fn).toHaveBeenCalledOnce();
    expect(sentryMock.startSpan).not.toHaveBeenCalled();
    expect(sentryMock.loggerInfo).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it("rethrows fn's original error exactly once without logging it", async () => {
    const stageError = new Error("private rejected stage detail");
    const fn = vi.fn().mockRejectedValue(stageError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(withScanSpan("ocr.page", {}, fn)).rejects.toBe(stageError);
    expect(fn).toHaveBeenCalledOnce();
    expect(sentryMock.startSpan).not.toHaveBeenCalled();
    expect(sentryMock.loggerInfo).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
