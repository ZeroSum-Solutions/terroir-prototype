import { z } from "zod";

const WineSectionAssignmentReceiptSchema = z.strictObject({
  requestedWineCount: z.number().refine(Number.isSafeInteger),
  section: z.string().max(100).nullable(),
});

export type WineSectionAssignmentReceipt = z.infer<
  typeof WineSectionAssignmentReceiptSchema
>;

export function parseWineSectionAssignmentReceipt(
  value: unknown,
  expectedCount: number,
  expectedSection: string | null,
): WineSectionAssignmentReceipt | null {
  const parsed = WineSectionAssignmentReceiptSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.requestedWineCount !== expectedCount ||
    parsed.data.section !== expectedSection
  ) {
    return null;
  }
  return parsed.data;
}
