import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasSameOriginEvidence,
  INTERNAL_SIGNOUT_HEADER,
  INTERNAL_SIGNOUT_VALUE,
  isInternalSignOut,
} from "./same-origin-request";

describe("same-origin request evidence", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts explicit same-origin Fetch Metadata", () => {
    expect(
      hasSameOriginEvidence(new Headers({ "sec-fetch-site": "same-origin" })),
    ).toBe(true);
  });

  it.each(["cross-site", "same-site", "none"])(
    "rejects explicit %s Fetch Metadata even with a matching Origin",
    (site) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://terroir.example");
      expect(
        hasSameOriginEvidence(
          new Headers({
            "sec-fetch-site": site,
            origin: "https://terroir.example",
          }),
        ),
      ).toBe(false);
    },
  );

  it("falls back to an exact configured Origin only when Fetch Metadata is absent", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://terroir.example");
    expect(
      hasSameOriginEvidence(
        new Headers({ origin: "https://terroir.example" }),
      ),
    ).toBe(true);
    expect(
      hasSameOriginEvidence(new Headers({ origin: "https://evil.example" })),
    ).toBe(false);
  });

  it.each([null, "not an origin", "https://terroir.example/path"])(
    "rejects missing or malformed Origin evidence (%s)",
    (origin) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://terroir.example");
      expect(
        hasSameOriginEvidence(
          new Headers(origin === null ? {} : { origin }),
        ),
      ).toBe(false);
    },
  );

  it("treats the internal mode header as response selection, not origin proof", () => {
    const headers = new Headers({
      [INTERNAL_SIGNOUT_HEADER]: INTERNAL_SIGNOUT_VALUE,
    });
    expect(isInternalSignOut(headers)).toBe(true);
    expect(hasSameOriginEvidence(headers)).toBe(false);
  });
});
