"use client";

import { useCallback, useRef, useState } from "react";

type PendingCommand<TPayload> = {
  fingerprint: string;
  operationId: string;
  payload: TPayload;
  inFlight: boolean;
  wasUncertain: boolean;
};

export type PendingCommandView<TPayload> = Omit<
  PendingCommand<TPayload>,
  "operationId" | "inFlight" | "wasUncertain"
> & {
  state: "in_flight" | "unresolved";
};

type CommandRetry<TPayload> = {
  fingerprint: string;
  operationId: string;
  payload: TPayload;
};

const UNCERTAIN_RESPONSE_STATUSES = new Set([408, 425, 429]);

export function isDefinitiveCommandResponse(
  response: Response,
  payload: unknown,
  isValidSuccess: (payload: unknown) => boolean,
): boolean {
  if (!response.ok) {
    return response.status < 500 && !UNCERTAIN_RESPONSE_STATUSES.has(response.status);
  }

  return isValidSuccess(payload);
}

export function isOpenBottleSuccess(payload: unknown): boolean {
  const result = resultRecord(payload, "open_bottle");
  return Boolean(
    result &&
      isUuid(result.id) &&
      isUuid(result.wine_id) &&
      isDateTime(result.opened_at) &&
      isNonnegativeNumber(result.remaining_ml),
  );
}

export function isCloseoutSuccess(payload: unknown): boolean {
  const result = resultRecord(payload, "closeout");
  return Boolean(
    result &&
      isUuid(result.id) &&
      isUuid(result.open_bottle_id) &&
      isUuid(result.wine_id),
  );
}

export function isClosedBottleSuccess(payload: unknown): boolean {
  const result = resultRecord(payload, "closed");
  return Boolean(
    result &&
      isUuid(result.id) &&
      isUuid(result.wine_id) &&
      isDateTime(result.closed_at),
  );
}

export function isReplayedCommandResponse(response: Response): boolean {
  return response.headers.get("Idempotency-Replayed") === "true";
}

export function useIdempotentCommand<TPayload>() {
  const pendingRef = useRef<PendingCommand<TPayload> | null>(null);
  const [pending, setPending] = useState<PendingCommandView<TPayload> | null>(null);

  const begin = useCallback((
    fingerprint: string,
    payload: TPayload,
  ): string | null => {
    if (pendingRef.current) return null;

    const operationId = crypto.randomUUID();
    pendingRef.current = {
      fingerprint,
      operationId,
      payload,
      inFlight: true,
      wasUncertain: false,
    };
    setPending({ fingerprint, payload, state: "in_flight" });
    return operationId;
  }, []);

  const retry = useCallback((): CommandRetry<TPayload> | null => {
    const current = pendingRef.current;
    if (!current || current.inFlight) return null;

    current.inFlight = true;
    setPending({
      fingerprint: current.fingerprint,
      payload: current.payload,
      state: "in_flight",
    });
    return {
      fingerprint: current.fingerprint,
      operationId: current.operationId,
      payload: current.payload,
    };
  }, []);

  const finish = useCallback((
    fingerprint: string,
    definitive: boolean,
    successful = false,
  ) => {
    const current = pendingRef.current;
    if (!current || current.fingerprint !== fingerprint) return;
    if (successful || (definitive && !current.wasUncertain)) {
      pendingRef.current = null;
      setPending(null);
    } else {
      current.inFlight = false;
      current.wasUncertain = true;
      setPending({
        fingerprint: current.fingerprint,
        payload: current.payload,
        state: "unresolved",
      });
    }
  }, []);

  return { begin, retry, finish, pending };
}

function resultRecord(payload: unknown, key: string) {
  if (!isRecord(payload)) return null;
  const result = payload[key];
  return isRecord(result) ? result : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" &&
    Number.isFinite(Date.parse(value));
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
