export const TYPESAFE_JEV_MAX_RESPONSE_BYTES = 64 * 1_024;
export const TYPESAFE_JEV_MAX_CONSECUTIVE_EMPTY_CHUNKS = 32;
export const TYPESAFE_JEV_READ_YIELD_INTERVAL = 64;

export type TypeSafeJevResponseReadReason =
  | "deadline"
  | "malformed_json"
  | "response_body_missing"
  | "response_body_unreadable"
  | "response_encoding"
  | "response_media_type"
  | "response_too_large";

export type TypeSafeJevResponseReadResult =
  | { status: "ok"; value: unknown }
  | { status: "unavailable"; reason: TypeSafeJevResponseReadReason };

function startCancellation(cancel: () => unknown): void {
  try {
    void Promise.resolve(cancel()).catch(() => undefined);
  } catch {
    // Cancellation is best-effort cleanup and must never replace the public result.
  }
}

export function cancelTypeSafeJevResponseBody(response: Response): void {
  const body = response.body;
  if (!body || body.locked) return;
  startCancellation(() => body.cancel());
}

function isJsonMediaType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return (
    mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"))
  );
}

function contentLengthExceedsLimit(value: string | null): boolean {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return false;
  try {
    return BigInt(normalized) > BigInt(TYPESAFE_JEV_MAX_RESPONSE_BYTES);
  } catch {
    return false;
  }
}

function yieldToTimers(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export async function readTypeSafeJevJsonResponse(
  response: Response,
  signal: AbortSignal,
): Promise<TypeSafeJevResponseReadResult> {
  const body = response.body;
  if (!body) {
    return { status: "unavailable", reason: "response_body_missing" };
  }
  if (!isJsonMediaType(response.headers.get("content-type"))) {
    cancelTypeSafeJevResponseBody(response);
    return { status: "unavailable", reason: "response_media_type" };
  }
  if (contentLengthExceedsLimit(response.headers.get("content-length"))) {
    cancelTypeSafeJevResponseBody(response);
    return { status: "unavailable", reason: "response_too_large" };
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    cancelTypeSafeJevResponseBody(response);
    return { status: "unavailable", reason: "response_body_unreadable" };
  }

  let cancellationStarted = false;
  let fullyConsumed = false;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let consecutiveEmptyChunks = 0;
  let readCount = 0;
  const cancelReader = () => {
    if (cancellationStarted) return;
    cancellationStarted = true;
    startCancellation(() => reader.cancel());
  };
  const onAbort = () => cancelReader();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal.aborted) {
      cancelReader();
      return { status: "unavailable", reason: "deadline" };
    }
    while (true) {
      if (signal.aborted) {
        cancelReader();
        return { status: "unavailable", reason: "deadline" };
      }
      if (
        readCount > 0 &&
        readCount % TYPESAFE_JEV_READ_YIELD_INTERVAL === 0
      ) {
        await yieldToTimers();
        if (signal.aborted) {
          cancelReader();
          return { status: "unavailable", reason: "deadline" };
        }
      }
      const chunk = await reader.read();
      readCount += 1;
      if (signal.aborted) {
        cancelReader();
        return { status: "unavailable", reason: "deadline" };
      }
      if (chunk.done) {
        fullyConsumed = true;
        break;
      }
      if (!(chunk.value instanceof Uint8Array)) {
        cancelReader();
        return { status: "unavailable", reason: "response_body_unreadable" };
      }
      if (chunk.value.byteLength === 0) {
        consecutiveEmptyChunks += 1;
        if (
          consecutiveEmptyChunks >
          TYPESAFE_JEV_MAX_CONSECUTIVE_EMPTY_CHUNKS
        ) {
          cancelReader();
          return { status: "unavailable", reason: "response_body_unreadable" };
        }
        continue;
      }
      consecutiveEmptyChunks = 0;
      if (
        chunk.value.byteLength >
        TYPESAFE_JEV_MAX_RESPONSE_BYTES - totalBytes
      ) {
        cancelReader();
        return { status: "unavailable", reason: "response_too_large" };
      }
      chunks.push(Uint8Array.from(chunk.value));
      totalBytes += chunk.value.byteLength;
    }
  } catch {
    cancelReader();
    return {
      status: "unavailable",
      reason: signal.aborted ? "deadline" : "response_body_unreadable",
    };
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!fullyConsumed) cancelReader();
    try {
      reader.releaseLock();
    } catch {
      // A hostile stream cannot change the bounded public failure result.
    }
  }

  if (signal.aborted) {
    return { status: "unavailable", reason: "deadline" };
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { status: "unavailable", reason: "response_encoding" };
  }
  try {
    return { status: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { status: "unavailable", reason: "malformed_json" };
  }
}
