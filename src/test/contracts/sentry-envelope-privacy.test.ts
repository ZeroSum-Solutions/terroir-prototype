// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

type RecordedEnvelope = [
  Record<string, unknown>,
  Array<[{ type?: string }, Record<string, unknown>]>,
];
type Client = NonNullable<ReturnType<typeof import("@sentry/nextjs").init>>;
type Transport = NonNullable<ReturnType<Client["getTransport"]>>;
const recording = vi.hoisted(() => ({ envelopes: [] as RecordedEnvelope[] }));

vi.mock("@sentry/nextjs", async () => {
  const { createRequire } = await import("node:module");
  const installed = createRequire(import.meta.url)("@sentry/nextjs") as typeof import("@sentry/nextjs");
  return {
    ...installed,
    init: (options: Parameters<typeof installed.init>[0]) => installed.init({
      ...options,
      // All envelopes go to this in-memory transport. No network transport exists.
      dsn: "https://public@example.invalid/1",
      transport: () => ({
        send(envelope: Parameters<Transport["send"]>[0]) {
          recording.envelopes.push(envelope as RecordedEnvelope);
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    }),
  };
});

afterEach(async () => {
  const sdk = await import("@sentry/nextjs");
  await sdk.close(2_000);
  vi.unstubAllEnvs();
});

it("exports only minimized errors through the real configured SDK, including internal errors", async () => {
  vi.stubEnv("SENTRY_DSN", "");
  vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "1");
  vi.stubEnv("SENTRY_ENVIRONMENT", "privacy-test");
  await import("../../../sentry.server.config");
  const sdk = await import("@sentry/nextjs");
  const sentinel = "PRIVATE_SENTINEL_C13";
  const expectedIds: string[] = [];

  for (const internal of [false, true]) {
    const id = sdk.withScope((scope) => {
      scope.setUser({ id: sentinel, email: `${sentinel}@example.invalid` });
      scope.setExtra("private", sentinel);
      scope.setTag("private", sentinel);
      scope.setContext("private", { note: sentinel });
      scope.setTransactionName(sentinel);
      scope.addBreadcrumb({ message: sentinel });
      scope.addAttachment({ filename: "scope.txt", data: sentinel });
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          method: "POST", url: `https://test.invalid/${sentinel}?token=${sentinel}`,
          headers: { authorization: sentinel, cookie: `sb-session=${sentinel}` },
          query_string: `token=${sentinel}`, data: JSON.stringify({ password: sentinel }),
        },
        dynamicSamplingContext: { public_key: sentinel },
      });
      return scope.captureException(new Error(sentinel, { cause: new Error(sentinel) }), {
        attachments: [{ filename: "hint.txt", data: sentinel }],
        ...(internal ? { data: { __sentry__: true, private: sentinel } } : {}),
      });
    });
    expectedIds.push(id);
  }
  await sdk.startSpan({ name: sentinel, forceTransaction: true }, async () => {});
  expect(await sdk.flush(2_000)).toBe(true);
  expect(sdk.getClient()?.getOptions().tracesSampleRate).toBe(0);

  const envelopes = recording.envelopes;
  expect(envelopes).toHaveLength(2);
  expect(envelopes.flatMap(([, items]) => items.map(([header]) => header.type)))
    .toEqual(["event", "event"]);
  expect(envelopes.map(([, items]) => items[0][1].event_id).sort())
    .toEqual([...expectedIds].sort());
  expect(JSON.stringify(envelopes)).not.toContain(sentinel);
  expect(JSON.stringify(envelopes)).not.toContain("attachment");

  for (const [header, items] of envelopes) {
    expect(Object.keys(header).sort()).toEqual(["event_id", "sdk", "sent_at"]);
    expect(items).toHaveLength(1);
    const event = items[0][1];
    expect(Object.keys(event).sort()).toEqual([
      "environment", "event_id", "exception", "level", "message", "platform",
      "release", "sdk", "timestamp", "type",
    ]);
    expect(event.environment).toBe("privacy-test");
    expect(event.message).toBe("Application error (details withheld)");
    const exception = event.exception as {
      values: Array<{ type: string; value: string; stacktrace: { frames: Record<string, unknown>[] } }>;
    };
    expect(exception.values.length).toBeGreaterThan(0);
    for (const value of exception.values) {
      expect(value.type).toBe("ApplicationError");
      expect(value.value).toBe("Error details withheld");
      expect(value.stacktrace.frames.some((frame) =>
        typeof frame.filename === "string" && typeof frame.lineno === "number",
      )).toBe(true);
      for (const frame of value.stacktrace.frames) {
        expect(Object.keys(frame).every((key) =>
          ["filename", "lineno", "colno", "in_app"].includes(key),
        )).toBe(true);
      }
    }
  }
});
