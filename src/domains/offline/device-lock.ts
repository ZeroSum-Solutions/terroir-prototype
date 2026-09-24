export const DEVICE_LOCK_COOKIE_NAME = "terroir_device_locked";
export const HARD_DEVICE_LOCK = "1";
export const REPROVISION_REQUIRED = "reprovision_required";
export const DEVICE_LOCK_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export type DeviceLockMarker =
  | typeof HARD_DEVICE_LOCK
  | typeof REPROVISION_REQUIRED;

type CookieWriter = {
  set: (
    name: string,
    value: string,
    options: ReturnType<typeof deviceLockCookieOptions>,
  ) => unknown;
};

type ClientCookieTarget = Pick<Document, "cookie">;

export function readDeviceLockMarker(
  cookieHeader: string = document.cookie,
): DeviceLockMarker | null {
  let recognized: DeviceLockMarker | null = null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== DEVICE_LOCK_COOKIE_NAME) continue;
    const value = rawValue.join("=");
    if (value === HARD_DEVICE_LOCK) return HARD_DEVICE_LOCK;
    if (value === REPROVISION_REQUIRED) recognized = REPROVISION_REQUIRED;
  }
  return recognized;
}

export function hasRecognizedDeviceDenial(cookieHeader: string): boolean {
  return readDeviceLockMarker(cookieHeader) !== null;
}

export function deviceLockCookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
    maxAge: DEVICE_LOCK_MAX_AGE_SECONDS,
  };
}

export function setDeviceLockCookie(
  writer: CookieWriter,
  value: DeviceLockMarker,
): void {
  writer.set(DEVICE_LOCK_COOKIE_NAME, value, deviceLockCookieOptions());
}

export function serializeClientDeviceLock(value: DeviceLockMarker): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DEVICE_LOCK_COOKIE_NAME}=${value}; Path=/; Max-Age=${DEVICE_LOCK_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function writeClientDeviceLock(
  value: DeviceLockMarker,
  target: ClientCookieTarget = document,
): boolean {
  try {
    target.cookie = serializeClientDeviceLock(value);
    return readDeviceLockMarker(target.cookie) === value;
  } catch {
    return false;
  }
}
