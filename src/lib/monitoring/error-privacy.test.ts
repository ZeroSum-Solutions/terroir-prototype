import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { minimizeErrorEvent } from "./error-privacy";

describe("error-only export boundary", () => {
  it("rebuilds diagnostics without request, actor, text or arbitrary contexts", () => {
    const event: ErrorEvent = {
      type: undefined,
      event_id: "0123456789abcdef0123456789abcdef",
      timestamp: 1_790_000_000,
      platform: "node",
      release: "test-release",
      environment: "test",
      message: "secret-message",
      logentry: { message: "secret-log", params: ["secret-param"] },
      request: {
        url: "https://test.invalid/secret-path?token=secret-query",
        headers: { Authorization: "secret-header" },
        cookies: { session: "secret-cookie" },
        data: { note: "secret-body" },
      },
      user: { id: "secret-user", email: "secret-email" },
      extra: { document: "secret-document" },
      contexts: { arbitrary: { note: "secret-context" } },
      tags: { wine: "secret-wine" },
      breadcrumbs: [{ message: "secret-breadcrumb" }],
      transaction: "secret-transaction",
      fingerprint: ["secret-fingerprint"],
      sdkProcessingMetadata: { normalizedRequest: { data: "secret-normalized" } },
      exception: {
        values: [{
          type: "secret-type", value: "secret-error",
          stacktrace: {
            frames: [{
              filename: "https://secret-user:secret-password@test.invalid/app.js?secret-token",
              function: "secret-function", lineno: 10, colno: 4, in_app: true,
              abs_path: "secret-absolute-path", vars: { auth: "secret-local" },
              context_line: "secret-source", pre_context: ["secret-before"],
              post_context: ["secret-after"],
            }],
          },
        }],
      },
    };
    const original = JSON.stringify(event);
    const minimized = minimizeErrorEvent(event, {});
    expect(JSON.stringify(minimized)).not.toContain("secret-");
    expect(minimized).toMatchObject({
      event_id: event.event_id, release: "test-release", environment: "test",
      exception: { values: [{ stacktrace: { frames: [{
        filename: "app.js", lineno: 10, colno: 4, in_app: true,
      }] } }] },
    });
    expect(JSON.stringify(event)).toBe(original);
  });

  it("removes out-of-band attachments from the hint", () => {
    const hint = {
      attachments: [{ filename: "invoice.txt", data: "private invoice" }],
    };
    expect(minimizeErrorEvent({ type: undefined }, hint)).toMatchObject({ level: "error" });
    expect(hint.attachments).toEqual([]);
  });

  it("bounds exception chains and stacks and excludes invalid code coordinates", () => {
    const result = minimizeErrorEvent({
      type: undefined,
      exception: { values: Array.from({ length: 10 }, () => ({
        stacktrace: { frames: Array.from({ length: 100 }, () => ({
          filename: "secret-not-a-code-file", lineno: -1, colno: Number.NaN,
        })) },
      })) },
    }, {});
    expect(result?.exception?.values).toHaveLength(5);
    expect(result?.exception?.values?.[0].stacktrace?.frames).toHaveLength(50);
    expect(result?.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({});
  });
});
