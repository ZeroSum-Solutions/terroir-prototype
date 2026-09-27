import { ToastContractError, ToastProvenance } from "./contracts";

function required(value: string, field: string) {
  if (!value.trim()) throw new ToastContractError("invalid_provenance", `${field} is required`);
  return value;
}

export function manualProvenance(input: {
  actorId: string;
  siteId: string;
}): ToastProvenance {
  return {
    kind: "manual",
    actorId: required(input.actorId, "actorId"),
    siteId: required(input.siteId, "siteId"),
    signatureState: "not_applicable",
  };
}

export function fixtureProvenance(input: {
  fixtureId: string;
  signatureState?: "synthetic_verified" | "not_verified";
}): ToastProvenance {
  return {
    kind: "fixture",
    fixtureId: required(input.fixtureId, "fixtureId"),
    signatureState: input.signatureState ?? "not_verified",
    liveEvidence: false,
  };
}
