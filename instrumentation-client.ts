/**
 * BND-032 / INT-010 — Sentry browser instrumentation.
 *
 * Runs on every page load. Uses NEXT_PUBLIC_SENTRY_DSN because the DSN
 * is embedded in the client bundle by design (it's a public identifier,
 * not a secret).
 *
 * Error-only diagnostics. Private collections, costs and tasting notes must
 * not enter session recordings or unrestricted tracing/log exports.
 */
import * as Sentry from "@sentry/nextjs";
import {
  errorOnlyIntegrations,
  errorOnlyMonitoring,
  errorPrivacyIntegration,
} from "./src/lib/monitoring/error-privacy";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

  ...errorOnlyMonitoring,
  integrations: (defaults) => [...errorOnlyIntegrations(defaults), errorPrivacyIntegration()],
});

// Keep Next's navigation hook registered; the error-only policy disables tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
