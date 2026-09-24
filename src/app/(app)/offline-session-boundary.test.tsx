import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OfflineSessionBoundary,
  type OfflineSessionBoundaryDependencies,
  useOfflineSessionBoundary,
} from "./offline-session-boundary";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function SignOutControl({ twice = false }: { twice?: boolean }) {
  const boundary = useOfflineSessionBoundary();
  return (
    <button
      type="button"
      onClick={() => {
        boundary?.beginSignOut();
        if (twice) boundary?.beginSignOut();
      }}
    >
      Sign out
    </button>
  );
}

function response(status: number) {
  return new Response(null, { status });
}

describe("OfflineSessionBoundary", () => {
  const roots: Root[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount());
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("unmounts the private tree before starting network and storage work", async () => {
    const events: string[] = [];
    const server = deferred<Response>();
    const database = deferred<{ locked: boolean; projectionsDeleted: boolean }>();
    const dependencies = createDependencies({
      requestSignOut: vi.fn(() => {
        events.push("request");
        return server.promise;
      }),
      lockDevice: vi.fn(() => {
        events.push("database");
        return database.promise;
      }),
    });
    const container = await mountBoundary(dependencies);

    await click(container, "Sign out");

    expect(container.querySelector("[data-private-wine]")).toBeNull();
    expect(container.textContent).not.toContain("Private wine inventory");
    expect(events).toEqual(["request", "database"]);
    server.resolve(response(503));
    database.resolve({ locked: false, projectionsDeleted: false });
    await flush();
  });

  it("does not let a storage throw suppress the already-created request", async () => {
    const dependencies = createDependencies({
      lockDevice: vi.fn(() => {
        throw new Error("blocked storage");
      }),
    });
    const container = await mountBoundary(dependencies);

    await click(container, "Sign out");
    await flush();

    expect(dependencies.requestSignOut).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "This device lock could not be saved. Server sign-out is not confirmed.",
    );
  });

  it.each([
    {
      name: "local lock only",
      serverStatus: 503,
      locked: true,
      cookie: false,
      message: "Locked on this device. Server sign-out is not confirmed.",
    },
    {
      name: "neither side confirmed",
      serverStatus: 503,
      locked: false,
      cookie: false,
      message:
        "This device lock could not be saved. Server sign-out is not confirmed.",
    },
    {
      name: "server only",
      serverStatus: 204,
      locked: false,
      cookie: false,
      message:
        "Online sign-out completed, but this device lock was not verified. Do not hand this device to another person until retry or recovery succeeds.",
    },
  ])("renders truthful unresolved copy for $name", async (scenario) => {
    const dependencies = createDependencies({
      requestSignOut: vi.fn(async () => response(scenario.serverStatus)),
      lockDevice: vi.fn(async () => ({
        locked: scenario.locked,
        projectionsDeleted: true,
      })),
      writeHardMarker: vi.fn(() => scenario.cookie),
    });
    const container = await mountBoundary(dependencies);

    await click(container, "Sign out");
    await flush();

    expect(container.textContent).toContain(scenario.message);
    expect(container.textContent).toContain("Retry sign-out");
    expect(container.querySelector("[data-private-wine]")).toBeNull();
    expect(dependencies.navigate).not.toHaveBeenCalled();
  });

  it("uses a whole-document navigation only after server and durable lock confirm", async () => {
    const dependencies = createDependencies({
      requestSignOut: vi.fn(async () => response(204)),
      writeHardMarker: vi.fn(() => true),
    });
    const container = await mountBoundary(dependencies);

    await click(container, "Sign out");
    await flush();

    expect(dependencies.navigate).toHaveBeenCalledOnce();
    expect(dependencies.navigate).toHaveBeenCalledWith("/login");
    expect(container.querySelector("[data-private-wine]")).toBeNull();
  });

  it("rejects duplicate concurrent intent", async () => {
    const server = deferred<Response>();
    const dependencies = createDependencies({
      requestSignOut: vi.fn(() => server.promise),
    });
    const container = await mountBoundary(dependencies, true);

    await click(container, "Sign out");

    expect(dependencies.requestSignOut).toHaveBeenCalledTimes(1);
    expect(dependencies.lockDevice).toHaveBeenCalledTimes(1);
    server.resolve(response(503));
    await flush();
  });

  it("retries an unresolved operation without remounting private children", async () => {
    const requestSignOut = vi
      .fn<OfflineSessionBoundaryDependencies["requestSignOut"]>()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(204));
    const writeHardMarker = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const dependencies = createDependencies({ requestSignOut, writeHardMarker });
    const container = await mountBoundary(dependencies);

    await click(container, "Sign out");
    await flush();
    expect(container.textContent).toContain("Retry sign-out");

    await click(container, "Retry sign-out");
    await flush();

    expect(requestSignOut).toHaveBeenCalledTimes(2);
    expect(dependencies.navigate).toHaveBeenCalledWith("/login");
    expect(container.querySelector("[data-private-wine]")).toBeNull();
  });

  it("finishes one attempt when a parent rerenders with fresh dependencies", async () => {
    const server = deferred<Response>();
    const requestSignOut = vi.fn(() => server.promise);
    const stableParts = createDependencies({ requestSignOut });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const render = (revision: number) => (
      <OfflineSessionBoundary dependencies={{ ...stableParts }}>
        <section data-revision={revision}>
          <SignOutControl />
        </section>
      </OfflineSessionBoundary>
    );
    await act(async () => root.render(render(1)));

    await click(container, "Sign out");
    await act(async () => root.render(render(2)));
    server.resolve(response(503));
    await flush();

    expect(requestSignOut).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Retry sign-out");
    expect(container.textContent).toContain(
      "This device lock could not be saved. Server sign-out is not confirmed.",
    );
  });

  it("aborts a hung request at the controlled deadline and drains late rejection", async () => {
    const server = deferred<Response>();
    let deadline: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const dependencies = createDependencies({
      requestSignOut: vi.fn((signal) => {
        observedSignal = signal;
        return server.promise;
      }),
      clock: {
        setTimeout(callback) {
          deadline = callback;
          return () => {
            deadline = undefined;
          };
        },
      },
    });
    const container = await mountBoundary(dependencies);

    await click(container, "Sign out");
    await act(async () => deadline?.());
    await flush();

    expect(observedSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("Server sign-out is not confirmed.");
    server.reject(new Error("late network failure"));
    await flush();
  });

  it("warns against device handoff when only server sign-out is confirmed", async () => {
    const dependencies = createDependencies({
      requestSignOut: vi.fn(async () => response(204)),
    });
    const container = await mountBoundary(dependencies);

    await click(container, "Sign out");
    await flush();

    expect(container.textContent).toContain(
      "Do not hand this device to another person until retry or recovery succeeds.",
    );
    expect(container.textContent).not.toMatch(/erased|safe to hand|durable/i);
  });

  function createDependencies(
    overrides: Partial<OfflineSessionBoundaryDependencies> = {},
  ): OfflineSessionBoundaryDependencies {
    return {
      requestSignOut: vi.fn(async () => response(503)),
      lockDevice: vi.fn(async () => ({ locked: false, projectionsDeleted: true })),
      writeHardMarker: vi.fn(() => false),
      readMarker: vi.fn(() => null),
      navigate: vi.fn(),
      clock: {
        setTimeout(callback, delay) {
          const handle = window.setTimeout(callback, delay);
          return () => window.clearTimeout(handle);
        },
      },
      ...overrides,
    };
  }

  async function mountBoundary(
    dependencies: OfflineSessionBoundaryDependencies,
    twice = false,
  ) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <OfflineSessionBoundary dependencies={dependencies}>
          <section data-private-wine="true">
            Private wine inventory
            <SignOutControl twice={twice} />
          </section>
        </OfflineSessionBoundary>,
      );
    });
    return container;
  }

  async function click(container: HTMLElement, label: string) {
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});
