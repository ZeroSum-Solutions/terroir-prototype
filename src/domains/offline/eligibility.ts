import { z } from "zod";
import {
  readSoleUsableProjection,
  type OfflineDatabaseOptions,
  type OfflineReadResult,
} from "./database";
import {
  readAuthorizationGeneration,
  readDeviceLockMarker,
} from "@/domains/offline/device-lock";

const Id = z.string().uuid();

export type OfflineEligibilityOptions = {
  cookieHeader?: string;
  now?: number;
  database?: OfflineDatabaseOptions;
};

export async function readEligibleOfflineContext(
  userId: string,
  restaurantId: string,
  options: OfflineEligibilityOptions = {},
): Promise<OfflineReadResult> {
  const cookieHeader = options.cookieHeader ?? globalThis.document?.cookie ?? "";
  if (!Id.safeParse(userId).success || !Id.safeParse(restaurantId).success ||
    readDeviceLockMarker(cookieHeader) !== null) {
    return { status: "unavailable", reason: "authorization_mismatch" };
  }
  const authorizationGeneration = readAuthorizationGeneration(cookieHeader);
  if (authorizationGeneration === null) {
    return { status: "unavailable", reason: "authorization_mismatch" };
  }
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) return { status: "unavailable", reason: "storage_failure" };
  return readSoleUsableProjection({
    userId,
    restaurantId,
    authorizationGeneration,
    now,
  }, options.database);
}
