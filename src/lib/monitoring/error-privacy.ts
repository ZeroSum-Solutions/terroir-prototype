import type { ErrorEvent, Event, EventHint, StackFrame } from "@sentry/nextjs";

type Integration = ReturnType<typeof import("@sentry/nextjs").getDefaultIntegrations>[number];

/** Only code coordinates, never source lines, request data or stack locals. */
function diagnosticFrame(frame: StackFrame): StackFrame {
  const path = frame.filename?.split(/[?#]/, 1)[0];
  const filename = path?.split(/[/\\]/).at(-1);
  return {
    ...(filename && /^[\w.()[\]-]{1,160}\.(?:[cm]?js|tsx?)$/.test(filename)
      ? { filename }
      : {}),
    ...(Number.isSafeInteger(frame.lineno) && frame.lineno! > 0
      ? { lineno: frame.lineno }
      : {}),
    ...(Number.isSafeInteger(frame.colno) && frame.colno! >= 0
      ? { colno: frame.colno }
      : {}),
    ...(typeof frame.in_app === "boolean" ? { in_app: frame.in_app } : {}),
  };
}

/**
 * Error-only export contract. A new SDK field is excluded by default.
 * Raw exception text can contain SQL values, uploaded text or provider payloads.
 * Attachments bypass the event body and must also be removed from the hint.
 */
export function minimizeErrorEvent(
  event: Event,
  hint: EventHint = {},
): ErrorEvent {
  hint.attachments = [];
  return {
    type: undefined,
    event_id: /^[a-f0-9]{32}$/i.test(event.event_id ?? "") ? event.event_id : undefined,
    timestamp: event.timestamp,
    level: "error",
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    message: "Application error (details withheld)",
    exception: {
      values: event.exception?.values?.slice(0, 5).map((exception) => ({
        type: "ApplicationError",
        value: "Error details withheld",
        stacktrace: {
          frames: exception.stacktrace?.frames?.slice(-50).map(diagnosticFrame),
        },
      })),
    },
  };
}

/** Internal SDK errors bypass beforeSend, but still pass this final event hook. */
export function errorPrivacyIntegration(): Integration {
  return {
    name: "TerroirErrorPrivacy",
    setup(client) {
      client.on("beforeSendEvent", (event, hint) => {
        const minimized = minimizeErrorEvent(event, hint);
        for (const key of Object.keys(event)) delete event[key as keyof Event];
        Object.assign(event, minimized);
      });
    },
  };
}

/** Avoid collecting browser context or emitting independent session envelopes. */
export function errorOnlyIntegrations(defaults: Integration[]): Integration[] {
  const excluded = new Set([
    "ProcessSession", "BrowserSession", "Breadcrumbs", "HttpContext", "BrowserTracing",
  ]);
  return defaults.filter((integration) => !excluded.has(integration.name));
}

/** Rich telemetry needs its own reviewed data contract; error monitoring stays on. */
export const errorOnlyMonitoring = {
  sendDefaultPii: false,
  // Explicit zero overrides the Node SDK's SENTRY_TRACES_SAMPLE_RATE fallback.
  tracesSampleRate: 0,
  beforeSendTransaction: () => null,
  enableLogs: false,
  enableMetrics: false,
  sendClientReports: false,
  beforeSend: minimizeErrorEvent,
};
