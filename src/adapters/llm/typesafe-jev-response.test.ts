import { describe, expect, it, vi } from "vitest";

import {
  TYPESAFE_JEV_MAX_CONSECUTIVE_EMPTY_CHUNKS,
  TYPESAFE_JEV_MAX_RESPONSE_BYTES,
  TYPESAFE_JEV_READ_YIELD_INTERVAL,
  readTypeSafeJevJsonResponse,
} from "./typesafe-jev-response";

const encoder = new TextEncoder();

function jsonResponse(
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: { "content-type": "application/json", ...headers },
  });
}

function exactSizeJson(size: number): Uint8Array {
  const prefix = '{"value":"';
  const suffix = '"}';
  return encoder.encode(`${prefix}${"x".repeat(size - prefix.length - suffix.length)}${suffix}`);
}

function chunkedResponse(
  chunks: Uint8Array[],
  {
    contentType = "application/json",
    contentLength,
    cancel = vi.fn(),
  }: {
    contentType?: string;
    contentLength?: string;
    cancel?: () => void | Promise<void>;
  } = {},
) {
  let index = 0;
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks[index];
    index += 1;
    if (chunk) controller.enqueue(chunk);
    else controller.close();
  });
  const headers = new Headers({ "content-type": contentType });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return {
    cancel,
    pull,
    response: new Response(
      new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
      { headers },
    ),
  };
}

describe("TypeSafe JEV bounded response reader", () => {
  it("accepts valid JSON at the exact delivered-byte cap", async () => {
    const bytes = exactSizeJson(TYPESAFE_JEV_MAX_RESPONSE_BYTES);

    await expect(
      readTypeSafeJevJsonResponse(
        jsonResponse(bytes, { "content-length": String(bytes.byteLength) }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "ok",
      value: { value: expect.stringMatching(/^x+$/) },
    });
    expect(bytes.byteLength).toBe(TYPESAFE_JEV_MAX_RESPONSE_BYTES);
  });

  it("rejects actual bytes over the cap despite a misleading low length and stops reading", async () => {
    const first = new Uint8Array(TYPESAFE_JEV_MAX_RESPONSE_BYTES).fill(0x20);
    const { cancel, pull, response } = chunkedResponse(
      [first, encoder.encode("x"), encoder.encode("unread")],
      { contentLength: "1" },
    );

    await expect(
      readTypeSafeJevJsonResponse(response, new AbortController().signal),
    ).resolves.toEqual({ status: "unavailable", reason: "response_too_large" });
    expect(pull).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("uses an oversized length only as an early rejection hint and initiates cancellation", async () => {
    const { cancel, pull, response } = chunkedResponse(
      [encoder.encode('{"ok":true}')],
      { contentLength: String(TYPESAFE_JEV_MAX_RESPONSE_BYTES + 1) },
    );

    await expect(
      readTypeSafeJevJsonResponse(response, new AbortController().signal),
    ).resolves.toEqual({ status: "unavailable", reason: "response_too_large" });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("accepts absent length, chunking, and a multibyte code point split across chunks", async () => {
    const expected = { producer: "Cuvée 🍷" };
    const bytes = encoder.encode(JSON.stringify(expected));
    const emojiStart = bytes.findIndex((byte) => byte === 0xf0);
    const { response } = chunkedResponse([
      bytes.slice(0, emojiStart + 1),
      bytes.slice(emojiStart + 1, emojiStart + 3),
      bytes.slice(emojiStart + 3),
    ]);

    await expect(
      readTypeSafeJevJsonResponse(response, new AbortController().signal),
    ).resolves.toEqual({ status: "ok", value: expected });
  });

  it("returns typed failures for invalid JSON, invalid UTF-8, and no body", async () => {
    await expect(
      readTypeSafeJevJsonResponse(
        jsonResponse(encoder.encode("not json")),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: "unavailable", reason: "malformed_json" });
    await expect(
      readTypeSafeJevJsonResponse(
        jsonResponse(new Uint8Array([0xff])),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: "unavailable", reason: "response_encoding" });
    await expect(
      readTypeSafeJevJsonResponse(
        new Response(null, { headers: { "content-type": "application/json" } }),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: "unavailable", reason: "response_body_missing" });
  });

  it("rejects a non-JSON media type and does not await a hanging cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const { response } = chunkedResponse([encoder.encode("private provider text")], {
      contentType: "text/plain",
      cancel,
    });

    await expect(
      readTypeSafeJevJsonResponse(response, new AbortController().signal),
    ).resolves.toEqual({ status: "unavailable", reason: "response_media_type" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps an unreadable body and a rejecting cancellation payload-private", async () => {
    const readErrorResponse = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          throw new Error("private read payload");
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    const cancel = vi.fn(() => Promise.reject(new Error("private cancel payload")));
    const { response } = chunkedResponse([encoder.encode("private body")], {
      contentLength: String(TYPESAFE_JEV_MAX_RESPONSE_BYTES + 1),
      cancel,
    });

    const readResult = await readTypeSafeJevJsonResponse(
      readErrorResponse,
      new AbortController().signal,
    );
    const cancelResult = await readTypeSafeJevJsonResponse(
      response,
      new AbortController().signal,
    );

    expect(readResult).toEqual({
      status: "unavailable",
      reason: "response_body_unreadable",
    });
    expect(cancelResult).toEqual({
      status: "unavailable",
      reason: "response_too_large",
    });
    expect(JSON.stringify([readResult, cancelResult])).not.toContain("private");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("bounds finite zero-length chunks without retaining them", async () => {
    const chunks = Array.from(
      { length: TYPESAFE_JEV_MAX_CONSECUTIVE_EMPTY_CHUNKS + 2 },
      () => new Uint8Array(),
    );
    const { cancel, pull, response } = chunkedResponse(chunks);

    const result = await readTypeSafeJevJsonResponse(
      response,
      new AbortController().signal,
    );

    expect(result).toEqual({
      status: "unavailable",
      reason: "response_body_unreadable",
    });
    expect(pull).toHaveBeenCalledTimes(
      TYPESAFE_JEV_MAX_CONSECUTIVE_EMPTY_CHUNKS + 1,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("yields to a deadline while finite immediately-ready chunks remain", async () => {
    const chunks = Array.from(
      { length: TYPESAFE_JEV_READ_YIELD_INTERVAL + 1 },
      () => encoder.encode(" "),
    );
    const { cancel, pull, response } = chunkedResponse(chunks);
    const controller = new AbortController();
    const abortHandle = globalThis.setTimeout(() => controller.abort(), 0);

    try {
      await expect(
        readTypeSafeJevJsonResponse(response, controller.signal),
      ).resolves.toEqual({ status: "unavailable", reason: "deadline" });
    } finally {
      globalThis.clearTimeout(abortHandle);
    }
    expect(pull.mock.calls.length).toBeLessThanOrEqual(
      TYPESAFE_JEV_READ_YIELD_INTERVAL,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
