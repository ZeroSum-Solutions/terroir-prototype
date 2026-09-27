/**
 * GET /api/import/batches/[id] — one batch's status + full row detail
 * (validation errors, LWIN match status, resolution/apply state for
 * every row). Tenant-scoped: a batch id belonging to another
 * restaurant resolves to 404, never another tenant's data.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMembership } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { Errors } from "@/lib/api/errors";
import { parseParams } from "@/lib/api/validation";
import { BatchIdParamsSchema } from "@/domains/import/request-schemas";
import {
  readImportBatchDisplayRows,
  type ImportBatchDisplayRow,
} from "@/lib/staff-cost/protected-readers";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

export async function GET(_request: NextRequest, { params }: { params: Params }) {
  return withApiHandler(() => getBatch(params));
}

async function getBatch(params: Params) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const { supabase, restaurantId } = auth;

  const parsedParams = await parseParams(params, BatchIdParamsSchema);
  if (!parsedParams.ok) return parsedParams.response;
  const { id } = parsedParams.data;

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("id, filename, status, total_rows, created_at, reverted_at")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) return Errors.notFound("Import batch");

  const rows: Array<{
    id: string;
    row_number: number;
    row_state: string;
    lwin_status: string;
    lwin_id: string | null;
    lwin_score: number | null;
    cost_status: string;
    resolution: string;
    apply_status: string;
    applied_inventory_item_id: string | null;
  }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("import_batch_rows")
      .select(
        "id, row_number, row_state, lwin_status, lwin_id, lwin_score, cost_status, resolution, apply_status, applied_inventory_item_id",
      )
      .eq("batch_id", id)
      .eq("restaurant_id", restaurantId)
      .order("row_number", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const displayRows: ImportBatchDisplayRow[] = [];
  for (let afterRowNumber = 0; ; ) {
    const page = await readImportBatchDisplayRows(supabase, id, {
      afterRowNumber,
      limit: 500,
    });
    displayRows.push(...page);
    if (page.length < 500) break;
    afterRowNumber = page[page.length - 1]!.row_number;
  }
  const displayById = new Map(displayRows.map((row) => [row.row_id, row]));
  if (
    displayById.size !== displayRows.length ||
    rows.some((row) => {
      const display = displayById.get(row.id);
      return !display || display.batch_id !== id ||
        display.restaurant_id !== restaurantId || display.row_number !== row.row_number;
    })
  ) {
    throw new Error("Import display protected read was incomplete.");
  }

  return NextResponse.json({
    batch,
    rows: rows.map((row) => {
      const display = displayById.get(row.id)!;
      return { ...row, producer: display.producer, name: display.name };
    }),
  });
}
