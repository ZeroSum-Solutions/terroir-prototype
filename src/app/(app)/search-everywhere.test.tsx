// GLOBAL-02 — the mobile entry point for global search.
//
// This used to pin the always-on band that rendered a full-width
// <SearchPalette> under the header on every route (asserted against
// ./layout directly). That band is gone — cellar-index defect #3: it cost
// ~140px of an 844px mobile viewport on every screen, duplicating each
// page's own search on /cellar and /bins, and was pure noise on /insights.
// What replaces it lives here instead: a single icon, collapsed by
// default, opening the same palette on demand and closing again on
// Escape, an outside interaction, or navigating away.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/cellar" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock("./search/search-palette", () => ({
  SearchPalette: () => (
    <input
      data-global-search="true"
      type="search"
      placeholder="Search cellar and catalogue…"
    />
  ),
}));

const { SearchEverywhere } = await import("./search-everywhere");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigation.pathname = "/cellar";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => {
    root.render(<SearchEverywhere />);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function field() {
  return container.querySelector<HTMLInputElement>('input[type="search"]');
}

function trigger() {
  return container.querySelector<HTMLButtonElement>("button")!;
}

describe("SearchEverywhere", () => {
  it("collapses to a single icon by default — no permanent band", () => {
    render();

    expect(field()).toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Search");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("is mobile-only — desktop keeps the inline header field instead", () => {
    render();
    expect(container.firstElementChild?.className).toContain("md:hidden");
  });

  it("opens the palette on tap", () => {
    render();
    click(trigger());

    expect(field()).not.toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Close search");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("closes again on a second tap", () => {
    render();
    click(trigger());
    expect(field()).not.toBeNull();

    click(trigger());
    expect(field()).toBeNull();
  });

  it("closes on Escape", () => {
    render();
    click(trigger());
    expect(field()).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(field()).toBeNull();
  });

  it("closes on an outside interaction", () => {
    render();
    click(trigger());
    expect(field()).not.toBeNull();

    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(field()).toBeNull();
  });

  it("does not close on a click inside the opened panel", () => {
    render();
    click(trigger());
    const input = field()!;

    act(() => {
      input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(field()).not.toBeNull();
  });

  it("closes when the route changes, since this sits in the persistent layout", () => {
    render();
    click(trigger());
    expect(field()).not.toBeNull();

    navigation.pathname = "/bins";
    render();

    expect(field()).toBeNull();
  });
});
