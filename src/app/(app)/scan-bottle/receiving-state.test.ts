import { describe, expect, it } from "vitest";
import { bottleScanReducer, initialBottleScanState } from "./scan-bottle-state";

const scan = { operationId: "abcdef", wineId: "wine-1", wine: null, section: "Cellar", binLocation: "A-1" };
describe("receiving session state", () => {
  it("counts a replay once and uses the server bin code", () => {
    const first = bottleScanReducer(initialBottleScanState, { type: "location-confirmed", scan });
    const replay = bottleScanReducer(first, { type: "location-confirmed", scan: { ...scan, operationId: "ABCDEF" } });
    expect(replay.session).toEqual([scan]);
    expect(replay.binLocation).toBe("A-1");
  });
  it("shows a recovered receipt in summary without inventing wine metadata", () => {
    const state = bottleScanReducer(initialBottleScanState, { type: "location-confirmed", scan });
    expect(state.phase).toBe("summary");
    expect(state.wine).toBeNull();
  });
  it("requires explicit bin reselection while retaining the wine and section intent", () => {
    const state = bottleScanReducer({ ...initialBottleScanState, binId: "old", binLocation: "old code" }, {
      type: "bin-reselection-required", wineId: "wine-1", section: "Cellar", message: "Select an active bin.",
    });
    expect(state).toMatchObject({ phase: "location", receivingWineId: "wine-1", section: "Cellar", binId: "", binLocation: "", wine: null });
  });
  it("clears selected bin and receiving identity for a new bottle", () => {
    const state = bottleScanReducer({ ...initialBottleScanState, binId: "old", receivingWineId: "old" }, { type: "scan-again" });
    expect(state.binId).toBe("");
    expect(state.receivingWineId).toBeNull();
  });
});
