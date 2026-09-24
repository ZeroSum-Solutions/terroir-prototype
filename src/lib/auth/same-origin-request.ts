import { getAppOrigin } from "./redirects";

export const INTERNAL_SIGNOUT_HEADER = "x-terroir-signout-mode";
export const INTERNAL_SIGNOUT_VALUE = "internal";

export function hasSameOriginEvidence(
  headers: Pick<Headers, "get">,
): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin";

  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === origin && origin === getAppOrigin();
  } catch {
    return false;
  }
}

export function isInternalSignOut(headers: Pick<Headers, "get">): boolean {
  return headers.get(INTERNAL_SIGNOUT_HEADER) === INTERNAL_SIGNOUT_VALUE;
}
