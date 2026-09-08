import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireMembership } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { fetchInsightsInventory, readInsightsPages } from "@/lib/insights/snapshot-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatMoney(n: number): string {
  return escapeField("$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
}

/**
 * GET /api/insights/csv — export the insights view as CSV.
 *
 * Columns match the visible panels on /insights: Date, Distributor,
 * Items Scanned, Accuracy, Value. Includes distributor breakdown
 * and varietal breakdown sections.
 */
export async function GET() {
  return withApiHandler(getInsightsCsv);
}

async function getInsightsCsv() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  try {
    // Fetch the same data as the insights page
    const [
      scans,
      inventoryItems,
      scanItems,
    ] = await Promise.all([
      readInsightsPages((from, to) => supabase
        .from("invoice_scans")
        .select(
          "id, distributor_name, item_count, accuracy_score, created_at, final_line_items",
        )
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false }).order("id").range(from, to)),
      fetchInsightsInventory(supabase, restaurantId),
      readInsightsPages((from, to) => supabase
        .from("inventory_items")
        .select(
          "quantity, unit_cost, invoice_scan_id, invoice_scans!inner(distributor_name)",
        )
        .eq("restaurant_id", restaurantId).order("id").range(from, to)),
    ]);

    const allScans = scans ?? [];
    const items = inventoryItems ?? [];

    const lines: string[] = [];

    // ── Section 1: Scan Activity ──────────────────────────────────────
    lines.push("=== SCAN ACTIVITY ===");
    lines.push("Date,Distributor,Items Scanned,Accuracy,Value");

    for (const scan of allScans) {
      const lineItems = (scan.final_line_items ?? []) as Array<{
        qty?: number;
        unitCost?: number;
      }>;
      const scanValue = lineItems.reduce(
        (sum, it) => sum + (it.qty ?? 0) * (it.unitCost ?? 0),
        0,
      );
      const accuracyPct =
        scan.accuracy_score != null
          ? Math.round(scan.accuracy_score * 100) + "%"
          : "";

      const date = new Date(scan.created_at).toISOString().split("T")[0];

      lines.push(
        [
          date,
          escapeField(scan.distributor_name),
          scan.item_count,
          accuracyPct,
          scanValue > 0 ? formatMoney(scanValue) : "",
        ].join(","),
      );
    }

    lines.push("");

    // ── Section 2: Distributor Breakdown ──────────────────────────────
    const distMap = new Map<string, { scans: number; spend: number }>();
    for (const scan of allScans) {
      const existing = distMap.get(scan.distributor_name) ?? { scans: 0, spend: 0 };
      existing.scans += 1;
      distMap.set(scan.distributor_name, existing);
    }
    for (const item of scanItems ?? []) {
      const distName = (
        item.invoice_scans as { distributor_name: string }
      )?.distributor_name;
      if (!distName) continue;
      const existing = distMap.get(distName) ?? { scans: 0, spend: 0 };
      existing.spend += item.quantity * item.unit_cost;
      distMap.set(distName, existing);
    }
    const distTotalSpend =
      [...distMap.values()].reduce((s, d) => s + d.spend, 0) || 1;

    lines.push("=== DISTRIBUTOR BREAKDOWN ===");
    lines.push("Distributor,Scans,Spend,Share");

    const distributors = [...distMap.entries()]
      .sort((a, b) => b[1].spend - a[1].spend);

    for (const [name, data] of distributors) {
      const pct = Math.round((data.spend / distTotalSpend) * 100);
      lines.push(
        [
          escapeField(name),
          data.scans,
          formatMoney(data.spend),
          pct + "%",
        ].join(","),
      );
    }

    lines.push("");

    // ── Section 3: Varietal Breakdown ─────────────────────────────────
    const varietalMap = new Map<string, number>();
    for (const item of items) {
      const varietal =
        (item.wines as { varietal: string | null } | null)?.varietal ?? "Other";
      varietalMap.set(
        varietal,
        (varietalMap.get(varietal) ?? 0) + item.quantity * item.unit_cost,
      );
    }
    const varietalTotal =
      [...varietalMap.values()].reduce((s, v) => s + v, 0) || 1;

    lines.push("=== VARIETAL BREAKDOWN ===");
    lines.push("Varietal,Value,Share");

    const varietals = [...varietalMap.entries()]
      .sort((a, b) => b[1] - a[1]);

    for (const [name, value] of varietals) {
      const pct = Math.round((value / varietalTotal) * 100);
      lines.push(
        [escapeField(name), formatMoney(value), pct + "%"].join(","),
      );
    }

    const csv = lines.join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="insights-export.csv"',
      },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { surface: "insights", phase: "csv-export" },
      extra: { restaurantId },
    });
    return Errors.internal("Failed to generate CSV export.");
  }
}
