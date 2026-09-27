/** POST /api/scans/[id]/re-extract — enqueue one closed re-extraction request. */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseParams } from "@/lib/api/validation";
import { ScanIdParamsSchema } from "@/lib/scanner/request-schemas";
import { readInvoiceScanPrivate } from "@/lib/staff-cost/protected-readers";

export const runtime = "nodejs";

const ReextractReceiptSchema = z.strictObject({
  scanId: z.string().uuid(),
  status: z.literal("queued"),
});

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner", "manager"]);
    if (auth instanceof NextResponse) return auth;
    const { supabase, restaurantId } = auth;

    const parsedParams = await parseParams(params, ScanIdParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id } = parsedParams.data;

    const scan = await readInvoiceScanPrivate(supabase, id);
    if (!scan || scan.restaurant_id !== restaurantId) {
      return Errors.forbidden(
        "Only a manager with cost access can re-extract this scan.",
      );
    }
    // Re-extracting after inventory commit would rewrite the immutable line
    // identities used by commit replay while leaving inventory unchanged.
    if (scan.committed_at !== null) {
      return Errors.conflict(
        "scan_already_committed",
        "A committed scan can no longer be re-extracted.",
      );
    }

    const { data, error } = await supabase.rpc(
      "request_invoice_scan_reextract",
      { p_scan_id: id },
    );
    if (error) {
      if (error.code === "42501") {
        return Errors.forbidden(
          "Only a manager with cost access can re-extract this scan.",
        );
      }
      throw new Error("Invoice re-extraction request was refused.");
    }

    const receipt = ReextractReceiptSchema.safeParse(data);
    if (!receipt.success || receipt.data.scanId !== id) {
      throw new Error(
        "request_invoice_scan_reextract returned an unexpected receipt",
      );
    }
    return NextResponse.json(receipt.data, { status: 202 });
  });
}
