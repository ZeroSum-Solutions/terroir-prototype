import { z } from "zod";

export const OFFLINE_SCHEMA_VERSION = 1;
export const CELLAR_LOOKUP_VERSION = 1;
export const OFFLINE_CONTEXT_MAX_AGE_MS = 12 * 60 * 60 * 1_000;

const Id = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });

export const OfflinePlacementSchema = z.strictObject({
  binId: Id,
  label: z.string().min(1),
  sealedQuantity: z.number().int().nonnegative(),
});

export const OfflineCellarRowSchema = z.strictObject({
  wineId: Id,
  displayName: z.string().min(1),
  producer: z.string(),
  vintage: z.number().int().nullable(),
  format: z.string().regex(/^\d+ml$/),
  sealedQuantity: z.number().int().nonnegative(),
  placements: z.array(OfflinePlacementSchema),
  activeOpenBottleId: Id.nullable(),
  openedAt: Timestamp.nullable(),
  remainingMl: z.number().int().nonnegative().nullable(),
}).superRefine((row, context) => {
  const lifecycle = [row.activeOpenBottleId, row.openedAt, row.remainingMl];
  const populated = lifecycle.filter((value) => value !== null).length;
  if (populated !== 0 && populated !== lifecycle.length) {
    context.addIssue({
      code: "custom",
      message: "Open-bottle lifecycle fields must be wholly present or absent.",
    });
  }
});

const OfflineDisplayContextSchema = z.strictObject({
  contextId: Id,
  userId: Id,
  restaurantId: Id,
  issuedAt: Timestamp,
  expiresAt: Timestamp,
}).superRefine((value, context) => {
  const age = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
  if (age <= 0 || age > OFFLINE_CONTEXT_MAX_AGE_MS) {
    context.addIssue({
      code: "custom",
      message: "Offline display context must expire within 12 hours.",
    });
  }
});

export const OfflineContextResponseSchema = z.strictObject({
  schemaVersion: z.literal(OFFLINE_SCHEMA_VERSION),
  context: OfflineDisplayContextSchema,
  projection: z.strictObject({
    kind: z.literal("cellar_lookup"),
    version: z.literal(CELLAR_LOOKUP_VERSION),
    asOf: Timestamp,
    rows: z.array(OfflineCellarRowSchema),
  }),
});

export type OfflineCellarRow = z.infer<typeof OfflineCellarRowSchema>;
export type OfflineContextResponse = z.infer<typeof OfflineContextResponseSchema>;
