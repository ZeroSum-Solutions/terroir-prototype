import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhysicalBottleSummary } from "@/lib/wine-list/shapes";
import {
  PhysicalBottleSelector,
  resolvePhysicalBottleSelection,
} from "./physical-bottle-selector";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("PhysicalBottleSelector", () => {
  it("fails closed when a contract-2 row has no exact array", () => {
    expect(resolvePhysicalBottleSelection({
      contractVersion: 2,
      bottles: undefined,
      activeBottleCount: undefined,
      activeOpenMl: undefined,
      requestedBottleId: null,
    })).toEqual({ status: "invalid", selectedBottleId: null });
  });

  it("never substitutes a sibling for a stale requested bottle", () => {
    expect(resolvePhysicalBottleSelection({
      contractVersion: 2,
      bottles: [bottle("A", 600), bottle("B", 300)],
      activeBottleCount: 2,
      activeOpenMl: 900,
      requestedBottleId: "stale",
    })).toEqual({ status: "stale", selectedBottleId: null });
  });

  it("auto-selects exactly one bottle but requires a choice for two", () => {
    expect(resolvePhysicalBottleSelection({
      contractVersion: 2,
      bottles: [bottle("A", 600)],
      activeBottleCount: 1,
      activeOpenMl: 600,
      requestedBottleId: null,
    })).toEqual({ status: "ready", selectedBottleId: "A" });
    expect(resolvePhysicalBottleSelection({
      contractVersion: 2,
      bottles: [bottle("A", 600), bottle("B", 300)],
      activeBottleCount: 2,
      activeOpenMl: 900,
      requestedBottleId: null,
    })).toEqual({ status: "choice_required", selectedBottleId: null });
  });

  it("renders two distinct touch-sized choices and selects only the chosen id", async () => {
    const onSelect = vi.fn();
    await act(async () => root.render(
      <PhysicalBottleSelector
        bottles={[bottle("A", 600), bottle("B", 300)]}
        selectedBottleId={null}
        onSelect={onSelect}
      />,
    ));

    const choices = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(choices).toHaveLength(2);
    expect(choices[0].closest("label")?.className).toContain("min-h-11");
    await act(async () => choices[1].click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("B");
  });

  it("keeps collision-safe bottle identity and service context stable across sibling changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
    const secondId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
    const first = bottle(firstId, 300);
    const second = bottle(secondId, 300);

    await act(async () => root.render(
      <PhysicalBottleSelector bottles={[first, second]} selectedBottleId={null} onSelect={() => undefined} />,
    ));
    const firstLabel = inputLabel(firstId);
    const secondLabel = inputLabel(secondId);
    expect(firstLabel).not.toBe(secondLabel);
    expect(firstLabel).toContain("Bottle ID");
    expect(firstLabel?.match(/^Bottle ID ([^,]+)/)?.[1]).toHaveLength(25);
    expect(firstLabel).toContain("Opened 1d ago");
    expect(firstLabel).toContain("Argon");

    await act(async () => root.render(
      <PhysicalBottleSelector bottles={[second, first]} selectedBottleId={null} onSelect={() => undefined} />,
    ));
    expect(inputLabel(firstId)).toBe(firstLabel);
    expect(inputLabel(secondId)).toBe(secondLabel);

    await act(async () => root.render(
      <PhysicalBottleSelector bottles={[first]} selectedBottleId={firstId} onSelect={() => undefined} />,
    ));
    expect(inputLabel(firstId)).toBe(firstLabel);
  });

  it("does not invent capacity for a legacy bottle", async () => {
    await act(async () => root.render(
      <PhysicalBottleSelector
        bottles={[{ ...bottle("A", 375), nominalCapacityMl: null, identityContract: 1, identityOrigin: "legacy_slot", sourceProvenance: "legacy_unknown" }]}
        selectedBottleId="A"
        onSelect={() => undefined}
      />,
    ));
    expect(container.textContent).toContain("Captured capacity unavailable");
    expect(container.textContent).not.toContain("of 750");
  });
});

function inputLabel(id: string) {
  return container.querySelector<HTMLInputElement>(
    `#physical-open-bottle-${id}`,
  )?.getAttribute("aria-label");
}

function bottle(id: string, remainingMl: number): PhysicalBottleSummary {
  return {
    id,
    wineId: "wine-1",
    remainingMl,
    nominalCapacityMl: 750,
    openedAt: "2026-09-23T12:00:00.000Z",
    preservationMethod: "argon",
    sourceProvenance: "known",
    sourceBinLocation: "A-1",
    identityContract: 2,
    identityOrigin: "native",
    stateVersion: 1,
  };
}
