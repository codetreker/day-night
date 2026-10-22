import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Preferences = { readonly expandedRootId: string | null };
type PreferenceIssue = { readonly kind: "read" | "invalid" | "write"; readonly cause: unknown };
type InitialPreference<Value> = {
  readonly value: Value | undefined;
  readonly saved: string | null;
  readonly issue: PreferenceIssue | null;
};

const readPreference = <Value,>(key: string, decode: (value: unknown) => Value): InitialPreference<Value> => {
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(key);
  } catch (cause) {
    return { value: undefined, saved: null, issue: { kind: "read", cause } };
  }
  if (saved === null) return { value: undefined, saved, issue: null };
  try {
    return { value: decode(JSON.parse(saved)), saved, issue: null };
  } catch (cause) {
    return { value: undefined, saved: null, issue: { kind: "invalid", cause } };
  }
};

const expandedRootPreference = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !("expandedRootId" in value) ||
    (value.expandedRootId !== null && (typeof value.expandedRootId !== "string" || value.expandedRootId.trim() === ""))) {
    throw new Error("Invalid project view preferences.");
  }
  return value.expandedRootId;
};

const completedChainPreference = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new Error("Invalid completed chain visibility preference.");
  return value;
};

export const projectViewPreferenceNotice = (issue: PreferenceIssue): string => {
  if (issue.kind === "read") return "无法读取浏览器保存的任务链展开状态，本次浏览仍可正常使用。";
  if (issue.kind === "invalid") return "浏览器保存的任务链展开状态无效，已使用默认状态，本次浏览仍可正常使用。";
  return "任务链展开状态无法保存到浏览器，刷新后可能无法恢复，本次浏览仍可正常使用。";
};

export const completedChainPreferenceNotice = (issue: PreferenceIssue): string => {
  if (issue.kind === "read") return "无法读取浏览器保存的已完成任务链显示偏好，本次浏览仍可正常使用。";
  if (issue.kind === "invalid") return "浏览器保存的已完成任务链显示偏好无效，已默认隐藏，本次浏览仍可正常使用。";
  return "已完成任务链显示偏好无法保存到浏览器，刷新后可能无法恢复，本次浏览仍可正常使用。";
};

export const useCompletedChainVisibility = (projectId: string) => {
  const key = `daynight:completed-chains:${projectId}`;
  const [initial] = useState(() => readPreference(key, completedChainPreference));
  const [showCompleted, setShowCompleted] = useState(initial.value ?? false);
  const [writeIssue, setWriteIssue] = useState<PreferenceIssue | null>(null);
  const onShowCompletedChange = useCallback((show: boolean) => {
    setShowCompleted(show);
    try {
      window.localStorage.setItem(key, JSON.stringify(show));
      setWriteIssue(null);
    } catch (cause) {
      setWriteIssue({ kind: "write", cause });
    }
  }, [key]);
  return { showCompleted, onShowCompletedChange, issue: writeIssue ?? initial.issue };
};

export const useProjectViewPreferences = (projectId: string, roots: readonly string[] | null) => {
  const key = `daynight:project-view:${projectId}`;
  const [initial] = useState(() => readPreference(key, expandedRootPreference));
  const [expanded, setExpandedRootId] = useState(initial.value);
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

export type TaskView = "standalone" | "chains";
type ScrollPositions = Readonly<Record<TaskView, number>>;

const taskViewPreference = (value: unknown): TaskView => {
  if (value !== "standalone" && value !== "chains") throw new Error("Invalid project task view preference.");
  return value;
};

const scrollPreference = (value: unknown): ScrollPositions => {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 2 ||
    !("chains" in value) || !("standalone" in value) || typeof value.chains !== "number" || typeof value.standalone !== "number" ||
    !Number.isFinite(value.chains) || !Number.isFinite(value.standalone) || value.chains < 0 || value.standalone < 0) {
    throw new Error("Invalid project task view scroll positions.");
  }
  return { chains: value.chains, standalone: value.standalone };
};

export const taskViewPreferenceNotice = (issue: PreferenceIssue): string => {
  if (issue.kind === "read") return "无法读取浏览器保存的任务页签，本次浏览仍可正常使用。";
  if (issue.kind === "invalid") return "浏览器保存的任务页签无效，已默认显示任务链，本次浏览仍可正常使用。";
  return "任务页签无法保存到浏览器，刷新后可能无法恢复，本次浏览仍可正常使用。";
};

export const standaloneVisibilityNotice = (issue: PreferenceIssue): string => {
  if (issue.kind === "read") return "无法读取浏览器保存的已完成独立任务显示偏好，本次浏览仍可正常使用。";
  if (issue.kind === "invalid") return "浏览器保存的已完成独立任务显示偏好无效，已默认隐藏，本次浏览仍可正常使用。";
  return "已完成独立任务显示偏好无法保存到浏览器，刷新后可能无法恢复，本次浏览仍可正常使用。";
};

export const taskViewScrollNotice = (issue: PreferenceIssue): string => {
  if (issue.kind === "read") return "无法读取浏览器保存的任务浏览位置，本次浏览仍可正常使用。";
  if (issue.kind === "invalid") return "浏览器保存的任务浏览位置无效，已从顶部开始，本次浏览仍可正常使用。";
  return "任务浏览位置无法保存到浏览器，刷新后可能无法恢复，本次浏览仍可正常使用。";
};

const useNamedPreference = <Value,>(key: string, decode: (value: unknown) => Value, defaultValue: Value) => {
  const [initial] = useState(() => readPreference(key, decode));
  const [value, setValue] = useState(initial.value === undefined ? defaultValue : initial.value);
  const [writeIssue, setWriteIssue] = useState<PreferenceIssue | null>(null);
  const save = useCallback((next: Value) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      setWriteIssue(null);
    } catch (cause) {
      setWriteIssue({ kind: "write", cause });
    }
  }, [key]);
  return { value, save, issue: writeIssue ?? initial.issue };
};

export const useStandaloneVisibility = (projectId: string) => {
  const { value, save, issue } = useNamedPreference(`daynight:completed-standalone-tasks:${projectId}`, completedChainPreference, false);
  return { showCompleted: value, onShowCompletedChange: save, issue };
};

export const useTaskView = (projectId: string) => {
  const { value, save, issue } = useNamedPreference(`daynight:task-view:${projectId}`, taskViewPreference, "chains");
  return { activeView: value, onViewChange: save, issue };
};

export const useTaskViewScroll = (projectId: string, activeView: TaskView, ready: boolean) => {
  const key = `daynight:task-view-scroll:${projectId}`;
  const [initial] = useState(() => readPreference(key, scrollPreference));
  const positions = useRef<ScrollPositions>(initial.value === undefined ? { chains: 0, standalone: 0 } : initial.value);
  const [writeIssue, setWriteIssue] = useState<PreferenceIssue | null>(null);
  const savePosition = useCallback(() => {
    const next = { ...positions.current, [activeView]: window.scrollY };
    if (next[activeView] === positions.current[activeView]) return;
    positions.current = next;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      setWriteIssue(null);
    } catch (cause) {
      setWriteIssue({ kind: "write", cause });
    }
  }, [key, activeView]);

  useLayoutEffect(() => {
    if (ready) window.scrollTo({ top: positions.current[activeView], behavior: "instant" });
  }, [ready, activeView]);

  useEffect(() => {
    if (!ready) return;
    window.addEventListener("scroll", savePosition, { passive: true });
    window.addEventListener("pagehide", savePosition);
    return () => {
      window.removeEventListener("scroll", savePosition);
      window.removeEventListener("pagehide", savePosition);
    };
  }, [ready, savePosition]);

  return { savePosition, issue: writeIssue ?? initial.issue };
};
