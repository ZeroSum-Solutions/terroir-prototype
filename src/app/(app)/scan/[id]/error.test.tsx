import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import ScanDetailError from "./error";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("keeps the app shell recoverable when the scan query fails", async () => {
  const unstableRetry = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ScanDetailError
        error={new Error("private database detail")}
        unstable_retry={unstableRetry}
      />,
    );
  });

  const alert = container.querySelector('[role="alert"]');
  const retryButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Try again",
  );
  expect(alert?.textContent).toContain("This scan couldn't be loaded");
  expect(alert?.textContent).not.toContain("private database detail");

  await act(async () => retryButton?.click());

  expect(unstableRetry).toHaveBeenCalledTimes(1);
});
