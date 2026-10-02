import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import type { LineItem } from "@/lib/scanner/types";
import { describeScanStatusReason } from "@/lib/scanner/scan-status-reason";
import { resolveSiteCostReadAccess } from "@/lib/api/site-capability";
import {
  readInventoryCosts,
  readInvoiceScanPrivate,
} from "@/lib/staff-cost/protected-readers";
import { ScanReview } from "../components/scan-review";
import { DeleteScanButton } from "./components/delete-scan-button";
import { ReExtractButton } from "./components/re-extract-button";
import {
  ScanInventoryList,
  type ScanInventoryItem,
} from "./components/scan-inventory-list";

export const metadata: Metadata = { title: "Scan review" };
const WineIdSchema = z.string().uuid();

type Params = Promise<{ id: string }>;

export default async function ScanDetailPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) notFound();

  const { supabase, restaurantId, userRole } = auth;

  const [canReadCost, scanResult] = await Promise.all([
    resolveSiteCostReadAccess(supabase, restaurantId),
    supabase
      .from("invoice_scans")
      .select(
        "id, distributor_name, invoice_number, invoice_date, accuracy_score, item_count, created_at, status, status_reason",
      )
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .single(),
  ]);
  const { data: scan, error: scanError } = scanResult;
  if (scanError && scanError.code !== "PGRST116") throw scanError;

  if (!scan) notFound();

  // SCAN-04 / D6 rule 3: the delete confirmation states the bottle-count
  // impact BEFORE the user commits, so it is read here rather than
  // discovered after the fact. Same link delete_invoice_scan (0143) uses.
  // The wine columns ride along on the same read so the committed bottles can
  // also be listed — and opened — below the review.
  const { data: linkedInventory, error: inventoryError } = await supabase
    .from("inventory_items")
    .select(
      "id, wine_id, quantity, added_at, wines(name, producer, vintage, hero_image_url, colour)",
    )
    .eq("invoice_scan_id", id)
    .eq("restaurant_id", restaurantId)
    .order("added_at", { ascending: true });
  if (inventoryError) throw inventoryError;
  const inventoryRows = linkedInventory?.length ?? 0;
  const bottles = (linkedInventory ?? []).reduce((sum, row) => sum + (row.quantity ?? 0), 0);

  const [privateScan, inventoryCosts] = canReadCost
    ? await Promise.all([
        readInvoiceScanPrivate(supabase, id),
        readInventoryCosts(
          supabase,
          restaurantId,
          [...new Set((linkedInventory ?? []).map((row) => row.wine_id))],
        ),
      ])
    : [null, []];
  if (
    canReadCost &&
    (!privateScan || privateScan.scan_id !== id || privateScan.restaurant_id !== restaurantId)
  ) {
    throw new Error("Scan detail protected read was incomplete.");
  }
  const costByInventoryId = new Map(
    inventoryCosts.map((row) => [row.inventory_item_id, row.unit_cost]),
  );
  if (
    canReadCost &&
    (costByInventoryId.size !== inventoryCosts.length ||
      (linkedInventory ?? []).some((row) => !costByInventoryId.has(row.id)))
  ) {
    throw new Error("Scan inventory cost protected read was incomplete.");
  }

  // Only committed rows have a wine id, so this is empty until the scan has
  // been committed — which is exactly when there is a wine to open.
  const inventoryItems: ScanInventoryItem[] = (linkedInventory ?? []).flatMap((row) => {
    if (!row.wines) return [];
    return [{
      id: row.id,
      wineId: row.wine_id,
      quantity: row.quantity,
      unitCost: canReadCost ? costByInventoryId.get(row.id)! : null,
      name: row.wines.name,
      producer: row.wines.producer,
      vintage: row.wines.vintage,
      heroImageUrl: row.wines.hero_image_url,
      colour: row.wines.colour,
    }];
  });

  const statusReason = describeScanStatusReason(scan.status_reason);

  const items: Array<LineItem & { wine_id?: string }> = ((privateScan?.final_line_items ?? []) as Array<Record<string, unknown>>).map(
    (it, idx) => {
      let wineId: string | undefined;
      if (it.wine_id !== undefined) {
        const parsedWineId = WineIdSchema.safeParse(it.wine_id);
        if (!parsedWineId.success) throw new Error("Scan line item contains an invalid wine identity.");
        wineId = parsedWineId.data;
      }
      return {
        id: `${scan.id}-${idx}`,
        name: (it.name as string) ?? "",
        producer: (it.producer as string) ?? "",
        vintage: (it.vintage as number | null) ?? null,
        varietal: (it.varietal as string) ?? "",
        region: (it.region as string) ?? "",
        qty: (it.qty as number) ?? 0,
        unitCost: (it.unitCost as number) ?? 0,
        currency: (it.currency as string | null) ?? null,
        format: (it.format as string | null) ?? null,
        confidence: (it.confidence as number) ?? 1,
        ...(wineId === undefined ? {} : { wine_id: wineId }),
      };
    },
  );

  return (
    <>
      {/* D6 rule 1: a scan that found nothing or failed stays here, and
          says why. Without this a 0-item "complete" row and a 0-item
          "failed" row are indistinguishable to the person reading them. */}
      {statusReason && (
        <p
          role="status"
          className="glass mb-md rounded-card px-md py-sm text-body-sm text-ink-soft"
        >
          {statusReason}
        </p>
      )}
      <div className="mb-md flex flex-wrap items-start justify-between gap-sm">
        {canReadCost && (userRole === "owner" || userRole === "manager") ? (
          <ReExtractButton scanId={scan.id} />
        ) : <span />}
        <DeleteScanButton
          scanId={scan.id}
          distributor={scan.distributor_name}
          inventoryRows={inventoryRows}
          bottles={bottles}
          canDelete={userRole === "owner" || userRole === "manager"}
        />
      </div>
      {canReadCost ? (
        <ScanReview
          id={scan.id}
          distributor={scan.distributor_name}
          invoiceNumber={scan.invoice_number}
          invoiceDate={scan.invoice_date}
          expectedUpdatedAt={privateScan!.updated_at}
          accuracy={scan.accuracy_score != null ? Math.round(scan.accuracy_score * 100) : null}
          itemCount={scan.item_count}
          createdAt={scan.created_at}
          items={items}
          hasImage={privateScan!.has_image}
        />
      ) : (
        <section className="glass rounded-card p-md" aria-label="Restricted scan details">
          <h1 className="font-serif text-heading-sm text-ink">Scan details restricted</h1>
          <p className="mt-xs text-body-sm text-ink-soft">
            Invoice line items, costs, and images require cost access. Scan status and
            linked inventory remain available below.
          </p>
        </section>
      )}
      <ScanInventoryList items={inventoryItems} costRestricted={!canReadCost} />
    </>
  );
}
