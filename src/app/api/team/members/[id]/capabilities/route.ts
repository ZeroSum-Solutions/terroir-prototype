import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { Errors } from "@/lib/api/errors";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;
const MAX_GRANT_REASON_LENGTH = 1000;

const CapabilityKeySchema = z.enum([
  "cost.read",
  "margin.read",
  "pricing.manage",
]);

const ParamsSchema = z.strictObject({ id: z.string().uuid() });

const ReplacementSchema = z.strictObject({
  capabilityKeys: z
    .array(CapabilityKeySchema)
    .max(3)
    .superRefine((keys, context) => {
      if (new Set(keys).size !== keys.length) {
        context.addIssue({
          code: "custom",
          message: "Capability keys must be unique.",
        });
      }
  }),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  grantReason: z.string().trim().min(1).max(MAX_GRANT_REASON_LENGTH),
});

type CapabilityKey = z.infer<typeof CapabilityKeySchema>;

type CapabilityReplacementClient = {
  rpc: (
    name: "replace_member_site_capabilities",
    args: {
      p_membership_id: string;
      p_capability_keys: CapabilityKey[];
      p_expires_at: string | null;
      p_grant_reason: string;
    },
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const GOVERNANCE_DENIALS = new Set([
  "C04_CALLER_NOT_GOVERNOR",
  "C04_TARGET_IDENTITY_NOT_CURRENT",
  "C04_TARGET_MEMBERSHIP_NOT_FOUND",
  "C04_TARGET_WORKSPACE_NOT_CURRENT",
]);

export async function PUT(
  request: NextRequest,
  { params }: { params: Params },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const parsedParams = ParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Errors.validation(parsedParams.error.issues, "Invalid member ID.");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Errors.invalidJson();
  }

  const parsed = ReplacementSchema.safeParse(raw);
  if (!parsed.success) return Errors.validation(parsed.error.issues);

  const requestedKeys = [...parsed.data.capabilityKeys].sort();
  const client = auth.supabase as unknown as CapabilityReplacementClient;
  let rpcResult: Awaited<ReturnType<CapabilityReplacementClient["rpc"]>>;
  try {
    rpcResult = await client.rpc("replace_member_site_capabilities", {
      p_membership_id: parsedParams.data.id,
      p_capability_keys: parsed.data.capabilityKeys,
      p_expires_at: parsed.data.expiresAt ?? null,
      p_grant_reason: parsed.data.grantReason,
    });
  } catch {
    return Errors.internal("Failed to replace capabilities.");
  }

  const { data, error } = rpcResult;

  if (error) {
    const message = error.message?.trim() ?? "";
    if (GOVERNANCE_DENIALS.has(message)) {
      return Errors.forbidden("Capability replacement is not permitted.");
    }
    if (message === "C04_GRANT_EXPIRY_NOT_FUTURE") {
      return Errors.badRequest("Capability expiry must be in the future.");
    }
    return Errors.internal("Failed to replace capabilities.");
  }

  const parsedResult = CapabilityKeySchema.array().safeParse(data);
  if (
    !parsedResult.success ||
    parsedResult.data.length !== requestedKeys.length ||
    parsedResult.data.some((key, index) => key !== requestedKeys[index])
  ) {
    return Errors.internal("Failed to replace capabilities.");
  }

  return NextResponse.json({ capabilityKeys: parsedResult.data });
}
