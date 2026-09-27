import { createHmac, timingSafeEqual } from "node:crypto";

const HMAC_BYTES = 32;

export function computeToastSignature(
  body: Uint8Array,
  timestamp: string,
  secret: string,
) {
  const hmac = createHmac("sha256", Buffer.from(secret, "utf8"));
  hmac.update(body);
  hmac.update(Buffer.from(timestamp, "utf8"));
  return hmac.digest("base64");
}

export function verifyToastSignature(input: {
  body: Uint8Array;
  timestamp: string;
  secret: string;
  signature: string;
}) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(input.signature)) return false;
  const supplied = Buffer.from(input.signature, "base64");
  if (supplied.length !== HMAC_BYTES || supplied.toString("base64") !== input.signature) {
    return false;
  }
  const expected = Buffer.from(
    computeToastSignature(input.body, input.timestamp, input.secret),
    "base64",
  );
  return timingSafeEqual(expected, supplied);
}
