import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PourActionBar } from "./pour-action-bar";
import { baseRow } from "./test-row";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent?.trim() === text);
}

describe("PourActionBar", () => {
  it("keeps Open another bottle enabled in physical mode", async () => {
    const doOpenBottle = vi.fn();
    await act(async () => root.render(
      <PourActionBar
        row={baseRow({ sealed_count: 3, activeBottleCount: 1 })}
        contractVersion={2}
        canPour
        outOfStock={false}
        pickerItem={null}
        busy={false}
        openBottleBusy={false}
        lastPour={null}
        doOpenBottle={doOpenBottle}
        doPour={vi.fn()}
        doUndo={vi.fn()}
        onOpenPicker={vi.fn()}
      />,
    ));
    expect(button("Open another bottle")?.disabled).toBe(false);
    await act(async () => button("Open another bottle")!.click());
    expect(doOpenBottle).toHaveBeenCalledOnce();
  });

  it("shows a disabled selection requirement instead of choosing a sibling", async () => {
    await act(async () => root.render(
      <PourActionBar
        row={baseRow({ sealed_count: 0, glass_pour_ml: 150, activeBottleCount: 2 })}
        contractVersion={2}
        canPour={false}
        requiresBottleSelection
        outOfStock={false}
        pickerItem={null}
        busy={false}
        openBottleBusy={false}
        lastPour={null}
        doOpenBottle={vi.fn()}
        doPour={vi.fn()}
        doUndo={vi.fn()}
        onOpenPicker={vi.fn()}
      />,
    ));
    expect(button("Select a bottle")?.disabled).toBe(true);
  });

  it("renders only Open bottle when the wine cannot be poured", async () => {
    const doOpenBottle = vi.fn();
    await act(async () => {
      root.render(
        <PourActionBar
          row={baseRow({
            sealed_count: 2,
            glass_pour_ml: null,
            open_bottle_id: null,
            opened_at: null,
          })}
          canPour={false}
          outOfStock={false}
          pickerItem={null}
          busy={false}
          openBottleBusy={false}
          lastPour={null}
          doOpenBottle={doOpenBottle}
          doPour={vi.fn()}
          doUndo={vi.fn()}
          onOpenPicker={vi.fn()}
        />,
      );
    });

    expect(button("Open bottle")).toBeDefined();
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent?.startsWith("Pour")),
    ).toBe(false);

    await act(async () => {
      button("Open bottle")!.click();
    });
    expect(doOpenBottle).toHaveBeenCalledOnce();
  });

  it("shows a disabled truthful state when a lifecycle is already open", async () => {
    const doOpenBottle = vi.fn();
    await act(async () => {
      root.render(
        <PourActionBar
          row={baseRow({ sealed_count: 6, glass_pour_ml: null })}
          canPour={false}
          outOfStock={false}
          pickerItem={null}
          busy={false}
          openBottleBusy={false}
          lastPour={null}
          doOpenBottle={doOpenBottle}
          doPour={vi.fn()}
          doUndo={vi.fn()}
          onOpenPicker={vi.fn()}
        />,
      );
    });

    const activeState = button("Bottle already open")!;
    expect(activeState.disabled).toBe(true);
    activeState.click();
    expect(doOpenBottle).not.toHaveBeenCalled();
    expect(button("Open bottle")).toBeUndefined();
  });

  it("calls doPour with the glass pour size", async () => {
    const doPour = vi.fn();
    await act(async () => {
      root.render(
        <PourActionBar
          row={baseRow({ sealed_count: 0, glass_pour_ml: 150 })}
          canPour={true}
          outOfStock={false}
          pickerItem={null}
          busy={false}
          openBottleBusy={false}
          lastPour={null}
          doOpenBottle={vi.fn()}
          doPour={doPour}
          doUndo={vi.fn()}
          onOpenPicker={vi.fn()}
        />,
      );
    });

    const pourButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Pour"),
    )!;
    await act(async () => {
      pourButton.click();
    });
    expect(doPour).toHaveBeenCalledWith(150);
  });

  it("makes an unresolved pour an explicit retry and blocks the size picker", async () => {
    const doPour = vi.fn();
    const retryPriorPour = vi.fn();
    await act(async () => root.render(
      <PourActionBar
        row={baseRow({ sealed_count: 0, glass_pour_ml: 150, pour_size_mode: "picker" })}
        canPour
        outOfStock={false}
        pickerItem={{}}
        busy={false}
        openBottleBusy={false}
        pourNeedsReview
        lastPour={null}
        doOpenBottle={vi.fn()}
        doPour={doPour}
        retryPriorPour={retryPriorPour}
        doUndo={vi.fn()}
        onOpenPicker={vi.fn()}
      />,
    ));

    await act(async () => button("Retry prior pour")!.click());
    expect(retryPriorPour).toHaveBeenCalledOnce();
    expect(doPour).not.toHaveBeenCalled();
    expect(container.querySelector(
      'button[aria-label="Pick a custom pour size"]',
    )).toBeNull();
  });

  it("keeps open recovery reachable after stock and lifecycle state change", async () => {
    const retryPriorOpen = vi.fn();
    await act(async () => root.render(
      <PourActionBar
        row={baseRow({ sealed_count: 0, glass_pour_ml: null })}
        canPour={false}
        outOfStock
        pickerItem={null}
        busy={false}
        openBottleBusy={false}
        openNeedsReview
        lastPour={null}
        doOpenBottle={vi.fn()}
        doPour={vi.fn()}
        retryPriorOpen={retryPriorOpen}
        doUndo={vi.fn()}
        onOpenPicker={vi.fn()}
      />,
    ));

    await act(async () => button("Retry prior open")!.click());
    expect(retryPriorOpen).toHaveBeenCalledOnce();
  });

  it("shows receipt-bound Undo even after physical availability changes", async () => {
    const doUndo = vi.fn();
    await act(async () => {
      root.render(
        <PourActionBar
          row={baseRow({ sealed_count: 0, glass_pour_ml: 150 })}
          contractVersion={2}
          canPour={false}
          outOfStock={false}
          pickerItem={null}
          busy={false}
          openBottleBusy={false}
          lastPour={{
            contractVersion: 2,
            wineId: "55555555-5555-4555-8555-555555555555",
            bottleId: "66666666-6666-4666-8666-666666666666",
            eventId: "77777777-7777-4777-8777-777777777777",
            ml: 150,
          }}
          doOpenBottle={vi.fn()}
          doPour={vi.fn()}
          doUndo={doUndo}
          onOpenPicker={vi.fn()}
        />,
      );
    });

    const undoButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Undo last pour"),
    )!;
    expect(undoButton).toBeDefined();
    await act(async () => {
      undoButton.click();
    });
    expect(doUndo).toHaveBeenCalledOnce();
  });

  it.each([1, 2] as const)("keeps contract-%i unresolved Undo reachable without a current receipt", async (contractVersion) => {
    const retryPriorUndo = vi.fn();
    await act(async () => root.render(
      <PourActionBar
        row={baseRow({ sealed_count: 0, glass_pour_ml: null })}
        contractVersion={contractVersion}
        canPour={false}
        outOfStock={false}
        pickerItem={null}
        busy={false}
        openBottleBusy={false}
        undoNeedsReview
        lastPour={null}
        doOpenBottle={vi.fn()}
        doPour={vi.fn()}
        doUndo={vi.fn()}
        retryPriorUndo={retryPriorUndo}
        onOpenPicker={vi.fn()}
      />,
    ));
    await act(async () => button("Retry prior Undo")!.click());
    expect(retryPriorUndo).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "open", flags: { openNeedsReview: true }, label: "Retry prior open" },
    { name: "pour", flags: { pourNeedsReview: true }, label: "Retry prior pour" },
    { name: "Undo", flags: { undoNeedsReview: true }, label: "Retry prior Undo" },
  ])("keeps only the retained $name retry when fresh physical state is invalid", async ({ flags, label }) => {
    const retry = vi.fn();
    await act(async () => root.render(
      <PourActionBar
        row={baseRow({ sealed_count: 3, glass_pour_ml: 150, activeBottleCount: 1, pour_size_mode: "picker" })}
        contractVersion={2}
        canPour
        freshActionsAvailable={false}
        outOfStock={false}
        pickerItem={{}}
        busy={false}
        openBottleBusy={false}
        lastPour={{ contractVersion: 2, wineId: "55555555-5555-4555-8555-555555555555",
          bottleId: "66666666-6666-4666-8666-666666666666",
          eventId: "77777777-7777-4777-8777-777777777777", ml: 150 }}
        {...flags}
        doOpenBottle={vi.fn()}
        doPour={vi.fn()}
        doUndo={vi.fn()}
        retryPriorOpen={retry}
        retryPriorPour={retry}
        retryPriorUndo={retry}
        onOpenPicker={vi.fn()}
      />,
    ));

    expect(button(label)).toBeDefined();
    expect(button("Open another bottle")).toBeUndefined();
    expect(button("Pour 5.1 oz")).toBeUndefined();
    expect(button("Undo last pour (5.1 oz)")).toBeUndefined();
    expect(container.querySelector('button[aria-label="Pick a custom pour size"]')).toBeNull();
    await act(async () => button(label)!.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("exposes the custom picker when fresh physical actions are available", async () => {
    const onOpenPicker = vi.fn();
    await act(async () => root.render(
      <PourActionBar
        row={baseRow({ sealed_count: 3, glass_pour_ml: 150, activeBottleCount: 1, pour_size_mode: "picker" })}
        contractVersion={2}
        canPour
        freshActionsAvailable
        outOfStock={false}
        pickerItem={{}}
        busy={false}
        openBottleBusy={false}
        lastPour={null}
        doOpenBottle={vi.fn()}
        doPour={vi.fn()}
        doUndo={vi.fn()}
        onOpenPicker={onOpenPicker}
      />,
    ));
    const picker = container.querySelector<HTMLButtonElement>('button[aria-label="Pick a custom pour size"]');
    expect(picker).not.toBeNull();
    await act(async () => picker!.click());
    expect(onOpenPicker).toHaveBeenCalledOnce();
  });

  it("preserves the legacy canPour gate for version-1 Undo", async () => {
    await act(async () => root.render(
      <PourActionBar
        row={baseRow({ glass_pour_ml: 150 })}
        contractVersion={1}
        canPour={false}
        outOfStock={false}
        pickerItem={null}
        busy={false}
        openBottleBusy={false}
        lastPour={{
          contractVersion: 1,
          wineId: "55555555-5555-4555-8555-555555555555",
          ml: 150,
        }}
        doOpenBottle={vi.fn()}
        doPour={vi.fn()}
        doUndo={vi.fn()}
        onOpenPicker={vi.fn()}
      />,
    ));
    expect(button("Undo last pour (5.1 oz)")).toBeUndefined();
  });

  it("disables the pour button and shows Out of stock when out of stock", async () => {
    await act(async () => {
      root.render(
        <PourActionBar
          row={baseRow({ sealed_count: 0, glass_pour_ml: 150 })}
          canPour={true}
          outOfStock={true}
          pickerItem={null}
          busy={false}
          openBottleBusy={false}
          lastPour={null}
          doOpenBottle={vi.fn()}
          doPour={vi.fn()}
          doUndo={vi.fn()}
          onOpenPicker={vi.fn()}
        />,
      );
    });
    const pourButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Out of stock",
    )!;
    expect(pourButton).toBeDefined();
    expect(pourButton.disabled).toBe(true);
  });
});
