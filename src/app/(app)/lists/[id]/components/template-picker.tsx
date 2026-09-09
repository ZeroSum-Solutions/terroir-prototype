"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { TEMPLATES, type Template } from "@/lib/wine-list/types";

interface TemplatePickerProps {
  current: string;
  onChange: (template: Template) => void;
  disabled?: boolean;
  ariaLabelledby?: string;
}

export function TemplatePicker({
  current,
  onChange,
  disabled,
  ariaLabelledby,
}: TemplatePickerProps) {
  return (
    <div
      role="group"
      aria-labelledby={ariaLabelledby}
      className="flex flex-col gap-2xs"
    >
      {TEMPLATES.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          disabled={disabled}
          aria-pressed={current === t}
          className={cn(
            "flex min-h-11 items-center justify-between rounded-pill border px-md py-xs transition-colors focus-ring disabled:pointer-events-none",
            current === t
              ? "border-accent font-medium text-accent"
              : "border-transparent text-grey hover:text-ink",
          )}
        >
          <span className="text-control">
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </span>
          {current === t && (
            <Check
              className="h-3.5 w-3.5 text-accent"
              strokeWidth={1.9}
            />
          )}
        </button>
      ))}
    </div>
  );
}
