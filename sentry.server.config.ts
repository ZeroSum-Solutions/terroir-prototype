/**
 * BND-032 / INT-010 — Sentry Node.js server runtime init.
 *
 * Loaded by instrumentation.ts when NEXT_RUNTIME === "nodejs".
 * Captures unhandled errors from API routes, server components,
 * server actions, and background jobs. Stack-local capture stays disabled:
 * handlers can hold private notes, request payloads and session-bearing clients.
 */
import * as Sentry from "@sentry/nextjs";
import {
  errorOnlyIntegrations,
  errorOnlyMonitoring,
  errorPrivacyIntegration,
} from "./src/lib/monitoring/error-privacy";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

  ...errorOnlyMonitoring,
  // Never attach request/auth locals to error events, including in production.
  // This also avoids the local-vars integration's React 19 dev-overlay conflict.
  includeLocalVariables: false,
  integrations: (defaults) => [
    ...errorOnlyIntegrations(defaults).filter(
      (integration) => integration.name !== "RequestData" && integration.name !== "Http",
    ),
    Sentry.requestDataIntegration({
      include: {
        headers: false, cookies: false, query_string: false,
        url: false, data: false, ip: false,
      },
    }),
    Sentry.httpIntegration({
      maxIncomingRequestBodySize: "none",
      trackIncomingRequestsAsSessions: false,
      disableIncomingRequestSpans: true,
    }),
    errorPrivacyIntegration(),
  ],
});
