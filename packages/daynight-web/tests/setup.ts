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
