import { ApiError, attachmentPageUrl } from "../api/client";
import { canonicalId, isAttachmentPath } from "../api/parse";

export type TaskDetailTab = "overview" | "attachments";
export type TaskDetailNavigation = { readonly tab: TaskDetailTab; readonly path: string | null };

export type Route =
  | { readonly kind: "projects" }
  | { readonly kind: "project"; readonly projectId: string }
  | ({ readonly kind: "task"; readonly projectId: string; readonly taskId: string } & TaskDetailNavigation)
  | ({ readonly kind: "attachment"; readonly projectId: string; readonly taskId: string; readonly path: string } & TaskDetailNavigation)
  | { readonly kind: "notFound" };

const detailTab = (search: string, defaultTab: TaskDetailTab): TaskDetailTab | null => {
  const values = new URLSearchParams(search).getAll("tab");
  if (values.length === 0) return defaultTab;
  return values.length === 1 && (values[0] === "overview" || values[0] === "attachments") ? values[0] : null;
};

export const parseRoute = (pathname: string, search = ""): Route => {
  if (pathname === "/") return { kind: "projects" };
  const task = /^\/projects\/([^/]+)\/tasks\/([^/]+)(?:\/attachments\/(.+))?$/.exec(pathname);
  if (task !== null) {
    try {
      const projectId = canonicalId(decodeURIComponent(task[1]!));
      const taskId = canonicalId(decodeURIComponent(task[2]!));
      const file = task[3];
      const tab = detailTab(search, file === undefined ? "overview" : "attachments");
      if (projectId === null || taskId === null || tab === null) return { kind: "notFound" };
      if (file === undefined) return { kind: "task", projectId, taskId, tab, path: null };
      const segments = file.split('/').map((segment) => decodeURIComponent(segment));
      const path = segments.join('/');
      if (segments.some((segment) => segment.includes('/')) || !isAttachmentPath(path)) return { kind: "notFound" };
      return { kind: "attachment", projectId, taskId, path, tab };
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

export const taskDetailUrl = (projectId: string, taskId: string, navigation: TaskDetailNavigation): string => {
  if (canonicalId(projectId) === null || canonicalId(taskId) === null) throw new ApiError("protocol");
  const base = navigation.path === null
    ? `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
    : attachmentPageUrl(projectId, taskId, navigation.path);
  const defaultTab = navigation.path === null ? "overview" : "attachments";
  return navigation.tab === defaultTab ? base : `${base}?tab=${navigation.tab}`;
};

export const navigate = (to: string): void => {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export const navigateTaskDetail = (projectId: string, taskId: string, selection: TaskDetailNavigation): void => {
  const current = parseRoute(window.location.pathname, window.location.search);
  if ((current.kind === 'task' || current.kind === 'attachment') && current.projectId === projectId && current.taskId === taskId && current.tab === selection.tab && current.path === selection.path) return;
  navigate(taskDetailUrl(projectId, taskId, selection));
};
