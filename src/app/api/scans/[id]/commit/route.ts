import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { parseParams } from "@/lib/api/validation";
import { ScanIdParamsSchema } from "@/lib/scanner/request-schemas";

export const runtime = "nodejs";

const CommitReceiptSchema = z.strictObject({
  scanId: z.string().uuid(),
  itemCount: z.number().int().min(1).max(500),
  wineCount: z.number().int().min(1).max(500),
}).refine(({ itemCount, wineCount }) => wineCount <= itemCount);

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiHandler(async () => {
    const auth = await requireRole(["owner", "manager"]);
    if (auth instanceof NextResponse) return auth;
    const { supabase } = auth;

    const parsedParams = await parseParams(params, ScanIdParamsSchema);
    if (!parsedParams.ok) return parsedParams.response;
    const { id } = parsedParams.data;

    const scan = await supabase
      .from("invoice_scans")
      .select("id")
      .eq("id", id)
      .eq("restaurant_id", auth.restaurantId)
      .maybeSingle();
    if (scan.error) throw scan.error;
    if (!scan.data) return Errors.notFound("Scan");

    const { data: receiptRaw, error } = await supabase.rpc(
      "commit_invoice_scan",
      { p_scan_id: id },
    );
    if (error) {
      if (error.code === "42501") {
        return Errors.forbidden("Only a manager with cost access can commit this scan.");
      }
      throw error;
    }

    const receipt = CommitReceiptSchema.safeParse(receiptRaw);
    if (!receipt.success || receipt.data.scanId !== id) {
      throw new Error("commit_invoice_scan returned an unexpected receipt");
    }
    return NextResponse.json(receipt.data);
  });
}
