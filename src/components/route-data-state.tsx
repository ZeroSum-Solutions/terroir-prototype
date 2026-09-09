"use client";

import type { ReactNode } from "react";

/**
 * The three route-level data states, in the Obsidian Glass material
 * (DESIGN.md — Components, Glass Panel; Surfaces level 1). Each is a floating
 * panel rather than a bordered box: `.glass` carries its own hairline edge and
 * inset top highlight, so nothing here draws a border or a shadow of its own.
 */
export function RouteDataLoading({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="glass rounded-card p-lg text-grey"
    >
      <p className="text-control">{label}</p>
      {children}
    </div>
  );
}

export function RouteDataError({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}): ReactNode {
  return (
    <section role="alert" className="glass rounded-card p-lg text-ink">
      <h2 className="font-serif text-subheading font-normal leading-[1.2] text-ink">
        {title}
      </h2>
      <p className="mt-xs text-body-sm text-grey">{description}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-md inline-flex min-h-11 items-center rounded-pill bg-primary px-lg text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
      >
        Try again
      </button>
    </section>
  );
}

export function RouteDataEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <section
      aria-label={title}
      className="glass rounded-card p-xl text-center text-ink"
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
        {icon}
      </div>
      <h2 className="mt-md font-serif text-subheading font-normal leading-[1.2] text-ink">
        {title}
      </h2>
      <p className="mt-xs text-body-sm text-grey">{description}</p>
      {action ? <div className="mt-lg">{action}</div> : null}
    </section>
  );
}
