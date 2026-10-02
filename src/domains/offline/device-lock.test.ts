import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTHORIZATION_GENERATION_COOKIE_NAME,
  authorizationGenerationCookieOptions,
  clearReprovisionMarkerAfterCommit,
  createAuthorizationGeneration,
  hasRecognizedDeviceDenial,
  DEVICE_LOCK_COOKIE_NAME,
  DEVICE_LOCK_MAX_AGE_SECONDS,
  deviceLockCookieOptions,
  HARD_DEVICE_LOCK,
  readAuthorizationGeneration,
  readDeviceLockMarker,
  REPROVISION_REQUIRED,
  serializeClientAuthorizationGeneration,
  serializeClientDeviceLock,
  setDeviceLockCookie,
  writeClientDeviceLock,
} from "./device-lock";

const GENERATION_A = "10000000-0000-4000-8000-000000000010";
const GENERATION_B = "20000000-0000-4000-8000-000000000010";

function cookieJar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get cookie() {
      return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(serialized: string) {
      const [pair, ...attributes] = serialized.split(";").map((part) => part.trim());
      const [name, ...rawValue] = pair.split("=");
      if (attributes.some((attribute) => attribute.toLowerCase() === "max-age=0")) {
        values.delete(name);
      } else {
        values.set(name, rawValue.join("="));
      }
    },
  };
}

function serverCookieStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const read = (name: string) => {
    const value = values.get(name);
    return value === undefined ? undefined : { name, value };
  };
  const write = (name: string, value: string) => { values.set(name, value); };
  return {
    values,
    read,
    write,
    get: vi.fn(read),
    set: vi.fn(write),
  };
}

describe("device lock marker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([HARD_DEVICE_LOCK, REPROVISION_REQUIRED])(
    "recognizes %s as an offline denial marker",
    (marker) => {
      const header = `theme=dark; ${DEVICE_LOCK_COOKIE_NAME}=${marker}`;
      expect(readDeviceLockMarker(header)).toBe(marker);
      expect(hasRecognizedDeviceDenial(header)).toBe(true);
    },
  );

  it.each(["", "unknown", "0", "1-extra"])(
    "does not turn %j into positive eligibility",
    (value) => {
      const header = value ? `${DEVICE_LOCK_COOKIE_NAME}=${value}` : "";
      expect(readDeviceLockMarker(header)).toBeNull();
      expect(hasRecognizedDeviceDenial(header)).toBe(false);
    },
  );

  it.each([
    [`${DEVICE_LOCK_COOKIE_NAME}=unknown; ${DEVICE_LOCK_COOKIE_NAME}=1`, HARD_DEVICE_LOCK],
    [`${DEVICE_LOCK_COOKIE_NAME}=1; ${DEVICE_LOCK_COOKIE_NAME}=unknown`, HARD_DEVICE_LOCK],
    [
      `${DEVICE_LOCK_COOKIE_NAME}=unknown; ${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}`,
      REPROVISION_REQUIRED,
    ],
    [
      `${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}; ${DEVICE_LOCK_COOKIE_NAME}=unknown`,
      REPROVISION_REQUIRED,
    ],
    [
      `${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}; ${DEVICE_LOCK_COOKIE_NAME}=1`,
      HARD_DEVICE_LOCK,
    ],
    [
      `${DEVICE_LOCK_COOKIE_NAME}=1; ${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}`,
      HARD_DEVICE_LOCK,
    ],
  ])("uses the strongest recognized value across duplicate cookies: %s -> %s", (header, expected) => {
    expect(readDeviceLockMarker(header)).toBe(expected);
    expect(hasRecognizedDeviceDenial(header)).toBe(true);
  });

  it("uses the reviewed 400-day readable cookie attributes", () => {
    vi.stubEnv("NODE_ENV", "production");
    const writer = serverCookieStore();

    expect(setDeviceLockCookie(writer, HARD_DEVICE_LOCK, () => GENERATION_A))
      .toBe(GENERATION_A);

    expect(writer.set).toHaveBeenNthCalledWith(
      1,
      AUTHORIZATION_GENERATION_COOKIE_NAME,
      GENERATION_A,
      {
        path: "/",
        sameSite: "lax",
        secure: true,
        httpOnly: false,
        maxAge: DEVICE_LOCK_MAX_AGE_SECONDS,
      },
    );
    expect(writer.set).toHaveBeenNthCalledWith(
      2,
      DEVICE_LOCK_COOKIE_NAME,
      HARD_DEVICE_LOCK,
      {
        path: "/",
        sameSite: "lax",
        secure: true,
        httpOnly: false,
        maxAge: DEVICE_LOCK_MAX_AGE_SECONDS,
      },
    );
    expect(serializeClientDeviceLock(HARD_DEVICE_LOCK)).toBe(
      `${DEVICE_LOCK_COOKIE_NAME}=1; Path=/; Max-Age=${DEVICE_LOCK_MAX_AGE_SECONDS}; SameSite=Lax; Secure`,
    );
    expect(serializeClientAuthorizationGeneration(GENERATION_A)).toBe(
      `${AUTHORIZATION_GENERATION_COOKIE_NAME}=${GENERATION_A}; Path=/; Max-Age=${DEVICE_LOCK_MAX_AGE_SECONDS}; SameSite=Lax; Secure`,
    );
  });

  it("omits only Secure outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(deviceLockCookieOptions()).toMatchObject({
      path: "/",
      sameSite: "lax",
      secure: false,
      httpOnly: false,
      maxAge: DEVICE_LOCK_MAX_AGE_SECONDS,
    });
    expect(authorizationGenerationCookieOptions()).toEqual(deviceLockCookieOptions());
    expect(serializeClientDeviceLock(REPROVISION_REQUIRED)).not.toContain(
      "Secure",
    );
  });

  it("accepts exactly one UUID generation and rejects missing, malformed, or duplicate cookies", () => {
    expect(readAuthorizationGeneration(`${AUTHORIZATION_GENERATION_COOKIE_NAME}=${GENERATION_A}`))
      .toBe(GENERATION_A);
    expect(readAuthorizationGeneration("")).toBeNull();
    expect(readAuthorizationGeneration(`${AUTHORIZATION_GENERATION_COOKIE_NAME}=not-a-uuid`))
      .toBeNull();
    expect(readAuthorizationGeneration(
      `${AUTHORIZATION_GENERATION_COOKIE_NAME}=${GENERATION_A}; ` +
      `${AUTHORIZATION_GENERATION_COOKIE_NAME}=${GENERATION_A}`,
    )).toBeNull();
  });

  it("contains unavailable, non-callable, throwing, and malformed UUID sources", () => {
    vi.stubGlobal("crypto", {});
    expect(createAuthorizationGeneration()).toBeNull();
    vi.stubGlobal("crypto", { randomUUID: "not-callable" });
    expect(createAuthorizationGeneration()).toBeNull();
    expect(createAuthorizationGeneration(() => { throw new Error("private detail"); }))
      .toBeNull();
    expect(createAuthorizationGeneration(() => "invalid")).toBeNull();
  });

  it("verifies a fresh generation before publishing the requested marker", () => {
    const writer = serverCookieStore();

    expect(setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => GENERATION_A))
      .toBe(GENERATION_A);

    expect(writer.set.mock.calls.map(([name, value]) => [name, value])).toEqual([
      [AUTHORIZATION_GENERATION_COOKIE_NAME, GENERATION_A],
      [DEVICE_LOCK_COOKIE_NAME, REPROVISION_REQUIRED],
    ]);
    expect(writer.get.mock.calls.map(([name]) => name)).toEqual([
      AUTHORIZATION_GENERATION_COOKIE_NAME,
      AUTHORIZATION_GENERATION_COOKIE_NAME,
      DEVICE_LOCK_COOKIE_NAME,
    ]);
  });

  it("does not accept the pre-transition generation as fresh", () => {
    const writer = serverCookieStore({
      [AUTHORIZATION_GENERATION_COOKIE_NAME]: GENERATION_A,
    });

    expect(setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => GENERATION_A))
      .toBeNull();

    expect(writer.values.get(AUTHORIZATION_GENERATION_COOKIE_NAME)).toBe(GENERATION_A);
    expect(writer.values.get(DEVICE_LOCK_COOKIE_NAME)).toBe(HARD_DEVICE_LOCK);
    expect(writer.set.mock.calls.map(([name, value]) => [name, value])).toEqual([
      [DEVICE_LOCK_COOKIE_NAME, HARD_DEVICE_LOCK],
    ]);
  });

  it("falls back to hard denial when the prior generation cannot be read", () => {
    const writer = serverCookieStore();
    writer.get.mockImplementationOnce(() => { throw new Error("private detail"); });

    expect(setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => GENERATION_B))
      .toBeNull();

    expect(writer.values.get(DEVICE_LOCK_COOKIE_NAME)).toBe(HARD_DEVICE_LOCK);
    expect(writer.set.mock.calls.map(([name, value]) => [name, value])).toEqual([
      [DEVICE_LOCK_COOKIE_NAME, HARD_DEVICE_LOCK],
    ]);
  });

  it("retains the old generation but publishes only a verified hard denial when rotation is unavailable", () => {
    const writer = serverCookieStore({
      [AUTHORIZATION_GENERATION_COOKIE_NAME]: GENERATION_A,
      [DEVICE_LOCK_COOKIE_NAME]: REPROVISION_REQUIRED,
    });

    expect(setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => "invalid"))
      .toBeNull();

    expect(writer.values.get(AUTHORIZATION_GENERATION_COOKIE_NAME)).toBe(GENERATION_A);
    expect(writer.values.get(DEVICE_LOCK_COOKIE_NAME)).toBe(HARD_DEVICE_LOCK);
    expect(writer.set.mock.calls.map(([name, value]) => [name, value])).toEqual([
      [DEVICE_LOCK_COOKIE_NAME, HARD_DEVICE_LOCK],
    ]);
  });

  it("falls back to hard denial when the generation write throws", () => {
    const writer = serverCookieStore({
      [AUTHORIZATION_GENERATION_COOKIE_NAME]: GENERATION_A,
    });
    writer.set.mockImplementationOnce(() => { throw new Error("private detail"); });

    expect(setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => GENERATION_B))
      .toBeNull();

    expect(writer.values.get(AUTHORIZATION_GENERATION_COOKIE_NAME)).toBe(GENERATION_A);
    expect(writer.values.get(DEVICE_LOCK_COOKIE_NAME)).toBe(HARD_DEVICE_LOCK);
    expect(writer.set.mock.calls.map(([name, value]) => [name, value])).toEqual([
      [AUTHORIZATION_GENERATION_COOKIE_NAME, GENERATION_B],
      [DEVICE_LOCK_COOKIE_NAME, HARD_DEVICE_LOCK],
    ]);
  });

  it("falls back to hard denial when generation readback does not match", () => {
    const writer = serverCookieStore();
    writer.get
      .mockImplementationOnce(writer.read)
      .mockImplementationOnce(() => ({
        name: AUTHORIZATION_GENERATION_COOKIE_NAME,
        value: GENERATION_A,
      }));

    expect(setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => GENERATION_B))
      .toBeNull();

    expect(writer.values.get(DEVICE_LOCK_COOKIE_NAME)).toBe(HARD_DEVICE_LOCK);
    expect(writer.set.mock.calls.map(([name, value]) => [name, value])).toEqual([
      [AUTHORIZATION_GENERATION_COOKIE_NAME, GENERATION_B],
      [DEVICE_LOCK_COOKIE_NAME, HARD_DEVICE_LOCK],
    ]);
  });

  it("falls back to hard denial when the requested marker write throws", () => {
    const writer = serverCookieStore();
    writer.set
      .mockImplementationOnce(writer.write)
      .mockImplementationOnce(() => { throw new Error("private detail"); });

    expect(setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => GENERATION_B))
      .toBeNull();

    expect(writer.values.get(AUTHORIZATION_GENERATION_COOKIE_NAME)).toBe(GENERATION_B);
    expect(writer.values.get(DEVICE_LOCK_COOKIE_NAME)).toBe(HARD_DEVICE_LOCK);
    expect(writer.set.mock.calls.map(([name, value]) => [name, value])).toEqual([
      [AUTHORIZATION_GENERATION_COOKIE_NAME, GENERATION_B],
      [DEVICE_LOCK_COOKIE_NAME, REPROVISION_REQUIRED],
      [DEVICE_LOCK_COOKIE_NAME, HARD_DEVICE_LOCK],
    ]);
  });

  it("falls back to hard denial when requested-marker readback does not match", () => {
    const writer = serverCookieStore();
    writer.get
      .mockImplementationOnce(writer.read)
      .mockImplementationOnce(writer.read)
      .mockImplementationOnce(() => ({ name: DEVICE_LOCK_COOKIE_NAME, value: "unknown" }));

    expect(setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => GENERATION_B))
      .toBeNull();

    expect(writer.values.get(DEVICE_LOCK_COOKIE_NAME)).toBe(HARD_DEVICE_LOCK);
    expect(writer.set.mock.calls.map(([name, value]) => [name, value])).toEqual([
      [AUTHORIZATION_GENERATION_COOKIE_NAME, GENERATION_B],
      [DEVICE_LOCK_COOKIE_NAME, REPROVISION_REQUIRED],
      [DEVICE_LOCK_COOKIE_NAME, HARD_DEVICE_LOCK],
    ]);
  });

  it("throws a generic failure when hard denial cannot be scheduled", () => {
    const writer = serverCookieStore();
    writer.set.mockImplementation(() => { throw new Error("private detail"); });

    expect(() => setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => "invalid"))
      .toThrow("Unable to schedule device denial.");
  });

  it("rotates a valid generation with a browser hard-marker write", () => {
    const target = cookieJar();
    expect(writeClientDeviceLock(HARD_DEVICE_LOCK, target, () => GENERATION_A)).toBe(true);
    expect(readDeviceLockMarker(target.cookie)).toBe(HARD_DEVICE_LOCK);
    expect(readAuthorizationGeneration(target.cookie)).toBe(GENERATION_A);
    expect(writeClientDeviceLock(HARD_DEVICE_LOCK, target, () => GENERATION_B)).toBe(true);
    expect(readAuthorizationGeneration(target.cookie)).toBe(GENERATION_B);
  });

  it("clears only one exact reprovision marker after the captured generation remains unchanged", () => {
    const target = cookieJar({
      [DEVICE_LOCK_COOKIE_NAME]: REPROVISION_REQUIRED,
      [AUTHORIZATION_GENERATION_COOKIE_NAME]: GENERATION_A,
    });
    expect(clearReprovisionMarkerAfterCommit(GENERATION_A, target)).toBe(true);
    expect(readDeviceLockMarker(target.cookie)).toBeNull();
    expect(readAuthorizationGeneration(target.cookie)).toBe(GENERATION_A);
  });

  it.each([
    ["hard marker", HARD_DEVICE_LOCK, GENERATION_A],
    ["changed generation", REPROVISION_REQUIRED, GENERATION_B],
  ])("refuses marker deletion for %s", (_label, marker, generation) => {
    const target = cookieJar({
      [DEVICE_LOCK_COOKIE_NAME]: marker,
      [AUTHORIZATION_GENERATION_COOKIE_NAME]: generation,
    });
    expect(clearReprovisionMarkerAfterCommit(GENERATION_A, target)).toBe(false);
    expect(readDeviceLockMarker(target.cookie)).toBe(marker);
  });

  it("refuses marker deletion when duplicate markers make the root value ambiguous", () => {
    const target = {
      cookie:
        `${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}; ` +
        `${DEVICE_LOCK_COOKIE_NAME}=${HARD_DEVICE_LOCK}; ` +
        `${AUTHORIZATION_GENERATION_COOKIE_NAME}=${GENERATION_A}`,
    };
    expect(clearReprovisionMarkerAfterCommit(GENERATION_A, target)).toBe(false);
    expect(readDeviceLockMarker(target.cookie)).toBe(HARD_DEVICE_LOCK);
  });

  it("refuses generation and marker operations when UUID or browser primitives are unavailable", () => {
    expect(createAuthorizationGeneration(() => "invalid")).toBeNull();
    expect(writeClientDeviceLock(
      HARD_DEVICE_LOCK,
      null as unknown as Pick<Document, "cookie">,
      () => GENERATION_A,
    )).toBe(false);
    expect(clearReprovisionMarkerAfterCommit(
      GENERATION_A,
      null as unknown as Pick<Document, "cookie">,
    )).toBe(false);
  });

  it("returns false when the browser refuses the write or readback", () => {
    const denied = {
      get cookie() {
        return "";
      },
      set cookie(_value: string) {},
    };
    expect(writeClientDeviceLock(HARD_DEVICE_LOCK, denied)).toBe(false);

    const throwing = {
      get cookie(): string {
        throw new Error("private detail");
      },
      set cookie(_value: string) {
        throw new Error("private detail");
      },
    };
    expect(writeClientDeviceLock(HARD_DEVICE_LOCK, throwing)).toBe(false);
  });
});
