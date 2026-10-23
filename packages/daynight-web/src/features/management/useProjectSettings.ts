import { useEffect, useRef, useState } from "react";
import { listMembers, type ProjectRole } from "../../api/auth";
import { ApiError, isAbortError } from "../../api/client";
import { getProject, isExecutionWarningMinutes, saveProjectSettings } from "../../api/project-settings";
import type { Project } from "../../api/types";

export type SettingsNotice = "saved" | "cancelled" | "conflict" | "permission" | "reconciled" | null;
export const parseWarningDraft = (draft: string): number | null => {
  if (!/^[0-9]+$/.test(draft)) return null;
  const minutes = Number(draft);
  return isExecutionWarningMinutes(minutes) ? minutes : null;
};

export const useProjectSettings = (projectId: string, userId: string) => {
  const [project, setProject] = useState<Project | null>(null);
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const [notice, setNotice] = useState<SettingsNotice>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const submitting = useRef(false);

  const clearPrivate = () => { setProject(null); setRole(null); setDraft(""); setUncertain(false); setUnavailable(true); };
  const load = async (signal: AbortSignal, nextNotice: SettingsNotice = null) => {
    const current = ++generation.current;
    setLoading(true); setRole(null); setError(null);
    try {
      const [saved, members] = await Promise.all([getProject(projectId, signal), listMembers(projectId, signal)]);
      if (signal.aborted || current !== generation.current) return;
      const self = members.find((member) => member.userId === userId);
      if (self === undefined) { clearPrivate(); return; }
      setProject(saved); setRole(self.role); setDraft(String(saved.settings.executionWarningMinutes));
      setUnavailable(false); setUncertain(false); setInvalid(false); setNotice(nextNotice);
    } catch (failure) {
      if (signal.aborted || current !== generation.current || isAbortError(failure)) return;
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 403)) clearPrivate();
      else setError(failure);
    } finally { if (!signal.aborted && current === generation.current) setLoading(false); }
  };

  useEffect(() => {
    const active = new AbortController(); controller.current = active;
    void load(active.signal);
    return () => { active.abort(); ++generation.current; };
  }, [projectId, userId]);

  const save = async () => {
    if (submitting.current || loading || uncertain || role !== "admin" || project === null) return;
    const minutes = parseWarningDraft(draft);
    if (minutes === null) { setInvalid(true); return; }
    submitting.current = true; setPending(true); setError(null); setNotice(null); setInvalid(false);
    const signal = controller.current!.signal;
    try {
      const saved = await saveProjectSettings(projectId, { version: project.settings.version, executionWarningMinutes: minutes }, signal);
      if (signal.aborted) return;
      setProject(saved); setDraft(String(saved.settings.executionWarningMinutes)); setNotice("saved");
    } catch (failure) {
      if (signal.aborted || isAbortError(failure)) return;
      if (failure instanceof ApiError && failure.kind === "server" && failure.status === 404) clearPrivate();
      else if (failure instanceof ApiError && failure.kind === "server" && (failure.status === 409 || failure.status === 403)) {
        await load(signal, failure.status === 409 ? "conflict" : "permission");
      } else if (failure instanceof ApiError && failure.kind === "server" && failure.status !== null && failure.status >= 400 && failure.status < 500) setError(failure);
      else {
        // A missing success response cannot prove whether the transaction committed.
        setUncertain(true);
        await load(signal, "reconciled");
      }
    } finally { if (!signal.aborted) { submitting.current = false; setPending(false); } }
  };

  return {
    project, role, draft, loading, pending, unavailable, uncertain, error, invalid, notice,
    dirty: project !== null && draft !== String(project.settings.executionWarningMinutes),
    change: (value: string) => { setDraft(value); setInvalid(false); setNotice(null); setError(null); },
    cancel: () => { if (project !== null && !pending && !uncertain) { setDraft(String(project.settings.executionWarningMinutes)); setInvalid(false); setError(null); setNotice("cancelled"); } },
    retry: () => { if (!submitting.current) void load(controller.current!.signal, uncertain ? "reconciled" : null); },
    save,
  };
};
