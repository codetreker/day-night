import { canonicalId, isAttachmentPath } from "../api/parse";

export type Route =
  | { readonly kind: "projects" }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "attachment"; readonly projectId: string; readonly taskId: string; readonly path: string }
  | { readonly kind: "notFound" };

export const parseRoute = (pathname: string): Route => {
  if (pathname === "/") return { kind: "projects" };
  const attachment = /^\/projects\/([^/]+)\/tasks\/([^/]+)\/attachments\/(.+)$/.exec(pathname);
  if (attachment !== null) {
    try {
      const projectId = canonicalId(decodeURIComponent(attachment[1]!));
      const taskId = canonicalId(decodeURIComponent(attachment[2]!));
      const segments = attachment[3]!.split('/').map((segment) => decodeURIComponent(segment));
      const path = segments.join('/');
      if (projectId === null || taskId === null || segments.some((segment) => segment.includes('/')) || !isAttachmentPath(path)) return { kind: "notFound" };
      return { kind: "attachment", projectId, taskId, path };
    } catch {
      return { kind: "notFound" };
    }
  }
  const match = /^\/projects\/([^/]+)$/.exec(pathname);
  if (match === null) return { kind: "notFound" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]!);
  } catch {
    return { kind: "notFound" };
  }
  const projectId = canonicalId(decoded);
  return projectId === null ? { kind: "notFound" } : { kind: "project", projectId };
};

export const navigate = (to: string): void => {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
