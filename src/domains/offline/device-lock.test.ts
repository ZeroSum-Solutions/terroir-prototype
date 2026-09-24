import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasRecognizedDeviceDenial,
  DEVICE_LOCK_COOKIE_NAME,
  DEVICE_LOCK_MAX_AGE_SECONDS,
  deviceLockCookieOptions,
  HARD_DEVICE_LOCK,
  readDeviceLockMarker,
  REPROVISION_REQUIRED,
  serializeClientDeviceLock,
  setDeviceLockCookie,
  writeClientDeviceLock,
} from "./device-lock";

describe("device lock marker", () => {
  afterEach(() => vi.unstubAllEnvs());

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
    const writer = { set: vi.fn() };

    setDeviceLockCookie(writer, HARD_DEVICE_LOCK);

    expect(writer.set).toHaveBeenCalledWith(
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
    expect(serializeClientDeviceLock(REPROVISION_REQUIRED)).not.toContain(
      "Secure",
    );
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
