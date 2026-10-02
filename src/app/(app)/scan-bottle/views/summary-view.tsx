"use client";

import { Camera, MapPin } from "lucide-react";
import Link from "next/link";
import type { SessionScan } from "../scan-bottle-state";
import { wineDisplayName } from "@/lib/wine-display-name";

interface SummaryViewProps {
  session: SessionScan[];
  onNewSession: () => void;
}

export function SummaryView({ session, onNewSession }: SummaryViewProps) {
  return (
    <div className="space-y-md">
      <div className="rounded-card card-surface p-md md:p-lg">
        <h2 className="font-serif text-heading-sm font-normal text-ink">Session summary</h2>
        <p className="mt-xs text-body-sm text-ink-soft">
          {session.length} bottle{session.length !== 1 ? "s" : ""} received
          in this session.
        </p>
      </div>

      {session.length > 0 ? (
        <ul className="divide-y divide-rule rounded-card card-surface">
          {session.map((scan, i) => (
            <li key={scan.operationId} className="px-md py-md">
              <div className="flex items-start justify-between gap-sm">
                <div className="min-w-0">
                  <p className="truncate font-serif text-body-lg font-medium text-ink">
                    {scan.wine?.producer ?? "Recovered bottle receipt"}
                  </p>
                  <p className="truncate text-body-sm text-grey">
                    {scan.wine ? wineDisplayName(scan.wine.producer, scan.wine.name) : "Saved inventory confirmed. Open the wine to view its details."}
                    {scan.wine?.vintage ? " (" + scan.wine.vintage + ")" : ""}
                  </p>
                </div>
                <span className="tabular shrink-0 rounded-pill border border-rule-strong px-sm py-2xs text-caption font-medium text-grey">
                  #{i + 1}
                </span>
              </div>
              <p className="mt-xs inline-flex items-center gap-xs text-ledger text-grey">
                <MapPin className="h-3 w-3" strokeWidth={2} />
                {scan.section}{" "}
                <span aria-hidden>&middot;</span>{" "}
                {scan.binLocation}
              </p>
              <Link href={`/cellar/${scan.wineId}`} className="flex min-h-11 items-center text-control text-accent focus-ring">View wine</Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-md rounded-card card-surface px-lg py-2xl text-center">
          <p className="text-body-sm text-grey">
            No bottles were received in this session.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onNewSession}
        className="flex h-12 w-full items-center justify-center gap-sm rounded-pill bg-primary text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
      >
        <Camera className="h-4 w-4" strokeWidth={2} />
        Start new session
      </button>
    </div>
  );
}
