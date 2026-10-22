import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate, parseRoute } from "../src/app/router";

const taskId = "b0000000-0000-0000-0000-000000000002";
const projectId = "a0000000-0000-0000-0000-000000000001";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("route parsing", () => {
  it("maps the project list and canonicalizes decoded UUIDs", () => {
    expect(parseRoute("/")).toEqual({ kind: "projects" });
    expect(parseRoute(`/projects/${projectId.toUpperCase()}`)).toEqual({ kind: "project", projectId });
    expect(parseRoute(`/projects/%61${projectId.slice(1)}`)).toEqual({ kind: "project", projectId });
  });

  it("parses complete attachment identities without normalizing filename case or literal percent escapes", () => {
    expect(parseRoute(`/projects/${projectId.toUpperCase()}/tasks/${taskId.toUpperCase()}/attachments/Docs/%E8%AE%BE%E8%AE%A1%20%3F%23%25.md`)).toEqual({ kind: "attachment", projectId, taskId, path: "Docs/设计 ?#%.md" });
    expect(parseRoute(`/projects/${projectId}/tasks/${taskId}/attachments/%252F`)).toEqual({ kind: "attachment", projectId, taskId, path: "%2F" });
  });

  it.each(["", "/", "a//b", "a/", "%2F", "a%2fb", "a%5Cb", ".", "..", "a/%2E%2E/b", "%00", "%7F", "C%3A/absolute", "%ED%A0%80", "%ZZ"])("rejects invalid attachment route path %s", (path) => {
    expect(parseRoute(`/projects/${projectId}/tasks/${taskId}/attachments/${path}`)).toEqual({ kind: "notFound" });
  });
  it("rejects invalid attachment route IDs", () => {
    expect(parseRoute(`/projects/bad/tasks/${taskId}/attachments/a.txt`)).toEqual({ kind: "notFound" });
    expect(parseRoute(`/projects/${projectId}/tasks/bad/attachments/a.txt`)).toEqual({ kind: "notFound" });
    expect(parseRoute(`/projects/%ZZ/tasks/${taskId}/attachments/a.txt`)).toEqual({ kind: "notFound" });
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
