import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth-context";
import { Scanner } from "./scanner";
import type { RecentScan, ScanMode } from "@/lib/scanner/types";
import { resolveSiteCostReadAccess } from "@/lib/api/site-capability";
import { fetchRecentScans } from "@/domains/scanning/recent-scans";

export const metadata: Metadata = { title: "Scan" };

type SearchParams = Promise<{ mode?: string }>;

export default async function ScannerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const initialMode: ScanMode = sp.mode === "bottle" ? "bottle" : "invoice";
  const auth = await getAuthContext();

  let recentScans: RecentScan[] = [];

  if (auth) {
    const { supabase, restaurantId } = auth;
    const canReadCost = await resolveSiteCostReadAccess(supabase, restaurantId);
    recentScans = await fetchRecentScans(supabase, restaurantId, canReadCost);
  }

  return <Scanner userId={auth?.user.id ?? null} recentScans={recentScans} initialMode={initialMode} />;
}
