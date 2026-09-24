"use client";

import { useState } from "react";
import type { PreservationMethod } from "@/lib/partial-bottles/math";
import { useToast } from "@/lib/toast";
import {
  isCloseoutSuccess,
  isDefinitiveCommandResponse,
  isReplayedCommandResponse,
  unknownCommandOutcomeMessage,
  useIdempotentCommand,
} from "./use-idempotent-command";

type Bottle = {
  id: string;
  wineId: string;
  openedAt: string;
  theoreticalRemainingMl: number;
  preservationMethod: PreservationMethod;
  openedBy: string | null;
  identityContract?: 1 | 2;
};

type Reason = { id: string; label: string; category: string };
type ClosePayload = {
  bottle: Bottle;
  actualRemainingMl: number;
  writtenOffMl: number;
  reasonCodeId: string;
};

const LABELS: Record<PreservationMethod, string> = {
  argon: "Argon",
  coravin: "Coravin",
  none: "None",
  vacuum: "Vacuum",
};

export function PartialBottleCloseout({
  bottle,
  reasons,
  onComplete,
}: {
  bottle: Bottle;
  reasons: Reason[];
  onComplete?: () => void;
}) {
  const form = useCloseout(bottle, onComplete);

  return (
    <section aria-label="Partial bottle close-out" className="mt-md rounded-card card-surface p-md">
      <BottleSummary bottle={bottle} />
      <CloseoutFields reasons={reasons} form={form} />
    </section>
  );
}

function useCloseout(bottle: Bottle, onComplete?: () => void) {
  const [actual, setActual] = useState(String(Math.max(0, bottle.theoreticalRemainingMl)));
  const [writeoff, setWriteoff] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { begin, retry, finish, pending } = useIdempotentCommand<ClosePayload>();
  const actualMl = Number(actual);
  const writtenOffMl = Number(writeoff);
  const invalid = actual.trim() === "" || writeoff.trim() === "" ||
    !Number.isInteger(actualMl) || actualMl < 0 ||
    !Number.isInteger(writtenOffMl) || writtenOffMl < 0 ||
    (writtenOffMl > 0 && !reason);

  async function closeBottle() {
    const nextPayload = {
      bottle,
      actualRemainingMl: actualMl,
      writtenOffMl,
      reasonCodeId: reason,
    };
    const fingerprint = JSON.stringify([
      "close",
      bottle.identityContract ?? 1,
      bottle.id,
      bottle.identityContract === 2 ? bottle.wineId : bottle.openedAt,
      actualMl,
      writtenOffMl,
      reason || null,
    ]);
    const hadUncertainOutcome = pending?.state === "unresolved";
    const retryCommand = hadUncertainOutcome ? retry() : null;
    const operationId = retryCommand?.operationId ?? begin(fingerprint, nextPayload);
    const command = retryCommand?.payload ?? nextPayload;
    const commandFingerprint = retryCommand?.fingerprint ?? fingerprint;
    if (!operationId) {
      if (pending?.state === "unresolved") {
        setError("Retry the prior close-out before starting another one.");
      }
      return;
    }
    setBusy(true);
    setError(null);
    let definitive = false;
    let successful = false;
    try {
      const replayed = await postCloseout(
        command.bottle,
        command.actualRemainingMl,
        command.writtenOffMl,
        command.reasonCodeId,
        operationId,
        (classifiedDefinitive) => {
          definitive = classifiedDefinitive;
        },
      );
      successful = true;
      if (replayed) toast.success("Already recorded");
      onComplete?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Close-out failed.";
      setError(
        !definitive || hadUncertainOutcome
          ? unknownCommandOutcomeMessage(
            "Close-out",
            "close it",
            definitive ? message : undefined,
          )
          : message,
      );
    } finally {
      finish(commandFingerprint, definitive, successful);
      setBusy(false);
    }
  }

  return {
    actual,
    setActual,
    writeoff,
    setWriteoff,
    reason,
    setReason,
    writtenOffMl,
    busy,
    error,
    invalid,
    needsReview: pending?.state === "unresolved",
    closeBottle,
  };
}

async function postCloseout(
  bottle: Bottle,
  actualRemainingMl: number,
  writtenOffMl: number,
  reasonCodeId: string,
  operationId: string,
  onClassified: (definitive: boolean) => void,
) {
  const response = await fetch("/api/open-bottles/close", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": operationId,
    },
    body: JSON.stringify(bottle.identityContract === 2 ? {
      wine_id: bottle.wineId,
      open_bottle_id: bottle.id,
      actual_remaining_ml: actualRemainingMl,
      written_off_ml: writtenOffMl,
      reason_code_id: reasonCodeId || undefined,
    } : {
      open_bottle_id: bottle.id,
      expected_opened_at: bottle.openedAt,
      actual_remaining_ml: actualRemainingMl,
      written_off_ml: writtenOffMl,
      reason_code_id: reasonCodeId || undefined,
    }),
  });
  const payload = await response.json().catch(() => null) as
    | { error?: { message?: string }; closeout?: Record<string, unknown> }
    | null;
  const definitive = isDefinitiveCommandResponse(
    response,
    payload,
    isCloseoutSuccess,
  );
  onClassified(definitive);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Close-out failed.");
  }
  if (!definitive) {
    throw new Error("Couldn't confirm the bottle was closed. Retry the close.");
  }
  return isReplayedCommandResponse(response);
}

type CloseoutForm = ReturnType<typeof useCloseout>;

function BottleSummary({ bottle }: { bottle: Bottle }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-sm">
        <h3 className="text-caption font-medium uppercase text-grey">Open bottle</h3>
        <span className="text-[12px] text-grey">{LABELS[bottle.preservationMethod]}</span>
      </div>
      <p className="mt-xs text-[12px] text-grey">
        {bottle.theoreticalRemainingMl} ml theoretical remaining
        {/* openedBy is a raw auth user id — no display name is cheaply
            available in already-fetched data here, so show that someone
            opened it without ever rendering the UUID itself. */}
        {bottle.openedBy ? " · opened" : ""}
      </p>
    </>
  );
}

function CloseoutFields({ reasons, form }: { reasons: Reason[]; form: CloseoutForm }) {
  return (
    <>
      <div className="mt-sm grid grid-cols-2 gap-sm">
        <Field name="actual_remaining_ml" label="Actual remaining (ml)" value={form.actual} onChange={form.setActual} disabled={form.needsReview} />
        <Field name="written_off_ml" label="Write-off (ml)" value={form.writeoff} onChange={form.setWriteoff} disabled={form.needsReview} />
      </div>
      <label className="mt-sm block text-[12px] text-grey">
        Reason
        <select disabled={form.needsReview} value={form.reason} onChange={(event) => form.setReason(event.target.value)} className="mt-xs h-11 w-full rounded-pill border border-rule bg-surface px-sm text-[13px] text-ink">
          <option value="">{form.writtenOffMl > 0 ? "Select a reason" : "No reason"}</option>
          {reasons.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {form.error && <p role="alert" className="mt-sm text-[12px] text-risk-ink">{form.error}</p>}
      <button type="button" disabled={form.busy || form.invalid} onClick={form.closeBottle} className="mt-sm h-11 w-full rounded-pill border border-edge bg-surface text-[13px] font-medium text-ink hover:bg-wash disabled:opacity-50">
        {form.busy ? "Closing…" : form.needsReview ? "Retry prior action" : "Close bottle"}
      </button>
    </>
  );
}

function Field({ name, label, value, onChange, disabled }: { name: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <label className="text-[12px] text-grey">
      {label}
      {/* 17px keeps iOS from zooming the page on focus; 14px once there is
          a pointer. */}
      <input disabled={disabled} name={name} type="number" min="0" step="1" value={value} onChange={(event) => onChange(event.target.value)} className="mt-xs h-11 w-full rounded-pill border border-rule bg-surface px-sm font-mono text-body-lg text-ink md:text-control" />
    </label>
  );
}
