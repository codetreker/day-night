import { isAttachmentPath } from "../../../api/parse";
import type { Attachment } from "../../../api/types";

export { isAttachmentPath };

export type AttachmentKind = "markdown" | "image" | "pdf" | "text" | "html" | "unknown";
export type AttachmentNode = {
  readonly kind: "directory";
  readonly name: string;
  readonly path: string;
  readonly children: readonly AttachmentNode[];
} | {
  readonly kind: "file";
  readonly name: string;
  readonly path: string;
  readonly attachment: Attachment;
};

export const attachmentKind = (attachment: Attachment): AttachmentKind => {
  const type = attachment.contentType.split(";", 1)[0]!.trim().toLowerCase();
  const extension = attachment.path.slice(attachment.path.lastIndexOf(".") + 1).toLowerCase();
  if (type === "text/markdown" || ["md", "markdown"].includes(extension)) return "markdown";
  if (type === "text/html" || ["html", "htm"].includes(extension)) return "html";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/") || /^(?:application\/(?:json|[a-z0-9.+-]+\+json|xml|[a-z0-9.+-]+\+xml|yaml|javascript))$/.test(type) ||
    ["txt", "json", "csv", "tsv", "xml", "yaml", "yml", "css", "js", "mjs", "ts", "tsx", "jsx", "go", "py", "sh", "sql", "rs", "c", "h", "cpp", "cs", "java", "rb", "toml", "ini", "log"].includes(extension)) return "text";
  return "unknown";
};

type Branch = { readonly files: Map<string, Attachment>; readonly directories: Map<string, Branch> };
const branch = (): Branch => ({ files: new Map(), directories: new Map() });
const compare = (left: AttachmentNode, right: AttachmentNode): number =>
  left.kind !== right.kind ? left.kind === "directory" ? -1 : 1 : left.name < right.name ? -1 : left.name > right.name ? 1 : 0;

export const attachmentTree = (items: readonly Attachment[]): readonly AttachmentNode[] => {
  const root = branch();
  for (const attachment of items) {
    if (!isAttachmentPath(attachment.path)) throw new Error("Invalid attachment path.");
    const segments = attachment.path.split("/");
    const name = segments.pop()!;
    let current = root;
    for (const segment of segments) {
      if (current.files.has(segment)) throw new Error("Conflicting attachment paths.");
      let directory = current.directories.get(segment);
      if (directory === undefined) {
        directory = branch();
        current.directories.set(segment, directory);
      }
      current = directory;
    }
    if (current.files.has(name) || current.directories.has(name)) throw new Error("Conflicting attachment paths.");
    current.files.set(name, attachment);
  }
  const nodes = (current: Branch, prefix: string): AttachmentNode[] => [
    ...Array.from(current.directories, ([name, directory]): AttachmentNode => {
      const path = `${prefix}${name}`;
      return { kind: "directory", name, path, children: nodes(directory, `${path}/`) };
    }),
    ...Array.from(current.files, ([name, attachment]): AttachmentNode => ({ kind: "file", name, path: attachment.path, attachment })),
  ].sort(compare);
  return nodes(root, "");
};

export type MarkdownAttachmentBase = { readonly kind: "root" } | { readonly kind: "document"; readonly path: string };
export type AttachmentReference =
  | { readonly kind: "native"; readonly url: string }
  | { readonly kind: "relative"; readonly path: string; readonly suffix: string }
  | { readonly kind: "root"; readonly suffix: string }
  | { readonly kind: "invalid" };

export const resolveAttachmentReference = (value: string, base: MarkdownAttachmentBase): AttachmentReference => {
  if (base.kind === "document" && !isAttachmentPath(base.path)) return { kind: "invalid" };
  if (value.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value.trim())) return { kind: "native", url: value };
  const boundary = value.search(/[?#]/);
  const pathname = boundary === -1 ? value : value.slice(0, boundary);
  const suffix = boundary === -1 ? "" : value.slice(boundary);
  if (pathname === "") return base.kind === "root" ? { kind: "root", suffix } : { kind: "relative", path: base.path, suffix };
  const parts = base.kind === "root" ? [] : base.path.split("/").slice(0, -1);
  try {
    for (const encoded of pathname.split("/")) {
      const segment = decodeURIComponent(encoded);
      if (segment === ".") continue;
      if (segment === "..") {
        if (parts.length === 0) return { kind: "invalid" };
        parts.pop();
      } else {
        if (segment.includes("/") || !isAttachmentPath(segment)) return { kind: "invalid" };
        parts.push(segment);
      }
    }
  } catch {
    return { kind: "invalid" };
  }
  return parts.length === 0 ? { kind: "invalid" } : { kind: "relative", path: parts.join("/"), suffix };
};

export const resolveMarkdownAttachmentUrl = (value: string, base: MarkdownAttachmentBase, previewRoot: string): string | null => {
  const reference = resolveAttachmentReference(value, base);
  if (reference.kind === "invalid") return null;
  if (reference.kind === "native") return reference.url;
  if (reference.kind === "root") return `${previewRoot}${reference.suffix}`;
  return `${previewRoot}${reference.path.split("/").map(encodeURIComponent).join("/")}${reference.suffix}`;
};

export const resolveAttachmentUrl = (value: string, currentPath: string, previewRoot: string): string | null =>
  resolveMarkdownAttachmentUrl(value, { kind: "document", path: currentPath }, previewRoot);
