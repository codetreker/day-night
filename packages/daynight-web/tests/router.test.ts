import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate, parseRoute } from "../src/app/router";

const projectId = "a0000000-0000-0000-0000-000000000001";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("route parsing", () => {
  it("maps the project list and canonicalizes decoded UUIDs", () => {
    expect(parseRoute("/")).toEqual({ kind: "projects" });
    expect(parseRoute(`/projects/${projectId.toUpperCase()}`)).toEqual({ kind: "project", projectId });
    expect(parseRoute(`/projects/%61${projectId.slice(1)}`)).toEqual({ kind: "project", projectId });
  });

  it.each([
    "", "/projects", "/projects/", "/projects/not-a-uuid", `/projects/${projectId}/`, `/projects/${projectId}/tasks`,
    `/projects/${projectId.replaceAll("-", "")}`, "/projects/%ZZ", "/projects/%2F", "/unknown", "/%",
    `/projects/${projectId}?ignored=true`, `/projects/${projectId}#task`, "/projects/%ED%A0%80",
  ])("rejects unknown or invalid path %s", (pathname) => {
    expect(parseRoute(pathname)).toEqual({ kind: "notFound" });
  });
});

describe("navigation", () => {
  it("pushes a same-origin entry and notifies route subscribers", () => {
    const subscriber = vi.fn();
    window.addEventListener("popstate", subscriber);
    try {
      const previousLength = window.history.length;
      navigate(`/projects/${projectId}`);
      expect(window.location.pathname).toBe(`/projects/${projectId}`);
      expect(window.history.length).toBe(previousLength + 1);
      expect(subscriber).toHaveBeenCalledOnce();
      expect(parseRoute(window.location.pathname)).toEqual({ kind: "project", projectId });
      navigate("/");
      expect(window.location.pathname).toBe("/");
      expect(subscriber).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("popstate", subscriber);
    }
  });

  it("supports native browser back and forward notifications", async () => {
    navigate(`/projects/${projectId}`);
    navigate("/");
    const move = (direction: "back" | "forward"): Promise<void> => new Promise((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
      window.history[direction]();
    });
    await move("back");
    expect(parseRoute(window.location.pathname)).toEqual({ kind: "project", projectId });
    await move("forward");
    expect(parseRoute(window.location.pathname)).toEqual({ kind: "projects" });
  });

  it("keeps the current page when history rejects cross-origin destinations", () => {
    expect(() => navigate("https://example.org/foreign")).toThrow();
    expect(window.location.pathname).toBe("/");
  });
});
