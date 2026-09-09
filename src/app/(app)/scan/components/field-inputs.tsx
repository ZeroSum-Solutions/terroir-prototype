"use client";

import { AlertCircle, Minus, Plus } from "lucide-react";
import { useId, useState } from "react";
import { Field, type FieldA11yProps } from "@/components/field";
import { cn } from "@/lib/utils";

export function formatMoney(n: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* DESIGN.md - Spacing & Shapes: a form control is a 48px pill on the vault
   ground, hairline at rest, copper on focus. */
const FIELD_WRAP =
  "relative flex min-h-12 w-full items-center gap-xs rounded-pill border border-rule-strong bg-surface-sunken px-md transition-colors focus-within:border-accent focus-ring";

interface FieldWrapProps {
  low?: boolean;
  edited?: boolean;
  invalid?: boolean;
  children: React.ReactNode;
}

export function FieldWrap({ low, edited, invalid, children }: FieldWrapProps) {
  return (
    <div
      className={cn(
        FIELD_WRAP,
        low && "border-accent/60",
        edited && !low && "border-ready-ink/40",
        // DESIGN.md — State: the error row is a solid `edge` boundary on the
        // risk wash, not a tint you have to already know about.
        invalid && "border-edge bg-risk-wash",
      )}
    >
      {children}
      {/* The copper seal, not a red flag: a low-confidence field is unread,
          not wrong (DESIGN.md — Status Seal). */}
      {low && (
        <span className="inline-flex shrink-0 items-center gap-3xs rounded-pill border border-accent/60 px-xs py-2xs text-micro font-medium uppercase tracking-[0.14em] text-accent">
          <AlertCircle className="h-3 w-3" strokeWidth={1.9} aria-hidden="true" />
          Verify
        </span>
      )}
    </div>
  );
}

/**
 * The message a bare (label-less) field would otherwise have nowhere to put.
 * `Field` owns this when a caller supplies an id and label; the desktop scan
 * table supplies neither, and used to get no error at all.
 */
function BareField({
  error,
  errorId,
  children,
}: {
  error: string | null;
  errorId: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {children}
      {error !== null && (
        <p id={errorId} role="alert" className="mt-3xs px-sm text-ledger text-risk-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What a scanned field IS, in type (DESIGN.md — Typography): a wine name is
 * the serif at body-lg, a producer is a ledger-sized grey line under it, and
 * everything else is the working face — 17px so iOS does not zoom the page on
 * focus, 14px once there is a pointer.
 *
 * These strings are concatenated OUTSIDE cn() on purpose. tailwind-merge
 * cannot tell a custom `text-<size>` from a `text-<colour>` and keeps only the
 * last of the two, which is how `text-body-lg` used to disappear from every
 * one of these inputs the moment `text-ink` followed it.
 */
const TEXT_VARIANT = {
  default: "text-body-lg text-ink md:text-control",
  /** The wine name. Serif, never bold (DESIGN.md — Do's). */
  name: "font-serif text-body-lg font-medium text-ink md:text-body-lg",
  /** The producer line beneath a name. */
  secondary: "text-ledger text-grey md:text-ledger",
} as const;

export type TextInputVariant = keyof typeof TEXT_VARIANT;

interface TextInputProps {
  id?: string;
  label?: string;
  value: string;
  low?: boolean;
  edited?: boolean;
  onCommit: (v: string) => void;
  className?: string;
  variant?: TextInputVariant;
  srOnlyLabel?: boolean;
}

export function TextInput({
  value,
  low,
  edited,
  onCommit,
  className,
  variant = "default",
  label,
  id,
  srOnlyLabel = false,
}: TextInputProps) {
  const [val, setVal] = useState(value);
  const [prevProp, setPrevProp] = useState(value);
  if (value !== prevProp) {
    setPrevProp(value);
    setVal(value);
  }
  const input = (a11y?: FieldA11yProps) => (
    <FieldWrap low={low} edited={edited}>
      <input
        {...a11y}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => val !== value && onCommit(val)}
        aria-label={a11y ? undefined : label}
        className={
          TEXT_VARIANT[variant] +
          " " +
          cn("min-h-11 w-full bg-transparent outline-none", className)
        }
      />
    </FieldWrap>
  );

  return id && label ? (
    <Field id={id} label={label} srOnlyLabel={srOnlyLabel}>
      {(a11y) => input(a11y)}
    </Field>
  ) : (
    input()
  );
}

interface VintageInputProps {
  id?: string;
  label?: string;
  value: number | null;
  low?: boolean;
  edited?: boolean;
  onCommit: (v: number | null) => void;
  srOnlyLabel?: boolean;
}

export function VintageInput({
  value,
  low,
  edited,
  onCommit,
  id,
  label,
  srOnlyLabel = false,
}: VintageInputProps) {
  const [val, setVal] = useState(value === null ? "NV" : String(value));
  const [error, setError] = useState<string | null>(null);
  const [prevProp, setPrevProp] = useState(value);
  if (value !== prevProp) {
    setPrevProp(value);
    setVal(value === null ? "NV" : String(value));
    setError(null);
  }
  const errorId = useId();
  const commit = () => {
    const trimmed = val.trim().toUpperCase();
    if (!trimmed || trimmed === "NV") {
      setError(null);
      return onCommit(null);
    }
    // parseInt("2024abc") is 2024. Validate the whole string first, then
    // convert — a scanned invoice is exactly where a half-parsed year becomes
    // a wrong bottle.
    const n = /^\d{4}$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isFinite(n) || n < 1800 || n > new Date().getFullYear() + 2) {
      // Validation used to be suppressed without an `id`, because there was
      // nowhere to render the message — so the desktop scan table, which
      // passes neither id nor label, silently coerced "twenty-ten" to NV
      // while the mobile cards rejected it. An error state reachable on one
      // viewport and not the other is a data-integrity bug, not a styling
      // one (DESIGN.md — State).
      setError("Enter a four-digit year or NV.");
      return;
    }
    setError(null);
    onCommit(n);
  };
  const input = (a11y?: FieldA11yProps) => (
    <FieldWrap low={low} edited={edited} invalid={error !== null}>
      <input
        // The bare fallbacks come first so Field's own ids win when it wraps
        // this input, and stand on their own when nothing does.
        aria-invalid={error !== null || undefined}
        aria-describedby={error !== null ? errorId : undefined}
        {...a11y}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        inputMode="numeric"
        aria-label={a11y ? undefined : "Vintage"}
        // 17px keeps iOS from zooming the page on focus; 14px once there is
        // a pointer. Both are scale tokens (see add-wine-pricing.tsx).
        className="tabular min-h-11 w-full bg-transparent text-body-lg text-ink outline-none md:text-control"
      />
    </FieldWrap>
  );

  return id && label ? (
    <Field id={id} label={label} error={error} srOnlyLabel={srOnlyLabel}>
      {(a11y) => input(a11y)}
    </Field>
  ) : (
    <BareField error={error} errorId={errorId}>
      {input()}
    </BareField>
  );
}

interface MoneyInputProps {
  id?: string;
  label?: string;
  value: number;
  low?: boolean;
  edited?: boolean;
  onCommit: (v: number) => void;
  srOnlyLabel?: boolean;
}

export function MoneyInput({
  value,
  low,
  edited,
  onCommit,
  id,
  label,
  srOnlyLabel = false,
}: MoneyInputProps) {
  const [val, setVal] = useState(value.toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [prevProp, setPrevProp] = useState(value);
  if (value !== prevProp) {
    setPrevProp(value);
    setVal(value.toFixed(2));
    setError(null);
  }
  const errorId = useId();
  const commit = () => {
    // Same reasoning as the vintage: parseFloat("12abc") is 12.
    const cleaned = val.trim().replace(/^\$/, "").replace(/,/g, "");
    const n = /^\d*\.?\d+$/.test(cleaned) ? Number(cleaned) : NaN;
    if (!Number.isFinite(n)) {
      // Same reasoning as VintageInput: the message is shown whether or not
      // the caller supplied an id.
      setError("Enter a valid amount.");
      return;
    }
    setError(null);
    if (n !== value) onCommit(n);
  };
  const input = (a11y?: FieldA11yProps) => (
    <FieldWrap low={low} edited={edited} invalid={error !== null}>
      <span className="shrink-0 text-control text-grey">$</span>
      <input
        aria-invalid={error !== null || undefined}
        aria-describedby={error !== null ? errorId : undefined}
        {...a11y}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        inputMode="decimal"
        aria-label={a11y ? undefined : "Unit cost"}
        // 17px keeps iOS from zooming the page on focus; 14px once there is
        // a pointer. Both are scale tokens (see add-wine-pricing.tsx).
        className="tabular min-h-11 w-full bg-transparent text-right text-body-lg font-medium text-ink outline-none md:text-control"
      />
    </FieldWrap>
  );

  return id && label ? (
    <Field id={id} label={label} error={error} srOnlyLabel={srOnlyLabel}>
      {(a11y) => input(a11y)}
    </Field>
  ) : (
    <BareField error={error} errorId={errorId}>
      {input()}
    </BareField>
  );
}

interface QtyStepperProps {
  value: number;
  onChange: (v: number) => void;
}

export function QtyStepper({ value, onChange }: QtyStepperProps) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-pill border border-rule-strong bg-surface-sunken">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-11 w-11 items-center justify-center text-grey hover:text-ink focus-ring-inset"
      >
        <Minus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </button>
      <span className="tabular min-w-10 text-center text-control font-medium text-ink">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(value + 1)}
        className="flex h-11 w-11 items-center justify-center text-grey hover:text-ink focus-ring-inset"
      >
        <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}

interface ThProps {
  children?: React.ReactNode;
  className?: string;
}

export function Th({ children, className }: ThProps) {
  return (
    <th
      scope="col"
      className={cn(
        "px-sm py-sm text-left text-caption font-medium uppercase tracking-[0.18em] text-grey",
        className,
      )}
    >
      {children}
    </th>
  );
}
