// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@sentry/nextjs";
type Client = NonNullable<ReturnType<typeof import("@sentry/nextjs").init>>;

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/nextjs", async () => {
  // Resolve the installed Node entry, not Vite's browser-condition entry.
  const { createRequire } = await import("node:module");
  const installed = createRequire(import.meta.url)("@sentry/nextjs");
  return { ...installed, init, captureRouterTransitionStart: vi.fn() };
});

describe("server error-monitoring privacy", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "1");
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["production", "test", "development"])(
    "disables stack locals and unreviewed telemetry channels in %s",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      await import("../../../sentry.server.config");

      expect(init).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        includeLocalVariables: false,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSendTransaction: expect.any(Function),
        enableLogs: false,
        enableMetrics: false,
        sendClientReports: false,
        beforeSend: expect.any(Function),
      }));
      expect(init.mock.calls[0][0].beforeSendTransaction({ type: "transaction" }))
        .toBeNull();
      const integrations = init.mock.calls[0][0].integrations([
        { name: "ProcessSession" }, { name: "BrowserSession" },
      ]);
      expect(integrations.map((integration: { name: string }) => integration.name))
        .not.toContain("ProcessSession");
    },
  );

  it.each([
    "../../../sentry.edge.config",
    "../../../instrumentation-client",
  ])("uses the same error-only boundary in %s", async (configPath) => {
    await import(configPath);
    expect(init).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      beforeSend: expect.any(Function), enableLogs: false,
      enableMetrics: false, sendClientReports: false,
      sendDefaultPii: false,
    }));
    const config = init.mock.calls[0][0];
    expect(config.tracesSampleRate).toBe(0);
    expect(config.replaysSessionSampleRate ?? 0).toBe(0);
    expect(config.replaysOnErrorSampleRate ?? 0).toBe(0);
    if (configPath.endsWith("instrumentation-client")) {
      const names = config.integrations([
        { name: "BrowserSession" }, { name: "Breadcrumbs" },
        { name: "HttpContext" }, { name: "BrowserTracing" },
      ]).map((integration: { name: string }) => integration.name);
      expect(names).toEqual(["TerroirErrorPrivacy"]);
    }
  });

  it.each(["../../../sentry.server.config", "../../../sentry.edge.config"])(
    "the installed RequestData processor excludes request secrets for %s", async (configPath) => {
    await import(configPath);
    const config = init.mock.calls[0][0];
    const integrations = typeof config.integrations === "function"
      ? config.integrations([]) : config.integrations;
    const requestData = integrations.find(
      (integration: { name: string }) => integration.name === "RequestData",
    );
    expect(requestData).toBeDefined();
    const client = {
      getDataCollectionOptions: () => ({
        cookies: false, httpHeaders: { request: false },
        urlQueryParams: false, userInfo: false,
      }),
    } as unknown as Client;
    const event: Event = {
      sdkProcessingMetadata: {
        normalizedRequest: {
          method: "POST", url: "https://test.invalid/?secret-query",
          headers: { authorization: "secret-auth", cookie: "sb-session=secret-cookie" },
          query_string: "secret-query", data: '{"password":"secret-body"}',
        },
      },
    };
    const processed = await requestData.processEvent(event, {}, client);
    expect(processed.request).toEqual({ method: "POST" });
    // beforeSend also removes SDK metadata and any pre-existing explicit context.
    expect(JSON.stringify(config.beforeSend(processed, {}))).not.toContain("secret-");
  });
});
