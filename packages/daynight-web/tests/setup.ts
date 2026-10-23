import * as matchers from "@testing-library/jest-dom/matchers";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

declare module "vitest" {
  interface Matchers<R, T> extends TestingLibraryMatchers<unknown, R> {}
}

// JSDOM has no layout and returns grouped selector matches out of document order.
// We use upstream traversal in tests; real browser checks own visibility and focus behavior.
// https://github.com/focus-trap/tabbable/blob/7dbb9e9bf1636b02c2fc6955f0719648bb465743/README.md#testing-in-jsdom
vi.mock("tabbable", async (original) => {
  const actual = await original<typeof import("tabbable")>();
  return { ...actual, tabbable: (container: Element, options?: Parameters<typeof actual.tabbable>[1]) => actual.tabbable(container, { ...options, displayCheck: "none", getShadowRoot: true }) };
});

// JSDOM does not implement the native top layer. These shims expose open state;
// browser acceptance owns modal focus, inertness, positioning and light dismissal.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
});
Object.defineProperties(HTMLElement.prototype, {
  showPopover: { configurable: true, value: function (this: HTMLElement) { this.hidden = false; this.style.display = "block"; } },
  hidePopover: { configurable: true, value: function (this: HTMLElement) { this.hidden = true; this.style.display = "none"; } },
});

expect.extend(matchers);

beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});
