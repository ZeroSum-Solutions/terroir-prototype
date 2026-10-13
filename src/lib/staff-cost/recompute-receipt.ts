import { z } from "zod";

export const RecomputeReceiptSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("cellar_health_recompute"),
    status: z.literal("succeeded"),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("pricing_recommendations_recompute"),
    status: z.literal("succeeded"),
  }),
]);

export type RecomputeReceipt = z.infer<typeof RecomputeReceiptSchema>;
export type RecomputeReceiptKind = RecomputeReceipt["kind"];

export function createRecomputeReceipt(
  kind: RecomputeReceiptKind,
): RecomputeReceipt {
  return RecomputeReceiptSchema.parse({ version: 1, kind, status: "succeeded" });
}

export function parseRecomputeReceipt(
  value: unknown,
  expectedKind: RecomputeReceiptKind,
): RecomputeReceipt | null {
  const parsed = RecomputeReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== expectedKind) return null;
  return parsed.data;
}
