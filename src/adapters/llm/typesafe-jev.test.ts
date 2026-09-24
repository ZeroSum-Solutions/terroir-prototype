import { describe, expect, it, vi } from "vitest";

import {
  TYPESAFE_JEV_ENDPOINT,
  TYPESAFE_JEV_MAX_CHOICES,
  TYPESAFE_JEV_MAX_DEADLINE_MS,
  TYPESAFE_JEV_MODEL,
  createTypeSafeJevClient,
  type TypeSafeJevChoiceRequest,
  type TypeSafeJevClock,
  type TypeSafeJevTransport,
} from "./typesafe-jev";

const REQUEST: TypeSafeJevChoiceRequest = {
  state: {
    row: { producer: "Domaine Test", cuvee: "Les Vignes" },
    candidate: { producer: "Domaine Test", cuvee: "Les Vignes Rouge" },
  },
  question: {
    id: "identity_alignment",
    instructions: "Use only the supplied identity text.",
    choices: [
      { id: "supported", description: "The identities agree." },
      { id: "contradicted", description: "The identities conflict." },
      { id: "uncertain", description: "The text is insufficient." },
    ],
  },
};

const VALID_RESPONSE = {
  model: TYPESAFE_JEV_MODEL,
  answers: {
    identity_alignment: {
      type: "choice",
      choice: "supported",
      confidence: 0.8,
      probabilities: {
        supported: 0.8,
        contradicted: 0.1,
        uncertain: 0.1,
      },
    },
  },
  usage: { input_tokens: 120, output_tokens: 8 },
};

const response = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  }) as unknown as Response;

const fixedClock = (start = 100, end = 125): TypeSafeJevClock => ({
  now: vi.fn().mockReturnValueOnce(start).mockReturnValue(end),
  setTimeout: vi.fn(() => 1),
  clearTimeout: vi.fn(),
});

describe("TypeSafe JEV adapter", () => {
  it("sends one exact bounded request and returns only strictly parsed fields", async () => {
    const transport = vi.fn<TypeSafeJevTransport>().mockResolvedValue(
      response(VALID_RESPONSE),
    );
    const clock = fixedClock();
    const client = createTypeSafeJevClient({
      token: " test-token ",
      transport,
      clock,
      deadlineMs: 1_000,
    });

    await expect(client.choose(REQUEST)).resolves.toEqual({
      status: "ok",
      model: TYPESAFE_JEV_MODEL,
      answerKey: "identity_alignment",
      choice: "supported",
      confidence: 0.8,
      probabilities: {
        supported: 0.8,
        contradicted: 0.1,
        uncertain: 0.1,
      },
      usage: { inputTokens: 120, outputTokens: 8 },
      elapsedMs: 25,
      cost: { status: "unknown", reason: "no_verified_rate" },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(TYPESAFE_JEV_ENDPOINT);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      state: REQUEST.state,
      model: TYPESAFE_JEV_MODEL,
      questions: {
        identity_alignment: {
          type: "choice",
          instructions: "Use only the supplied identity text.",
          criteria: {
            supported: "The identities agree.",
            contradicted: "The identities conflict.",
            uncertain: "The text is insufficient.",
          },
        },
      },
    });
    expect(clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(clock.clearTimeout).toHaveBeenCalledWith(1);
  });

  it("accepts an approximate probability sum inside the frozen tolerance", async () => {
    const body = structuredClone(VALID_RESPONSE);
    body.answers.identity_alignment.probabilities = {
      supported: 0.5004,
      contradicted: 0.2997,
      uncertain: 0.1999,
    };
    body.answers.identity_alignment.confidence = 0.5004;
    const client = createTypeSafeJevClient({
      token: "token",
      transport: vi.fn().mockResolvedValue(response(body)),
      clock: fixedClock(),
    });

    await expect(client.choose(REQUEST)).resolves.toMatchObject({
      status: "ok",
      choice: "supported",
    });
  });

  it.each([
    ["extra top-level fields", () => ({ ...VALID_RESPONSE, trace_id: "private" }), "schema_mismatch"],
    ["unexpected model", () => ({ ...VALID_RESPONSE, model: "jev-latest" }), "model_mismatch"],
    ["missing answer key", () => ({ ...VALID_RESPONSE, answers: {} }), "schema_mismatch"],
    [
      "extra answer key",
      () => ({ ...VALID_RESPONSE, answers: { ...VALID_RESPONSE.answers, extra: {} } }),
      "schema_mismatch",
    ],
    [
      "wrong answer type",
      () => ({
        ...VALID_RESPONSE,
        answers: { identity_alignment: { ...VALID_RESPONSE.answers.identity_alignment, type: "noul" } },
      }),
      "schema_mismatch",
    ],
    [
      "extra answer field",
      () => ({
        ...VALID_RESPONSE,
        answers: { identity_alignment: { ...VALID_RESPONSE.answers.identity_alignment, explanation: "leak" } },
      }),
      "schema_mismatch",
    ],
    [
      "option mismatch",
      () => ({
        ...VALID_RESPONSE,
        answers: {
          identity_alignment: {
            ...VALID_RESPONSE.answers.identity_alignment,
            probabilities: { supported: 0.8, contradicted: 0.1, invented: 0.1 },
          },
        },
      }),
      "schema_mismatch",
    ],
    [
      "non-maximal choice",
      () => ({
        ...VALID_RESPONSE,
        answers: {
          identity_alignment: {
            ...VALID_RESPONSE.answers.identity_alignment,
            choice: "uncertain",
          },
        },
      }),
      "schema_mismatch",
    ],
    [
      "out-of-range probability",
      () => ({
        ...VALID_RESPONSE,
        answers: {
          identity_alignment: {
            ...VALID_RESPONSE.answers.identity_alignment,
            probabilities: { supported: 1.1, contradicted: 0, uncertain: 0 },
          },
        },
      }),
      "schema_mismatch",
    ],
    [
      "probability sum outside tolerance",
      () => ({
        ...VALID_RESPONSE,
        answers: {
          identity_alignment: {
            ...VALID_RESPONSE.answers.identity_alignment,
            probabilities: { supported: 0.7, contradicted: 0.1, uncertain: 0.1 },
          },
        },
      }),
      "schema_mismatch",
    ],
    [
      "non-finite confidence",
      () => ({
        ...VALID_RESPONSE,
        answers: {
          identity_alignment: {
            ...VALID_RESPONSE.answers.identity_alignment,
            confidence: Number.NaN,
          },
        },
      }),
      "schema_mismatch",
    ],
    [
      "out-of-range confidence",
      () => ({
        ...VALID_RESPONSE,
        answers: {
          identity_alignment: {
            ...VALID_RESPONSE.answers.identity_alignment,
            confidence: 1.01,
          },
        },
      }),
      "schema_mismatch",
    ],
    [
      "invalid usage",
      () => ({ ...VALID_RESPONSE, usage: { input_tokens: -1, output_tokens: 1.5 } }),
      "usage_invalid",
    ],
  ])("fails closed for %s", async (_name, buildBody, reason) => {
    const client = createTypeSafeJevClient({
      token: "token",
      transport: vi.fn().mockResolvedValue(response(buildBody())),
      clock: fixedClock(),
    });

    await expect(client.choose(REQUEST)).resolves.toMatchObject({
      status: "unavailable",
      reason,
    });
  });

  it.each([
    [401, "http_unauthorized"],
    [422, "http_validation"],
    [429, "http_rate_limited"],
    [500, "http_server"],
    [529, "http_overloaded"],
  ])("maps HTTP %s without reading or exposing provider error text", async (status, reason) => {
    const errorResponse = response({ detail: "private provider error" }, status);
    const transport = vi.fn().mockResolvedValue(errorResponse);
    const client = createTypeSafeJevClient({
      token: "token",
      transport,
      clock: fixedClock(),
    });

    const result = await client.choose(REQUEST);

    expect(result).toMatchObject({ status: "unavailable", reason });
    expect(errorResponse.json).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private provider error");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("maps malformed JSON and synchronous or asynchronous network failure without retry", async () => {
    const malformed = {
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("bad json")),
    } as unknown as Response;
    const malformedTransport = vi.fn().mockResolvedValue(malformed);
    const networkTransport = vi.fn().mockRejectedValue(new Error("secret upstream text"));
    const throwingTransport = vi.fn(() => {
      throw new Error("secret synchronous upstream text");
    });

    await expect(
      createTypeSafeJevClient({
        token: "token",
        transport: malformedTransport,
        clock: fixedClock(),
      }).choose(REQUEST),
    ).resolves.toMatchObject({ status: "unavailable", reason: "malformed_json" });
    await expect(
      createTypeSafeJevClient({
        token: "token",
        transport: networkTransport,
        clock: fixedClock(),
      }).choose(REQUEST),
    ).resolves.toMatchObject({ status: "unavailable", reason: "network" });
    await expect(
      createTypeSafeJevClient({
        token: "token",
        transport: throwingTransport,
        clock: fixedClock(),
      }).choose(REQUEST),
    ).resolves.toMatchObject({ status: "unavailable", reason: "network" });
    expect(malformedTransport).toHaveBeenCalledTimes(1);
    expect(networkTransport).toHaveBeenCalledTimes(1);
    expect(throwingTransport).toHaveBeenCalledTimes(1);
  });

  it("maps a redirect rejection without retrying or exposing payload or error text", async () => {
    const redirectError = "redirect blocked: private Location and provider text";
    const transport = vi.fn<TypeSafeJevTransport>((_url, init) => {
      expect(init.redirect).toBe("error");
      return Promise.reject(new TypeError(`${redirectError}: ${String(init.body)}`));
    });
    const result = await createTypeSafeJevClient({
      token: "token",
      transport,
      clock: fixedClock(),
    }).choose(REQUEST);

    expect(result).toEqual({
      status: "unavailable",
      reason: "network",
      elapsedMs: 25,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(redirectError);
    expect(JSON.stringify(result)).not.toContain("Domaine Test");
  });

  it("cancels and returns deadline when the one transport attempt does not settle", async () => {
    let fireDeadline: (() => void) | undefined;
    let currentTime = 0;
    const clock: TypeSafeJevClock = {
      now: vi.fn(() => currentTime),
      setTimeout: vi.fn((callback) => {
        fireDeadline = () => {
          currentTime = 25;
          callback();
        };
        return 7;
      }),
      clearTimeout: vi.fn(),
    };
    const transport = vi.fn<TypeSafeJevTransport>().mockReturnValue(
      new Promise<Response>(() => undefined),
    );
    const pending = createTypeSafeJevClient({
      token: "token",
      transport,
      clock,
      deadlineMs: 25,
    }).choose(REQUEST);

    fireDeadline?.();

    await expect(pending).resolves.toEqual({
      status: "unavailable",
      reason: "deadline",
      elapsedMs: 25,
    });
    expect((transport.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("applies the same total deadline while reading the response body", async () => {
    let fireDeadline: (() => void) | undefined;
    let currentTime = 0;
    const clock: TypeSafeJevClock = {
      now: vi.fn(() => currentTime),
      setTimeout: vi.fn((callback) => {
        fireDeadline = () => {
          currentTime = 25;
          callback();
        };
        return 8;
      }),
      clearTimeout: vi.fn(),
    };
    const json = vi.fn(() => new Promise<unknown>(() => undefined));
    const transport = vi.fn<TypeSafeJevTransport>().mockResolvedValue({
      ok: true,
      status: 200,
      json,
    } as unknown as Response);
    const pending = createTypeSafeJevClient({
      token: "token",
      transport,
      clock,
      deadlineMs: 25,
    }).choose(REQUEST);

    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    fireDeadline?.();

    await expect(pending).resolves.toEqual({
      status: "unavailable",
      reason: "deadline",
      elapsedMs: 25,
    });
    expect((transport.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects missing tokens, invalid grammar, duplicate choices, and oversize payloads before transport", async () => {
    const transport = vi.fn<TypeSafeJevTransport>();
    const missingToken = createTypeSafeJevClient({ transport, clock: fixedClock() });
    const duplicateChoices = {
      ...REQUEST,
      question: {
        ...REQUEST.question,
        choices: [REQUEST.question.choices[0], REQUEST.question.choices[0]],
      },
    };
    const tooManyChoices = {
      ...REQUEST,
      question: {
        ...REQUEST.question,
        choices: Array.from({ length: TYPESAFE_JEV_MAX_CHOICES + 1 }, (_, index) => ({
          id: `choice_${index}`,
          description: "bounded",
        })),
      },
    };
    const invalidQuestionId = {
      ...REQUEST,
      question: { ...REQUEST.question, id: "identity-alignment" },
    };
    const requestWithUnknownField = { ...REQUEST, model: "jev-latest" };

    await expect(missingToken.choose(REQUEST)).resolves.toMatchObject({
      status: "unavailable",
      reason: "missing_token",
    });
    for (const invalid of [
      duplicateChoices,
      tooManyChoices,
      invalidQuestionId,
      requestWithUnknownField,
    ]) {
      await expect(
        createTypeSafeJevClient({ token: "token", transport, clock: fixedClock() }).choose(invalid),
      ).resolves.toMatchObject({ status: "unavailable", reason: "invalid_request" });
    }
    await expect(
      createTypeSafeJevClient({ token: "token", transport, clock: fixedClock() }).choose({
        ...REQUEST,
        state: "x".repeat(20_000),
      }),
    ).resolves.toMatchObject({ status: "unavailable", reason: "request_too_large" });
    await expect(
      createTypeSafeJevClient({
        token: "token",
        transport,
        clock: fixedClock(),
        deadlineMs: TYPESAFE_JEV_MAX_DEADLINE_MS + 1,
      }).choose(REQUEST),
    ).resolves.toMatchObject({ status: "unavailable", reason: "invalid_request" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns typed invalid_request for cyclic or excessively deep runtime state", async () => {
    const transport = vi.fn<TypeSafeJevTransport>();
    const client = createTypeSafeJevClient({
      token: "token",
      transport,
      clock: fixedClock(),
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = { value: "leaf" };
    for (let index = 0; index < 10_000; index += 1) deep = { child: deep };

    for (const state of [cyclic, deep]) {
      await expect(
        client.choose({ ...REQUEST, state } as TypeSafeJevChoiceRequest),
      ).resolves.toMatchObject({
        status: "unavailable",
        reason: "invalid_request",
      });
    }
    expect(transport).not.toHaveBeenCalled();
  });
});
