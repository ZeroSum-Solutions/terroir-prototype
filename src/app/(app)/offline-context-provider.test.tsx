import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OfflineContextResponse } from "@/domains/offline/contract";
import {
  AUTHORIZATION_GENERATION_COOKIE_NAME,
  DEVICE_LOCK_COOKIE_NAME,
  HARD_DEVICE_LOCK,
  REPROVISION_REQUIRED,
  setDeviceLockCookie,
} from "@/domains/offline/device-lock";
import {
  OfflineContextProvider,
  type OfflineContextProviderDependencies,
  useOfflineContextStatus,
} from "./offline-context-provider";

const USER_A = "10000000-0000-4000-8000-000000000001";
const SITE_A = "10000000-0000-4000-8000-000000000002";
const USER_B = "20000000-0000-4000-8000-000000000001";
const GENERATION_A = "10000000-0000-4000-8000-000000000010";
const FENCE = {
  userId: "__terroir_device_access_fence__",
  restaurantId: "__v1__",
  recordType: "device_access_fence",
  fenceVersion: 1,
  revision: "10000000-0000-4000-8000-000000000011",
  state: "denied",
  authorizationGeneration: "20000000-0000-4000-8000-000000000010",
  eligibleUserId: null,
  eligibleRestaurantId: null,
  eligibleContextId: null,
  changedAt: "2026-09-23T12:00:00.000Z",
  reason: "sign_out",
} as const;
const response: OfflineContextResponse = {
  schemaVersion: 1,
  context: {
    contextId: "10000000-0000-4000-8000-000000000003",
    userId: USER_A,
    restaurantId: SITE_A,
    issuedAt: "2026-09-23T11:00:00.000Z",
    expiresAt: "2026-09-23T23:00:00.000Z",
  },
  projection: {
    kind: "cellar_lookup",
    version: 1,
    asOf: "2026-09-23T11:00:00.000Z",
    rows: [],
  },
};
const transitionCookie =
  `${AUTHORIZATION_GENERATION_COOKIE_NAME}=${GENERATION_A}; ` +
  `${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}`;
const eligibleCookie = `${AUTHORIZATION_GENERATION_COOKIE_NAME}=${GENERATION_A}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
function Status() {
  const status = useOfflineContextStatus();
  return <output data-status={status.phase}>{status.phase}:{"reason" in status ? status.reason : ""}</output>;
}

describe("OfflineContextProvider", () => {
  const roots: Root[] = [];
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });
  afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["hard marker", `${eligibleCookie}; ${DEVICE_LOCK_COOKIE_NAME}=${HARD_DEVICE_LOCK}`],
    ["missing generation", `${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}`],
    ["malformed generation", `${AUTHORIZATION_GENERATION_COOKIE_NAME}=bad; ${DEVICE_LOCK_COOKIE_NAME}=${REPROVISION_REQUIRED}`],
    ["duplicate generation", `${transitionCookie}; ${AUTHORIZATION_GENERATION_COOKIE_NAME}=${GENERATION_A}`],
  ])("rejects %s before any IndexedDB or fetch call", async (_label, cookieHeader) => {
    const dependencies = createDependencies({ readCookieHeader: () => cookieHeader });
    const container = await mount(dependencies);
    await flush();
    expect(container.textContent).toContain("unavailable:");
    expect(dependencies.captureFence).not.toHaveBeenCalled();
    expect(dependencies.readEligible).not.toHaveBeenCalled();
    expect(dependencies.requestContext).not.toHaveBeenCalled();
  });

  it("uses only the marker-checked read when no marker is present and never auto-provisions a miss", async () => {
    const dependencies = createDependencies({
      readCookieHeader: () => eligibleCookie,
      readEligible: vi.fn(async () => ({
        status: "unavailable" as const,
        reason: "no_usable_context" as const,
      })),
    });
    const container = await mount(dependencies);
    await flush();
    expect(container.textContent).toContain("site_transition_unacknowledged");
    expect(dependencies.readEligible).toHaveBeenCalledWith(USER_A, SITE_A);
    expect(dependencies.captureFence).not.toHaveBeenCalled();
    expect(dependencies.requestContext).not.toHaveBeenCalled();
  });

  it("reports ready only after fence capture, fetch, committed provision, marker acknowledgement, and exact readback", async () => {
    const events: string[] = [];
    let cookieHeader = transitionCookie;
    const dependencies = createDependencies({
      readCookieHeader: () => cookieHeader,
      captureFence: vi.fn(async () => {
        events.push("capture");
        return { status: "captured" as const, fence: FENCE };
      }),
      requestContext: vi.fn(async () => { events.push("fetch"); return jsonResponse(response); }),
      provision: vi.fn(async (_value, authorization) => {
        events.push("commit");
        expect(authorization).toMatchObject({
          userId: USER_A,
          restaurantId: SITE_A,
          authorizationGeneration: GENERATION_A,
          marker: REPROVISION_REQUIRED,
          capturedFence: FENCE,
        });
        return { status: "stored" as const, replayed: false };
      }),
      clearMarker: vi.fn(() => { events.push("ack"); cookieHeader = eligibleCookie; return true; }),
      readEligible: vi.fn(async () => {
        events.push("read");
        return { status: "ready" as const, value: response };
      }),
    });
    const container = await mount(dependencies);
    await flush(8);
    expect(container.textContent).toContain("ready:");
    expect(events).toEqual(["capture", "fetch", "commit", "ack", "read"]);
  });

  it("rejects an expired lease before starting the provision transaction", async () => {
    const expired = {
      ...response,
      context: {
        ...response.context,
        issuedAt: "2026-09-22T11:00:00.000Z",
        expiresAt: "2026-09-22T23:00:00.000Z",
      },
    };
    const dependencies = createDependencies({
      requestContext: vi.fn(async () => jsonResponse(expired)),
    });
    const container = await mount(dependencies);
    await flush(6);
    expect(container.textContent).toContain("invalid_response");
    expect(dependencies.provision).not.toHaveBeenCalled();
    expect(dependencies.clearMarker).not.toHaveBeenCalled();
  });

  it("keeps provisioning unavailable when AbortController is missing", async () => {
    vi.stubGlobal("AbortController", undefined);
    const dependencies = createDependencies();
    const container = await mount(dependencies);
    await flush();
    expect(container.textContent).toContain("request_failure");
    expect(dependencies.captureFence).not.toHaveBeenCalled();
    expect(dependencies.requestContext).not.toHaveBeenCalled();
  });

  it("does not acknowledge a fetched response when the transaction fails", async () => {
    const dependencies = createDependencies({
      provision: vi.fn(async () => ({
        status: "unavailable" as const,
        reason: "fence_changed" as const,
      })),
    });
    const container = await mount(dependencies);
    await flush(6);
    expect(container.textContent).toContain("unavailable:");
    expect(dependencies.clearMarker).not.toHaveBeenCalled();
    expect(dependencies.readEligible).not.toHaveBeenCalled();
  });

  it("keeps readiness denied when marker acknowledgement fails", async () => {
    const dependencies = createDependencies({
      clearMarker: vi.fn(() => false),
      readEligible: vi.fn(async () => ({ status: "ready" as const, value: response })),
    });
    const container = await mount(dependencies);
    await flush(6);
    expect(dependencies.readEligible).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("marker_acknowledgement_failed");
    expect(container.textContent).not.toContain("ready:");
  });

  it("invalidates a late fetch on unmount without provisioning or marker deletion", async () => {
    const pending = deferred<Response>();
    let signal: AbortSignal | undefined;
    const dependencies = createDependencies({
      requestContext: vi.fn((observedSignal) => {
        signal = observedSignal;
        return pending.promise;
      }),
    });
    const { root } = await mountWithRoot(dependencies, USER_A, SITE_A);
    await flush(3);
    await act(async () => root.unmount());
    pending.resolve(jsonResponse(response));
    await flush(3);
    expect(signal?.aborted).toBe(true);
    expect(dependencies.provision).not.toHaveBeenCalled();
    expect(dependencies.clearMarker).not.toHaveBeenCalled();
  });

  it("invalidates actor changes and never acknowledges the old actor's response", async () => {
    const pending = deferred<Response>();
    const dependencies = createDependencies({ requestContext: vi.fn(() => pending.promise) });
    const { container, root } = await mountWithRoot(dependencies, USER_A, SITE_A);
    await flush(3);
    await act(async () => root.render(
      <OfflineContextProvider userId={USER_B} restaurantId={SITE_A} dependencies={dependencies}>
        <Status />
      </OfflineContextProvider>,
    ));
    pending.resolve(jsonResponse(response));
    await flush(4);
    expect(container.textContent).not.toContain("ready:");
    expect(dependencies.clearMarker).not.toHaveBeenCalled();
  });

  it("blocks a held old-generation response when an accepted transition cannot rotate generation", async () => {
    const pending = deferred<Response>();
    const cookies = new Map([
      [AUTHORIZATION_GENERATION_COOKIE_NAME, GENERATION_A],
      [DEVICE_LOCK_COOKIE_NAME, REPROVISION_REQUIRED],
    ]);
    const cookieHeader = () => [...cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    const writer = {
      get: (name: string) => {
        const value = cookies.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => { cookies.set(name, value); },
    };
    const dependencies = createDependencies({
      readCookieHeader: vi.fn(cookieHeader),
      requestContext: vi.fn(() => pending.promise),
      clearMarker: vi.fn(() => {
        cookies.delete(DEVICE_LOCK_COOKIE_NAME);
        return true;
      }),
    });
    const container = await mount(dependencies);
    await flush(3);

    const rotation = setDeviceLockCookie(writer, REPROVISION_REQUIRED, () => "invalid");
    pending.resolve(jsonResponse(response));
    await flush(5);

    expect(rotation).toBeNull();
    expect(cookies.get(AUTHORIZATION_GENERATION_COOKIE_NAME)).toBe(GENERATION_A);
    expect(cookies.get(DEVICE_LOCK_COOKIE_NAME)).toBe(HARD_DEVICE_LOCK);
    expect(dependencies.provision).not.toHaveBeenCalled();
    expect(dependencies.clearMarker).not.toHaveBeenCalled();
    expect(dependencies.readEligible).not.toHaveBeenCalled();
    expect(container.textContent).toContain("stale_attempt");
    expect(container.textContent).not.toContain("ready:");
  });

  function createDependencies(
    overrides: Partial<OfflineContextProviderDependencies> = {},
  ): OfflineContextProviderDependencies {
    return {
      readCookieHeader: vi.fn(() => transitionCookie),
      captureFence: vi.fn(async () => ({ status: "captured" as const, fence: FENCE })),
      requestContext: vi.fn(async () => jsonResponse(response)),
      provision: vi.fn(async () => ({ status: "stored" as const, replayed: false })),
      clearMarker: vi.fn(() => true),
      readEligible: vi.fn(async () => ({ status: "ready" as const, value: response })),
      clock: {
        now: () => Date.parse("2026-09-23T12:00:00.000Z"),
        setTimeout(callback, delay) {
          const handle = window.setTimeout(callback, delay);
          return () => window.clearTimeout(handle);
        },
      },
      ...overrides,
    };
  }
  async function mount(dependencies: OfflineContextProviderDependencies) {
    return (await mountWithRoot(dependencies, USER_A, SITE_A)).container;
  }
  async function mountWithRoot(
    dependencies: OfflineContextProviderDependencies,
    userId: string,
    restaurantId: string,
  ) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(
      <OfflineContextProvider userId={userId} restaurantId={restaurantId} dependencies={dependencies}>
        <Status />
      </OfflineContextProvider>,
    ));
    return { container, root };
  }
  async function flush(count = 2) {
    await act(async () => {
      for (let step = 0; step < count; step += 1) await Promise.resolve();
    });
  }
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
