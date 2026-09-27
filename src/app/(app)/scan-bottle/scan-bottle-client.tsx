"use client";

import { List } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { readApiError } from "@/lib/api/client-error";
import { useRestaurant } from "@/lib/context/restaurant";
import { useBottleLocationReceive } from "@/domains/scanning/use-bottle-location-receive";
import { BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE } from "@/lib/api/bottle-location-receive-contract";
import { bottleScanReducer, initialBottleScanState, type MatchedWine } from "./scan-bottle-state";
import { ScanningView } from "./views/scanning-view";
import { NoCameraView } from "./views/no-camera-view";
import { ManualView } from "./views/manual-view";
import { MatchedView } from "./views/matched-view";
import { CorrectingView } from "./views/correcting-view";
import { LocationView } from "./views/location-view";
import { ConfirmedView } from "./views/confirmed-view";
import { ErrorView } from "./views/error-view";
import { SummaryView } from "./views/summary-view";
import { ReceivingRecoveryView } from "./views/receiving-recovery-view";
import { useActiveBins } from "./use-active-bins";

import { useQrScanner } from "./use-qr-scanner";

async function lookupWine(payload: string): Promise<MatchedWine> {
  const res = await fetch("/api/scan-bottle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qr_payload: payload }),
  });
  if (!res.ok) {
    throw new Error(
      readApiError(
        await res.json().catch(() => null),
        "Lookup failed (" + res.status + ")",
      ).message,
    );
  }
  return (await res.json()) as MatchedWine;
}

/**
 * `/api/wines/search` answers with a bare array on the projection in
 * src/app/api/wines/search/route.ts — which does not include `country`, so a
 * corrected wine carries none until it is re-read from the wine record.
 */
type WineSearchResult = Omit<MatchedWine, "country">;

async function searchWines(query: string): Promise<MatchedWine[]> {
  if (query.length < 2) return [];
  const res = await fetch("/api/wines/search?q=" + encodeURIComponent(query));
  if (!res.ok) {
    // A swallowed non-ok here is indistinguishable from "no such wine": this
    // call used to hit a route that does not exist and reported an empty
    // cellar for every query, silently, for as long as it was wrong.
    throw new Error(
      readApiError(
        await res.json().catch(() => null),
        "Search failed (" + res.status + ")",
      ).message,
    );
  }
  const wines = (await res.json()) as WineSearchResult[];
  return wines.map((wine) => ({ ...wine, country: null }));
}

export default function ScanBottleClient({ userId }: { userId: string | null }) {
  const { restaurantId } = useRestaurant();
  return <BottleReceivingSession key={`${userId}:${restaurantId}`} userId={userId} restaurantId={restaurantId} />;
}

function BottleReceivingSession({ userId, restaurantId }: { userId: string | null; restaurantId: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, dispatch] = useReducer(bottleScanReducer, initialBottleScanState);
  const { phase, error, wine, payload, manualCode, searchQuery, searchResults, searching, searchError, locationError, section, binLocation, binId, receivingWineId, session } = state;
  const bins = useActiveBins(phase === "location");
  const receiving = useBottleLocationReceive({ userId, restaurantId,
    onCommitted: (receipt) => dispatch({ type: "location-confirmed", scan: {
      operationId: receipt.operationId, wineId: receipt.wineId,
      wine: wine?.id.toLowerCase() === receipt.wineId.toLowerCase() ? wine : null,
      section: receipt.section, binLocation: receipt.binCode,
    } }),
    onReselect: (intent) => {
      dispatch({ type: "bin-reselection-required", wineId: intent.wine_id, section: intent.section,
        message: BOTTLE_LOCATION_BIN_UNAVAILABLE_MESSAGE });
      bins.reload();
    },
    onWineReselect: (section) => dispatch({ type: "wine-reselection-required", section }),
    onRecoveryCleared: () => dispatch({ type: "scan-again" }),
  });
  const recoveryRequired = receiving.state.phase !== "empty" || receiving.isSaving;

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: "camera-unavailable" });
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {
        dispatch({ type: "camera-unavailable" });
      });
  }, []);

  const handleDecode = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    dispatch({ type: "decode-started", payload: trimmed });
    try {
      const matched = await lookupWine(trimmed);
      dispatch({ type: "lookup-succeeded", wine: matched });
    } catch (err) {
      dispatch({
        type: "lookup-failed",
        message: err instanceof Error ? err.message : "Lookup failed.",
      });
    }
  }, []);

  useQrScanner(videoRef, phase === "scanning" && !recoveryRequired, handleDecode);

  const handleManualSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!manualCode.trim()) return;
      await handleDecode(manualCode);
    },
    [manualCode, handleDecode],
  );

  const handleCorrectSearch = useCallback(async (q: string) => {
    dispatch({ type: "correct-search-query-changed", query: q });
    if (q.length < 2) {
      return;
    }
    dispatch({ type: "correct-search-started" });
    try {
      const results = await searchWines(q);
      dispatch({ type: "correct-search-completed", results });
    } catch (err) {
      dispatch({
        type: "correct-search-failed",
        message: err instanceof Error ? err.message : "Search failed.",
      });
    }
  }, []);

  const handleCorrectSelect = useCallback((w: MatchedWine) => {
    dispatch({ type: "correct-wine-selected", wine: w });
  }, []);

  const handleScanAgain = useCallback(() => {
    dispatch({ type: "scan-again" });
  }, []);

  const handleConfirmLocation = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!receivingWineId || !section.trim() || recoveryRequired || bins.status !== "ready" || !bins.bins.some((bin) => bin.id === binId)) return;
      await receiving.save({ wine_id: receivingWineId, section: section.trim(), bin_id: binId });
    },
    [receivingWineId, section, binId, recoveryRequired, bins, receiving],
  );

  const handleEndSession = useCallback(() => {
    dispatch({ type: "session-ended" });
  }, []);

  const handleNewSession = useCallback(() => {
    dispatch({ type: "new-session-started" });
  }, []);

  const showSessionBadge = session.length > 0;

  return (
    <div className="mx-auto max-w-[480px]">
      <header className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-xl md:pt-2xl">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
              Scan · Bottle
            </p>
            <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink">
              Receive a bottle
            </h1>
            <p className="mt-sm max-w-[52ch] text-body text-ink-soft">
              Find the wine, select its bin, then receive one bottle into inventory.
            </p>
          </div>
          {showSessionBadge && phase !== "summary" && !recoveryRequired && (
            <div className="flex shrink-0 items-center gap-xs">
              <span className="inline-flex items-center gap-xs rounded-pill border border-rule-strong px-sm py-2xs text-caption font-medium uppercase tracking-[0.14em] text-ink-soft">
                <List className="h-3.5 w-3.5" strokeWidth={1.9} />
                <span className="tabular">{session.length}</span> received
              </span>
              <button
                type="button"
                onClick={handleEndSession}
                className="flex min-h-11 items-center gap-xs rounded-pill border border-rule-strong bg-transparent px-md text-caption font-medium uppercase tracking-[0.18em] text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
              >
                End session
              </button>
            </div>
          )}
        </div>
      </header>

      {recoveryRequired ? <ReceivingRecoveryView state={receiving.state} message={receiving.message}
        saving={receiving.isSaving} onRetry={() => void receiving.retry()} onRecheck={() => void receiving.recheck()} /> : <>
      {["scanning", "no-camera", "manual"].includes(phase) && <button type="button"
        onClick={() => dispatch({ type: "correction-started" })}
        className="mb-md min-h-12 w-full rounded-pill border border-rule-strong px-md text-control text-ink focus-ring">Find wine by name</button>}
      {/* BND-112: Summary view showing all scanned bottles */}
      {phase === "summary" && (
        <SummaryView session={session} onNewSession={handleNewSession} />
      )}

      {phase === "scanning" && (
        <ScanningView
          videoRef={videoRef}
          onEnterCode={() => dispatch({ type: "manual-entry-opened" })}
        />
      )}

      {phase === "no-camera" && (
        <NoCameraView onEnterCode={() => dispatch({ type: "no-camera-manual-entry" })} />
      )}

      {phase === "manual" && (
        <ManualView
          manualCode={manualCode}
          onManualCodeChange={(value) => dispatch({ type: "manual-code-changed", value })}
          onSubmit={handleManualSubmit}
          onUseCamera={() => dispatch({ type: "camera-entry-opened" })}
        />
      )}

      {phase === "matched" && wine && (
        <MatchedView
          wine={wine}
          onCorrect={() => dispatch({ type: "correction-started" })}
          onConfirm={() => dispatch({ type: "location-entry-started" })}
        />
      )}

      {phase === "correcting" && (
        <CorrectingView
          searchQuery={searchQuery}
          onSearchChange={handleCorrectSearch}
          searching={searching}
          searchResults={searchResults}
          searchError={searchError}
          onSelect={handleCorrectSelect}
          onCancel={() => dispatch({ type: wine ? "correction-cancelled" : "scan-again" })}
        />
      )}

      {phase === "location" && receivingWineId && (
        <LocationView
          wine={wine}
          section={section}
          binId={binId}
          bins={bins}
          onReloadBins={bins.reload}
          locationError={locationError ?? receiving.message}
          onSectionChange={(value) => dispatch({ type: "section-changed", value })}
          onBinSelect={(id) => dispatch({ type: "bin-selected", id })}
          onSubmit={handleConfirmLocation}
          onBack={() => dispatch({ type: wine ? "correction-cancelled" : "scan-again" })}
          confirming={receiving.isSaving}
        />
      )}

      {phase === "confirmed" && wine && (
        <ConfirmedView
          wine={wine}
          section={section}
          binLocation={binLocation}
          sessionCount={session.length}
          onScanAgain={handleScanAgain}
          onEndSession={handleEndSession}
        />
      )}

      {phase === "error" && (
        <ErrorView
          error={error}
          payload={payload}
          onTryAgain={handleScanAgain}
          onManualEntry={() => dispatch({ type: "manual-entry-opened" })}
        />
      )}
      </>}
    </div>
  );
}
