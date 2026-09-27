import { describe, expect, it } from "vitest";

import { isJsonObject, isLosslessNumber, ToastContractError } from "./contracts";
import { parseLosslessJson } from "./lossless-json";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("parseLosslessJson", () => {
  it("preserves decimal and exponent tokens without Number coercion", () => {
    const parsed = parseLosslessJson(
      bytes('{"quantity":1.2300e-2,"negativeZero":-0.0,"whole":100000000000000000001}'),
    );
    expect(isJsonObject(parsed)).toBe(true);
    if (!isJsonObject(parsed)) throw new Error("expected object");
    for (const value of Object.values(parsed)) expect(isLosslessNumber(value)).toBe(true);
    expect(isLosslessNumber(parsed.quantity) && parsed.quantity.raw).toBe("1.2300e-2");
    expect(isLosslessNumber(parsed.negativeZero) && parsed.negativeZero.raw).toBe("-0.0");
    expect(isLosslessNumber(parsed.whole) && parsed.whole.raw).toBe("100000000000000000001");
  });

  it("rejects duplicate keys, invalid UTF-8, excessive depth, and oversized input", () => {
    expect(() => parseLosslessJson(bytes('{"timestamp":"a","timestamp":"b"}')))
      .toThrowError(expect.objectContaining({ code: "duplicate_json_key" }));
    expect(() => parseLosslessJson(Uint8Array.from([0xc3, 0x28])))
      .toThrowError(expect.objectContaining({ code: "invalid_utf8" }));
    expect(() => parseLosslessJson(bytes("[[[0]]]"), { maxDepth: 1 }))
      .toThrowError(expect.objectContaining({ code: "json_too_deep" }));
    expect(() => parseLosslessJson(bytes("[0]"), { maxBytes: 2 }))
      .toThrowError(expect.objectContaining({ code: "body_too_large" }));
  });

  it("rejects long numeric tokens before any numeric conversion", () => {
    try {
      parseLosslessJson(bytes('{"quantity":123456}'), { maxNumberLength: 5 });
      throw new Error("expected parser failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ToastContractError);
      expect((error as ToastContractError).code).toBe("number_too_long");
    }
  });

  it("treats prototype-shaped keys as data without mutating object prototypes", () => {
    const parsed = parseLosslessJson(bytes('{"__proto__":{"polluted":true}}'));
    expect(isJsonObject(parsed)).toBe(true);
    if (!isJsonObject(parsed)) throw new Error("expected object");
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("accepts a body above 600 KiB but rejects bytes above the 2 MiB engineering cap", () => {
    const accepted = bytes(JSON.stringify({ padding: "x".repeat(650 * 1024) }));
    expect(() => parseLosslessJson(accepted)).not.toThrow();
    expect(() => parseLosslessJson(new Uint8Array(2 * 1024 * 1024 + 1)))
      .toThrowError(expect.objectContaining({ code: "body_too_large" }));
  });
});
