/**
 * Is this process talking to a throwaway local Supabase, or to a real one?
 *
 * The answer used to be carried by the demo tenant's own NAME: the local seed
 * called its restaurant "LOCAL SEED - Osteria Scala", so anyone looking at a
 * screen could tell at a glance which database they were on. That worked, but
 * it cost the demo — an investor opening the prototype saw a tenant that
 * announced itself as test data, truncated to "LOCAL SE…" in a 390px header.
 *
 * The signal moved here instead, and got stronger on the way: it is derived
 * from the connection this process actually holds, not from a row inside it.
 * Renaming a restaurant cannot switch it off, seeding a hosted project cannot
 * switch it on, and it does not depend on anyone remembering a prefix.
 *
 * The allow-list (and the reasoning behind allow- rather than deny-listing)
 * is shared with the live-database test guard in src/test/live-db-target.ts,
 * which re-exports this function — "local" must mean exactly one thing in a
 * codebase where it gates both a UI badge and a service-role kill switch.
 */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function isLoopbackDbUrl(rawUrl: string): boolean {
  let hostname: string;
  try {
    // Parse rather than substring-match: "https://evil.test/?h=127.0.0.1"
    // contains a loopback address but does not point at one.
    hostname = new URL(rawUrl).hostname;
  } catch {
    return false;
  }
  // WHATWG URL renders IPv6 hosts bracketed ("[::1]"); compare the address.
  return LOOPBACK_HOSTNAMES.has(hostname.replace(/^\[|\]$/g, ""));
}

/**
 * Whether the app is pointed at a local stack right now. Unset URL counts as
 * NOT local: an app with no configured Supabase is misconfigured, and the
 * honest failure is a missing badge rather than a badge claiming a hosted
 * deployment is a scratch database.
 */
export function isLocalSupabaseTarget(
  rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  return typeof rawUrl === "string" && isLoopbackDbUrl(rawUrl);
}
