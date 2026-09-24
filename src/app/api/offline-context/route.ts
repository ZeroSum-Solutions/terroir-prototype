import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  CELLAR_LOOKUP_VERSION,
  OFFLINE_CONTEXT_MAX_AGE_MS,
  OFFLINE_SCHEMA_VERSION,
  OfflineContextResponseSchema,
} from "@/domains/offline/contract";
import { loadOfflineCellarRows } from "@/domains/offline/cellar-lookup";
import { requireMembership } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request?: NextRequest) {
  const response = await withApiHandler(async () => {
    const auth = await requireMembership();
    if (auth instanceof NextResponse) return auth;

    const issuedAt = new Date();
    const rows = await loadOfflineCellarRows(auth.supabase, auth.restaurantId);
    const body = OfflineContextResponseSchema.parse({
      schemaVersion: OFFLINE_SCHEMA_VERSION,
      context: {
        contextId: randomUUID(),
        userId: auth.user.id,
        restaurantId: auth.restaurantId,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(
          issuedAt.getTime() + OFFLINE_CONTEXT_MAX_AGE_MS,
        ).toISOString(),
      },
      projection: {
        kind: "cellar_lookup",
        version: CELLAR_LOOKUP_VERSION,
        asOf: issuedAt.toISOString(),
        rows,
      },
    });
    return NextResponse.json(body);
  });

  response.headers.set("Cache-Control", "no-store");
  return response;
}
