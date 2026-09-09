// The live-database suites are the most privileged code in the test tree: they
// connect with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely, and they
// create and destroy tenants, import batches and wine rows, and drive the
// destructive revert/reconcile paths on purpose.
//
// Until this guard existed they gated on nothing but "the three env vars are
// set" — with no check on WHERE those vars pointed. A .env.local holding the
// production project's URL and service-role key (exactly what this repo's own
// runbooks tell you to generate for other tasks) was therefore one `export`
// away from running the destructive suites against production.
//
// An allow-list, not a deny-list of known production hosts: a host this guard
// has never heard of must still be refused, or it would only protect against
// the names someone remembered to enumerate.
//
// The predicate itself lives in src/lib/local-stack.ts because the app now
// renders a "LOCAL" badge off the same answer. One definition of "local", not
// two that can drift: the badge and this kill switch must never disagree
// about which database this process is holding.
export { isLoopbackDbUrl } from "@/lib/local-stack";

import { isLoopbackDbUrl } from "@/lib/local-stack";

export function assertLiveDbTargetIsLocal(rawUrl: string): void {
  if (isLoopbackDbUrl(rawUrl)) return;
  throw new Error(
    `Live-database suites refuse a non-loopback Supabase target (${rawUrl}).\n` +
      "These suites hold a service-role key that bypasses RLS and they create, " +
      "revert and delete tenant data on purpose. Running them anywhere but a " +
      "throwaway local stack can destroy real data.\n" +
      "Fix: point NEXT_PUBLIC_SUPABASE_URL at the local stack (`supabase start`), " +
      "or unset it so these suites skip.",
  );
}
