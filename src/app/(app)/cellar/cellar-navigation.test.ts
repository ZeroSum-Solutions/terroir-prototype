import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveBottleNavigation,
  resolveCellarNavigationIntent,
  useBottleNavigationState,
} from "./cellar-navigation";

describe("resolveCellarNavigationIntent", () => {
  const wineIds = new Set(["wine-1"]);

  it("opens the live-pour view for the Pour FAB action", () => {
    expect(resolveCellarNavigationIntent("pour", null, wineIds)).toEqual({
      filter: "open",
      selectedWineId: null,
      shouldFocusSearch: true,
      shouldConsumeParams: true,
    });
  });

  it("opens search for the 86 FAB action", () => {
    expect(resolveCellarNavigationIntent("eightysix", null, wineIds)).toEqual({
      filter: null,
      selectedWineId: null,
      shouldFocusSearch: true,
      shouldConsumeParams: true,
    });
  });

  it("selects only wines that exist in the current cellar", () => {
    expect(resolveCellarNavigationIntent(null, "wine-1", wineIds).selectedWineId).toBe("wine-1");
    expect(resolveCellarNavigationIntent(null, "missing-wine", wineIds).selectedWineId).toBeNull();
  });

  it("EV-4.3: keeps wine deep links persistent instead of consuming them", () => {
    expect(resolveCellarNavigationIntent(null, "wine-1", wineIds)).toEqual({
      filter: null,
      selectedWineId: "wine-1",
      shouldFocusSearch: false,
      shouldConsumeParams: false,
    });
  });
});

describe("resolveBottleNavigation", () => {
  const bottleIds = new Set(["bottle-a", "bottle-b"]);

  it("keeps an exact bottle that belongs to the selected wine", () => {
    expect(resolveBottleNavigation("bottle-b", bottleIds)).toEqual({
      selectedBottleId: "bottle-b",
      stale: false,
    });
  });

  it("clears a stale id without choosing a sibling", () => {
    expect(resolveBottleNavigation("closed-bottle", bottleIds)).toEqual({
      selectedBottleId: null,
      stale: true,
    });
  });

  it("holds a just-opened id until the refreshed exact snapshot arrives", () => {
    expect(resolveBottleNavigation("bottle-c", bottleIds, "bottle-c")).toEqual({
      selectedBottleId: "bottle-c",
      stale: false,
    });
    expect(resolveBottleNavigation("bottle-c", bottleIds)).toEqual({
      selectedBottleId: null,
      stale: true,
    });
  });
});

describe("useBottleNavigationState", () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof useBottleNavigationState>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses the latest rows token when an older pending-open callback resolves", async () => {
    const firstRows: readonly unknown[] = [];
    const refreshedRows: readonly unknown[] = [];
    const validatedRows: readonly unknown[] = [];
    const replaceUrlState = vi.fn();
    const render = async (
      rowsToken: readonly unknown[],
      requestedBottleId: string | null,
      bottleIds: string[],
    ) => act(async () => root.render(createElement(Harness, {
      rowsToken, requestedBottleId, bottleIds, replaceUrlState,
    })));
    function Harness(props: {
      rowsToken: readonly unknown[];
      requestedBottleId: string | null;
      bottleIds: string[];
      replaceUrlState: (patch: { bottle: string | null }) => void;
    }) {
      current = useBottleNavigationState(props);
      return null;
    }

    await render(firstRows, null, ["bottle-a"]);
    const pendingOpenCallback = current!.selectOpenedBottle;
    await render(refreshedRows, null, ["bottle-a"]);
    await act(async () => pendingOpenCallback("bottle-b"));
    await render(refreshedRows, "bottle-b", ["bottle-a"]);

    expect(current!.selectedBottleId).toBe("bottle-b");
    expect(replaceUrlState).not.toHaveBeenCalledWith({ bottle: null });

    await render(validatedRows, "bottle-b", ["bottle-a", "bottle-b"]);
    expect(current!.selectedBottleId).toBe("bottle-b");
  });
});
