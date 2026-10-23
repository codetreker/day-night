import { describe, expect, it } from "vitest";
import type { Attachment } from "../src/api/types";
import { attachmentKind, attachmentTree, resolveAttachmentReference, resolveAttachmentUrl, resolveMarkdownAttachmentUrl } from "../src/features/task-detail/attachments/model";
const time = "2026-10-21T00:00:00Z";
const file = (path: string, contentType = "application/octet-stream"): Attachment => ({ path, contentType, sizeBytes: 1, createdAt: time, updatedAt: time });

describe("attachment model", () => {
  it("constructs deterministic implicit directories without flattening same-name files", () => {
    const items = [file("z.txt"), file("docs/z.txt"), file("Docs/a.txt"), file("docs/assets/a.png"), file("docs/a.txt"), file("a.txt")];
    const tree = attachmentTree(items);
    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual(["directory:Docs", "directory:docs", "file:a.txt", "file:z.txt"]);
    expect(tree[1]).toEqual({ kind: "directory", name: "docs", path: "docs", children: [
      { kind: "directory", name: "assets", path: "docs/assets", children: [{ kind: "file", name: "a.png", path: "docs/assets/a.png", attachment: items[3] }] },
      { kind: "file", name: "a.txt", path: "docs/a.txt", attachment: items[4] },
      { kind: "file", name: "z.txt", path: "docs/z.txt", attachment: items[1] },
    ] });
    expect(attachmentTree([...items].reverse())).toEqual(tree);
    expect(attachmentTree([])).toEqual([]);
    expect(attachmentTree([file("a")])).toHaveLength(1);
  });
  it.each([["docs", "docs/a"], ["docs/a", "docs"], ["docs/a", "docs/a"], ["../bad"]].map((paths) => [paths] as const))("rejects impossible tree metadata %j", (paths) => {
    expect(() => attachmentTree(paths.map((path) => file(path)))).toThrow();
  });
  it.each([
    ["doc.md", "application/octet-stream", "markdown"], ["doc.MARKDOWN", "text/plain", "markdown"], ["doc", "text/markdown; charset=utf-8", "markdown"],
    ["index.html", "application/octet-stream", "html"], ["page", "text/html", "html"], ["photo", "image/png", "image"], ["paper", "application/pdf", "pdf"],
    ["source", "text/plain", "text"], ["source", "application/problem+json", "text"], ["source", "application/xml", "text"], ["main.tsx", "application/octet-stream", "text"],
    ["archive.zip", "application/zip", "unknown"],
  ])("classifies %s / %s", (path, type, kind) => expect(attachmentKind(file(path, type))).toBe(kind));
});

describe("Markdown attachment URLs", () => {
  const root = "/task/preview/";
  const resolve = (value: string) => resolveAttachmentUrl(value, "docs/design.md", root);
  it.each([
    ["./image.png", "/task/preview/docs/image.png"], ["../images/a.png", "/task/preview/images/a.png"],
    ["../设计 %25%3F%23.png?raw=1#part", "/task/preview/%E8%AE%BE%E8%AE%A1%20%25%3F%23.png?raw=1#part"],
    ["%252F.md", "/task/preview/docs/%252F.md"], ["image.png?v=%23#part", "/task/preview/docs/image.png?v=%23#part"],
    ["#section", "#section"], ["?raw=1", "/task/preview/docs/design.md?raw=1"], ["", "/task/preview/docs/design.md"],
    ["https://example.com/a", "https://example.com/a"], ["mailto:test@example.com", "mailto:test@example.com"],
    ["javascript:alert(1)", "javascript:alert(1)"], ["//cdn.example.com/a", "//cdn.example.com/a"], ["/root/image.png", "/root/image.png"],
  ])("resolves %j", (value, expected) => expect(resolve(value)).toBe(expected));
  it.each(["../../escape.md", "%2e%2e/%2e%2e/escape.md", "%2Fescape", "a//b", "a\\b", "%5Cescape", "%00", "%FF", "%", "../", "a/"])("rejects unsafe or invalid relative URL %j", (value) => {
    expect(resolve(value)).toBeNull();
  });
  it("rejects an invalid current attachment path", () => expect(resolveAttachmentUrl("image.png", "../bad", root)).toBeNull());
});

describe("description attachment roots", () => {
  const root = "/task/preview/";
  const base = { kind: "root" } as const;
  it.each([
    ["plan.md", "/task/preview/plan.md"], ["./mockui/index.html", "/task/preview/mockui/index.html"],
    ["docs/../方案%20%25%3F%23.md", "/task/preview/%E6%96%B9%E6%A1%88%20%25%3F%23.md"],
    ["%252F.md", "/task/preview/%252F.md"], ["guide.md?raw=1#part", "/task/preview/guide.md?raw=1#part"],
    ["?raw=1", "/task/preview/?raw=1"], ["#part", "#part"], ["", "/task/preview/"],
    ["/absolute.md", "/absolute.md"], ["https://example.com/a", "https://example.com/a"],
  ])("resolves %j without inventing a document", (value, expected) => {
    expect(resolveMarkdownAttachmentUrl(value, base, root)).toBe(expected);
  });
  it.each(["../plan.md", "%2e%2e/plan.md", "docs/../../escape.md", "a//b.md", "%2Fplan.md", "%5Cplan.md", "%FF", "%", ".", "docs/.."])("rejects invalid root reference %j", (value) => {
    expect(resolveAttachmentReference(value, base)).toEqual({ kind: "invalid" });
    expect(resolveMarkdownAttachmentUrl(value, base, root)).toBeNull();
  });
  it("retains decoded path identity separately from URL suffixes", () => {
    expect(resolveAttachmentReference("docs/方案%20%25%3F%23.md?raw=1#part", base)).toEqual({ kind: "relative", path: "docs/方案 %?#.md", suffix: "?raw=1#part" });
  });
});
