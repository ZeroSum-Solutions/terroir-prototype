export const DEVICE_LOCK_COOKIE_NAME = "terroir_device_locked";
export const AUTHORIZATION_GENERATION_COOKIE_NAME = "terroir_authorization_generation";
export const HARD_DEVICE_LOCK = "1";
export const REPROVISION_REQUIRED = "reprovision_required";
export const DEVICE_LOCK_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export type DeviceLockMarker = typeof HARD_DEVICE_LOCK | typeof REPROVISION_REQUIRED;
type CookieOptions = ReturnType<typeof deviceLockCookieOptions>;
type CookieWriter = {
  get: (name: string) => { value: string } | undefined;
  set: (name: string, value: string, options: CookieOptions) => unknown;
};
type ClientCookieTarget = Pick<Document, "cookie">;
type RandomUUID = () => string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cookieValues(cookieHeader: string, name: string): string[] {
  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) values.push(rawValue.join("="));
  }
  return values;
}

export function readDeviceLockMarker(
  cookieHeader: string = globalThis.document?.cookie ?? "",
): DeviceLockMarker | null {
  let recognized: DeviceLockMarker | null = null;
  for (const value of cookieValues(cookieHeader, DEVICE_LOCK_COOKIE_NAME)) {
    if (value === HARD_DEVICE_LOCK) return HARD_DEVICE_LOCK;
    if (value === REPROVISION_REQUIRED) recognized = REPROVISION_REQUIRED;
  }
  return recognized;
}

export function readAuthorizationGeneration(
  cookieHeader: string = globalThis.document?.cookie ?? "",
): string | null {
  const values = cookieValues(cookieHeader, AUTHORIZATION_GENERATION_COOKIE_NAME);
  return values.length === 1 && UUID.test(values[0]) ? values[0] : null;
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

export const authorizationGenerationCookieOptions = deviceLockCookieOptions;

export function createAuthorizationGeneration(
  create?: RandomUUID,
): string | null {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    const generate = create ?? (
      typeof randomUUID === "function" ? randomUUID.bind(globalThis.crypto) : undefined
    );
    const value = generate?.();
    return value && UUID.test(value) ? value : null;
  } catch { return null; }
}

function writeVerifiedCookie(
  writer: CookieWriter,
  name: string,
  value: string,
  options: CookieOptions,
): boolean {
  try {
    writer.set(name, value, options);
    return writer.get(name)?.value === value;
  } catch {
    return false;
  }
}

function writeVerifiedDeviceLock(writer: CookieWriter, value: DeviceLockMarker): boolean {
  try {
    writer.set(DEVICE_LOCK_COOKIE_NAME, value, deviceLockCookieOptions());
    return writer.get(DEVICE_LOCK_COOKIE_NAME)?.value === value;
  } catch {
    return false;
  }
}

function scheduleHardDenial(writer: CookieWriter): null {
  if (!writeVerifiedDeviceLock(writer, HARD_DEVICE_LOCK)) {
    throw new Error("Unable to schedule device denial.");
  }
  return null;
}

export function setDeviceLockCookie(
  writer: CookieWriter,
  value: DeviceLockMarker,
  create?: RandomUUID,
): string | null {
  let previousGeneration: string | undefined;
  try {
    previousGeneration = writer.get(AUTHORIZATION_GENERATION_COOKIE_NAME)?.value;
  } catch {
    return scheduleHardDenial(writer);
  }
  const generation = createAuthorizationGeneration(create);
  if (!generation || generation === previousGeneration) {
    return scheduleHardDenial(writer);
  }
  if (!writeVerifiedCookie(
    writer,
    AUTHORIZATION_GENERATION_COOKIE_NAME,
    generation,
    authorizationGenerationCookieOptions(),
  )) return scheduleHardDenial(writer);
  if (!writeVerifiedDeviceLock(writer, value)) return scheduleHardDenial(writer);
  return generation;
}

function serializeReadableCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function serializeClientDeviceLock(value: DeviceLockMarker): string {
  return serializeReadableCookie(DEVICE_LOCK_COOKIE_NAME, value, DEVICE_LOCK_MAX_AGE_SECONDS);
}

export function serializeClientAuthorizationGeneration(value: string): string {
  return serializeReadableCookie(
    AUTHORIZATION_GENERATION_COOKIE_NAME,
    value,
    DEVICE_LOCK_MAX_AGE_SECONDS,
  );
}

export function writeClientDeviceLock(
  value: DeviceLockMarker,
  target: ClientCookieTarget | undefined = globalThis.document,
  create?: RandomUUID,
): boolean {
  if (!target) return false;
  try {
    const generation = createAuthorizationGeneration(create);
    if (generation) target.cookie = serializeClientAuthorizationGeneration(generation);
    target.cookie = serializeClientDeviceLock(value);
    return generation !== null && readDeviceLockMarker(target.cookie) === value &&
      readAuthorizationGeneration(target.cookie) === generation;
  } catch { return false; }
}

export function clearReprovisionMarkerAfterCommit(
  capturedGeneration: string,
  target: ClientCookieTarget | undefined = globalThis.document,
): boolean {
  if (!target || !UUID.test(capturedGeneration)) return false;
  try {
    const before = target.cookie;
    const markers = cookieValues(before, DEVICE_LOCK_COOKIE_NAME);
    if (markers.length !== 1 || markers[0] !== REPROVISION_REQUIRED ||
      readAuthorizationGeneration(before) !== capturedGeneration) return false;
    target.cookie = serializeReadableCookie(DEVICE_LOCK_COOKIE_NAME, "", 0);
    const after = target.cookie;
    return readDeviceLockMarker(after) === null &&
      readAuthorizationGeneration(after) === capturedGeneration;
  } catch { return false; }
}
