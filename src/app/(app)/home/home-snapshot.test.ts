import { describe, expect, it } from "vitest";
import { buildHomeSnapshot } from "./home-snapshot";

describe("buildHomeSnapshot", () => {
  it("sums every inventory row and only counts unbinned quantities as unbinned", () => {
    expect(
      buildHomeSnapshot(
        [
          { quantity: 6, bin_id: "bin-a" },
          { quantity: 3, bin_id: null },
          { quantity: 2, bin_id: "bin-b" },
          { quantity: 4, bin_id: null },
        ],
        { openBottleCount: 2, reviewCount: 1, eightysixedCount: 5 },
      ),
    ).toEqual({
      bottleCount: 15,
      unbinnedBottleCount: 7,
      openBottleCount: 2,
      reviewCount: 1,
      eightysixedCount: 5,
    });
  });
});
