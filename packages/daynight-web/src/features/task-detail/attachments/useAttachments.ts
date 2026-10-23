import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, checkAttachmentPreview, isAbortError, listAttachments, putAttachment, readAttachmentText, removeAttachment } from "../../../api/client";
import type { Attachment } from "../../../api/types";
import { attachmentKind, attachmentTree } from "./model";

export type AttachmentApi = {
  readonly list: typeof listAttachments;
  readonly put: typeof putAttachment;
  readonly remove: typeof removeAttachment;
  readonly readText: typeof readAttachmentText;
  readonly checkPreview: typeof checkAttachmentPreview;
};

export const attachmentApi: AttachmentApi = { list: listAttachments, put: putAttachment, remove: removeAttachment, readText: readAttachmentText, checkPreview: checkAttachmentPreview };

type ListState = {
  readonly scope: string;
  readonly items: readonly Attachment[];
  readonly loading: boolean;
  readonly complete: boolean;
  readonly error: unknown;
};
type PreviewState = {
  readonly scope: string;
  readonly path: string | null;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly text: string | null;
  readonly error: unknown;
};
type WriteState = { readonly scope: string; readonly status: "idle" | "saving" | "deleting"; readonly error: unknown };
const initialList = (scope: string): ListState => ({ scope, items: [], loading: true, complete: false, error: null });
const initialPreview = (scope: string, path: string | null): PreviewState => ({ scope, path, status: path === null ? "idle" : "loading", text: null, error: null });

export const useAttachments = (projectId: string, taskId: string, api: AttachmentApi = attachmentApi) => {
  const scope = `${projectId}/${taskId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [list, setList] = useState(() => initialList(scope));
  const [selection, setSelection] = useState<{ readonly scope: string; readonly path: string | null }>({ scope, path: null });
  const [preview, setPreview] = useState(() => initialPreview(scope, null));
  const [previewRevision, setPreviewRevision] = useState(0);
  const [write, setWrite] = useState<WriteState>({ scope, status: "idle", error: null });
  const listRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const listGeneration = useRef(0);
  const writeGeneration = useRef(0);

  const reload = useCallback(() => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    const generation = ++listGeneration.current;
    const owns = () => !controller.signal.aborted && generation === listGeneration.current && currentScope.current === scope;
    setList((prior) => ({ ...(prior.scope === scope ? prior : initialList(scope)), loading: true, complete: false, error: null }));
    void (async () => {
      const items: Attachment[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      try {
        do {
          const page = await api.list(projectId, taskId, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }, controller.signal);
          if (!owns()) return;
          items.push(...page.items);
          attachmentTree(items);
          if (page.nextCursor !== null && cursors.has(page.nextCursor)) throw new ApiError("protocol");
          if (page.nextCursor !== null) cursors.add(page.nextCursor);
          cursor = page.nextCursor === null ? undefined : page.nextCursor;
          setList({ scope, items: [...items], loading: cursor !== undefined, complete: cursor === undefined, error: null });
        } while (cursor !== undefined);
      } catch (error) {
        if (!owns() || isAbortError(error)) return;
        setList((prior) => ({ ...prior, loading: false, complete: false, error }));
      } finally {
        if (generation === listGeneration.current) listRequest.current = null;
      }
    })();
  }, [api, projectId, taskId, scope]);

  useEffect(() => {
    reload();
    return () => {
      ++listGeneration.current;
      ++writeGeneration.current;
      listRequest.current?.abort();
      writeRequest.current?.abort();
      listRequest.current = null;
      writeRequest.current = null;
    };
  }, [reload]);

  const selectedPath = selection.scope === scope ? selection.path : null;
  const visibleList = list.scope === scope ? list : initialList(scope);
  const selected = visibleList.items.find((item) => item.path === selectedPath);
  const selectedKind = selected === undefined ? undefined : attachmentKind(selected);
  const selectedUpdatedAt = selected?.updatedAt;
  useEffect(() => {
    const controller = new AbortController();
    const path = selectedPath;
    setPreview(initialPreview(scope, path));
    if (path === null) return () => controller.abort();
    const usesText = selectedKind === "text" || selectedKind === "markdown";
    if (!usesText && selectedKind !== "html" && selectedKind !== "pdf") {
      setPreview({ scope, path, status: "ready", text: null, error: null });
      return () => controller.abort();
    }
    void (async () => {
      try {
        const text = usesText ? await api.readText(projectId, taskId, path, controller.signal) : null;
        if (!usesText) await api.checkPreview(projectId, taskId, path, controller.signal);
        if (!controller.signal.aborted && currentScope.current === scope) setPreview({ scope, path, status: "ready", text, error: null });
      } catch (error) {
        if (!controller.signal.aborted && currentScope.current === scope && !isAbortError(error)) setPreview({ scope, path, status: "error", text: null, error });
      }
    })();
    return () => controller.abort();
  }, [api, projectId, taskId, scope, selectedPath, selectedKind, selectedUpdatedAt, previewRevision]);

  const select = useCallback((path: string | null) => setSelection({ scope, path }), [scope]);
  const retryPreview = useCallback(() => setPreviewRevision((value) => value + 1), []);
  const mutate = useCallback(async (path: string, file: File | null): Promise<boolean> => {
    if (writeRequest.current !== null) return false;
    const controller = new AbortController();
    writeRequest.current = controller;
    const generation = ++writeGeneration.current;
    const owns = () => !controller.signal.aborted && generation === writeGeneration.current && currentScope.current === scope;
    setWrite({ scope, status: file === null ? "deleting" : "saving", error: null });
    try {
      if (file === null) await api.remove(projectId, taskId, path, controller.signal);
      else await api.put(projectId, taskId, path, file, controller.signal);
      if (!owns()) return false;
      if (file !== null) setSelection({ scope, path });
      else setSelection((prior) => prior.scope === scope && prior.path === path ? { scope, path: null } : prior);
      setPreviewRevision((value) => value + 1);
      setWrite({ scope, status: "idle", error: null });
      reload();
      return true;
    } catch (error) {
      if (!owns()) return false;
      setWrite({ scope, status: "idle", error: isAbortError(error) ? null : error });
      return false;
    } finally {
      if (generation === writeGeneration.current) writeRequest.current = null;
    }
  }, [api, projectId, taskId, scope, reload]);
  const put = useCallback((path: string, file: File) => mutate(path, file), [mutate]);
  const remove = useCallback((path: string) => mutate(path, null), [mutate]);
  const visiblePreview = preview.scope === scope && preview.path === selectedPath ? preview : initialPreview(scope, selectedPath);
  const visibleWrite = write.scope === scope ? write : { scope, status: "idle" as const, error: null };
  return { ...visibleList, selectedPath, select, preview: visiblePreview, retryPreview, write: visibleWrite, put, remove, reload };
};

export type AttachmentController = ReturnType<typeof useAttachments>;
