import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PartialBottleCloseout } from "./partial-bottle-closeout";

const mockToastSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: mockToastSuccess, error: vi.fn(), toast: vi.fn() }),
}));

const closeoutBody = {
  closeout: {
    id: "77777777-7777-4777-8777-777777777777",
    open_bottle_id: "b1b2c3d4-e5f6-4789-8abc-def012345678",
    wine_id: "55555555-5555-4555-8555-555555555555",
  },
};

describe("PartialBottleCloseout", () => {
  it("EV-10.1/10.2: shows live theoretical remaining and closeout inputs with spoilage reasons", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <PartialBottleCloseout
        bottle={{
          id: "b-1",
          wineId: "w-1",
          openedAt: "2026-09-23T12:00:00.000Z",
          theoreticalRemainingMl: 515,
          preservationMethod: "coravin",
          openedBy: "u-1",
        }}
        reasons={[{ id: "reason-1", label: "Spoiled", category: "spoilage" }]}
      />,
    );

    expect(document.body.textContent).toContain("515 ml theoretical remaining");
    expect(document.body.textContent).toContain("Coravin");
    expect(document.querySelector('input[name="actual_remaining_ml"]')).not.toBeNull();
    expect(document.querySelector('input[name="written_off_ml"]')).not.toBeNull();
    expect(document.querySelector('option[value="reason-1"]')?.textContent).toBe("Spoiled");
  });

  it("never renders the raw opened-by user id — a UUID must never leak into the UI", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <PartialBottleCloseout
        bottle={{
          id: "b-1",
          wineId: "w-1",
          openedAt: "2026-09-23T12:00:00.000Z",
          theoreticalRemainingMl: 515,
          preservationMethod: "coravin",
          openedBy: "d88b0a20-4b1e-4a3b-9c2f-1a2b3c4d5e6f",
        }}
        reasons={[]}
      />,
    );

    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(document.body.textContent).toContain("opened");
  });

  it("keeps every close-out control at least 44px tall", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <PartialBottleCloseout
        bottle={{
          id: "b-1",
          wineId: "w-1",
          openedAt: "2026-09-23T12:00:00.000Z",
          theoreticalRemainingMl: 515,
          preservationMethod: "coravin",
          openedBy: "u-1",
        }}
        reasons={[{ id: "reason-1", label: "Spoiled", category: "spoilage" }]}
      />,
    );

    for (const control of document.querySelectorAll<HTMLElement>("input, select, button")) {
      expect(control.className).toContain("h-11");
    }
  });

  it("submits the exact lifecycle version with a client operation UUID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(closeoutBody), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = "";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PartialBottleCloseout
          bottle={{
            id: "b1b2c3d4-e5f6-4789-8abc-def012345678",
            wineId: "w-1",
            openedAt: "2026-09-23T12:00:00.000Z",
            theoreticalRemainingMl: 515,
            preservationMethod: "coravin",
            openedBy: "u-1",
          }}
          reasons={[]}
        />,
      );
    });
    const close = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent === "Close bottle")!;
    await act(async () => close.click());

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.parse(String(init?.body))).toEqual({
      open_bottle_id: "b1b2c3d4-e5f6-4789-8abc-def012345678",
      expected_opened_at: "2026-09-23T12:00:00.000Z",
      actual_remaining_ml: 515,
      written_off_ml: 0,
    });
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("reuses the operation UUID after a proxy 503", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(closeoutBody), {
          status: 201,
          headers: {
            "content-type": "application/json",
            "Idempotency-Replayed": "true",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = "";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const bottle = {
      id: "b1b2c3d4-e5f6-4789-8abc-def012345678",
      wineId: "w-1",
      openedAt: "2026-09-23T12:00:00.000Z",
      theoreticalRemainingMl: 515,
      preservationMethod: "coravin" as const,
      openedBy: "u-1",
    };

    await act(async () => root.render(
      <PartialBottleCloseout bottle={bottle} reasons={[]} />,
    ));
    const close = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => ["Close bottle", "Retry prior action"].includes(
        item.textContent ?? "",
      ))!;
    await act(async () => close().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Close-out not confirmed. This may already be recorded. Retry the prior action to check; do not close it again.",
    );
    await act(async () => close().click());

    const first = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const retry = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(retry.get("Idempotency-Key")).toBe(first.get("Idempotency-Key"));
    expect(mockToastSuccess).toHaveBeenCalledWith("Already recorded");
    expect(container.textContent).not.toContain("Close-out not confirmed");
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("retains the operation UUID for a malformed success payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(closeoutBody), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = "";
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const bottle = {
      id: "b1b2c3d4-e5f6-4789-8abc-def012345678",
      wineId: "w-1",
      openedAt: "2026-09-23T12:00:00.000Z",
      theoreticalRemainingMl: 515,
      preservationMethod: "coravin" as const,
      openedBy: "u-1",
    };

    await act(async () => root.render(
      <PartialBottleCloseout bottle={bottle} reasons={[]} />,
    ));
    const close = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => ["Close bottle", "Retry prior action"].includes(
        item.textContent ?? "",
      ))!;
    await act(async () => close().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Close-out not confirmed. This may already be recorded. Retry the prior action to check; do not close it again.",
    );
    expect(close().textContent).toBe("Retry prior action");
    expect(container.querySelector<HTMLInputElement>(
      'input[name="actual_remaining_ml"]',
    )?.disabled).toBe(true);
    await act(async () => close().click());

    const first = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const retry = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(retry.get("Idempotency-Key")).toBe(first.get("Idempotency-Key"));
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("freezes the selected physical bottle, wine, values, reason, and UUID for retry", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce(new Response(JSON.stringify(closeoutBody), {
        status: 201, headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const bottle = (id: string, wineId: string, remaining: number) => ({
      id, wineId, openedAt: "2026-09-23T12:00:00.000Z",
      theoreticalRemainingMl: remaining, preservationMethod: "argon" as const,
      openedBy: null, identityContract: 2 as const,
    });
    await act(async () => root.render(<PartialBottleCloseout
      bottle={bottle("b1b2c3d4-e5f6-4789-8abc-def012345678", "55555555-5555-4555-8555-555555555555", 515)}
      reasons={[]} />));
    const action = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => ["Close bottle", "Retry prior action"].includes(item.textContent ?? ""))!;
    await act(async () => action().click());
    await act(async () => root.render(<PartialBottleCloseout
      bottle={bottle("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "99999999-9999-4999-8999-999999999999", 300)}
      reasons={[]} />));
    await act(async () => action().click());
    expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[0][1]?.body);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      wine_id: "55555555-5555-4555-8555-555555555555",
      open_bottle_id: "b1b2c3d4-e5f6-4789-8abc-def012345678",
      actual_remaining_ml: 515, written_off_ml: 0,
    });
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Idempotency-Key"));
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});
