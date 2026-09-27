import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseSignedUrl,
  SupabaseStorageError,
} from "@/adapters/storage";
import { readInvoiceImageTarget } from "@/lib/staff-cost/protected-readers";
import type { Database } from "@/types/database";

const INVOICE_IMAGE_BUCKET = "invoice-images";
const SIGNED_URL_TTL_SECONDS = 60;

export class ScanImageNotFoundError extends Error {
  constructor() {
    super("Scan image not found.");
    this.name = "ScanImageNotFoundError";
  }
}

export class ScanImageStorageError extends Error {
  constructor(cause: unknown) {
    super("Failed to generate scan image URL.");
    this.name = "ScanImageStorageError";
    this.cause = cause;
  }
}

export type GetScanImageUrlInput = {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
  scanId: string;
  pageIndex?: number;
};

export async function getScanImageUrl(
  input: GetScanImageUrlInput,
): Promise<string> {
  const { supabase, restaurantId, scanId, pageIndex = 0 } = input;
  const target = await readInvoiceImageTarget(supabase, scanId, pageIndex);
  if (!target || !target.object_name.startsWith(`${restaurantId}/${scanId}`)) {
    throw new ScanImageNotFoundError();
  }

  try {
    return await createSupabaseSignedUrl({
      supabase,
      bucket: INVOICE_IMAGE_BUCKET,
      path: target.object_name,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    if (error instanceof SupabaseStorageError) {
      console.error("fetch-storage failed:", error.cause ?? error);
      Sentry.captureException(error.cause ?? error, {
        tags: { surface: "scanner", phase: "fetch-storage" },
        extra: { scan_id: scanId },
      });
      throw new ScanImageStorageError(error);
    }
    throw error;
  }
}
