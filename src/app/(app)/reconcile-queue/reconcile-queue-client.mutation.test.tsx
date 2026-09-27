import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ReconcileQueueClient } from "./reconcile-queue-client";
import type { QueueResponse } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const KEY_A = "33333333-3333-4333-8333-333333333333";
const KEY_B = "44444444-4444-4444-8444-444444444444";
const BATCH = "55555555-5555-4555-8555-555555555555";
const SCAN_A = "66666666-6666-4666-8666-666666666666";
const SCAN_B = "77777777-7777-4777-8777-777777777777";
const WINE_A = "88888888-8888-4888-8888-888888888888";
const WINE_B = "99999999-9999-4999-8999-999999999999";
const UNDONE_AT = "2026-09-26T12:34:56.000Z";

const roots: Root[] = [];
const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
});

function line(id: string) {
  return {
    id,
    name: "Estate Red",
    producer: "Domaine Test",
    vintage: 2021,
    varietal: "Pinot Noir",
    region: "Burgundy",
    qty: 2,
    unitCost: 42.5,
    currency: "USD",
    format: "750ml",
    confidence: 0.95,
    lowFields: [],
  };
}

function queueResponse(): QueueResponse {
  return {
    issues: [
      {
        id: "issue-a",
        kind: "unmatched_scan",
        subjectTable: "invoice_scans",
        subjectId: `${SCAN_A}:0:line-a`,
        title: "Wine A",
        detail: "Match scan line",
        units: 2,
        unitCost: 42.5,
        atRisk: 85,
        action: {
          type: "match_scan",
          label: "Match scan",
          targetId: SCAN_A,
          payload: { line_index: 0, wine_id: WINE_A, expected_line: line("line-a") },
        },
      },
      {
        id: "issue-b",
        kind: "unmatched_scan",
        subjectTable: "invoice_scans",
        subjectId: `${SCAN_B}:1:line-b`,
        title: "Wine B",
        detail: "Match scan line",
        units: 1,
        unitCost: 30,
        atRisk: 30,
        action: {
          type: "match_scan",
          label: "Match scan",
          targetId: SCAN_B,
          payload: { line_index: 1, wine_id: WINE_B, expected_line: line("line-b") },
        },
      },
    ],
    summary: { itemCount: 2, unitCount: 3, atRisk: 115 },
    latest_batch: { id: BATCH, action_count: 2, created_at: UNDONE_AT },
    bins: [],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function render(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <ReconcileQueueClient
      canManage
      userId={USER}
      restaurantId={SITE}
    />,
  ));
  await vi.waitFor(() => {
    expect(container.querySelectorAll("[data-queue-row]")).toHaveLength(2);
  });
  return { container, root };
}

async function renderStrict(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(
    <StrictMode>
      <ReconcileQueueClient
        canManage
        userId={USER}
        restaurantId={SITE}
      />
    </StrictMode>,
  ));
  await vi.waitFor(() => {
    expect(container.querySelectorAll("[data-queue-row]")).toHaveLength(2);
  });
  return { container, root };
}

function buttons(container: HTMLElement) {
  return [...container.querySelectorAll("button")];
}

function button(container: HTMLElement, text: string) {
  const found = buttons(container).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

function checkbox(container: HTMLElement, title: string) {
  const found = container.querySelector<HTMLInputElement>(
    `input[aria-label="Select ${title}"]`,
  );
  if (!found) throw new Error(`Missing checkbox: ${title}`);
  return found;
}

function postCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) =>
    (init as RequestInit | undefined)?.method === "POST",
  );
}

type FailureFactory = () => Response | Promise<Response>;

const uncertainFailures: Array<[string, FailureFactory]> = [
  ["network rejection", () => Promise.reject(new Error("offline"))],
  ["fixed 5xx", () => jsonResponse({ error: { code: "internal_error", message: "Reconciliation failed." } }, 500)],
  ["409", () => jsonResponse({ error: { code: "reconcile_conflict", message: "Refresh and try again." } }, 409)],
  ["malformed 2xx", () => new Response("not-json", { status: 201 })],
  ["extra-field 2xx", () => jsonResponse({ batchId: KEY_A, actionCount: 1, status: "accepted", extra: true }, 201)],
  ["wrong batch ID", () => jsonResponse({ batchId: KEY_B, actionCount: 1, status: "accepted" }, 201)],
  ["wrong count", () => jsonResponse({ batchId: KEY_A, actionCount: 2, status: "accepted" }, 201)],
];

describe("ReconcileQueueClient mutation boundaries", () => {
  it.each(uncertainFailures)(
    "retains the ordered action, selection, and UUID after %s until strict success",
    async (_label, firstFailure) => {
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(KEY_A);
      let getCount = 0;
      let postCount = 0;
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") {
          getCount += 1;
          return jsonResponse(queueResponse());
        }
        postCount += 1;
        if (postCount === 1) return firstFailure();
        return jsonResponse({ batchId: KEY_A, actionCount: 1, status: "accepted" }, 201);
      });
      const { container } = await render(fetchMock);

      await act(async () => checkbox(container, "Wine A").click());
      await act(async () => button(container, "Accept 1 item").click());
      await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());

      expect(checkbox(container, "Wine A").checked).toBe(true);
      expect(getCount).toBe(1);
      expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();

      await act(async () => button(container, "Accept 1 item").click());
      await vi.waitFor(() => expect(container.textContent).toContain("1 item accepted"));

      const posts = postCalls(fetchMock);
      expect(posts).toHaveLength(2);
      expect((posts[0][1] as RequestInit).body).toBe((posts[1][1] as RequestInit).body);
      expect(new Headers((posts[0][1] as RequestInit).headers)).toEqual(
        new Headers((posts[1][1] as RequestInit).headers),
      );
      const headers = new Headers((posts[0][1] as RequestInit).headers);
      expect(headers.get("Idempotency-Key")).toBe(KEY_A);
      expect(headers.get("X-Expected-User-Id")).toBe(USER);
      expect(headers.get("X-Expected-Restaurant-Id")).toBe(SITE);
      expect(JSON.parse(String((posts[0][1] as RequestInit).body))).toEqual([{
        action_type: "match_scan",
        subject_table: "invoice_scans",
        subject_id: SCAN_A,
        patch: { line_index: 0, wine_id: WINE_A, expected_line: line("line-a") },
      }]);
      expect(getCount).toBe(2);
      expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    },
  );

  it("mints a new UUID when the ordered action payload changes, then reuses it unchanged", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(KEY_A)
      .mockReturnValueOnce(KEY_B);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ error: { code: "reconcile_conflict", message: "Refresh and try again." } }, 409)
        : jsonResponse(queueResponse()));
    const { container } = await render(fetchMock);

    await act(async () => checkbox(container, "Wine A").click());
    await act(async () => button(container, "Accept 1 item").click());
    await vi.waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1));

    await act(async () => checkbox(container, "Wine B").click());
    await act(async () => button(container, "Accept 2 items").click());
    await vi.waitFor(() => expect(postCalls(fetchMock)).toHaveLength(2));
    await act(async () => button(container, "Accept 2 items").click());
    await vi.waitFor(() => expect(postCalls(fetchMock)).toHaveLength(3));

    const keys = postCalls(fetchMock).map(([, init]) =>
      new Headers((init as RequestInit).headers).get("Idempotency-Key"),
    );
    expect(keys).toEqual([KEY_A, KEY_B, KEY_B]);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(2);
  });

  it("clears a successful accept and gives the next distinct accept a new UUID", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(KEY_A)
      .mockReturnValueOnce(KEY_B);
    let postCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") return jsonResponse(queueResponse());
      postCount += 1;
      return jsonResponse({
        batchId: postCount === 1 ? KEY_A : KEY_B,
        actionCount: 1,
        status: "accepted",
      }, 201);
    });
    const { container } = await render(fetchMock);

    await act(async () => checkbox(container, "Wine A").click());
    await act(async () => button(container, "Accept 1 item").click());
    await vi.waitFor(() => expect(container.textContent).toContain("1 item accepted"));
    expect(checkbox(container, "Wine A").checked).toBe(false);

    await act(async () => checkbox(container, "Wine B").click());
    await act(async () => button(container, "Accept 1 item").click());
    await vi.waitFor(() => expect(postCalls(fetchMock)).toHaveLength(2));

    const keys = postCalls(fetchMock).map(([, init]) =>
      new Headers((init as RequestInit).headers).get("Idempotency-Key"),
    );
    expect(keys).toEqual([KEY_A, KEY_B]);
  });

  it("unmounts the old queue immediately on an actor/site change and sends no stale POST", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(KEY_A);
    let getCount = 0;
    const pending = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ batchId: KEY_A, actionCount: 1, status: "accepted" }, 201);
      }
      getCount += 1;
      return getCount === 1 ? jsonResponse(queueResponse()) : pending;
    });
    const { container, root } = await render(fetchMock);
    await act(async () => checkbox(container, "Wine A").click());

    await act(async () => root.render(
      <ReconcileQueueClient
        canManage
        userId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        restaurantId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      />,
    ));

    expect(buttons(container).some((candidate) =>
      candidate.textContent?.includes("Accept"),
    )).toBe(false);
    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("accepts only an exact undo receipt matching the latest batch and count", async () => {
    let undoCount = 0;
    let getCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") {
        getCount += 1;
        return jsonResponse(queueResponse());
      }
      undoCount += 1;
      if (undoCount === 1) {
        return jsonResponse({
          batchId: BATCH,
          actionCount: 2,
          status: "undone",
          undoneAt: UNDONE_AT,
          extra: true,
        });
      }
      return jsonResponse({
        batchId: BATCH,
        actionCount: 2,
        status: "undone",
        undoneAt: UNDONE_AT,
      });
    });
    const { container } = await render(fetchMock);

    await act(async () => button(container, "Undo latest batch").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Undo outcome is uncertain"));
    expect(container.textContent).not.toContain("Latest batch undone");
    expect(getCount).toBe(1);

    await act(async () => button(container, "Undo latest batch").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Latest batch undone"));
    expect(getCount).toBe(2);

    const posts = postCalls(fetchMock);
    expect(posts).toHaveLength(2);
    const headers = new Headers((posts[0][1] as RequestInit).headers);
    expect(headers.get("Idempotency-Key")).toBeNull();
    expect(headers.get("X-Expected-User-Id")).toBe(USER);
    expect(headers.get("X-Expected-Restaurant-Id")).toBe(SITE);
    expect(JSON.parse(String((posts[0][1] as RequestInit).body))).toEqual({ batch_id: BATCH });
  });

  it("completes exact accept and undo successes after StrictMode effect replay", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(KEY_A);
    let reloadCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") {
        reloadCount += 1;
        return jsonResponse(queueResponse());
      }
      if (String(input).endsWith("/accept")) {
        return jsonResponse({
          batchId: KEY_A,
          actionCount: 1,
          status: "accepted",
        }, 201);
      }
      return jsonResponse({
        batchId: BATCH,
        actionCount: 2,
        status: "undone",
        undoneAt: UNDONE_AT,
      });
    });
    const { container } = await renderStrict(fetchMock);
    const initialGetCount = reloadCount;

    await act(async () => checkbox(container, "Wine A").click());
    await act(async () => button(container, "Accept 1 item").click());
    await vi.waitFor(() => expect(container.textContent).toContain("1 item accepted"));
    expect(checkbox(container, "Wine A").checked).toBe(false);
    expect(button(container, "Select actionable").disabled).toBe(false);
    expect(reloadCount).toBe(initialGetCount + 1);

    await act(async () => button(container, "Undo latest batch").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Latest batch undone"));
    expect(button(container, "Undo latest batch").disabled).toBe(false);
    expect(reloadCount).toBe(initialGetCount + 2);
  });
});
