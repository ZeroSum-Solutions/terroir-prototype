import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useLayoutEffect } from "react";
import { cleanup, mount } from "@/test/render";
import { useActiveBins } from "./use-active-bins";

let latest: ReturnType<typeof useActiveBins>;
function Harness({ enabled = true }: { enabled?: boolean }) {
  const value = useActiveBins(enabled);
  useLayoutEffect(() => { latest = value; });
  return <div>{value.status}</div>;
}
afterEach(async () => { await cleanup(); vi.unstubAllGlobals(); });
const bin = { id: "11111111-1111-4111-8111-111111111111", code: "A-1", bottle_count: 5 };
describe("active receiving bins", () => {
  it("projects active-bin identity and labels from the cost-free endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([bin])); vi.stubGlobal("fetch", fetcher);
    await mount(<Harness />);
    expect(fetcher).toHaveBeenCalledWith("/api/bins", expect.objectContaining({ cache: "no-store" }));
    expect(latest).toMatchObject({ status: "ready", bins: [{ id: bin.id, code: "A-1" }] });
    expect(latest.bins[0]).not.toHaveProperty("bottle_count");
  });
  it.each([[{ ...bin, id: "A-1" }], [bin, bin]])("rejects malformed or duplicate identities", async (...rows) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(rows)));
    await mount(<Harness />); expect(latest.status).toBe("error"); expect(latest.bins).toEqual([]);
  });
  it("exposes failures and permits an explicit refresh", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValueOnce(Response.json([bin]));
    vi.stubGlobal("fetch", fetcher); await mount(<Harness />); expect(latest.status).toBe("error");
    await act(async () => latest.reload()); expect(latest.status).toBe("ready"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not request bins outside the location step", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await mount(<Harness enabled={false} />);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts the request when its context unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, options) => { signal = options.signal; return new Promise(() => {}); }));
    await mount(<Harness />); await cleanup(); expect(signal?.aborted).toBe(true);
  });
});
