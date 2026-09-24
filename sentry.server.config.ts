/**
 * BND-032 / INT-010 — Sentry Node.js server runtime init.
 *
 * Loaded by instrumentation.ts when NEXT_RUNTIME === "nodejs".
 * Captures unhandled errors from API routes, server components,
 * server actions, and background jobs. Stack-local capture stays disabled:
 * handlers can hold private notes, request payloads and session-bearing clients.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

  // 100% in dev for easy debugging; 10% in prod to control cost.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Default PII capture stays disabled. Explicit context at captureException
  // sites still needs minimization; this flag does not sanitize arbitrary extras.
  sendDefaultPii: false,
  // Never attach request/auth locals to error events, including in production.
  // This also avoids the local-vars integration's React 19 dev-overlay conflict.
  includeLocalVariables: false,
  enableLogs: true,
});
