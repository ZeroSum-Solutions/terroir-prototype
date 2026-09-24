import { z } from "zod";

export const TYPESAFE_JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_JEV_MODEL = "jev-1.13.0";
export const TYPESAFE_JEV_PROBABILITY_SUM_TOLERANCE = 0.001;
export const TYPESAFE_JEV_MAX_CHOICES = 255;
export const TYPESAFE_JEV_MAX_REQUEST_BYTES = 16_384;
export const TYPESAFE_JEV_DEFAULT_DEADLINE_MS = 10_000;
export const TYPESAFE_JEV_MAX_DEADLINE_MS = 30_000;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const StateSchema = z.union([
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]);

const IdentifierSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const ChoiceSchema = z
  .object({
    id: IdentifierSchema,
    description: z.string().trim().min(1).max(2_000),
  })
  .strict();

const ChoiceRequestSchema = z
  .object({
    state: StateSchema,
    question: z
      .object({
        id: IdentifierSchema,
        instructions: z.string().trim().min(1).max(4_000),
        choices: z.array(ChoiceSchema).min(1).max(TYPESAFE_JEV_MAX_CHOICES),
      })
      .strict(),
  })
  .strict();

const EnvelopeSchema = z
  .object({
    model: z.string(),
    answers: z.record(z.string(), z.unknown()),
    usage: z.unknown(),
  })
  .strict();

const ChoiceAnswerSchema = z
  .object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().finite().min(0).max(1),
    probabilities: z.record(
      z.string(),
      z.number().finite().min(0).max(1),
    ),
  })
  .strict();

const UsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  })
  .strict();

export type TypeSafeJevChoiceRequest = z.input<typeof ChoiceRequestSchema>;

export type TypeSafeJevUnavailableReason =
  | "missing_token"
  | "invalid_request"
  | "request_too_large"
  | "deadline"
  | "network"
  | "http_unauthorized"
  | "http_validation"
  | "http_rate_limited"
  | "http_overloaded"
  | "http_server"
  | "http_error"
  | "malformed_json"
  | "schema_mismatch"
  | "model_mismatch"
  | "usage_invalid";

export type TypeSafeJevResult =
  | {
      status: "ok";
      model: typeof TYPESAFE_JEV_MODEL;
      answerKey: string;
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
      usage: { inputTokens: number; outputTokens: number };
      elapsedMs: number;
      cost: { status: "unknown"; reason: "no_verified_rate" };
    }
  | {
      status: "unavailable";
      reason: TypeSafeJevUnavailableReason;
      elapsedMs: number;
    };

export type TypeSafeJevTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface TypeSafeJevClock {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

type TypeSafeJevClientOptions = {
  token?: string;
  transport?: TypeSafeJevTransport;
  clock?: TypeSafeJevClock;
  deadlineMs?: number;
};

export interface TypeSafeJevClient {
  choose(request: TypeSafeJevChoiceRequest): Promise<TypeSafeJevResult>;
}

const systemClock: TypeSafeJevClock = {
  now: Date.now,
  setTimeout: (callback, milliseconds) =>
    globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

const unavailable = (
  reason: TypeSafeJevUnavailableReason,
  elapsedMs: number,
): TypeSafeJevResult => ({ status: "unavailable", reason, elapsedMs });

function httpFailureReason(status: number): TypeSafeJevUnavailableReason {
  if (status === 401) return "http_unauthorized";
  if (status === 422) return "http_validation";
  if (status === 429) return "http_rate_limited";
  if (status === 529) return "http_overloaded";
  if (status >= 500) return "http_server";
  return "http_error";
}

export function createTypeSafeJevClient({
  token,
  transport = fetch,
  clock = systemClock,
  deadlineMs = TYPESAFE_JEV_DEFAULT_DEADLINE_MS,
}: TypeSafeJevClientOptions): TypeSafeJevClient {
  return {
    async choose(input) {
      const startedAt = clock.now();
      const elapsed = () => Math.max(0, clock.now() - startedAt);
      const bearerToken = token?.trim();
      if (!bearerToken) return unavailable("missing_token", elapsed());
      if (
        !Number.isInteger(deadlineMs) ||
        deadlineMs <= 0 ||
        deadlineMs > TYPESAFE_JEV_MAX_DEADLINE_MS
      ) {
        return unavailable("invalid_request", elapsed());
      }

      let parsedRequest: ReturnType<typeof ChoiceRequestSchema.safeParse>;
      try {
        parsedRequest = ChoiceRequestSchema.safeParse(input);
      } catch {
        return unavailable("invalid_request", elapsed());
      }
      if (!parsedRequest.success) {
        return unavailable("invalid_request", elapsed());
      }
      const choiceIds = parsedRequest.data.question.choices.map(({ id }) => id);
      if (new Set(choiceIds).size !== choiceIds.length) {
        return unavailable("invalid_request", elapsed());
      }

      const criteria = Object.fromEntries(
        parsedRequest.data.question.choices.map(({ id, description }) => [
          id,
          description,
        ]),
      );
      let body: string;
      try {
        body = JSON.stringify({
          state: parsedRequest.data.state,
          model: TYPESAFE_JEV_MODEL,
          questions: {
            [parsedRequest.data.question.id]: {
              type: "choice",
              instructions: parsedRequest.data.question.instructions,
              criteria,
            },
          },
        });
      } catch {
        return unavailable("invalid_request", elapsed());
      }
      if (new TextEncoder().encode(body).byteLength > TYPESAFE_JEV_MAX_REQUEST_BYTES) {
        return unavailable("request_too_large", elapsed());
      }

      const controller = new AbortController();
      let resolveDeadline: (() => void) | undefined;
      const deadline = new Promise<{ kind: "deadline" }>((resolve) => {
        resolveDeadline = () => resolve({ kind: "deadline" });
      });
      const timeoutHandle = clock.setTimeout(() => {
        controller.abort();
        resolveDeadline?.();
      }, deadlineMs);

      const request = Promise.resolve()
        .then(() =>
          transport(TYPESAFE_JEV_ENDPOINT, {
            method: "POST",
            redirect: "error",
            headers: {
              authorization: `Bearer ${bearerToken}`,
              "content-type": "application/json",
            },
            body,
            signal: controller.signal,
          }),
        )
        .then(
        (response) => ({ kind: "response" as const, response }),
        () => ({ kind: "network" as const }),
      );

      try {
        const outcome = await Promise.race([request, deadline]);
        if (outcome.kind === "deadline") {
          return unavailable("deadline", elapsed());
        }
        if (outcome.kind === "network") {
          return unavailable(
            controller.signal.aborted ? "deadline" : "network",
            elapsed(),
          );
        }
        if (elapsed() >= deadlineMs) return unavailable("deadline", elapsed());
        if (!outcome.response.ok) {
          return unavailable(httpFailureReason(outcome.response.status), elapsed());
        }

        const parsedBody = await Promise.race([
          Promise.resolve()
            .then(() => outcome.response.json())
            .then(
              (body) => ({ kind: "body" as const, body }),
              () => ({ kind: "malformed" as const }),
            ),
          deadline,
        ]);
        if (parsedBody.kind === "deadline") {
          return unavailable("deadline", elapsed());
        }
        if (parsedBody.kind === "malformed") {
          return unavailable("malformed_json", elapsed());
        }
        if (elapsed() >= deadlineMs) return unavailable("deadline", elapsed());
        const envelope = EnvelopeSchema.safeParse(parsedBody.body);
        if (!envelope.success) return unavailable("schema_mismatch", elapsed());
        if (envelope.data.model !== TYPESAFE_JEV_MODEL) {
          return unavailable("model_mismatch", elapsed());
        }
        const usage = UsageSchema.safeParse(envelope.data.usage);
        if (!usage.success) return unavailable("usage_invalid", elapsed());

        const answerKeys = Object.keys(envelope.data.answers);
        const expectedAnswerKey = parsedRequest.data.question.id;
        if (answerKeys.length !== 1 || answerKeys[0] !== expectedAnswerKey) {
          return unavailable("schema_mismatch", elapsed());
        }
        const answer = ChoiceAnswerSchema.safeParse(
          envelope.data.answers[expectedAnswerKey],
        );
        if (!answer.success) return unavailable("schema_mismatch", elapsed());

        const probabilityKeys = Object.keys(answer.data.probabilities).sort();
        const expectedChoices = [...choiceIds].sort();
        if (
          probabilityKeys.length !== expectedChoices.length ||
          probabilityKeys.some((key, index) => key !== expectedChoices[index]) ||
          !expectedChoices.includes(answer.data.choice)
        ) {
          return unavailable("schema_mismatch", elapsed());
        }
        const probabilities = Object.values(answer.data.probabilities);
        const probabilityTotal = probabilities.reduce((sum, value) => sum + value, 0);
        const maximumProbability = Math.max(...probabilities);
        if (
          Math.abs(probabilityTotal - 1) >
            TYPESAFE_JEV_PROBABILITY_SUM_TOLERANCE ||
          answer.data.probabilities[answer.data.choice] !== maximumProbability
        ) {
          return unavailable("schema_mismatch", elapsed());
        }

        return {
          status: "ok",
          model: TYPESAFE_JEV_MODEL,
          answerKey: expectedAnswerKey,
          choice: answer.data.choice,
          confidence: answer.data.confidence,
          probabilities: answer.data.probabilities,
          usage: {
            inputTokens: usage.data.input_tokens,
            outputTokens: usage.data.output_tokens,
          },
          elapsedMs: elapsed(),
          cost: { status: "unknown", reason: "no_verified_rate" },
        };
      } finally {
        clock.clearTimeout(timeoutHandle);
      }
    },
  };
}
