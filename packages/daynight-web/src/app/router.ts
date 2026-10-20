import { canonicalId } from "../api/parse";

export type Route =
  | { readonly kind: "projects" }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "notFound" };

export const parseRoute = (pathname: string): Route => {
  if (pathname === "/") return { kind: "projects" };
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
