import { describe, expect, it } from "vitest";
import { parseCurrentOperationalMemberships } from "./current-operational-memberships";

const SITE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SITE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function membership(
  overrides: Partial<{
    restaurant_id: string;
    restaurant_name: string;
    role: "owner" | "manager" | "staff";
  }> = {},
) {
  return {
    restaurant_id: SITE_A,
    restaurant_name: "Osteria Scala",
    role: "staff" as const,
    ...overrides,
  };
}

describe("parseCurrentOperationalMemberships", () => {
  it("preserves database order and accepts exactly the three operational roles", () => {
    const value = [
      membership({ restaurant_id: SITE_B, restaurant_name: "Newest", role: "owner" }),
      membership({ restaurant_name: "Middle", role: "manager" }),
      membership({ restaurant_id: SITE_C, restaurant_name: "Oldest", role: "staff" }),
    ];

    expect(parseCurrentOperationalMemberships(value)).toEqual(value);
  });

  it("distinguishes a valid empty result from an invalid response", () => {
    expect(parseCurrentOperationalMemberships([])).toEqual([]);
    expect(parseCurrentOperationalMemberships(null)).toBeNull();
    expect(parseCurrentOperationalMemberships(undefined)).toBeNull();
    expect(parseCurrentOperationalMemberships({})).toBeNull();
  });

  it("keeps legitimate database name strings without fabricating a fallback", () => {
    expect(
      parseCurrentOperationalMemberships([
        membership({ restaurant_name: "" }),
        membership({ restaurant_id: SITE_B, restaurant_name: "  " }),
      ]),
    ).toEqual([
      membership({ restaurant_name: "" }),
      membership({ restaurant_id: SITE_B, restaurant_name: "  " }),
    ]);
  });

  it("canonicalizes UUID case and rejects duplicates after canonicalization", () => {
    expect(
      parseCurrentOperationalMemberships([
        membership({ restaurant_id: SITE_A.toUpperCase() }),
      ]),
    ).toEqual([membership()]);

    expect(
      parseCurrentOperationalMemberships([
        membership(),
        membership({ restaurant_id: SITE_A.toUpperCase(), restaurant_name: "Duplicate" }),
      ]),
    ).toBeNull();
  });

  it("rejects an exact duplicate site instead of selecting either row", () => {
    expect(
      parseCurrentOperationalMemberships([
        membership(),
        membership({ restaurant_name: "Duplicate", role: "owner" }),
      ]),
    ).toBeNull();
  });

  it.each([
    ["invalid UUID", membership({ restaurant_id: "not-a-uuid" })],
    ["unknown role", { ...membership(), role: "admin" }],
    ["null role", { ...membership(), role: null }],
    ["null name", { ...membership(), restaurant_name: null }],
    ["non-string name", { ...membership(), restaurant_name: 42 }],
    ["missing id", { restaurant_name: "Missing", role: "staff" }],
    ["missing name", { restaurant_id: SITE_A, role: "staff" }],
    ["missing role", { restaurant_id: SITE_A, restaurant_name: "Missing" }],
    ["extra key", { ...membership(), workspace_id: SITE_B }],
    ["non-object row", "membership"],
  ])("rejects a row with %s", (_case, value) => {
    expect(parseCurrentOperationalMemberships([value])).toBeNull();
  });

  it("rejects the whole response when a later row is malformed", () => {
    expect(
      parseCurrentOperationalMemberships([
        membership(),
        { ...membership({ restaurant_id: SITE_B }), role: "viewer" },
      ]),
    ).toBeNull();
  });
});
