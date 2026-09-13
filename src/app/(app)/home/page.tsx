import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth-context";
import { readInsightsPages } from "@/lib/insights/snapshot-data";
import { HomeView } from "./home-view";
import { buildHomeSnapshot } from "./home-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const auth = (await getAuthContext())!;
  const { supabase, restaurantId, restaurantName, userRole } = auth;

  const [inventoryRows, openResult, reviewResult, eightysixedResult] = await Promise.all([
    readInsightsPages((from, to) =>
      supabase
        .from("inventory_items")
        .select("quantity, bin_id")
        .eq("restaurant_id", restaurantId)
        .order("id")
        .range(from, to),
    ),
    supabase
      .from("open_bottles")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .is("closed_at", null),
    supabase
      .from("invoice_scans")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("status", "review"),
    supabase
      .from("wines")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("is_eightysixed", true),
  ]);

  const countError = openResult.error ?? reviewResult.error ?? eightysixedResult.error;
  if (countError) throw countError;

  const snapshot = buildHomeSnapshot(inventoryRows, {
    openBottleCount: openResult.count ?? 0,
    reviewCount: reviewResult.count ?? 0,
    eightysixedCount: eightysixedResult.count ?? 0,
  });

  return (
    <HomeView
      restaurantName={restaurantName}
      role={userRole}
      snapshot={snapshot}
    />
  );
}
