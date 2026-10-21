import { useLayoutEffect, useRef, useState } from "react";

type Preferences = { readonly expandedRootId: string | null };
type PreferenceIssue = { readonly kind: "read" | "invalid" | "write"; readonly cause: unknown };
type InitialPreferences = {
  readonly expandedRootId: string | null | undefined;
  readonly saved: string | null;
  readonly issue: PreferenceIssue | null;
};

const readPreferences = (key: string): InitialPreferences => {
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(key);
  } catch (cause) {
    return { expandedRootId: undefined, saved: null, issue: { kind: "read", cause } };
  }
  if (saved === null) return { expandedRootId: undefined, saved, issue: null };
  try {
    const value: unknown = JSON.parse(saved);
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !("expandedRootId" in value) ||
      (value.expandedRootId !== null && (typeof value.expandedRootId !== "string" || value.expandedRootId.trim() === ""))) {
      throw new Error("Invalid project view preferences.");
    }
    return { expandedRootId: value.expandedRootId, saved, issue: null };
  } catch (cause) {
    return { expandedRootId: undefined, saved: null, issue: { kind: "invalid", cause } };
  }
};

export const projectViewPreferenceNotice = (issue: PreferenceIssue): string => {
  if (issue.kind === "read") return "无法读取浏览器保存的任务链展开状态，本次浏览仍可正常使用。";
  if (issue.kind === "invalid") return "浏览器保存的任务链展开状态无效，已使用默认状态，本次浏览仍可正常使用。";
  return "任务链展开状态无法保存到浏览器，刷新后可能无法恢复，本次浏览仍可正常使用。";
};

export const useProjectViewPreferences = (projectId: string, roots: readonly string[] | null) => {
  const key = `daynight:project-view:${projectId}`;
  const [initial] = useState(() => readPreferences(key));
  const [expanded, setExpandedRootId] = useState(initial.expandedRootId);
  const [writeIssue, setWriteIssue] = useState<PreferenceIssue | null>(null);
  const saved = useRef(initial.saved);
  const expandedRootId = roots === null || expanded === null ? null
    : expanded !== undefined && roots.includes(expanded) ? expanded : roots[0] ?? null;

  // Reconcile and save before the rendered rows can receive navigation or reload actions.
  useLayoutEffect(() => {
    if (roots === null || roots.length === 0) return;
    setExpandedRootId(expandedRootId);
    const preferences: Preferences = { expandedRootId };
    const serialized = JSON.stringify(preferences);
    if (serialized === saved.current) return;
    try {
      window.localStorage.setItem(key, serialized);
      saved.current = serialized;
      setWriteIssue(null);
    } catch (cause) {
      setWriteIssue({ kind: "write", cause });
    }
  }, [key, roots, expandedRootId]);

  return { expandedRootId, setExpandedRootId, issue: writeIssue ?? initial.issue };
};
