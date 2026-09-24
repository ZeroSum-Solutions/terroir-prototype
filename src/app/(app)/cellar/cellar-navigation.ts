import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CellarUrlState } from "@/lib/cellar-facets/url-state";
import type { CellarWineRow } from "./types";

export type CellarNavigationIntent = {
  filter: "open" | null;
  selectedWineId: string | null;
  shouldFocusSearch: boolean;
  shouldConsumeParams: boolean;
};

/**
 * Translate the short-lived `mode` parameter used by the mobile FAB while
 * treating `wine` as persistent, shareable Cellar state.
 */
export function resolveCellarNavigationIntent(
  mode: string | null,
  wineId: string | null,
  wineIds: ReadonlySet<string>,
): CellarNavigationIntent {
  const shouldFocusSearch = mode === "pour" || mode === "eightysix";

  return {
    filter: mode === "pour" ? "open" : null,
    selectedWineId: wineId && wineIds.has(wineId) ? wineId : null,
    shouldFocusSearch,
    shouldConsumeParams: Boolean(mode),
  };
}

export function resolveBottleNavigation(
  requestedBottleId: string | null,
  bottleIds: ReadonlySet<string>,
  provisionalBottleId: string | null = null,
) {
  if (!requestedBottleId) {
    return { selectedBottleId: null, stale: false };
  }
  if (!bottleIds.has(requestedBottleId) && requestedBottleId !== provisionalBottleId) {
    return { selectedBottleId: null, stale: true };
  }
  return { selectedBottleId: requestedBottleId, stale: false };
}

export function useBottleNavigationState(input: {
  requestedBottleId: string | null;
  bottleIds: string[];
  rowsToken: readonly unknown[];
  replaceUrlState: (patch: { bottle: string | null }) => void;
}) {
  const { requestedBottleId, bottleIds, rowsToken, replaceUrlState } = input;
  const [message, setMessage] = useState<string | null>(null);
  const [provisional, setProvisional] = useState<{
    id: string;
    rowsToken: readonly unknown[];
  } | null>(null);
  const latestRowsToken = useRef(rowsToken);
  useLayoutEffect(() => {
    latestRowsToken.current = rowsToken;
  }, [rowsToken]);
  const navigation = resolveBottleNavigation(
    requestedBottleId,
    new Set(bottleIds),
    provisional?.rowsToken === rowsToken ? provisional.id : null,
  );

  useEffect(() => {
    if (!provisional || provisional.rowsToken === rowsToken) return;
    const frame = requestAnimationFrame(() => setProvisional(null));
    return () => cancelAnimationFrame(frame);
  }, [provisional, rowsToken]);
  useEffect(() => {
    if (!navigation.stale) return;
    const frame = requestAnimationFrame(() => {
      setMessage("The selected bottle is no longer available. Choose an open bottle.");
      replaceUrlState({ bottle: null });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation.stale, replaceUrlState]);

  const selectBottle = useCallback((bottleId: string) => {
    setProvisional(null);
    setMessage(null);
    replaceUrlState({ bottle: bottleId });
  }, [replaceUrlState]);
  const selectOpenedBottle = useCallback((bottleId: string) => {
    setProvisional({ id: bottleId, rowsToken: latestRowsToken.current });
    setMessage(null);
    replaceUrlState({ bottle: bottleId });
  }, [replaceUrlState]);
  const markBottleStale = useCallback((nextMessage: string) => {
    setProvisional(null);
    setMessage(nextMessage);
    replaceUrlState({ bottle: null });
  }, [replaceUrlState]);
  const resetBottleNavigation = useCallback(() => {
    setProvisional(null);
    setMessage(null);
  }, []);

  return {
    selectedBottleId: navigation.selectedBottleId,
    message,
    selectBottle,
    selectOpenedBottle,
    markBottleStale,
    resetBottleNavigation,
  };
}

export function useCellarSelectionNavigation(input: {
  rows: CellarWineRow[];
  wineId: string | null;
  bottleId: string | null;
  applyUrlState: (patch: Partial<CellarUrlState>, mode: "replace" | "push") => void;
  replaceUrlState: (patch: Partial<CellarUrlState>) => void;
}) {
  const { rows, wineId, bottleId, applyUrlState, replaceUrlState } = input;
  const selected = useMemo(
    () => wineId
      ? rows.find((row) => row.wine_id === wineId) ?? null
      : null,
    [rows, wineId],
  );
  const bottle = useBottleNavigationState({
    requestedBottleId: bottleId,
    bottleIds: Array.isArray(selected?.activeBottles)
      ? selected.activeBottles.map((item) => item.id)
      : [],
    rowsToken: rows,
    replaceUrlState,
  });
  const { resetBottleNavigation } = bottle;
  const openWine = useCallback((nextWineId: string) => {
    resetBottleNavigation();
    applyUrlState({ wine: nextWineId, bottle: null }, "push");
  }, [applyUrlState, resetBottleNavigation]);
  const closeWine = useCallback(() => {
    resetBottleNavigation();
    replaceUrlState({ wine: null, bottle: null });
  }, [replaceUrlState, resetBottleNavigation]);
  useEffect(() => {
    if (wineId && !selected) closeWine();
  }, [closeWine, selected, wineId]);
  return { selected, openWine, closeWine, ...bottle };
}
