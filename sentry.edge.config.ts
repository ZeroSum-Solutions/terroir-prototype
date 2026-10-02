/**
 * BND-032 / INT-010 — Sentry Edge runtime init.
 *
 * Loaded by instrumentation.ts when NEXT_RUNTIME === "edge".
 * The edge runtime is V8-isolate-based — no Node APIs — so options
 * like `includeLocalVariables` aren't available here.
 */
import * as Sentry from "@sentry/nextjs";
import { errorOnlyMonitoring, errorPrivacyIntegration } from "./src/lib/monitoring/error-privacy";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  ...errorOnlyMonitoring,
  integrations: [
    Sentry.requestDataIntegration({
      include: {
        headers: false, cookies: false, query_string: false,
        url: false, data: false, ip: false,
      },
    }),
    errorPrivacyIntegration(),
  ],
});
