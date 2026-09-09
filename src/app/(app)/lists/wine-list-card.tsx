"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import {
  OverflowMenu,
  type OverflowMenuItem,
} from "@/components/overflow-menu";
import { TimeAgo } from "@/components/time-ago";
import type { WineListWithCount } from "@/lib/wine-list/types";

/**
 * A wine list, as a glass card (DESIGN.md — Components).
 *
 * Extracted from wine-list-landing.tsx so that page stays inside its source
 * budget; the behaviour is unchanged. Copy link and Open are ghost pills — the
 * everyday actions — and management sits behind the one 44px overflow circle
 * (GLOBAL-01; see the note in wine-list-landing.tsx).
 */

const ghostPillClassName =
  "inline-flex min-h-11 items-center gap-xs whitespace-nowrap rounded-pill border border-rule-strong bg-transparent px-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring";

/** The status seal (DESIGN.md — Status Seal): published reads ready, a draft
 *  is the achromatic at-peak wash, archived is the quiet muted stamp. */
function ListSeal({ list }: { list: WineListWithCount }) {
  const seal = list.archived
    ? { label: "Archived", tone: "bg-wash text-grey" }
    : list.is_published
      ? { label: "Published", tone: "bg-ready-wash text-ready-ink" }
      : { label: "Draft", tone: "bg-peak-wash text-peak-ink" };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2xs whitespace-nowrap rounded-pill px-sm py-2xs uppercase ${seal.tone}`}
    >
      <span className="text-caption font-medium tracking-[0.18em]">
        {seal.label}
      </span>
    </span>
  );
}

export function WineListCard({
  list,
  justCopied,
  manageActions,
  onOpen,
  onCopyLink,
}: {
  list: WineListWithCount;
  justCopied: boolean;
  manageActions: OverflowMenuItem[];
  onOpen: () => void;
  onCopyLink: () => void;
}) {
  const showCopyAction = list.is_published && list.slug;
  return (
    <article className="glass group rounded-card transition-transform hover:-translate-y-px">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-card p-md text-left focus-ring"
      >
        <div className="flex items-start justify-between gap-sm">
          <h3 className="font-serif text-subheading font-normal leading-tight text-ink group-hover:text-accent">
            {list.name}
          </h3>
          <ListSeal list={list} />
        </div>
        {list.description && (
          <p className="mt-xs line-clamp-2 text-body-sm text-ink-soft">
            {list.description}
          </p>
        )}
        <p className="mt-md uppercase text-grey">
          <span className="text-caption font-medium tracking-[0.18em]">
            <span className="tabular">{list.wine_count}</span> wines
            {" · "}
            {list.is_published ? (
              <>
                Published{" "}
                <TimeAgo iso={list.last_published_at ?? list.updated_at} />
              </>
            ) : (
              <>
                Updated <TimeAgo iso={list.updated_at} />
              </>
            )}
          </span>
        </p>
      </button>
      <div
        data-list-card-actions={list.id}
        className="flex items-center justify-between gap-xs border-t border-rule px-md py-sm"
      >
        <div className="flex min-w-0 items-center gap-xs">
          {showCopyAction && (
            <>
              <button
                type="button"
                onClick={onCopyLink}
                aria-label={`Copy public link for ${list.name}`}
                className={ghostPillClassName}
              >
                {justCopied ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                )}
                <span className="text-ledger">
                  {justCopied ? "Copied" : "Copy link"}
                </span>
              </button>
              <a
                href={`/list/${list.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open public ${list.name} list in a new tab`}
                className={ghostPillClassName}
              >
                <ExternalLink
                  className="h-3.5 w-3.5"
                  strokeWidth={1.9}
                  aria-hidden
                />
                <span className="text-ledger">Open</span>
              </a>
            </>
          )}
        </div>
        <OverflowMenu
          label={`More actions for ${list.name}`}
          items={manageActions}
        />
      </div>
    </article>
  );
}
